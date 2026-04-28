/**
 * KB Indexing Service
 *
 * Indekserer innhold fra kunnskapsbase-lenker og -filer til Pinecone
 * for semantisk søk. Bruker eksisterende chunking og Pinecone-integrasjon.
 *
 * Metadata-konvensjon:
 *   - userId: brukerens ID
 *   - courseId: "kb:<baseId>" (prefix for å skille fra Canvas-data)
 *   - moduleId: 0 (ikke brukt for KB)
 *   - fileId: hash av sourceId (numerisk verdi for Pinecone-filter)
 *   - chunkIndex: chunk-nummer
 */

import crypto from "crypto";
import { logger } from "../utils/logger.js";
import { KBContentChunk } from "../database/models/KBContentChunk.js";
import { KnowledgeBase } from "../database/models/Kunnskapsbase.js";
import { createChunksFromContent } from "./chunk.service.js";
import { countTokens } from "../utils/tokenCounter.js";
import {
  isPineconeConfigured,
  pineconeUpsert,
  pineconeDeleteByFilter,
  pineconeQuery,
} from "./pinecone.service.js";
import {
  cohereRerank,
  isCohereConfigured,
  type RerankDocument,
} from "./cohere-rerank.service.js";

/** Overhent-faktor før Cohere-rerank — speiler hybrid-retrievalens overhent (15/8 ≈ 1.9×). */
const KB_RERANK_OVERFETCH = 2;
/** Hard øvre grense på antall kandidater sendt til Cohere (kostnad/latency). */
const KB_RERANK_MAX_CANDIDATES = 24;

// ─── Hjelpefunksjoner ──────────────────────────────��─────

/** Genererer en stabil numerisk fileId fra sourceId for Pinecone-metadata */
function sourceIdToNumeric(sourceId: string): number {
  const digest = crypto.createHash("sha256").update(sourceId, "utf8").digest();
  const high = digest.readUInt32BE(0) & 0x001fffff;
  const low = digest.readUInt32BE(4);
  return high * 0x100000000 + low;
}

/** Lager Pinecone courseId-prefiks for kunnskapsbase */
export function kbCourseId(baseId: string): string {
  return `kb:${baseId}`;
}

// ─── Indeksering ─────────────────────────────────────────

export interface IndexContentOptions {
  userId: string;
  baseId: string;
  sourceId: string;
  sourceType: "link" | "file";
  sourceName: string;
  content: string;
  /** Ekstra metadata for crawlede sider */
  metadata?: {
    sourceUrl?: string;
    parentUrl?: string;
    depth?: number;
    contentType?: string;
    domain?: string;
    path?: string;
  };
}

/**
 * Indekserer tekstinnhold fra en lenke eller fil til MongoDB + Pinecone.
 * Chunker innholdet, lagrer i KBContentChunk og upsert-er til Pinecone.
 */
