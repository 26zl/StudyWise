/**
 * Pinecone vector store med Integrated embedding.
 * Index opprettes i Pinecone-konsollen med "Field map: text" — Pinecone embedder
 * teksten ved upsert og ved søk. Vi sender kun id + text + metadata; ingen egne vektorer.
 */

import { Pinecone } from "@pinecone-database/pinecone";
import { logger } from "../utils/logger.js";
import { pineconeCircuit } from "../utils/circuitBreaker.js";

const PINECONE_API_KEY = process.env.PINECONE_API_KEY?.trim();
const PINECONE_INDEX_NAME = process.env.PINECONE_INDEX_NAME?.trim() || "studywise";

/** Feltnavn som matcher index "Field map" i Pinecone-konsollen (integrated embedding). */
const TEXT_FIELD = "text";

/** Maks antall records per upsert-batch (Pinecone integrated embedding grense). */
const PINECONE_UPSERT_BATCH_SIZE = 96;

export const EMBEDDING_DIMENSIONS = 1024;

/** Metadata lagret i Pinecone for filtrering (må matche index schema) */
export interface PineconeChunkMetadata extends Record<string, string | number> {
  userId: string;
  courseId: string;
  moduleId: number;
  fileId: number;
  chunkIndex: number;
}

const pc =
  PINECONE_API_KEY && PINECONE_INDEX_NAME
    ? new Pinecone({ apiKey: PINECONE_API_KEY })
    : null;

let indexHost: string | null = null;
let indexHostFetchedAt = 0;
/** TTL for cached index host (10 min) — oppdateres ved DNS/host-endringer */
const INDEX_HOST_TTL_MS = 10 * 60 * 1000;

const DEFAULT_NAMESPACE = "__default__";

async function getIndexHost(): Promise<string> {
  if (!pc) throw new Error("Pinecone er ikke konfigurert");
  const now = Date.now();
  if (indexHost && now - indexHostFetchedAt < INDEX_HOST_TTL_MS) return indexHost;
  const desc = await pc.describeIndex(PINECONE_INDEX_NAME);
  indexHost = desc.host ?? null;
  if (!indexHost) throw new Error("Pinecone index mangler host");
  indexHostFetchedAt = now;
  return indexHost;
}

export function isPineconeConfigured(): boolean {
  return pc !== null && !!PINECONE_INDEX_NAME;
}

/**
 * Resolve index host (lazy). Index må opprettes i Pinecone-konsollen med Integrated embedding.
 */
export async function ensurePineconeIndex(): Promise<boolean> {
  if (!pc) return false;
  try {
    await getIndexHost();
    return true;
  } catch (error) {
    logger.warn(
      { err: error, indexName: PINECONE_INDEX_NAME },
      "Kunne ikke hente Pinecone-index (opprett index med Integrated embedding i konsollen)",
    );
    return false;
  }
}

/**
 * Upsert med Integrated embedding: sender records med feltet "text"; Pinecone embedder selv.
 * API 2025-04 (namespace __default__ krever 2025-04).
 */
export async function pineconeUpsert(
  records: Array<{
    id: string;
    text: string;
    metadata: PineconeChunkMetadata;
  }>,
): Promise<void> {
  if (!isPineconeConfigured() || records.length === 0) return;
  await pineconeCircuit.execute(async () => {
    const host = await getIndexHost();
    const url = `https://${host}/records/namespaces/${DEFAULT_NAMESPACE}/upsert`;
    for (let i = 0; i < records.length; i += PINECONE_UPSERT_BATCH_SIZE) {
      const batch = records.slice(i, i + PINECONE_UPSERT_BATCH_SIZE);
      const ndjson = batch
        .map(
          (r) =>
            JSON.stringify({
              _id: r.id,
              [TEXT_FIELD]: r.text,
              userId: r.metadata.userId,
              courseId: r.metadata.courseId,
              moduleId: r.metadata.moduleId,
              fileId: r.metadata.fileId,
              chunkIndex: r.metadata.chunkIndex,
            }),
        )
        .join("\n");
      const res = await fetch(url, {
        method: "POST",
        headers: {
          "Api-Key": PINECONE_API_KEY!,
          "Content-Type": "application/x-ndjson",
          "X-Pinecone-Api-Version": "2025-04",
        },
        body: ndjson,
      });
      if (!res.ok) {
        const body = await res.text();
        logger.warn({ status: res.status, body }, "Pinecone upsert (integrated) feilet");
        throw new Error(`Pinecone upsert feilet: ${res.status} ${body}`);
      }
    }
  });
}

