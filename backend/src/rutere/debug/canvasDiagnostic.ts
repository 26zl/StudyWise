/**
 * Canvas Diagnostic Route (dev-only)
 *
 * GET /api/debug/canvas-content?q=<søkeord>
 * Viser lagrede chunks i MongoDB, søkeresultater og filtilgjengelighet for en bruker.
 * Kun tilgjengelig i utvikling (ikke prod).
 */

import { Router, type Request, type Response } from "express";
import { logger } from "../../utils/logger.js";
import { getCache, isRedisReady } from "../../cache/redis.js";
import { userKey } from "../../services/canvas-sync.service.js";
import { searchChunks } from "../../services/chunk.service.js";
import { getStoredChunksForCourse } from "../../services/embedding.service.js";
import { extractSearchTerms } from "../../services/semantic-search.service.js";
import { isProd } from "../../utils/env.js";

const router = Router();

router.get("/canvas-content", async (req: Request, res: Response) => {
  if (isProd) {
    return res.status(404).json({ error: "Not available in production" });
  }

  if (!req.user?.id) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const userId = req.user.id;
  const query = typeof req.query.q === "string" ? req.query.q : "";

  if (!isRedisReady()) {
    return res.json({ error: "Redis not available" });
  }

  try {
    // Hent emner
    const emnerRaw = await getCache(userKey(userId, "emner"));
    const emner = emnerRaw
      ? (JSON.parse(emnerRaw) as Array<{ id: number; name: string; course_code?: string }>)
      : [];

    // Samle diagnostikk for hvert emne
    const courses = [];
    let totalChunks = 0;
    const allChunks = [];

    for (const emne of emner) {
      const courseId = String(emne.id);
      const chunks = await getStoredChunksForCourse(userId, courseId);
      totalChunks += chunks.length;
      allChunks.push(...chunks);

      // Tell unike filer i chunks
      const files = new Set(chunks.map((c) => c.source.fileName));

      courses.push({
        id: emne.id,
        name: emne.name,
        courseCode: emne.course_code,
        chunkCount: chunks.length,
        fileCount: files.size,
        files: [...files],
      });
    }

    // Søkeresultater (hvis query er oppgitt)
    let searchResults = null;
    if (query) {
      const terms = extractSearchTerms(query);
      const scored = searchChunks(allChunks, query);
      searchResults = {
        query,
        terms,
        matchCount: scored.length,
        results: scored.slice(0, 5).map((s) => ({
          score: Math.round(s.score * 100) / 100,
          source: s.source,
          chunkIndex: s.index,
          preview: s.text.substring(0, 200) + (s.text.length > 200 ? "..." : ""),
        })),
      };
    }

    return res.json({
      userId,
      courseCount: emner.length,
      totalChunks,
      courses,
      searchResults,
    });
  } catch (error) {
    logger.error({ err: error }, "Canvas diagnostic error");
    return res.status(500).json({ error: "Internal error" });
  }
});

export default router;
