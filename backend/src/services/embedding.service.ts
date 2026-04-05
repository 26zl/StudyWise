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

export async function getStoredCourseCatalog(
  userId: string,
): Promise<StoredCourseCatalogEntry[]> {
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
    docs.map((doc) => [
      doc.fileId,
      { fileHash: doc.fileHash, hasEmbedding: doc.hasEmbedding },
    ]),
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
  }> = [];
  const toUpdate: Array<{ _id: mongoose.Types.ObjectId; text: string; tokenCount: number; contentHash: string }> = [];
  const pineconeRecords: Array<{ id: string; text: string; metadata: { userId: string; courseId: string; moduleId: number; fileId: number; chunkIndex: number } }> = [];

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
      });
    }
  }

  // Slett overskytende chunks (f.eks. filen ble kortere)
  const newMaxIndex = chunks.length - 1;
  const staleIds = existing
    .filter((doc) => doc.chunkIndex > newMaxIndex)
    .map((doc) => doc._id);

  if (staleIds.length > 0) {
    await ContentEmbedding.deleteMany({ _id: { $in: staleIds } });
  }

  // Utfør MongoDB-operasjoner
  if (toUpdate.length > 0) {
    await Promise.all(
      toUpdate.map((u) =>
        ContentEmbedding.updateOne(
          { _id: u._id },
          { $set: { text: u.text, tokenCount: u.tokenCount, contentHash: u.contentHash, fileHash, courseName, moduleId, moduleTitle, fileName } },
        ),
      ),
    );
  }

  if (toInsert.length > 0) {
    const inserted = await ContentEmbedding.insertMany(toInsert, { ordered: true });
    for (let i = 0; i < inserted.length; i++) {
      pineconeRecords.push({
        id: inserted[i]._id.toString(),
        text: toInsert[i].text,
        metadata: { userId, courseId, moduleId, fileId, chunkIndex: toInsert[i].chunkIndex },
      });
    }
  }

  // Synk metadata for eksisterende/skip-poster også, slik at fileHash og modulinfo
  // reflekterer siste Canvas-versjon selv når chunk-tekst er uendret.
  await ContentEmbedding.updateMany(
    { userId, courseId, fileId },
    { $set: { fileHash, courseName, moduleId, moduleTitle, fileName } },
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
    });
  }

  // Slett stale vektorer fra Pinecone
  if (staleIds.length > 0) {
    try {
      await pineconeDeleteByFilter({ userId, courseId, fileId });
    } catch (error) {
      logger.warn(
        { err: error, userId, courseId, fileId },
        "Pinecone delete av stale vektorer feilet",
      );
    }
  }

  // Retry med enkel backoff for Pinecone upsert (MongoDB er allerede lagret)
  const MAX_UPSERT_RETRIES = 2;
  let upsertSuccess = false;
  if (pineconeRecords.length > 0 && isPineconeConfigured()) {
    for (let attempt = 0; attempt <= MAX_UPSERT_RETRIES; attempt++) {
      try {
        await pineconeUpsert(pineconeRecords);
        upsertSuccess = true;
        break;
      } catch (error) {
        if (attempt < MAX_UPSERT_RETRIES) {
          const delayMs = 1000 * (attempt + 1);
          logger.warn(
            { err: error, userId, courseId, fileId, attempt: attempt + 1, maxRetries: MAX_UPSERT_RETRIES },
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
    query.fileName = { $regex: escapeRegex(options.fileHint.replace(/\.pdf$/i, "")), $options: "i" };
  }

  let builder = ContentEmbedding.find(
    query,
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
    .sort({ courseId: 1, fileId: 1, chunkIndex: 1 })
    .lean();

  if (options?.limit && options.limit > 0) {
    builder = builder.limit(options.limit);
  }

  const docs = await builder;

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

export async function getStoredFullDocumentForFile(
  userId: string,
  courseId: string,
  fileId: number,
): Promise<{ fullText: string; charCount: number; fileName: string } | null> {
  const doc = await ContentEmbedding.findOne(
    { userId, courseId, fileId, chunkIndex: -1 },
    { _id: 0, fullText: 1, text: 1, charCount: 1, fileName: 1 },
  ).lean();

  if (!doc) return null;
  const fullText = typeof doc.fullText === "string" && doc.fullText.length > 0
    ? doc.fullText
    : doc.text;
  if (!fullText || fullText.trim().length === 0) return null;

  return {
    fullText,
    charCount: typeof doc.charCount === "number" ? doc.charCount : fullText.length,
    fileName: doc.fileName,
  };
}

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
}): Promise<void> {
  const normalizedFullText = options.fullText.slice(0, 50000);
  const fullTextHash = crypto.createHash("sha256").update(normalizedFullText, "utf8").digest("hex");
  await ContentEmbedding.updateOne(
    { userId: options.userId, courseId: options.courseId, fileId: options.fileId, chunkIndex: -1 },
    {
      $set: {
        courseName: options.courseName,
        moduleId: options.moduleId,
        moduleTitle: options.moduleTitle,
        fileName: options.fileName,
        fileHash: options.fileHash,
        text: normalizedFullText,
        tokenCount: countTokens(normalizedFullText),
        contentHash: fullTextHash,
        fullText: normalizedFullText,
        charCount: options.fullText.length,
        isFullDocument: true,
      },
    },
    { upsert: true },
  );
}

export async function backfillMissingFullText(): Promise<FullTextBackfillResult> {
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
  ]);

  let updatedFiles = 0;
  for (const group of fileGroups) {
    if (group.hasFullDoc > 0) continue;

    const chunks = await ContentEmbedding.find(
      { userId: group.userId, courseId: group.courseId, fileId: group.fileId, chunkIndex: { $gte: 0 } },
      { _id: 0, text: 1, chunkIndex: 1, courseName: 1, moduleId: 1, moduleTitle: 1, fileHash: 1, fileName: 1 },
    ).sort({ chunkIndex: 1 }).lean();

    if (chunks.length === 0) continue;
    const fullText = chunks.map((chunk) => chunk.text).join("\n\n");
    if (!fullText.trim()) continue;

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
  }

  return { scannedFiles: fileGroups.length, updatedFiles };
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
      { text: 1, courseId: 1, courseName: 1, moduleTitle: 1, fileName: 1, fileId: 1, chunkIndex: 1 },
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
    return result.deletedCount;
  }
  // GDPR: Pinecone først — feiler dette, slettes ikke MongoDB heller
  await pineconeDeleteByFilter({ userId, courseId });
  const result = await ContentEmbedding.deleteMany({ userId, courseId });
  return result.deletedCount;
}

export async function deleteStoredFileContent(
  userId: string,
  courseId: string,
  fileId: number,
): Promise<number> {
  await pineconeDeleteByFilter({ userId, courseId, fileId });
  const result = await ContentEmbedding.deleteMany({ userId, courseId, fileId });
  return result.deletedCount;
}

export async function deleteStoredCourseContent(
  userId: string,
  courseId: string,
): Promise<number> {
  // GDPR: Slett Pinecone først — hvis det feiler, beholdes MongoDB som konsistent
  await pineconeDeleteByFilter({ userId, courseId });
  const result = await ContentEmbedding.deleteMany({ userId, courseId });
  return result.deletedCount;
}

export async function deleteStoredUserVectors(userId: string): Promise<void> {
  await pineconeDeleteByFilter({ userId });
}

export async function deleteStoredUserMongoContent(
  userId: string,
  session?: ClientSession,
): Promise<number> {
  const result = await ContentEmbedding.deleteMany(
    { userId },
    session ? { session } : undefined,
  );
  return result.deletedCount;
}

export async function deleteStoredUserContent(userId: string): Promise<number> {
  // GDPR: Slett Pinecone først — hvis det feiler, beholdes MongoDB som konsistent
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
