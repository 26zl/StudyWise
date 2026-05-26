/**
 * Content Store / Embedding Service
 *
 * Lagrer filchunks i MongoDB (tekst + metadata). Vektorer lagres i Pinecone
 * og genereres via Pinecone integrated embedding (feltet "text" sendes; Pinecone embedder).
 * Semantisk søk bruker Pinecone; keyword-søk og katalog bruker kun MongoDB.
 *
 */

import mongoose, { type ClientSession } from "mongoose";
import crypto from "crypto";
import { logger } from "../utils/logger.js";
import { CircuitBreakerError } from "../utils/circuitBreaker.js";
import { ContentEmbedding } from "../database/models/ContentEmbedding.js";
import { countTokens } from "../utils/tokenCounter.js";
import type { ContentChunk } from "./chunk.service.js";
import {
  isPineconeConfigured,
  EMBEDDING_DIMENSIONS,
  pineconeUpsert,
  pineconeQuery,
  pineconeDeleteByFilter,
} from "./pinecone.service.js";
import { escapeRegex } from "../utils/regexUtils.js";
import {
  clearAllExtractionFailuresForCourse,
  clearExtractionFailuresForMissingFiles,
  clearExtractionFailure,
} from "./file-extraction-status.service.js";
import { FileExtractionStatus } from "../database/models/FileExtractionStatus.js";

export { EMBEDDING_DIMENSIONS };

interface StoredFileMetadata {
  courseName: string;
  moduleTitle: string;
  fileName: string;
  fileHash: string;
}

interface StoredFileStatus {
  fileHash: string;
  hasEmbedding: boolean;
}

export interface FullTextBackfillResult {
  scannedFiles: number;
  updatedFiles: number;
}

export interface StoredCourseCatalogEntry {
  courseId: string;
  courseName: string;
  moduleTitles: string[];
  fileNames: string[];
}

export function isEmbeddingAvailable(): boolean {
  return isPineconeConfigured();
}

export async function hasStoredContentForUser(userId: string): Promise<boolean> {
  const doc = await ContentEmbedding.findOne({ userId }, { _id: 1 }).lean();
  return doc !== null;
}

export async function getStoredCourseCatalog(userId: string): Promise<StoredCourseCatalogEntry[]> {
  const docs = await ContentEmbedding.aggregate<{
    courseId: string;
    courseName: string;
    moduleTitles: string[];
    fileNames: string[];
  }>([
    { $match: { userId } },
    {
      $group: {
        _id: "$courseId",
        courseName: { $first: "$courseName" },
        moduleTitles: { $addToSet: "$moduleTitle" },
        fileNames: { $addToSet: "$fileName" },
      },
    },
    {
      $project: {
        _id: 0,
        courseId: "$_id",
        courseName: 1,
        moduleTitles: 1,
        fileNames: 1,
      },
    },
    { $sort: { courseName: 1 } },
  ]);

  return docs.map((doc) => ({
    courseId: doc.courseId,
    courseName: doc.courseName,
    moduleTitles: doc.moduleTitles.filter(
      (value): value is string => typeof value === "string" && value.trim().length > 0,
    ),
    fileNames: doc.fileNames.filter(
      (value): value is string => typeof value === "string" && value.trim().length > 0,
    ),
  }));
}

/**
 * Oppdaterer lagret metadata for en uendret fil uten å re-ekstrahere innholdet.
 */
export async function updateStoredFileMetadata(
  userId: string,
  courseId: string,
  fileId: number,
  metadata: StoredFileMetadata,
): Promise<number> {
  const result = await ContentEmbedding.updateMany(
    { userId, courseId, fileId },
    { $set: metadata },
  );
  return result.modifiedCount;
}

/**
 * Henter lagret fileHash og faktisk Pinecone-synkstatus per fil i et kurs.
 * `hasEmbedding` er true kun når minst én chunk i filen har `pineconesynced: true`.
 */
export async function getStoredFileStatusForCourse(
  userId: string,
  courseId: string,
): Promise<Map<number, StoredFileStatus>> {
  const docs = await ContentEmbedding.aggregate<{
    fileId: number;
    fileHash: string;
    hasEmbedding: boolean;
  }>([
    { $match: { userId, courseId, chunkIndex: { $gte: 0 } } },
    {
      $group: {
        _id: "$fileId",
        fileHash: { $first: "$fileHash" },
        // True hvis minst én chunk er synkronisert til Pinecone
        hasEmbedding: { $max: { $ifNull: ["$pineconesynced", false] } },
      },
    },
    { $project: { _id: 0, fileId: "$_id", fileHash: 1, hasEmbedding: 1 } },
  ]);
  return new Map(
    docs.map((doc) => [doc.fileId, { fileHash: doc.fileHash, hasEmbedding: doc.hasEmbedding }]),
  );
}