export async function indexKBContent(options: IndexContentOptions): Promise<number> {
  const { userId, baseId, sourceId, sourceType, sourceName, content, metadata } = options;

  if (!content || content.trim().length === 0) {
    logger.warn({ baseId, sourceId, sourceType }, "Tomt innhold — hopper over indeksering");
    return 0;
  }

  // Chunk innholdet med eksisterende chunking-logikk
  const chunkSource = {
    courseId: `kb:${baseId}`,
    courseName: sourceName,
    moduleTitle: sourceType === "file" ? "Fil" : "Lenke",
    fileName: sourceName,
    fileId: sourceIdToNumeric(sourceId),
  };
  const chunks = createChunksFromContent(content, chunkSource);

  if (chunks.length === 0) {
    logger.warn({ baseId, sourceId }, "Ingen chunks generert fra innhold");
    return 0;
  }

  // Lagre chunks i MongoDB med ekstra metadata
  const mongoOps = chunks.map((chunk, index) => ({
    updateOne: {
      filter: { userId, baseId, sourceId, chunkIndex: index },
      update: {
        $set: {
          sourceType,
          sourceName,
          text: chunk.text,
          tokenCount: countTokens(chunk.text),
          contentHash: crypto.createHash("sha256").update(chunk.text).digest("hex"),
          pineconeSynced: false,
          // Ekstra metadata for crawlede sider
          ...(metadata?.sourceUrl && { sourceUrl: metadata.sourceUrl }),
          ...(metadata?.parentUrl && { parentUrl: metadata.parentUrl }),
          ...(metadata?.depth !== undefined && { depth: metadata.depth }),
          ...(metadata?.contentType && { contentType: metadata.contentType }),
          ...(metadata?.domain && { domain: metadata.domain }),
          ...(metadata?.path && { path: metadata.path }),
        },
      },
      upsert: true,
    },
  }));

  await KBContentChunk.bulkWrite(mongoOps, { ordered: false });

  // Slett eventuelle overflødige chunks fra forrige indeksering
  await KBContentChunk.deleteMany({
    userId,
    baseId,
    sourceId,
    chunkIndex: { $gte: chunks.length },
  });

  // Upsert til Pinecone
  if (isPineconeConfigured()) {
    const pineconeRecords = chunks.map((chunk, index) => ({
      id: `kb:${userId}:${baseId}:${sourceId}:${index}`,
      text: chunk.text,
      metadata: {
        userId,
        courseId: kbCourseId(baseId),
        moduleId: 0,
        fileId: sourceIdToNumeric(sourceId),
        chunkIndex: index,
        // Ekstra metadata for sporing
        ...(metadata?.sourceUrl && { sourceUrl: metadata.sourceUrl }),
        ...(metadata?.depth !== undefined && { depth: metadata.depth }),
      },
    }));

    try {
      await pineconeUpsert(pineconeRecords);
      // Marker chunks som synkronisert
      await KBContentChunk.updateMany(
        { userId, baseId, sourceId, chunkIndex: { $lt: chunks.length } },
        { $set: { pineconeSynced: true } },
      );
    } catch (err) {
      logger.error(
        { err, baseId, sourceId },
        "Pinecone upsert feilet for KB-innhold — MongoDB-data beholdes",
      );
    }
  }

  logger.info({ baseId, sourceId, sourceType, chunkCount: chunks.length }, "KB-innhold indeksert");

  return chunks.length;
}

/**
 * Sletter indeksert innhold for en kilde (lenke eller fil).
 * Sletter fra Pinecone først (GDPR), deretter MongoDB.
 */
export async function deleteKBSourceContent(
  userId: string,
  baseId: string,
  sourceId: string,
): Promise<void> {
  // Slett fra Pinecone først
  if (isPineconeConfigured()) {
    try {
      await pineconeDeleteByFilter({
        userId,
        courseId: kbCourseId(baseId),
        fileId: sourceIdToNumeric(sourceId),
      });
    } catch (err) {
      logger.error(
        { err, baseId, sourceId },
        "Pinecone-sletting feilet for KB-kilde — avbryter for dataintegritet",
      );
      throw err;
    }
  }

  await KBContentChunk.deleteMany({ userId, baseId, sourceId });
}

/**
 * Sletter alt indeksert innhold for en hel base.
 */
export async function deleteKBBaseContent(userId: string, baseId: string): Promise<void> {
  if (isPineconeConfigured()) {
    try {
      await pineconeDeleteByFilter({
        userId,
        courseId: kbCourseId(baseId),
      });
    } catch (err) {
      logger.error(
        { err, baseId },
        "Pinecone-sletting feilet for KB-base — avbryter for dataintegritet",
      );
      throw err;
    }
  }

  await KBContentChunk.deleteMany({ userId, baseId });
}

/**
 * Sletter alt indeksert KB-innhold for en bruker (kontosletting / GDPR).
 */
