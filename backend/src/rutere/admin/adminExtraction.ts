/**
 * Admin extraction-failures.
 * Monteres under /api/admin (allerede beskyttet med requireAuth + requireRole("admin")).
 *
 * Endepunkter:
 *   GET    /extraction-failures              — Liste over alle filer som ikke kunne ekstraheres
 *   DELETE /extraction-failures/:id          — Slett én enkelt status-rad (f.eks. etter manuell OCR)
 *
 * Hvorfor:
 * - Bilde-baserte PPTX og korrupte filer fanges opp under sync og lagres i
 *   FileExtractionStatus. Admin trenger synlighet slik at de kan følge opp
 *   (kontakte studenter, kjøre OCR manuelt, rapportere inn til emneansvarlig).
 */
import { Router } from "express";
import { z } from "zod";
import {
  listExtractionFailuresForAdmin,
  rescanForSparseExtractions,
} from "../../services/file-extraction-status.service.js";
import { FileExtractionStatus } from "../../database/models/FileExtractionStatus.js";
import { apiError, requireUserId, sendUnknownError, sendZodError } from "../../utils/apiError.js";
import { audit, AUDIT_ACTIONS } from "../../utils/auditLog.js";
import { requireRecentAuth } from "../../middleware/auth.js";
import { logger } from "../../utils/logger.js";

const router = Router();

const STATUS_ENUM = z.enum(["empty", "sparse", "failed", "too_large", "unsupported"]);

const ListQuerySchema = z.object({
  courseId: z.string().optional(),
  status: STATUS_ENUM.optional(),
  limit: z.coerce.number().int().positive().max(500).optional(),
  skip: z.coerce.number().int().nonnegative().optional(),
});

router.get("/extraction-failures", async (req, res) => {
  const actorUserId = requireUserId(req, res);
  if (!actorUserId) return;

  const parsed = ListQuerySchema.safeParse(req.query);
  if (!parsed.success) return sendZodError(res, parsed.error);

  try {
    const { items, total } = await listExtractionFailuresForAdmin({
      courseId: parsed.data.courseId,
      status: parsed.data.status,
      limit: parsed.data.limit ?? 100,
      skip: parsed.data.skip ?? 0,
    });

    return res.json({
      total,
      items: items.map((item) => ({
        id: String(item._id),
        userId: item.userId,
        courseId: item.courseId,
        courseName: item.courseName,
        moduleId: item.moduleId ?? null,
        moduleTitle: item.moduleTitle ?? null,
        fileName: item.fileName,
        fileId: item.fileId,
        status: item.status,
        reason: item.reason ?? null,
        attemptCount: item.attemptCount,
        lastAttempt: item.lastAttempt.toISOString(),
        createdAt: item.createdAt.toISOString(),
        updatedAt: item.updatedAt.toISOString(),
      })),
    });
  } catch (err) {
    logger.error({ err }, "Admin extraction-failures listing feilet");
    return sendUnknownError(res, err);
  }
});

router.delete("/extraction-failures/:id", requireRecentAuth, async (req, res) => {
  const actorUserId = requireUserId(req, res);
  if (!actorUserId) return;

  const id = String(req.params.id ?? "");
  if (!id || !/^[a-f0-9]{24}$/i.test(id)) {
    return apiError.badRequest(res, "Ugyldig id");
  }

  try {
    const deleted = await FileExtractionStatus.findByIdAndDelete(id).lean();
    if (!deleted) {
      return apiError.notFound(res, "Extraction-status ikke funnet");
    }
    await audit({
      req,
      action: AUDIT_ACTIONS.ADMIN_ACTION,
      category: "admin",
      outcome: "success",
      actorUserId,
      metadata: {
        operation: "delete-extraction-failure",
        fileId: deleted.fileId,
        fileName: deleted.fileName,
        courseId: deleted.courseId,
      },
    });
    return res.json({ ok: true });
  } catch (err) {
    logger.error({ err, id }, "Sletting av FileExtractionStatus feilet");
    return sendUnknownError(res, err);
  }
});

router.post("/extraction-failures/rescan", requireRecentAuth, async (req, res) => {
  const actorUserId = requireUserId(req, res);
  if (!actorUserId) return;

  try {
    const result = await rescanForSparseExtractions();
    await audit({
      req,
      action: AUDIT_ACTIONS.ADMIN_ACTION,
      category: "admin",
      outcome: "success",
      actorUserId,
      metadata: {
        operation: "rescan-extraction-failures",
        ...result,
      },
    });
    return res.json(result);
  } catch (err) {
    logger.error({ err }, "Retroaktiv sparse-skann feilet");
    return sendUnknownError(res, err);
  }
});

export default router;
