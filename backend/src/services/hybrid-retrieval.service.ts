/**
 * Hybrid Retrieval Service
 *
 * Orkestrerer hybrid søk: kjører Pinecone vektorsøk og BM25 keyword-søk
 * parallelt, fusjonerer resultatene med Reciprocal Rank Fusion (RRF),
 * og reranker de fusjonerte resultatene med Cohere Rerank API.
 *
 * Fallback-strategi:
 *   - Pinecone feiler → bruker kun BM25-resultater
 *   - BM25 feiler → bruker kun Pinecone-resultater
 *   - Cohere feiler → returnerer RRF-fusjonerte resultater uten reranking
 *   - Begge søk feiler → returnerer tomt med degraded=true
 */

import { logger } from "../utils/logger.js";
import { vectorSearch, type VectorSearchResult } from "./embedding.service.js";
import { bm25Search, type BM25Result } from "./bm25.service.js";
import {
  cohereRerank,
  isCohereConfigured,
  type RerankDocument,
} from "./cohere-rerank.service.js";

// ─── Konfigurasjon ─────────────────────────────────────────

/** RRF-konstant (typisk 60) — demper rankeringsforskjeller */
const RRF_K = 60;

/** Antall resultater fra hvert søkesystem (overhent for bedre RRF-fusjon) */
const PER_SOURCE_LIMIT = 15;

/** Endelig antall resultater etter reranking */
const FINAL_TOP_N = 8;

/** Maks antall parallelle begrep-søk ved multi-concept splitting */
const MAX_CONCEPT_SPLITS = 3;

/** Minimumslengde for et begrep som skal gi eget søk */
const MIN_CONCEPT_LENGTH = 4;

// ─── Multi-concept splitting ───────────────────────────────

/**
 * Splitter en spørring i distinkte begreper for parallelle søk.
 * Returnerer null hvis spørringen ikke bør splittes (kun ett begrep).
 *
 * Splitter på:
 * - "og", "and", "&" mellom begreper
 * - Komma og semikolon
 * - "forskjellen mellom X og Y"
 * - "hva er X, Y og Z"
 */
function splitQueryIntoConcepts(query: string): string[] | null {
  const trimmed = query.trim().toLowerCase();

  // Sjekk om spørringen inneholder splitt-mønstre
  const hasAndPattern = /\b(og|and)\b/.test(trimmed);
  const hasComma = trimmed.includes(",");
  const hasSemicolon = trimmed.includes(";");
  const hasAmpersand = trimmed.includes("&");

  if (!hasAndPattern && !hasComma && !hasSemicolon && !hasAmpersand) {
    return null; // Ingen splitting nødvendig
  }

  // Fjern vanlige spørsmålsord og -fraser først
  let cleaned = trimmed
    .replace(/^(forklar|hva er|beskriv|definer|sammenlign|fortell om)\s+/i, "")
    .replace(/\?$/, "")
    .trim();

  // Splitt på "og", "and", ",", ";", "&"
  const splitPattern = /\s*(?:,|;|\s+og\s+|\s+and\s+|&)\s*/;
  const parts = cleaned.split(splitPattern).filter((part) => {
    const cleanPart = part.trim();
    // Filtrer bort korte ord og stoppord
    return cleanPart.length >= MIN_CONCEPT_LENGTH &&
           !["forskjellen", "mellom", "begrepene", "konseptene", "dette", "disse"].includes(cleanPart);
  });

  // Trenger minst 2 begreper for å splitte
  if (parts.length < 2) {
    return null;
  }

  // Begrens antall splits
  return parts.slice(0, MAX_CONCEPT_SPLITS);
}

// ─── Typer ─────────────────────────────────────────────────

export interface HybridSearchResult {
  text: string;
  score: number;
  source: {
    courseId: string;
    courseName: string;
    moduleTitle: string;
    fileName: string;
    fileId: number;
  };
  chunkIndex: number;
}

export interface HybridSearchResponse {
  results: HybridSearchResult[];
  /** true hvis minst ett søkesystem feilet (delvis eller full degradering) */
  degraded: boolean;
  /** Hvilke kilder som bidro til resultatet */
  sources: {
    vector: boolean;
    bm25: boolean;
    reranked: boolean;
  };
}

// ─── Intern: RRF-fusjon ────────────────────────────────────

interface FusedDoc {
  /** Unik nøkkel for deduplisering */
  key: string;
  text: string;
  rrfScore: number;
  source: HybridSearchResult["source"];
  chunkIndex: number;
  /** MongoDB _id (for Cohere-mapping) */
  docId?: string;
}