export async function deleteAllKBContentForUser(userId: string, baseIds?: string[]): Promise<void> {
  const resolvedBaseIds = Array.from(
    new Set(
      (baseIds && baseIds.length > 0
        ? baseIds
        : await (async () => {
            const bases = await KnowledgeBase.find({ userId }, { _id: 1 }).lean();
            if (bases.length > 0) {
              return bases.map((base) => String(base._id));
            }

            // Hvis base-dokumentene allerede er slettet, prøv å hente baseId fra chunks.
            // Bruker $group-aggregation i stedet for .distinct() fordi MongoDB
            // Stable API v1 ikke støtter distinct-kommandoen.
            const chunkBaseIds = await KBContentChunk.aggregate<{ _id: unknown }>([
              { $match: { userId } },
              { $group: { _id: "$baseId" } },
            ]);
            return chunkBaseIds
              .map((doc) => doc._id)
              .filter(
                (value): value is string => typeof value === "string" && value.trim().length > 0,
              );
          })()
      )
        .map((value) => value.trim())
        .filter((value) => value.length > 0),
    ),
  );
  const failedBaseIds: string[] = [];

  for (const baseId of resolvedBaseIds) {
    if (isPineconeConfigured()) {
      try {
        await pineconeDeleteByFilter({
          userId,
          courseId: kbCourseId(baseId),
        });
      } catch (err) {
        failedBaseIds.push(baseId);
        logger.error({ err, baseId }, "Pinecone-sletting feilet for KB-base ved kontosletting");
      }
    }
  }

  if (failedBaseIds.length > 0) {
    throw new Error(
      `KB Pinecone-sletting feilet for ${failedBaseIds.length} base(r): ${failedBaseIds.join(", ")}`,
    );
  }

  await KBContentChunk.deleteMany({ userId });
}

// ─── Søk / konteksthenting ──────────────────────────────

export interface KBSearchResult {
  text: string;
  sourceId?: string;
  sourceName: string;
  sourceType: "link" | "file";
  sourceUrl?: string;
  score?: number;
}

/**
 * Parser Pinecone-ID for KB-poster.
 * Format: kb:<userId>:<baseId>:<sourceId>:<chunkIndex>
 * NB: sourceId kan inneholde kolon, så vi parser fra høyre side.
 */
function parseKBPineconeId(id: string): { sourceId: string; chunkIndex: number } | null {
  const parts = id.split(":");
  if (parts.length < 5 || parts[0] !== "kb") return null;

  const chunkIndexRaw = parts[parts.length - 1];
  const chunkIndex = Number.parseInt(chunkIndexRaw, 10);
  if (!Number.isFinite(chunkIndex)) return null;

  const sourceId = parts.slice(3, -1).join(":");
  if (!sourceId) return null;

  return { sourceId, chunkIndex };
}

// Stoppord for KB-søk. Vi filtrerer kun bort funksjonsord (pronomen, preposisjoner,
// modalverb osv.) og meta-ord om selve kilden — IKKE innholdsbærende ord som
// "innhold", "dokument", "oppsummer", "hva" eller "hvordan", siden disse ofte er
// semantisk meningsbærende i studiekontekst (f.eks. "hva står i dokumentet").
// Ord ≤ 2 tegn faller uansett bort i extractKBQueryTerms, så kortord ekskluderes her.
const KB_QUERY_STOPWORDS = new Set([
  // Norske funksjonsord
  "kan",
  "jeg",
  "meg",
  "det",
  "den",
  "dette",
  "denne",
  "disse",
  "og",
  "på",
  "av",
  "for",
  "til",
  "fra",
  "med",
  "om",
  "som",
  "var",
  "blir",
  "skal",
  "vil",
  "må",
  "kunne",
  "har",
  // KB-/link-meta-ord (referer til selve kilden, ikke innholdet)
  "base",
  "basen",
  "kunnskapsbase",
  "kunnskapsbasen",
  "lenke",
  "lenken",
  "link",
  "linken",
  "url",
  "nettside",
  "webside",
  "kilde",
  "kilden",
  // Engelske funksjonsord
  "the",
  "and",
  "with",
  "from",
  "about",
]);

function extractKBQueryTerms(query: string): string[] {
  const normalized = query
    .toLowerCase()
    .replace(/[^\wæøå\s-]/g, " ")
    .split(/\s+/)
    .map((word) => word.trim())
    .filter((word) => word.length > 2)
    .filter((word) => !KB_QUERY_STOPWORDS.has(word));

  return [...new Set(normalized)];
}