/**
 * Lagrer chunks for én fil i MongoDB med content-hash-basert deduplisering,
 * og synkroniserer vektorer til Pinecone.
 *
 * Per chunk:
 * - Finnes chunk med samme fileId+chunkIndex og uendret contentHash → skip
 * - Finnes chunk med endret contentHash → oppdater eksisterende dokument
 * - Finnes ikke → insert nytt dokument
 *
 * Overskytende chunks (fra forrige versjon med flere chunks) slettes.
 */
export async function upsertStoredFileContent(options: {
  userId: string;
  courseId: string;
  courseName: string;
  moduleId: number;
  moduleTitle: string;
  fileName: string;
  fileId: number;
  fileHash: string;
  chunks: ContentChunk[];
  fullText?: string;
  /**
   * Valgfri ekstern URL der filen opprinnelig ble hentet fra (crawlet innhold).
   * Lagres på alle chunks for denne filen så kilde-paneler kan åpne originalen
   * når fileId er syntetisk og ikke kan lastes ned via Canvas-API.
   */
  externalUrl?: string;
}): Promise<number> {
  const {
    userId,
    courseId,
    courseName,
    moduleId,
    moduleTitle,
    fileName,
    fileId,
    fileHash,
    chunks,
    fullText,
    externalUrl,
  } = options;

  if (chunks.length === 0) return 0;

  const startTime = Date.now();

  // Hent eksisterende chunks for denne filen
  const existing = await ContentEmbedding.find(
    { userId, courseId, fileId },
    { _id: 1, chunkIndex: 1, contentHash: 1 },
  ).lean();
  const existingByIndex = new Map(existing.map((doc) => [doc.chunkIndex, doc]));

  // Kategoriser chunks: skip, update, insert
  const toInsert: Array<{
    userId: string;
    courseId: string;
    courseName: string;
    moduleId: number;
    moduleTitle: string;
    fileName: string;
    fileId: number;
    fileHash: string;
    chunkIndex: number;
    text: string;
    tokenCount: number;
    contentHash: string;
    externalUrl?: string;
  }> = [];
  const toUpdate: Array<{
    _id: mongoose.Types.ObjectId;
    text: string;
    tokenCount: number;
    contentHash: string;
  }> = [];
  const pineconeRecords: Array<{
    id: string;
    text: string;
    metadata: {
      userId: string;
      courseId: string;
      moduleId: number;
      fileId: number;
      chunkIndex: number;
    };
  }> = [];

  for (const chunk of chunks) {
    const hash = crypto.createHash("sha256").update(chunk.text, "utf8").digest("hex");
    const tokens = countTokens(chunk.text);
    const prev = existingByIndex.get(chunk.index);

    if (prev) {
      // eslint-disable-next-line security/detect-possible-timing-attacks -- innholdshash, ikke sikkerhetskritisk
      if (prev.contentHash === hash) {
        // Uendret — skip MongoDB-skriving, men sikre at Pinecone har vektoren
        pineconeRecords.push({
          id: prev._id.toString(),
          text: chunk.text,
          metadata: { userId, courseId, moduleId, fileId, chunkIndex: chunk.index },
        });
        continue;
      }
      // Endret — oppdater
      toUpdate.push({ _id: prev._id, text: chunk.text, tokenCount: tokens, contentHash: hash });
      pineconeRecords.push({
        id: prev._id.toString(),
        text: chunk.text,
        metadata: { userId, courseId, moduleId, fileId, chunkIndex: chunk.index },
      });
    } else {
      // Ny chunk
      toInsert.push({
        userId,
        courseId,
        courseName,
        moduleId,
        moduleTitle,
        fileName,
        fileId,
        fileHash,
        chunkIndex: chunk.index,
        text: chunk.text,
        tokenCount: tokens,
        contentHash: hash,
        ...(externalUrl ? { externalUrl } : {}),
      });
    }
  }

  // Slett overskytende chunks (f.eks. filen ble kortere).
  // Pinecone slettes FØR MongoDB slik at vi ikke mister referanser til orphaned vektorer.
  const newMaxIndex = chunks.length - 1;
  const staleIds = existing.filter((doc) => doc.chunkIndex > newMaxIndex).map((doc) => doc._id);

  let stalePineconeDeleted = false;
  if (staleIds.length > 0) {
    try {
      await pineconeDeleteByFilter({ userId, courseId, fileId });
      stalePineconeDeleted = true;
    } catch (error) {
      logger.warn(
        { err: error, userId, courseId, fileId },
        "Pinecone delete av stale vektorer feilet — beholder MongoDB-chunks som referanse",
      );
    }
    // Slett MongoDB stale chunks kun hvis Pinecone-sletting lyktes (eller Pinecone ikke er konfigurert),
    // slik at vi ikke mister referanser til orphaned vektorer.
    if (stalePineconeDeleted || !isPineconeConfigured()) {
      await ContentEmbedding.deleteMany({ _id: { $in: staleIds } });
    }
  }

  // Utfør MongoDB-operasjoner
  if (toUpdate.length > 0) {
    await Promise.all(
      toUpdate.map((u) =>
        ContentEmbedding.updateOne(
          { _id: u._id },
          {
            $set: {
              text: u.text,
              tokenCount: u.tokenCount,
              contentHash: u.contentHash,
              fileHash,
              courseName,
              moduleId,
              moduleTitle,
              fileName,
            },
          },
        ),
      ),
    );
  }

  if (toInsert.length > 0) {
    try {
      // ordered: false — fortsett innsetting selv om enkeltdokumenter feiler (f.eks. E11000 duplikatnøkkel
      // fra en annen prosess som satt inn samme chunk samtidig)
      const inserted = await ContentEmbedding.insertMany(toInsert, { ordered: false });
      for (let i = 0; i < inserted.length; i++) {
        pineconeRecords.push({
          id: inserted[i]._id.toString(),
          text: inserted[i].text,
          metadata: { userId, courseId, moduleId, fileId, chunkIndex: inserted[i].chunkIndex },
        });
      }
    } catch (err: unknown) {
      // Ved duplikatnøkkel-feil (E11000) har noen chunks allerede blitt satt inn av en annen prosess.
      // insertMany med ordered:false setter inn alle den kan og kaster feil for duplikatene.
      const bulkErr = err as {
        code?: number;
        insertedDocs?: Array<{ _id: mongoose.Types.ObjectId; text: string; chunkIndex: number }>;
      };
      if (bulkErr.code === 11000) {
        const successDocs = bulkErr.insertedDocs ?? [];
        logger.info(
          { userId, fileId, attempted: toInsert.length, inserted: successDocs.length },
          "Noen chunks var allerede satt inn av en annen prosess — fortsetter med de vellykkede",
        );
        for (const doc of successDocs) {
          pineconeRecords.push({
            id: doc._id.toString(),
            text: doc.text,
            metadata: { userId, courseId, moduleId, fileId, chunkIndex: doc.chunkIndex },
          });
        }
      } else {
        throw err;
      }
    }
  }

  // Synk metadata for eksisterende/skip-poster også, slik at fileHash og modulinfo
  // reflekterer siste Canvas-versjon selv når chunk-tekst er uendret.
  await ContentEmbedding.updateMany(
    { userId, courseId, fileId },
    {
      $set: {
        fileHash,
        courseName,
        moduleId,
        moduleTitle,
        fileName,
        ...(externalUrl ? { externalUrl } : {}),
      },
    },
  );

  // Lagre full dokumenttekst som én egen post i samme collection (chunkIndex=-1).
  // Dette gjør at vi kan svare helhetlig på "oppsummer hele filen"-spørsmål.
  if (typeof fullText === "string" && fullText.trim().length > 0) {
    await upsertStoredFullText({
      userId,
      courseId,
      courseName,
      moduleId,
      moduleTitle,
      fileName,
      fileId,
      fileHash,
      fullText,
      externalUrl,
    });
  }

  // Retry med enkel backoff for Pinecone upsert (MongoDB er allerede lagret).
  // Stale Pinecone-vektorer er allerede slettet (eller feilet) ovenfor.
  // Når circuit breaker er åpen hopper vi retries — de er garantert å feile
  // i hele cooldown-perioden (30 s), og sparer ~3 s per fil ved mange filer.
  const MAX_UPSERT_RETRIES = 2;
  let upsertSuccess = false;
  if (pineconeRecords.length > 0 && isPineconeConfigured()) {
    for (let attempt = 0; attempt <= MAX_UPSERT_RETRIES; attempt++) {
      try {
        await pineconeUpsert(pineconeRecords);
        upsertSuccess = true;
        break;
      } catch (error) {
        const isCircuitOpen = error instanceof CircuitBreakerError;
        if (isCircuitOpen) {
          logger.warn(
            { userId, courseId, fileId, chunkCount: pineconeRecords.length },
            "Pinecone circuit breaker åpen — hopper over upsert og retries (chunks lagret i MongoDB uten vektorer)",
          );
          break;
        }
        if (attempt < MAX_UPSERT_RETRIES) {
          const delayMs = 1000 * (attempt + 1);
          logger.warn(
            {
              err: error,
              userId,
              courseId,
              fileId,
              attempt: attempt + 1,
              maxRetries: MAX_UPSERT_RETRIES,
            },
            `Pinecone upsert feilet — prøver igjen om ${delayMs}ms`,
          );
          await new Promise((resolve) => setTimeout(resolve, delayMs));
        } else {
          logger.warn(
            { err: error, userId, courseId, fileId },
            "Pinecone upsert feilet etter alle forsøk — chunks lagret i MongoDB uten vektorer",
          );
        }
      }
    }
  }

  // Oppdater pineconesynced-flagg på alle chunks for denne filen
  await ContentEmbedding.updateMany(
    { userId, courseId, fileId, chunkIndex: { $gte: 0 } },
    { $set: { pineconesynced: upsertSuccess } },
  );

  logger.info(
    {
      userId,
      courseId,
      fileId,
      fileName,
      chunkCount: chunks.length,
      inserted: toInsert.length,
      updated: toUpdate.length,
      skipped: chunks.length - toInsert.length - toUpdate.length,
      staleRemoved: staleIds.length,
      pineconeSync: upsertSuccess,
      elapsedMs: Date.now() - startTime,
    },
    upsertSuccess
      ? "Filchunks lagret i MongoDB og Pinecone"
      : "Filchunks lagret i MongoDB (Pinecone upsert feilet)",
  );

  return chunks.length;
}