/**
 * Reciprocal Rank Fusion: fusjonerer to rangerte lister.
 * RRF-score = Σ 1/(k + rank_i) for alle lister dokumentet finnes i.
 */
function reciprocalRankFusion(
  vectorResults: VectorSearchResult[],
  bm25Results: BM25Result[],
): FusedDoc[] {
  const docMap = new Map<string, FusedDoc>();

  // Prosesser vektorsøk-resultater
  for (let i = 0; i < vectorResults.length; i++) {
    const r = vectorResults[i];
    const key = `${r.source.courseId}:${r.source.fileId}:${r.chunkIndex}`;
    const rrfScore = 1 / (RRF_K + i + 1);
    const existing = docMap.get(key);
    if (existing) {
      existing.rrfScore += rrfScore;
    } else {
      docMap.set(key, {
        key,
        text: r.text,
        rrfScore,
        source: r.source,
        chunkIndex: r.chunkIndex,
      });
    }
  }

  // Prosesser BM25-resultater
  for (let i = 0; i < bm25Results.length; i++) {
    const r = bm25Results[i];
    const key = `${r.source.courseId}:${r.source.fileId}:${r.chunkIndex}`;
    const rrfScore = 1 / (RRF_K + i + 1);
    const existing = docMap.get(key);
    if (existing) {
      existing.rrfScore += rrfScore;
      // Behold docId fra BM25 hvis vi ikke har det
      if (!existing.docId) existing.docId = r.docId;
    } else {
      docMap.set(key, {
        key,
        text: r.text,
        rrfScore,
        source: r.source,
        chunkIndex: r.chunkIndex,
        docId: r.docId,
      });
    }
  }

  // Sorter etter fusjonert RRF-score
  return Array.from(docMap.values()).sort((a, b) => b.rrfScore - a.rrfScore);
}

// ─── Eksportert funksjon ───────────────────────────────────

/**
 * Utfører parallelle søk for en enkelt query.
 * Intern hjelpefunksjon for hybridSearch.
 */
async function singleConceptSearch(
  userId: string,
  query: string,
  options?: {
    courseIds?: string[];
    limit?: number;
  },
): Promise<{
  vectorResults: VectorSearchResult[];
  bm25Results: BM25Result[];
  degraded: boolean;
}> {
  const [vectorResponse, bm25Response] = await Promise.all([
    vectorSearch(userId, query, {
      limit: options?.limit ?? PER_SOURCE_LIMIT,
      courseIds: options?.courseIds,
    }),
    bm25Search(userId, query, {
      limit: options?.limit ?? PER_SOURCE_LIMIT,
      courseIds: options?.courseIds,
    }),
  ]);

  return {
    vectorResults: vectorResponse.results,
    bm25Results: bm25Response.results,
    degraded: vectorResponse.degraded,
  };
}

/**
 * Utfører hybrid søk: Pinecone (semantisk) + BM25 (keyword) → RRF → Cohere Rerank.
 *
 * Støtter multi-concept queries: Når spørringen inneholder flere distinkte
 * begreper (f.eks. "reliabilitet og validitet"), kjøres parallelle søk for
 * hvert begrep og resultatene merges før RRF-fusjon.
 *
 * @param userId - Brukerens lokale ID
 * @param query - Brukerens søketekst
 * @param options - Valgfrie filtere og konfigurasjonsoverstyrelser
 */