function shouldPreferLinkResults(query: string): boolean {
  return /\b(?:lenke|lenken|link|linken|url|nettside|webside|kilde|kilden)\b/i.test(query);
}

function prioritizeKBResults<T extends { sourceType: "link" | "file" }>(
  results: T[],
  topK: number,
  preferLinks: boolean,
): T[] {
  if (!preferLinks) return results.slice(0, topK);
  const linkResults = results.filter((result) => result.sourceType === "link");
  if (linkResults.length === 0) return results.slice(0, topK);
  const fileResults = results.filter((result) => result.sourceType === "file");
  return [...linkResults, ...fileResults].slice(0, topK);
}

/**
 * Henter relevante chunks fra en aktiv kunnskapsbase basert på brukerens spørsmål.
 * Bruker Pinecone for semantisk søk, med fallback til MongoDB keyword-søk.
 */
export async function searchKBContent(
  userId: string,
  baseId: string,
  query: string,
  topK = 6,
): Promise<KBSearchResult[]> {
  const { KnowledgeBase } = await import("../database/models/Kunnskapsbase.js");
  const ownsBase = await KnowledgeBase.exists({ _id: baseId, userId });
  if (!ownsBase) {
    logger.warn({ userId, baseId }, "KB-søk avvist: base finnes ikke eller tilhører annen bruker");
    return [];
  }

  const courseId = kbCourseId(baseId);

  // Logger-hjelper: gir enhetlig observabilitet for alle retur-veier
  // (Pinecone-treff, Pinecone-tom, MongoDB-match, MongoDB-nyeste, tom base).
  const logOutcome = async (
    source:
      | "pinecone"
      | "mongodb_regex"
      | "mongodb_recent"
      | "pinecone_parse_failed"
      | "pinecone_empty",
    resultCount: number,
    pineconeFailed = false,
  ) => {
    if (resultCount > 0) {
      logger.info(
        { userId, baseId, source, resultCount, queryLen: query.length },
        "KB-søk: fant treff",
      );
      return;
    }
    // Ved 0 treff teller vi totalChunks i basen så vi kan skille
    // "tom base" fra "ingen match mot spørsmål".
    const totalChunks = await KBContentChunk.countDocuments({ userId, baseId });
    const reason =
      totalChunks === 0 ? "empty_base" : pineconeFailed ? "pinecone_unavailable" : "no_match";
    logger.warn(
      { userId, baseId, source, resultCount: 0, totalChunks, reason, queryLen: query.length },
      "KB-søk: ingen treff",
    );
  };

  let pineconeFailed = false;
  const preferLinkResults = shouldPreferLinkResults(query);
  const queryWords = extractKBQueryTerms(query);

  // Prøv Pinecone semantisk søk. Overhent kandidater før Cohere-rerank slik at
  // KB-søk får samme relevans-finpussing som Canvas (hybrid-retrievalens
  // siste trinn). Faller tilbake til Pinecone-score når Cohere ikke er
  // tilgjengelig.
  if (isPineconeConfigured()) {
    try {
      const pineconeFetchK = isCohereConfigured()
        ? Math.min(KB_RERANK_MAX_CANDIDATES, Math.max(topK, topK * KB_RERANK_OVERFETCH))
        : topK;
      const pineconeResults = await pineconeQuery(query, pineconeFetchK, {
        userId,
        courseIds: [courseId],
      });

      if (pineconeResults.length > 0) {
        // Hent fullstendig chunk-data fra MongoDB basert på Pinecone-resultatene
        const chunkIds = pineconeResults
          .map((r) => parseKBPineconeId(r.id))
          .filter((v): v is { sourceId: string; chunkIndex: number } => v !== null);

        if (chunkIds.length === 0) {
          logger.warn(
            { baseId, hitCount: pineconeResults.length },
            "Ingen gyldige KB Pinecone-ID-er etter parsing",
          );
          await logOutcome("pinecone_parse_failed", 0);
          return [];
        }

        const chunks = await KBContentChunk.find({
          userId,
          baseId,
          $or: chunkIds.map((c) => ({
            sourceId: c.sourceId,
            chunkIndex: c.chunkIndex,
          })),
        }).lean();

        const scoreById = new Map(pineconeResults.map((result) => [result.id, result.score]));

        const mapped = chunks
          .map((chunk) => {
            const resultId = `kb:${userId}:${baseId}:${chunk.sourceId}:${chunk.chunkIndex}`;
            return {
              text: chunk.text,
              sourceId: chunk.sourceId,
              sourceName: chunk.sourceName,
              sourceType: chunk.sourceType,
              sourceUrl: chunk.sourceUrl,
              score: scoreById.get(resultId),
            };
          })
          .sort((a, b) => (b.score ?? 0) - (a.score ?? 0));

        // Cohere-rerank for å speile Canvas hybrid-retrieval. Hopper over
        // hvis Cohere ikke er konfigurert; ved feil returneres rå
        // Pinecone-rangering uten å bryte søket.
        let postRerank = mapped;
        let rerankedCount = 0;
        if (isCohereConfigured() && mapped.length > 1) {
          try {
            const rerankInput: RerankDocument[] = mapped.map((doc, idx) => ({
              docId: `${doc.sourceId ?? ""}:${idx}`,
              text: doc.text,
              originalScore: doc.score ?? 0,
              meta: { idx },
            }));
            const reranked = await cohereRerank(query, rerankInput, topK);
            if (reranked.length > 0) {
              const rebuilt: typeof mapped = [];
              for (const r of reranked) {
                const idx = (r.meta as { idx?: number }).idx;
                if (typeof idx !== "number") continue;
                const orig = mapped[idx];
                if (!orig) continue;
                rebuilt.push({ ...orig, score: r.relevanceScore });
              }
              postRerank = rebuilt;
              rerankedCount = rebuilt.length;
            }
          } catch (err) {
            logger.warn(
              { err, baseId },
              "Cohere-rerank feilet for KB — bruker Pinecone-rangering",
            );
          }
        }

        const prioritized = prioritizeKBResults(postRerank, topK, preferLinkResults);
        await logOutcome("pinecone", prioritized.length);
        if (rerankedCount > 0) {
          logger.info(
            { userId, baseId, candidateCount: mapped.length, rerankedCount, topK },
            "KB-søk: Cohere-rerank anvendt",
          );
        }
        return prioritized;
      }
      // Pinecone kom tilbake med tomt resultat — fall videre til MongoDB-fallback
      // for å skille "ikke funnet semantisk" fra "kan gjenfinnes via keyword".
    } catch (err) {
      pineconeFailed = true;
      logger.warn({ err, baseId }, "Pinecone-søk feilet for KB — fallback til MongoDB");
    }
  }

  // Reserveløsning: nøkkelordsøk i MongoDB
  if (queryWords.length === 0) {
    // Returner de nyeste chunks ved generiske spørsmål.
    // Hvis bruker ber om lenke-innhold, prioriter link-kilder.
    let chunks = await KBContentChunk.find({
      userId,
      baseId,
      ...(preferLinkResults ? { sourceType: "link" as const } : {}),
    })
      .sort({ createdAt: -1, chunkIndex: 1 })
      .limit(topK)
      .lean();

    if (chunks.length === 0 && preferLinkResults) {
      chunks = await KBContentChunk.find({ userId, baseId })
        .sort({ createdAt: -1, chunkIndex: 1 })
        .limit(topK)
        .lean();
    }

    const mapped = chunks.map(toKBSearchResult);
    await logOutcome("mongodb_recent", mapped.length, pineconeFailed);
    return mapped;
  }

  // Enkel nøkkelord-matching via regex
  const regexPattern = queryWords
    .map((w) => `(?=.*${w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})`)
    .join("");
  const chunks = await KBContentChunk.find({
    userId,
    baseId,
    // eslint-disable-next-line security/detect-non-literal-regexp -- queryWords er sanitert med regex-escape
    text: { $regex: new RegExp(regexPattern, "i") },
  })
    .limit(preferLinkResults ? topK * 3 : topK)
    .lean();

  const mapped = chunks.map(toKBSearchResult);
  const prioritized = prioritizeKBResults(mapped, topK, preferLinkResults);
  await logOutcome("mongodb_regex", prioritized.length, pineconeFailed);
  return prioritized;
}

