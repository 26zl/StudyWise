/**
 * Content Store / Embedding Service
 *
 * Lagrer filchunks i MongoDB (tekst + metadata). Vektorer lagres i Pinecone
 * og genereres via Pinecone Inference (multilingual-e5-large). Semantisk søk
 * bruker Pinecone; keyword-søk og katalog bruker kun MongoDB.
 */

import mongoose from "mongoose";
import { logger } from "../utils/logger.js";
import { ContentEmbedding } from "../database/models/ContentEmbedding.js";
import type { ContentChunk } from "./chunk.service.js";
import {
  isPineconeConfigured,
  EMBEDDING_DIMENSIONS,
  pineconeUpsert,
  pineconeQuery,
  pineconeDeleteByFilter,
} from "./pinecone.service.js";

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

export interface StoredCourseCatalogEntry {
  courseId: string;
  courseName: string;
  moduleTitles: string[];
  fileNames: string[];
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
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
 * Henter lagret fileHash per fil i et kurs.
 * Når Pinecone er aktiv brukes vektorer der; vi regner da alle lagrede chunks som vectorisert.
 */
export async function getStoredFileStatusForCourse(
  userId: string,
  courseId: string,
): Promise<Map<number, StoredFileStatus>> {
  const docs = await ContentEmbedding.aggregate<{
    fileId: number;
    fileHash: string;
  }>([
    { $match: { userId, courseId } },
    { $group: { _id: "$fileId", fileHash: { $first: "$fileHash" } } },
    { $project: { _id: 0, fileId: "$_id", fileHash: 1 } },
  ]);
  const hasVector = isEmbeddingAvailable();
  return new Map(
    docs.map((doc) => [
      doc.fileId,
      { fileHash: doc.fileHash, hasEmbedding: hasVector },
    ]),
  );
}

/**
 * Lagrer alle chunks for én fil i MongoDB og vektorer i Pinecone. Eksisterende chunks for filen erstattes.
 */
export async function upsertStoredFileContent(options: {
  userId: string;
  courseId: string;
  courseName: string;
  moduleTitle: string;
  fileName: string;
  fileId: number;
  fileHash: string;
  chunks: ContentChunk[];
}): Promise<number> {
  const {
    userId,
    courseId,
    courseName,
    moduleTitle,
    fileName,
    fileId,
    fileHash,
    chunks,
  } = options;

  if (chunks.length === 0) return 0;

  const startTime = Date.now();
  await pineconeDeleteByFilter({ userId, courseId, fileId });
  await ContentEmbedding.deleteMany({ userId, courseId, fileId });

  const documents = chunks.map((chunk) => ({
    userId,
    courseId,
    courseName,
    moduleTitle,
    fileName,
    fileId,
    fileHash,
    chunkIndex: chunk.index,
    text: chunk.text,
  }));
  const inserted = await ContentEmbedding.insertMany(documents, { ordered: true });

  try {
    await pineconeUpsert(
      inserted.map((doc, i) => ({
        id: doc._id.toString(),
        text: chunks[i].text,
        metadata: { userId, courseId, fileId },
      })),
    );
  } catch (error) {
    logger.warn(
      { err: error, userId, courseId, fileId },
      "Pinecone upsert (integrated) feilet — chunks lagret i MongoDB uten vektorer",
    );
  }

  logger.info(
    {
      userId,
      courseId,
      fileId,
      fileName,
      chunkCount: chunks.length,
      elapsedMs: Date.now() - startTime,
    },
    "Filchunks lagret i MongoDB og Pinecone",
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
    { userId, courseId, fileId },
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
  const query: Record<string, unknown> = { userId };

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

export async function vectorSearch(
  userId: string,
  query: string,
  options?: {
    limit?: number;
    courseIds?: string[];
  },
): Promise<
  Array<{
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
  }>
> {
  if (!isPineconeConfigured()) return [];
  const trimmedQuery = query?.trim();
  if (!trimmedQuery) return [];
  try {
    const limit = options?.limit ?? 8;
    const matches = await pineconeQuery(trimmedQuery, limit, {
      userId,
      courseIds: options?.courseIds,
    });
    if (matches.length === 0) return [];
    const ids = matches.map((m) => m.id).filter(Boolean);
    const objectIds = ids
      .filter((id) => mongoose.Types.ObjectId.isValid(id))
      .map((id) => new mongoose.Types.ObjectId(id));
    if (objectIds.length === 0) return [];
    const docs = await ContentEmbedding.find(
      { _id: { $in: objectIds } },
      { text: 1, courseId: 1, courseName: 1, moduleTitle: 1, fileName: 1, fileId: 1, chunkIndex: 1 },
    ).lean();
    const byId = new Map(docs.map((d) => [d._id.toString(), d]));
    return matches
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
  } catch (error) {
    logger.warn({ err: error, userId }, "Pinecone vectorSearch feilet");
    return [];
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
    for (const fileId of toRemove) {
      await pineconeDeleteByFilter({ userId, courseId, fileId });
    }
    const result = await ContentEmbedding.deleteMany({
      userId,
      courseId,
      fileId: { $nin: keepFileIds },
    });
    return result.deletedCount;
  }
  await pineconeDeleteByFilter({ userId, courseId });
  const result = await ContentEmbedding.deleteMany({ userId, courseId });
  return result.deletedCount;
}

export async function deleteStoredCourseContent(
  userId: string,
  courseId: string,
): Promise<number> {
  await pineconeDeleteByFilter({ userId, courseId });
  const result = await ContentEmbedding.deleteMany({ userId, courseId });
  return result.deletedCount;
}

export async function deleteStoredUserContent(userId: string): Promise<number> {
  await pineconeDeleteByFilter({ userId });
  const result = await ContentEmbedding.deleteMany({ userId });
  return result.deletedCount;
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