export async function hybridSearch(
  userId: string,
  query: string,
  options?: {
    courseIds?: string[];
    topN?: number;
  },
): Promise<HybridSearchResponse> {
  const trimmedQuery = query?.trim();
  if (!trimmedQuery) {
    return { results: [], degraded: false, sources: { vector: false, bm25: false, reranked: false } };
  }

  const topN = options?.topN ?? FINAL_TOP_N;
  const startTime = Date.now();

  // ── Trinn 0: Sjekk om query bør splittes i flere begreper ──
  const concepts = splitQueryIntoConcepts(trimmedQuery);
  const isMultiConcept = concepts !== null && concepts.length > 1;

  let allVectorResults: VectorSearchResult[] = [];
  let allBm25Results: BM25Result[] = [];
  let anyDegraded = false;

  if (isMultiConcept) {
    // Multi-concept: kjør parallelle søk for hvert begrep
    logger.info(
      { userId, concepts, originalQuery: trimmedQuery.substring(0, 100) },
      "Multi-concept søk: splitter query i parallelle søk",
    );

    // Også kjør et søk på hele query for å fange opp sammenheng
    const searchPromises = [
      singleConceptSearch(userId, trimmedQuery, {
        courseIds: options?.courseIds,
        limit: Math.ceil(PER_SOURCE_LIMIT / 2),
      }),
      ...concepts.map((concept) =>
        singleConceptSearch(userId, concept, {
          courseIds: options?.courseIds,
          limit: Math.ceil(PER_SOURCE_LIMIT / concepts.length),
        }),
      ),
    ];

    const searchResults = await Promise.all(searchPromises);

    // Merge resultater fra alle søk
    for (const result of searchResults) {
      allVectorResults.push(...result.vectorResults);
      allBm25Results.push(...result.bm25Results);
      if (result.degraded) anyDegraded = true;
    }

    // Dedupliser basert på chunk-nøkkel (courseId:fileId:chunkIndex)
    const seenVector = new Set<string>();
    allVectorResults = allVectorResults.filter((r) => {
      const key = `${r.source.courseId}:${r.source.fileId}:${r.chunkIndex}`;
      if (seenVector.has(key)) return false;
      seenVector.add(key);
      return true;
    });

    const seenBm25 = new Set<string>();
    allBm25Results = allBm25Results.filter((r) => {
      const key = `${r.source.courseId}:${r.source.fileId}:${r.chunkIndex}`;
      if (seenBm25.has(key)) return false;
      seenBm25.add(key);
      return true;
    });

    logger.info(
      {
        userId,
        conceptCount: concepts.length,
        mergedVectorCount: allVectorResults.length,
        mergedBm25Count: allBm25Results.length,
      },
      "Multi-concept søk: resultater merget",
    );
  } else {
    // Single concept: standard søk
    const result = await singleConceptSearch(userId, trimmedQuery, {
      courseIds: options?.courseIds,
    });
    allVectorResults = result.vectorResults;
    allBm25Results = result.bm25Results;
    anyDegraded = result.degraded;
  }

  const hasVector = allVectorResults.length > 0;
  const hasBm25 = allBm25Results.length > 0;

  // Begge feilet / tomt
  if (!hasVector && !hasBm25) {
    logger.info(
      { userId, degraded: anyDegraded, isMultiConcept },
      "Hybrid søk: ingen resultater fra verken vektor- eller BM25-søk",
    );
    return {
      results: [],
      degraded: anyDegraded,
      sources: { vector: false, bm25: false, reranked: false },
    };
  }

  // ── Trinn 2: RRF-fusjon ──
  const fused = reciprocalRankFusion(allVectorResults, allBm25Results);

  // ── Trinn 3: Cohere Rerank ──
  // For multi-concept queries, rerank mot hele originalspørringen for best sammenheng
  const rerankQuery = trimmedQuery;
  let finalResults: HybridSearchResult[];
  let wasReranked = false;

  if (isCohereConfigured() && fused.length > 1) {
    const rerankInput: RerankDocument[] = fused.map((doc) => ({
      docId: doc.docId ?? doc.key,
      text: doc.text,
      originalScore: doc.rrfScore,
      meta: {
        source: doc.source,
        chunkIndex: doc.chunkIndex,
      },
    }));

    const reranked = await cohereRerank(rerankQuery, rerankInput, topN);

    finalResults = reranked.map((r) => {
      const meta = r.meta as { source: HybridSearchResult["source"]; chunkIndex: number };
      return {
        text: r.text,
        score: r.relevanceScore,
        source: meta.source,
        chunkIndex: meta.chunkIndex,
      };
    });
    wasReranked = finalResults.length > 0;
  } else {
    // Uten Cohere: bruk RRF-scorer direkte
    finalResults = fused.slice(0, topN).map((doc) => ({
      text: doc.text,
      score: doc.rrfScore,
      source: doc.source,
      chunkIndex: doc.chunkIndex,
    }));
  }

  logger.info(
    {
      userId,
      vectorCount: allVectorResults.length,
      bm25Count: allBm25Results.length,
      fusedCount: fused.length,
      finalCount: finalResults.length,
      reranked: wasReranked,
      isMultiConcept,
      elapsedMs: Date.now() - startTime,
    },
    "Hybrid søk fullført",
  );

  return {
    results: finalResults,
    degraded: anyDegraded,
    sources: {
      vector: hasVector,
      bm25: hasBm25,
      reranked: wasReranked,
    },
  };
}