export async function getStoredChunksForCourse(
  userId: string,
  courseId: string,
): Promise<ContentChunk[]> {
  return getStoredChunksForCourses(userId, { courseIds: [courseId] });
}

export async function getStoredChunksForFile(
  userId: string,
  courseId: string,
  fileId: number,
): Promise<ContentChunk[]> {
  const docs = await ContentEmbedding.find(
    { userId, courseId, fileId, chunkIndex: { $gte: 0 } },
    {
      _id: 0,
      courseId: 1,
      courseName: 1,
      moduleTitle: 1,
      fileName: 1,
      fileId: 1,
      text: 1,
      chunkIndex: 1,
    },
  )
    .sort({ chunkIndex: 1 })
    .lean();

  if (docs.length === 0) {
    logger.info(
      { userId, courseId, fileId },
      "getStoredChunksForFile: ingen chunks i MongoDB (ekstraksjon ufullstendig eller filen aldri indeksert)",
    );
  }

  return docs.map((doc) => ({
    id: `${doc.courseId}:${doc.fileId}:${doc.chunkIndex}`,
    text: doc.text,
    source: {
      courseId: doc.courseId,
      courseName: doc.courseName,
      moduleTitle: doc.moduleTitle,
      fileName: doc.fileName,
      fileId: doc.fileId,
    },
    index: doc.chunkIndex,
  }));
}

