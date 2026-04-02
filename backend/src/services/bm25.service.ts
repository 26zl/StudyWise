/**
 * BM25 Search Service
 *
 * Implementerer BM25 (Okapi BM25) keyword-scoring mot chunks lagret i
 * MongoDB (ContentEmbedding). Kjøres parallelt med Pinecone vektorsøk
 * og fusjoneres via RRF i hybrid-retrieval.service.ts.
 *
 * Flyt:
 *   1. Henter kandidat-chunks fra MongoDB (filtrert på userId + evt. courseIds)
 *   2. Trekker ut søketermer (via semantic-search.service extractSearchTerms)
 *   3. Beregner IDF over hele korpuset
 *   4. Scorer hver chunk med BM25-formelen
 *   5. Returnerer topp-K resultater sortert etter score
 */

import { logger } from "../utils/logger.js";
import { ContentEmbedding } from "../database/models/ContentEmbedding.js";
import { extractSearchTerms } from "./semantic-search.service.js";

// ─── BM25-parametre ────────────────────────────────────────

/** Term-frekvens metning — høyere verdi → TF-boost flater ut saktere */
const K1 = 1.2;

/** Dokumentlengde-normalisering — 0 = ingen normalisering, 1 = full */
const B = 0.75;

/** Maks antall chunks å hente fra MongoDB for scoring */
const MAX_CANDIDATE_CHUNKS = 2000;

// ─── Typer ─────────────────────────────────────────────────

export interface BM25Result {
  /** MongoDB _id som streng */
  docId: string;
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

export interface BM25SearchResponse {
  results: BM25Result[];
}

// ─── Intern hjelpefunksjon ─────────────────────────────────

interface DocCandidate {
  _id: string;
  text: string;
  /** Forhåndsberegnet lowercase av text — unngår gjentatte toLowerCase-kall */
  textLower: string;
  courseId: string;
  courseName: string;
  moduleTitle: string;
  fileName: string;
  fileId: number;
  chunkIndex: number;
  tokenCount: number;
}

/**
 * Beregner BM25-score for et sett dokumenter gitt søketermer.
 */
function beregnBM25Scorer(docs: DocCandidate[], termer: string[]): Map<string, number> {
  const n = docs.length;
  if (n === 0 || termer.length === 0) return new Map();

  // Gjennomsnittlig dokumentlengde (i tokens)
  const avgDl = docs.reduce((sum, d) => sum + (d.tokenCount || d.text.length / 4), 0) / n;

  // Forhåndsberegn IDF per term
  const idf = new Map<string, number>();
  for (const term of termer) {
    let df = 0;
    for (const doc of docs) {
      if (doc.textLower.includes(term)) {
        df++;
      }
    }
    // BM25 IDF: log((N - df + 0.5) / (df + 0.5) + 1)
    const idfValue = Math.log((n - df + 0.5) / (df + 0.5) + 1);
    idf.set(term, idfValue);
  }

  // Score per dokument
  const scorer = new Map<string, number>();
  for (const doc of docs) {
    const docLower = doc.textLower;
    const dl = doc.tokenCount || doc.text.length / 4;
    let score = 0;

    for (const term of termer) {
      // Tell term-frekvens
      let tf = 0;
      let pos = 0;
      while (pos < docLower.length) {
        const idx = docLower.indexOf(term, pos);
        if (idx === -1) break;
        tf++;
        pos = idx + term.length;
      }

      if (tf === 0) continue;

      const termIdf = idf.get(term) ?? 0;
      // BM25 TF-komponent: (tf * (k1 + 1)) / (tf + k1 * (1 - b + b * dl/avgdl))
      const tfNorm = (tf * (K1 + 1)) / (tf + K1 * (1 - B + B * (dl / avgDl)));
      score += termIdf * tfNorm;
    }

    if (score > 0) {
      scorer.set(doc._id, score);
    }
  }

  return scorer;
}

// ─── Eksportert funksjon ───────────────────────────────────

/**
 * Søker i MongoDB ContentEmbedding med BM25-scoring.
 *
 * @param userId - Brukerens lokale ID
 * @param query - Brukerens søketekst
 * @param options - Valgfrie filtere
 * @returns BM25-resultater sortert etter score (topp-K)
 */
export async function bm25Search(
  userId: string,
  query: string,
  options?: {
    limit?: number;
    courseIds?: string[];
  },
): Promise<BM25SearchResponse> {
  const trimmedQuery = query?.trim();
  if (!trimmedQuery) return { results: [] };

  const termer = extractSearchTerms(trimmedQuery);
  if (termer.length === 0) return { results: [] };

  const limit = options?.limit ?? 15;

  try {
    // Bygg MongoDB-filter (ekskluder syntetiske fulltekst-rader med chunkIndex=-1)
    const filter: Record<string, unknown> = { userId, chunkIndex: { $gte: 0 } };
    if (options?.courseIds && options.courseIds.length > 0) {
      filter.courseId = { $in: options.courseIds };
    }

    // Hent kandidat-chunks fra MongoDB (sortert for deterministisk utvalg)
    const docs = await ContentEmbedding.find(filter, {
      _id: 1,
      text: 1,
      courseId: 1,
      courseName: 1,
      moduleTitle: 1,
      fileName: 1,
      fileId: 1,
      chunkIndex: 1,
      tokenCount: 1,
    })
      .sort({ _id: 1 })
      .limit(MAX_CANDIDATE_CHUNKS)
      .lean();

    if (docs.length === 0) return { results: [] };

    const candidates: DocCandidate[] = docs.map((d) => ({
      _id: d._id.toString(),
      text: d.text,
      textLower: d.text.toLowerCase(),
      courseId: d.courseId,
      courseName: d.courseName,
      moduleTitle: d.moduleTitle,
      fileName: d.fileName,
      fileId: d.fileId,
      chunkIndex: d.chunkIndex,
      tokenCount: d.tokenCount,
    }));

    // Beregn BM25
    const scorer = beregnBM25Scorer(candidates, termer);

    // Sorter og returner topp-K
    const scored = candidates
      .filter((d) => scorer.has(d._id))
      .map((d) => ({
        docId: d._id,
        text: d.text,
        score: scorer.get(d._id)!,
        source: {
          courseId: d.courseId,
          courseName: d.courseName,
          moduleTitle: d.moduleTitle,
          fileName: d.fileName,
          fileId: d.fileId,
        },
        chunkIndex: d.chunkIndex,
      }))
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);

    logger.info(
      {
        userId,
        termer: termer.length,
        kandidater: candidates.length,
        treff: scored.length,
        topScore: scored[0]?.score.toFixed(3),
      },
      "BM25-søk fullført",
    );

    return { results: scored };
  } catch (error) {
    logger.warn({ err: error, userId }, "BM25-søk feilet");
    return { results: [] };
  }
}
