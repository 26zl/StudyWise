/**
 * Cohere Rerank Service
 *
 * Kaller Cohere Rerank API (rerank-v3.5) for å reranke fusjonerte søkeresultater.
 * Brukes som siste trinn i hybrid retrieval-pipelinen etter RRF-fusjon.
 *
 * Oppfører seg gracefully: hvis Cohere er utilgjengelig eller nøkkelen mangler,
 * returneres inndataene uendret (passthrough).
 */

import { logger } from "../utils/logger.js";
import { CircuitBreaker } from "../utils/circuitBreaker.js";

// ─── Konfigurasjon ─────────────────────────────────────────

const COHERE_API_KEY = process.env.COHERE_API_KEY?.trim();
const COHERE_RERANK_MODEL = "rerank-v3.5";
/** Stabil Cohere v2 endepunkt — hardkodet fordi URL-en er fast og versjonert. */
const COHERE_RERANK_URL = "https://api.cohere.com/v2/rerank";

/** Timeout for Cohere API-kall (ms) */
const COHERE_TIMEOUT_MS = 8_000;

// ─── Circuit breaker ───────────────────────────────────────

const cohereCircuit = new CircuitBreaker("Cohere Rerank", {
  failureThreshold: 3,
  resetTimeoutMs: 60_000,
});

// ─── Typer ─────────────────────────────────────────────────

export interface RerankDocument {
  /** Identifikator for dokumentet (f.eks. MongoDB _id) */
  docId: string;
  text: string;
  /** Original score (fra RRF-fusjon) */
  originalScore: number;
  /** Vilkårlig metadata å bære gjennom */
  meta: Record<string, unknown>;
}

export interface RerankResult {
  docId: string;
  text: string;
  /** Relevance-score fra Cohere (0–1) */
  relevanceScore: number;
  /** Original RRF-score */
  originalScore: number;
  meta: Record<string, unknown>;
}

// ─── Cohere API-respons ────────────────────────────────────

interface CohereRerankResponse {
  results: Array<{
    index: number;
    relevance_score: number;
  }>;
}

// ─── Eksporterte funksjoner ────────────────────────────────

/** Sjekker om Cohere reranking er tilgjengelig */
export function isCohereConfigured(): boolean {
  return !!COHERE_API_KEY;
}

/**
 * Pinger Cohere /v1/models for å verifisere at API-et svarer.
 * Brukes av /status og /health/dependencies for å rapportere faktisk provider-helse.
 * Returnerer false hvis nøkkel mangler, nettverket svikter, eller API-et returnerer
 * en feilstatus.
 */
export async function isCohereHealthy(): Promise<boolean> {
  if (!COHERE_API_KEY) return false;
  try {
    const response = await fetch("https://api.cohere.com/v1/models?page_size=1", {
      method: "GET",
      headers: {
        Authorization: `Bearer ${COHERE_API_KEY}`,
      },
      signal: AbortSignal.timeout(5_000),
    });
    return response.ok;
  } catch (error) {
    logger.debug({ err: error }, "Cohere helsesjekk feilet");
    return false;
  }
}

/**
 * Reranker dokumenter via Cohere Rerank API.
 *
 * Fallback: Returnerer input sortert etter originalScore hvis Cohere feiler/mangler.
 *
 * @param query - Brukerens søketekst
 * @param documents - Dokumenter å reranke
 * @param topN - Antall resultater å returnere (default: 8)
 */
export async function cohereRerank(
  query: string,
  documents: RerankDocument[],
  topN = 8,
): Promise<RerankResult[]> {
  if (documents.length === 0) return [];

  // Passthrough hvis Cohere ikke er konfigurert
  if (!COHERE_API_KEY) {
    logger.info("Cohere API-nøkkel mangler — hopper over reranking");
    return passthrough(documents, topN);
  }

  // Begrens antall dokumenter sendt til Cohere (API-grense og kostnad)
  const maxDocs = Math.min(documents.length, 100);
  const docsToRerank = documents.slice(0, maxDocs);

  try {
    const reranked = await cohereCircuit.execute(async () => {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), COHERE_TIMEOUT_MS);

      try {
        const res = await fetch(COHERE_RERANK_URL, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${COHERE_API_KEY}`,
            "Content-Type": "application/json",
          },
          signal: controller.signal,
          body: JSON.stringify({
            model: COHERE_RERANK_MODEL,
            query,
            documents: docsToRerank.map((d) => d.text),
            top_n: topN,
          }),
        });

        if (!res.ok) {
          const body = await res.text();
          logger.warn(
            { status: res.status, body },
            "Cohere rerank API feilet",
          );
          throw new Error(`Cohere rerank feilet: ${res.status}`);
        }

        const data = (await res.json()) as CohereRerankResponse;
        return data;
      } finally {
        clearTimeout(timeout);
      }
    });

    // Map tilbake til våre resultater
    const results: RerankResult[] = reranked.results.map((r) => {
      const doc = docsToRerank[r.index];
      return {
        docId: doc.docId,
        text: doc.text,
        relevanceScore: r.relevance_score,
        originalScore: doc.originalScore,
        meta: doc.meta,
      };
    });

    logger.info(
      {
        inputCount: docsToRerank.length,
        outputCount: results.length,
        topRelevance: results[0]?.relevanceScore.toFixed(3),
      },
      "Cohere rerank fullført",
    );

    return results;
  } catch (error) {
    logger.warn(
      { err: error },
      "Cohere rerank feilet — bruker originale scorer",
    );
    return passthrough(documents, topN);
  }
}

/** Fallback: returnerer topp-N sortert etter originalScore */
function passthrough(documents: RerankDocument[], topN: number): RerankResult[] {
  return [...documents]
    .sort((a, b) => b.originalScore - a.originalScore)
    .slice(0, topN)
    .map((d) => ({
      docId: d.docId,
      text: d.text,
      relevanceScore: d.originalScore,
      originalScore: d.originalScore,
      meta: d.meta,
    }));
}