export async function getStoredChunksForCourses(
  userId: string,
  options?: {
    courseIds?: string[];
    moduleHint?: string | null;
    fileHint?: string | null;
    limit?: number;
  },
): Promise<ContentChunk[]> {
  const query: Record<string, unknown> = { userId, chunkIndex: { $gte: 0 } };

  if (options?.courseIds && options.courseIds.length > 0) {
    query.courseId = { $in: options.courseIds };
  }

  if (options?.moduleHint) {
    query.moduleTitle = { $regex: escapeRegex(options.moduleHint), $options: "i" };
  }

  if (options?.fileHint) {
    query.fileName = {
      $regex: escapeRegex(options.fileHint.replace(/\.pdf$/i, "")),
      $options: "i",
    };
  }

  let builder = ContentEmbedding.find(query, {
    _id: 0,
    courseId: 1,
    courseName: 1,
    moduleTitle: 1,
    fileName: 1,
    fileId: 1,
    text: 1,
    chunkIndex: 1,
  })
    .sort({ courseId: 1, fileId: 1, chunkIndex: 1 })
    .lean();

  if (options?.limit && options.limit > 0) {
    builder = builder.limit(options.limit);
  }

  const docs = await builder;

  if (docs.length === 0) {
    logger.info(
      {
        userId,
        courseIds: options?.courseIds ?? null,
        moduleHint: options?.moduleHint ?? null,
        fileHint: options?.fileHint ?? null,
      },
      "getStoredChunksForCourses: ingen chunks matchet filteret (kurs ikke indeksert eller hint for spesifikt)",
    );
  }

  return docs.map((doc) => ({
    id: `${doc.courseId}:${doc.fileId}:${doc.chunkIndex}`,
    text: doc.text,
    source: {
      courseId: doc.courseId,
      courseName: doc.courseName,
      moduleTitle: doc.moduleTitle,
      fileName: doc.fileName,
      fileId: doc.fileId,
    },
    index: doc.chunkIndex,
  }));
}