/**
 * Søk med query-tekst; Pinecone embedder query og returnerer treff (Integrated embedding).
 * API 2025-04.
 */
export async function pineconeQuery(
  queryText: string,
  topK: number,
  filter: { userId: string; courseIds?: string[] },
): Promise<Array<{ id: string; score?: number }>> {
  if (!isPineconeConfigured()) return [];
  const trimmed = queryText?.trim();
  if (!trimmed) return [];
  return pineconeCircuit.execute(async () => {
    const host = await getIndexHost();
    const url = `https://${host}/records/namespaces/${DEFAULT_NAMESPACE}/search`;
    const filterObj: Record<string, unknown> = {
      userId: { $eq: filter.userId },
    };
    if (filter.courseIds && filter.courseIds.length > 0) {
      filterObj.courseId = { $in: filter.courseIds };
    }
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Api-Key": PINECONE_API_KEY!,
        "Content-Type": "application/json",
        "Accept": "application/json",
        "X-Pinecone-Api-Version": "2025-04",
      },
      body: JSON.stringify({
        query: {
          inputs: { text: trimmed },
          top_k: topK,
          filter: filterObj,
        },
      }),
    });
    if (!res.ok) {
      const body = await res.text();
      logger.warn({ status: res.status, body }, "Pinecone search (integrated) feilet");
      throw new Error(`Pinecone search feilet: ${res.status} ${body}`);
    }
    const data = (await res.json()) as {
      result?: { hits?: Array<{ id?: string; _id?: string; score?: number; _score?: number }> };
    };
    const hits = data.result?.hits ?? [];
    return hits.map((h) => ({
      id: h.id ?? h._id ?? "",
      score: h.score ?? h._score,
    }));
  });
}

/** Slett vektorer etter metadata-filter via REST (2025-04 støtter filter på /vectors/delete).
 * Kaster feil ved svikt — GDPR-kritisk: kalleren MÅ håndtere feil for å unngå at vektorer
 * forblir i Pinecone mens MongoDB-data slettes.
 */
export async function pineconeDeleteByFilter(
  filter: Partial<PineconeChunkMetadata>,
): Promise<void> {
  if (!isPineconeConfigured()) return;
  const filterObj: Record<string, unknown> = {};
  if (filter.userId != null) filterObj.userId = { $eq: filter.userId };
  if (filter.courseId != null) filterObj.courseId = { $eq: filter.courseId };
  if (filter.fileId != null) filterObj.fileId = { $eq: filter.fileId };
  if (Object.keys(filterObj).length === 0) {
    logger.warn("pineconeDeleteByFilter kalt uten filter — hopper over");
    return;
  }
  await pineconeCircuit.execute(async () => {
    const host = await getIndexHost();
    const url = `https://${host}/vectors/delete`;
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Api-Key": PINECONE_API_KEY!,
        "Content-Type": "application/json",
        "X-Pinecone-Api-Version": "2025-04",
      },
      body: JSON.stringify({
        namespace: DEFAULT_NAMESPACE,
        filter: filterObj,
      }),
    });
    if (!res.ok) {
      const body = await res.text();
      logger.error(
        { status: res.status, body, filter: filterObj },
        "Pinecone deleteByFilter feilet — GDPR-kritisk",
      );
      throw new Error(`Pinecone deleteByFilter feilet: ${res.status} ${body}`);
    }
  });
}

/**
 * Slett vektorer etter eksplisitte IDer. Brukes av cleanup-script som
 * må fjerne enkeltchunks (f.eks. mikro-chunks fra gammel chunking-bug)
 * uten å slette hele filer.
 */
export async function pineconeDeleteByIds(ids: string[]): Promise<void> {
  if (!isPineconeConfigured() || ids.length === 0) return;
  const BATCH = 1000;
  await pineconeCircuit.execute(async () => {
    const host = await getIndexHost();
    const url = `https://${host}/vectors/delete`;
    for (let i = 0; i < ids.length; i += BATCH) {
      const batch = ids.slice(i, i + BATCH);
      const res = await fetch(url, {
        method: "POST",
        headers: {
          "Api-Key": PINECONE_API_KEY!,
          "Content-Type": "application/json",
          "X-Pinecone-Api-Version": "2025-04",
        },
        body: JSON.stringify({
          namespace: DEFAULT_NAMESPACE,
          ids: batch,
        }),
      });
      if (!res.ok) {
        const body = await res.text();
        logger.error(
          { status: res.status, body, batchSize: batch.length },
          "Pinecone deleteByIds feilet",
        );
        throw new Error(`Pinecone deleteByIds feilet: ${res.status} ${body}`);
      }
    }
  });
}
