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
  /** true hvis begge søkesystemer feilet */
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
 * Utfører hybrid søk: Pinecone (semantisk) + BM25 (keyword) → RRF → Cohere Rerank.
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

  // ── Trinn 1: Parallelt søk ──
  const [vectorResponse, bm25Response] = await Promise.all([
    vectorSearch(userId, trimmedQuery, {
      limit: PER_SOURCE_LIMIT,
      courseIds: options?.courseIds,
    }),
    bm25Search(userId, trimmedQuery, {
      limit: PER_SOURCE_LIMIT,
      courseIds: options?.courseIds,
    }),
  ]);

  const hasVector = vectorResponse.results.length > 0;
  const hasBm25 = bm25Response.results.length > 0;

  // Begge feilet / tomt
  if (!hasVector && !hasBm25) {
    logger.info(
      { userId, degraded: vectorResponse.degraded },
      "Hybrid søk: ingen resultater fra verken vektor- eller BM25-søk",
    );
    return {
      results: [],
      degraded: vectorResponse.degraded,
      sources: { vector: false, bm25: false, reranked: false },
    };
  }

  // ── Trinn 2: RRF-fusjon ──
  const fused = reciprocalRankFusion(vectorResponse.results, bm25Response.results);

  // ── Trinn 3: Cohere Rerank ──
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

    const reranked = await cohereRerank(trimmedQuery, rerankInput, topN);

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
      vectorCount: vectorResponse.results.length,
      bm25Count: bm25Response.results.length,
      fusedCount: fused.length,
      finalCount: finalResults.length,
      reranked: wasReranked,
      elapsedMs: Date.now() - startTime,
    },
    "Hybrid søk fullført",
  );

  return {
    results: finalResults,
    degraded: false,
    sources: {
      vector: hasVector,
      bm25: hasBm25,
      reranked: wasReranked,
    },
  };
}