/**
 * Henter alle fulle dokumenter (alle parter per fil) for et kurs.
 * Brukes for kursomfattende oversiktsspørsmål ("forklar forelesningene").
 *
 * Med chunked fullText-lagring kan én fil ha flere parter (chunkIndex -1,
 * -2, -3...). Vi aggregerer per (fileId) og konkatenerer tekst fra alle
 * parter i riktig rekkefølge.
 */
export async function getAllFullDocumentsForCourse(
  userId: string,
  courseId: string,
): Promise<
  Array<{
    fileId: number;
    fileName: string;
    moduleTitle: string;
    fullText: string;
    charCount: number;
    externalUrl?: string;
  }>
> {
  const aggregated = await ContentEmbedding.aggregate<{
    _id: number;
    fileName: string;
    moduleTitle: string;
    charCount: number;
    externalUrl?: string;
    parts: Array<{ chunkIndex: number; fullText?: string; text?: string }>;
  }>([
    { $match: { userId, courseId, chunkIndex: { $lt: 0 } } },
    { $sort: { chunkIndex: -1 } },
    {
      $group: {
        _id: "$fileId",
        fileName: { $first: "$fileName" },
        moduleTitle: { $first: "$moduleTitle" },
        externalUrl: { $first: "$externalUrl" },
        // charCount ligger på part 0 (chunkIndex: -1) = maks av negative
        // indekser. $max over kun positive tall (andre parter er 0) gir
        // den riktige totalen.
        charCount: { $max: { $ifNull: ["$charCount", 0] } },
        parts: { $push: { chunkIndex: "$chunkIndex", fullText: "$fullText", text: "$text" } },
      },
    },
    { $sort: { moduleTitle: 1, fileName: 1 } },
  ]);

  return aggregated
    .map((row) => {
      const fullText = row.parts
        .map((p) => {
          const text =
            typeof p.fullText === "string" && p.fullText.length > 0 ? p.fullText : p.text;
          return text ?? "";
        })
        .join("");
      if (!fullText || fullText.trim().length === 0) return null;
      return {
        fileId: row._id,
        fileName: row.fileName,
        moduleTitle: row.moduleTitle ?? "",
        fullText,
        charCount: row.charCount > 0 ? row.charCount : fullText.length,
        ...(row.externalUrl ? { externalUrl: row.externalUrl } : {}),
      };
    })
    .filter(
      (
        d,
      ): d is {
        fileId: number;
        fileName: string;
        moduleTitle: string;
        fullText: string;
        charCount: number;
      } => d !== null,
    );
}

export async function getStoredFullDocumentForFile(
  userId: string,
  courseId: string,
  fileId: number,
): Promise<{ fullText: string; charCount: number; fileName: string; externalUrl?: string } | null> {
  // Hent alle parter (chunkIndex < 0) og sett dem sammen i rekkefølge
  // -1 → -2 → -3 → ... (part 0 → part 1 → part 2). Eksisterende data som
  // ble skrevet med den gamle single-row-mekanismen har kun chunkIndex: -1,
  // noe som gir nøyaktig samme resultat som før (én part = hele teksten).
  const docs = await ContentEmbedding.find(
    { userId, courseId, fileId, chunkIndex: { $lt: 0 } },
    { _id: 0, fullText: 1, text: 1, charCount: 1, fileName: 1, chunkIndex: 1, externalUrl: 1 },
  )
    .sort({ chunkIndex: -1 })
    .lean();

  if (docs.length === 0) return null;

  const fullText = docs
    .map((d) => {
      const text = typeof d.fullText === "string" && d.fullText.length > 0 ? d.fullText : d.text;
      return text ?? "";
    })
    .join("");
  if (!fullText || fullText.trim().length === 0) return null;

  // charCount er lagret på part 0 (første rad etter sort). Fall tilbake til
  // faktisk konkatenert lengde hvis feltet mangler (defensiv mot eldre data).
  const firstDoc = docs[0];
  const charCount =
    typeof firstDoc.charCount === "number" && firstDoc.charCount > 0
      ? firstDoc.charCount
      : fullText.length;

  return {
    fullText,
    charCount,
    fileName: firstDoc.fileName,
    ...(firstDoc.externalUrl ? { externalUrl: firstDoc.externalUrl } : {}),
  };
}

