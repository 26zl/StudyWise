/**
 * Admin plattformstatistikk.
 * Monteres under /api/admin (allerede beskyttet med requireAuth + requireRole("admin")).
 *
 * Endepunkt:
 *   GET /statistikk – Aggregerte nøkkeltall for plattformen
 */
import { Router } from "express";
import { AdminStatsResponseSchema } from "common/admin";
import { User } from "../../../database/models/User.js";
import { ChatHistory } from "../../../database/models/ChatHistory.js";
import { TaskBreakdown } from "../../../database/models/TaskBreakdown.js";
import { ContentEmbedding } from "../../../database/models/ContentEmbedding.js";
import { apiError, requireUserId } from "../../../utils/apiError.js";
import { audit, AUDIT_ACTIONS } from "../../../utils/auditLog.js";
import { logger } from "../../../utils/logger.js";

const router = Router();

const ACTIVE_FILTER = { deletedAt: { $exists: false } };

router.get("/statistikk", async (req, res) => {
  const actorUserId = requireUserId(req, res);
  if (!actorUserId) return;

  try {
    const [
      totalBrukere,
      antallAdmin,
      antallMedCanvas,
      totalSamtaler,
      totalOppgaver,
      totalEmbeddings,
    ] = await Promise.all([
      User.countDocuments(ACTIVE_FILTER),
      User.countDocuments({ ...ACTIVE_FILTER, role: "admin" }),
      User.countDocuments({ ...ACTIVE_FILTER, canvasBaseUrl: { $exists: true, $ne: null } }),
      ChatHistory.countDocuments(),
      TaskBreakdown.countDocuments(),
      ContentEmbedding.countDocuments(),
    ]);

    await audit({
      actorUserId,
      action: AUDIT_ACTIONS.ADMIN_ACTION,
      category: "admin",
      outcome: "success",
      role: req.actorRole,
      metadata: { subAction: "statistikk.hent" },
      req,
    });

    return res.json(
      AdminStatsResponseSchema.parse({
      brukere: {
        totalt: totalBrukere,
        admin: antallAdmin,
        vanlige: totalBrukere - antallAdmin,
        medCanvas: antallMedCanvas,
      },
      samtaler: totalSamtaler,
      oppgaveoppdelinger: totalOppgaver,
      embeddings: totalEmbeddings,
      }),
    );
  } catch (err) {
    logger.error({ err }, "Admin statistikk feilet");
    return apiError.serverError(res);
  }
});

export default router;