/** Mapper en MongoDB-chunk til KBSearchResult-format. Brukes av begge MongoDB-fallback-stier. */
function toKBSearchResult(chunk: {
  text: string;
  sourceId?: string;
  sourceName: string;
  sourceType: "link" | "file";
  sourceUrl?: string;
}): KBSearchResult {
  return {
    text: chunk.text,
    sourceId: chunk.sourceId,
    sourceName: chunk.sourceName,
    sourceType: chunk.sourceType,
    sourceUrl: chunk.sourceUrl,
  };
}

/**
 * Saniterer brukerkontrollert tekst som plasseres inne i en attributtverdi
 * eller mellom XML-tags i system-prompten. Forhindrer at KB-navn eller
 * KB-innhold kan bryte ut av <kunnskapsbase>-konteksten og injisere
 * instruksjoner til modellen.
 */
function sanitizeForPromptTag(value: string): string {
  return (
    value
      .replace(/[<>]/g, " ")
      .replace(/&/g, "&amp;")
      .replace(/"/g, "'")
      // eslint-disable-next-line no-control-regex -- fjerner null-bytes for å hindre prompt-injection
      .replace(/\u0000/g, "")
  );
}

/**
 * Fjerner forekomster av </kunnskapsbase> og lignende lukkende tags fra
 * brukerinnhold slik at KB-tekst ikke kan terminere konteksten tidlig.
 */
function sanitizeKBBodyText(text: string): string {
  return (
    text
      .replace(/<\/?kunnskapsbase[^>]*>/gi, " ")
      .replace(/<\/?live_url[^>]*>/gi, " ")
      // eslint-disable-next-line no-control-regex -- fjerner null-bytes for å hindre prompt-injection
      .replace(/\u0000/g, "")
  );
}

/**
 * Laster alt lagret innhold for en aktiv kunnskapsbase i dokumentrekkefølge
 * (per kilde, sortert etter chunkIndex) og pakker det inn i en
 * <kunnskapsbase>-kontekst. Brukes ved oppsummerings-/fordypnings-spørsmål der
 * semantisk top-K-søk ikke er tilstrekkelig — speiler Canvas-flytens
 * `fullDocumentMode` hvor hele dokumentet injiseres i stedet for rangerte
 * chunks.
 *
 * Pakker inn chunks opp til `maxTokens` (default 60k) for å beskytte
 * kontekstvinduet; resten markeres som trunkert slik at modellen kan være
 * ærlig om manglende innhold.
 */
/**
 * Hard øvre grense på antall chunks som lastes i full-dokument-modus.
 * Beskytter mot baser med patologisk mange små chunks. Token-budsjettet
 * (`maxTokens`) er primær mekanisme; dette er backup mot worst-case.
 */
const MAX_FULL_KB_CHUNKS = 800;

export async function loadFullKBContext(
  userId: string,
  baseId: string,
  baseName: string,
  maxTokens = 60000,
): Promise<{ context: string; sources: KBSearchResult[]; truncated: boolean; hasContent: boolean }> {
  const ownsBase = await KnowledgeBase.exists({ _id: baseId, userId });
  if (!ownsBase) {
    logger.warn({ userId, baseId }, "KB full-doc last avvist: base tilhører ikke bruker");
    return {
      context: buildKBContext([], baseName),
      sources: [],
      truncated: false,
      hasContent: false,
    };
  }

  const totalChunks = await KBContentChunk.countDocuments({ userId, baseId });
  const chunks = await KBContentChunk.find({ userId, baseId })
    .sort({ sourceName: 1, sourceId: 1, chunkIndex: 1 })
    .limit(MAX_FULL_KB_CHUNKS)
    .lean();
  if (totalChunks > MAX_FULL_KB_CHUNKS) {
    logger.warn(
      { userId, baseId, totalChunks, maxFullKbChunks: MAX_FULL_KB_CHUNKS },
      "KB full-doc: antall chunks overskrider tak — kun de første lastes",
    );
  }

  if (chunks.length === 0) {
    return {
      context: buildKBContext([], baseName),
      sources: [],
      truncated: false,
      hasContent: false,
    };
  }

  const safeBaseName = sanitizeForPromptTag(baseName);
  const sections: string[] = [];
  const sources: KBSearchResult[] = [];
  let tokensUsed = 0;
  let truncated = totalChunks > MAX_FULL_KB_CHUNKS;
  let currentSourceId: string | null = null;
  let currentBuffer: string[] = [];
  let currentMeta: { sourceName: string; sourceType: "link" | "file"; sourceUrl?: string } | null =
    null;

  const flushCurrent = () => {
    if (!currentMeta || currentBuffer.length === 0) return;
    const kildetype = currentMeta.sourceType === "file" ? "Fil" : "Lenke";
    const safeName = sanitizeForPromptTag(currentMeta.sourceName);
    const body = sanitizeKBBodyText(currentBuffer.join("\n\n"));
    sections.push(`--- ${kildetype}: ${safeName} ---\n${body}\n--- SLUTT ---`);
    sources.push({
      text: body,
      sourceId: currentSourceId ?? undefined,
      sourceName: currentMeta.sourceName,
      sourceType: currentMeta.sourceType,
      sourceUrl: currentMeta.sourceUrl,
    });
    currentBuffer = [];
    currentMeta = null;
  };

  for (const chunk of chunks) {
    if (tokensUsed + chunk.tokenCount > maxTokens) {
      truncated = true;
      break;
    }
    if (chunk.sourceId !== currentSourceId) {
      flushCurrent();
      currentSourceId = chunk.sourceId;
      currentMeta = {
        sourceName: chunk.sourceName,
        sourceType: chunk.sourceType,
        sourceUrl: chunk.sourceUrl,
      };
    }
    currentBuffer.push(chunk.text);
    tokensUsed += chunk.tokenCount;
  }
  flushCurrent();

  const header = truncated
    ? `<kunnskapsbase name="${safeBaseName}" status="aktiv" mode="full" truncated="true">`
    : `<kunnskapsbase name="${safeBaseName}" status="aktiv" mode="full">`;
  const context = `${header}\n${sections.join("\n\n")}\n</kunnskapsbase>`;

  logger.info(
    {
      userId,
      baseId,
      baseName,
      sourceCount: sources.length,
      chunkCount: chunks.length,
      tokensUsed,
      truncated,
    },
    "KB full-doc-kontekst bygget",
  );

  return { context, sources, truncated, hasContent: sources.length > 0 };
}

/**
 * Bygger kontekststreng for KI-chatten fra KB-søkeresultater.
 * Returnerer alltid en kontekst når baseName er oppgitt, selv uten resultater,
 * slik at KI-en vet at basen er aktiv.
 */
export function buildKBContext(results: KBSearchResult[], baseName: string): string {
  const safeBaseName = sanitizeForPromptTag(baseName);

  if (results.length === 0) {
    return `<kunnskapsbase name="${safeBaseName}" status="aktiv">
Ingen relevante utdrag funnet for dette spørsmålet. Basen "${safeBaseName}" er fortsatt aktiv.
</kunnskapsbase>`;
  }

  const sections = results.map((r) => {
    const kildetype = r.sourceType === "file" ? "Fil" : "Lenke";
    const safeName = sanitizeForPromptTag(r.sourceName);
    const safeText = sanitizeKBBodyText(r.text);
    return `--- ${kildetype}: ${safeName} ---\n${safeText}\n--- SLUTT ---`;
  });

  return `<kunnskapsbase name="${safeBaseName}" status="aktiv">\n${sections.join("\n\n")}\n</kunnskapsbase>`;
}