/** Størrelse per part når fullText splittes over flere MongoDB-rader.
 *  Hver part blir en egen ContentEmbedding-rad med negativ chunkIndex
 *  (-1 = part 0, -2 = part 1, osv.). 500 000 tegn per part gir komfortabel
 *  margin mot Mongo-dokumentets 16 MB-grense samtidig som antall rader per
 *  fil holdes lavt (en 2 MB-fil blir 4 parter). Ingen øvre cap på total
 *  fullText-størrelse — silent truncation er eliminert ved konstruksjon. */
export const FULL_TEXT_PART_SIZE = 500_000;

/**
 * Lagrer full-dokument-tekst delt over én eller flere ContentEmbedding-rader.
 *
 * Tidligere var alt lagret i én rad (chunkIndex: -1) med en hardkodet
 * truncation-cap — filer større enn cap-en mistet sluttinnholdet stille.
 * Nå splittes teksten i parter på FULL_TEXT_PART_SIZE tegn. Hver part
 * lagres i egen rad med chunkIndex -(partIndex+1), slik at unike-indeksen
 * `(userId, courseId, fileId, chunkIndex)` forblir unik uten schema-endring.
 *
 * Garantier:
 *   - Hele teksten lagres (ingen silent truncation)
 *   - charCount på part 0 = total lengde
 *   - contentHash er felles på tvers av alle parter (hash av hele teksten)
 *   - Eksisterende parter slettes før nye skrives (håndterer tilfeller der
 *     ny tekst har færre parter enn forrige versjon)
 */
export async function upsertStoredFullText(options: {
  userId: string;
  courseId: string;
  courseName: string;
  moduleId: number;
  moduleTitle: string;
  fileName: string;
  fileId: number;
  fileHash: string;
  fullText: string;
  externalUrl?: string;
}): Promise<void> {
  const totalChars = options.fullText.length;
  const fullTextHash = crypto.createHash("sha256").update(options.fullText, "utf8").digest("hex");

  // Splitt i parter. Selv tom tekst lagres som én tom part slik at
  // `getStoredFullDocumentForFile` kan skille "fil eksisterer med tom tekst"
  // fra "fil finnes ikke i lageret".
  const parts: string[] = [];
  if (totalChars === 0) {
    parts.push("");
  } else {
    for (let i = 0; i < totalChars; i += FULL_TEXT_PART_SIZE) {
      parts.push(options.fullText.slice(i, i + FULL_TEXT_PART_SIZE));
    }
  }

  // Slett eksisterende parter for filen. Gjør dette før insert så vi ikke
  // etterlater orphan-parter hvis ny tekst er kortere enn forrige versjon.
  await ContentEmbedding.deleteMany({
    userId: options.userId,
    courseId: options.courseId,
    fileId: options.fileId,
    chunkIndex: { $lt: 0 },
  });

  // Insert alle parter i én bulk-operasjon.
  await ContentEmbedding.insertMany(
    parts.map((partText, i) => ({
      userId: options.userId,
      courseId: options.courseId,
      courseName: options.courseName,
      moduleId: options.moduleId,
      moduleTitle: options.moduleTitle,
      fileName: options.fileName,
      fileId: options.fileId,
      fileHash: options.fileHash,
      chunkIndex: -(i + 1), // -1, -2, -3, ...
      text: partText,
      tokenCount: countTokens(partText),
      contentHash: fullTextHash,
      fullText: partText,
      // Total lengde lagres kun på part 0. Andre parter får 0 så $max-
      // aggregeringer som brukes i `kiCourseKnowledge` fortsatt gir riktig
      // total (maks over alle parter = verdien på part 0).
      charCount: i === 0 ? totalChars : 0,
      isFullDocument: true,
      ...(options.externalUrl ? { externalUrl: options.externalUrl } : {}),
    })),
    { ordered: false },
  );
}

/** Maks antall filgrupper som behandles per kjøring for å begrense minnebruk */
const BACKFILL_BATCH_SIZE = 100;
/** Maks antall parallelle backfill-operasjoner */
const BACKFILL_CONCURRENCY = 5;

