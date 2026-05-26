/**
 * KI Course Knowledge – aggregert oversikt over hva KI har indeksert for et kurs.
 *
 * Brukes av "Hva vet jeg om kurset"-panelet i frontend slik at brukeren ser
 * tydelig hvilke filer KI faktisk kan svare basert på.
 */
import { Router } from "express";
import { ContentEmbedding } from "../../database/models/ContentEmbedding.js";
import { logger } from "../../utils/logger.js";
import { apiError, sendUnknownError, requireUserId } from "../../utils/apiError.js";
import { CourseKnowledgeResponseSchema } from "common/ki";

export const kiCourseKnowledgeRouter = Router();

// GET /course-knowledge/:courseId - aggreger filer/chunks for et kurs
kiCourseKnowledgeRouter.get("/course-knowledge/:courseId", async (req, res) => {
  try {
    const userId = requireUserId(req, res);
    if (!userId) return;

    const courseId = String(req.params.courseId || "").trim();
    if (!courseId) {
      return apiError.badRequest(res, "courseId mangler");
    }

    // Aggreger per fil. Ekskluder full-dokument-poster (chunkIndex=-1) fra chunkCount.
    const aggregert = await ContentEmbedding.aggregate<{
      _id: { fileId: number; fileName: string };
      chunkCount: number;
      charCount: number;
      lastUpdated: Date;
      courseName: string;
    }>([
      { $match: { userId, courseId } },
      {
        $group: {
          _id: { fileId: "$fileId", fileName: "$fileName" },
          chunkCount: {
            $sum: { $cond: [{ $eq: ["$isFullDocument", true] }, 0, 1] },
          },
          charCount: { $max: { $ifNull: ["$charCount", 0] } },
          lastUpdated: { $max: "$updatedAt" },
          courseName: { $first: "$courseName" },
        },
      },
      { $sort: { "_id.fileName": 1 } },
      { $limit: 500 },
    ]);

    const files = aggregert.map((row) => ({
      fileId: row._id.fileId,
      fileName: row._id.fileName,
      chunkCount: row.chunkCount,
      charCount: row.charCount > 0 ? row.charCount : undefined,
      lastUpdated: row.lastUpdated ? row.lastUpdated.toISOString() : undefined,
    }));

    const totalChunks = files.reduce((sum, f) => sum + f.chunkCount, 0);
    const courseName = aggregert[0]?.courseName ?? "";

    const payload = CourseKnowledgeResponseSchema.parse({
      courseId,
      courseName,
      fileCount: files.length,
      totalChunks,
      files,
    });

    res.json(payload);
  } catch (error) {
    logger.error({ error }, "Feil ved henting av course-knowledge");
    sendUnknownError(res, error, { kontekst: "course-knowledge" });
  }
});