export async function backfillMissingFullText(): Promise<FullTextBackfillResult> {
  let skip = 0;
  let totalScanned = 0;
  let updatedFiles = 0;

  // Paginer gjennom filgrupper i batcher for å unngå å laste alt i minnet
  while (true) {
    const fileGroups = await ContentEmbedding.aggregate<{
      userId: string;
      courseId: string;
      fileId: number;
      fileName: string;
      hasFullDoc: number;
    }>([
      {
        $group: {
          _id: { userId: "$userId", courseId: "$courseId", fileId: "$fileId" },
          fileName: { $first: "$fileName" },
          hasFullDoc: {
            $sum: {
              $cond: [
                {
                  $and: [
                    { $eq: ["$chunkIndex", -1] },
                    { $eq: ["$isFullDocument", true] },
                    { $gt: [{ $strLenCP: { $ifNull: ["$fullText", ""] } }, 0] },
                  ],
                },
                1,
                0,
              ],
            },
          },
        },
      },
      {
        $project: {
          _id: 0,
          userId: "$_id.userId",
          courseId: "$_id.courseId",
          fileId: "$_id.fileId",
          fileName: 1,
          hasFullDoc: 1,
        },
      },
      { $skip: skip },
      { $limit: BACKFILL_BATCH_SIZE },
    ]);

    if (fileGroups.length === 0) break;
    totalScanned += fileGroups.length;

    const missingGroups = fileGroups.filter((g) => g.hasFullDoc === 0);

    // Begrens parallellitet for å unngå minnetopper
    const limit = (await import("p-limit")).default;
    const limiter = limit(BACKFILL_CONCURRENCY);
    const tasks = missingGroups.map((group) =>
      limiter(async () => {
        const chunks = await ContentEmbedding.find(
          {
            userId: group.userId,
            courseId: group.courseId,
            fileId: group.fileId,
            chunkIndex: { $gte: 0 },
          },
          {
            _id: 0,
            text: 1,
            chunkIndex: 1,
            courseName: 1,
            moduleId: 1,
            moduleTitle: 1,
            fileHash: 1,
            fileName: 1,
          },
        )
          .sort({ chunkIndex: 1 })
          .lean();

        if (chunks.length === 0) return;
        const fullText = chunks.map((chunk) => chunk.text).join("\n\n");
        if (!fullText.trim()) return;

        await upsertStoredFullText({
          userId: group.userId,
          courseId: group.courseId,
          courseName: chunks[0].courseName,
          moduleId: chunks[0].moduleId,
          moduleTitle: chunks[0].moduleTitle,
          fileName: chunks[0].fileName,
          fileId: group.fileId,
          fileHash: chunks[0].fileHash,
          fullText,
        });

        updatedFiles++;
        logger.info(
          { fileId: group.fileId, fileName: group.fileName, charCount: fullText.length },
          "Backfill fullText fullført for fil",
        );
      }),
    );
    await Promise.all(tasks);

    if (fileGroups.length < BACKFILL_BATCH_SIZE) break;
    skip += BACKFILL_BATCH_SIZE;
  }

  return { scannedFiles: totalScanned, updatedFiles };
}

export interface VectorSearchResult {
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

export interface VectorSearchResponse {
  results: VectorSearchResult[];
  /** true hvis Pinecone-søk feilet — kalleren bør falle tilbake til keyword-søk */
  degraded: boolean;
}

export async function vectorSearch(
  userId: string,
  query: string,
  options?: {
    limit?: number;
    courseIds?: string[];
  },
): Promise<VectorSearchResponse> {
  if (!isPineconeConfigured()) return { results: [], degraded: false };
  const trimmedQuery = query?.trim();
  if (!trimmedQuery) return { results: [], degraded: false };
  try {
    const limit = options?.limit ?? 8;
    const matches = await pineconeQuery(trimmedQuery, limit, {
      userId,
      courseIds: options?.courseIds,
    });
    if (matches.length === 0) return { results: [], degraded: false };
    const ids = matches.map((m) => m.id).filter(Boolean);
    const objectIds = ids
      .filter((id) => mongoose.Types.ObjectId.isValid(id))
      .map((id) => new mongoose.Types.ObjectId(id));
    if (objectIds.length === 0) return { results: [], degraded: false };
    const docs = await ContentEmbedding.find(
      { _id: { $in: objectIds }, userId },
      {
        text: 1,
        courseId: 1,
        courseName: 1,
        moduleTitle: 1,
        fileName: 1,
        fileId: 1,
        chunkIndex: 1,
        externalUrl: 1,
      },
    ).lean();
    const byId = new Map(docs.map((d) => [d._id.toString(), d]));
    const results = matches
      .map((m) => {
        const doc = byId.get(m.id);
        if (!doc) return null;
        return {
          text: doc.text,
          score: m.score ?? 0,
          source: {
            courseId: doc.courseId,
            courseName: doc.courseName,
            moduleTitle: doc.moduleTitle,
            fileName: doc.fileName,
            fileId: doc.fileId,
            ...(doc.externalUrl ? { externalUrl: doc.externalUrl } : {}),
          },
          chunkIndex: doc.chunkIndex,
        };
      })
      .filter((r): r is NonNullable<typeof r> => r !== null);
    return { results, degraded: false };
  } catch (error) {
    logger.warn({ err: error, userId }, "Pinecone vectorSearch feilet — degradert modus");
    return { results: [], degraded: true };
  }
}

export async function deleteMissingFilesForCourse(
  userId: string,
  courseId: string,
  keepFileIds: number[],
): Promise<number> {
  if (keepFileIds.length > 0) {
    const match = { userId, courseId, fileId: { $nin: keepFileIds } };
    const agg = await ContentEmbedding.aggregate<{ fileIds: number[] }>([
      { $match: match },
      { $group: { _id: null, fileIds: { $addToSet: "$fileId" } } },
      { $project: { _id: 0, fileIds: 1 } },
    ]);
    const toRemove = agg[0]?.fileIds ?? [];
    const removableFileIds: number[] = [];
    for (const fileId of toRemove) {
      try {
        await pineconeDeleteByFilter({ userId, courseId, fileId });
        removableFileIds.push(fileId);
      } catch (error) {
        logger.warn(
          { err: error, userId, courseId, fileId },
          "Pinecone delete feilet for fil — hopper over MongoDB-sletting for denne filen",
        );
      }
    }
    if (removableFileIds.length === 0) {
      return 0;
    }
    const result = await ContentEmbedding.deleteMany({
      userId,
      courseId,
      fileId: { $in: removableFileIds },
    });
    // Rydd extraction-status for samme filer
    await clearExtractionFailuresForMissingFiles(userId, courseId, keepFileIds);
    return result.deletedCount;
  }
  // GDPR: Pinecone først — feiler dette, slettes ikke MongoDB heller
  await pineconeDeleteByFilter({ userId, courseId });
  const result = await ContentEmbedding.deleteMany({ userId, courseId });
  await clearAllExtractionFailuresForCourse(userId, courseId);
  return result.deletedCount;
}

export async function deleteStoredFileContent(
  userId: string,
  courseId: string,
  fileId: number,
): Promise<number> {
  await pineconeDeleteByFilter({ userId, courseId, fileId });
  const result = await ContentEmbedding.deleteMany({ userId, courseId, fileId });
  await clearExtractionFailure(userId, courseId, fileId);
  return result.deletedCount;
}

export async function deleteStoredCourseContent(userId: string, courseId: string): Promise<number> {
  // GDPR: Slett Pinecone først — hvis det feiler, beholdes MongoDB som konsistent
  await pineconeDeleteByFilter({ userId, courseId });
  const result = await ContentEmbedding.deleteMany({ userId, courseId });
  await clearAllExtractionFailuresForCourse(userId, courseId);
  return result.deletedCount;
}

export async function deleteStoredUserVectors(userId: string): Promise<void> {
  await pineconeDeleteByFilter({ userId });
}

export async function deleteStoredUserMongoContent(
  userId: string,
  session?: ClientSession,
): Promise<number> {
  const result = await ContentEmbedding.deleteMany({ userId }, session ? { session } : undefined);
  await FileExtractionStatus.deleteMany({ userId }, session ? { session } : undefined);
  return result.deletedCount;
}

export async function deleteStoredUserContent(userId: string): Promise<number> {
  // GDPR: Slett Pinecone først — hvis det feiler, beholdes MongoDB som konsistent.
  // deleteStoredUserMongoContent sletter også FileExtractionStatus i samme kall.
  await deleteStoredUserVectors(userId);
  return deleteStoredUserMongoContent(userId);
}

if (isPineconeConfigured()) {
  logger.info(
    { indexName: process.env.PINECONE_INDEX_NAME ?? "studywise", dimensions: EMBEDDING_DIMENSIONS },
    "Pinecone embedding og vector-søk aktivert",
  );
} else {
  logger.info(
    "Pinecone ikke konfigurert (PINECONE_API_KEY/PINECONE_INDEX_NAME) — lagrer kun tekstchunks i MongoDB",
  );
}
