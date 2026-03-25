/**
 * Admin brukeradministrasjon.
 * Monteres under /api/admin (allerede beskyttet med requireAuth + requireRole("admin")).
 *
 * Endepunkter:
 *   GET    /brukere           – Liste brukere (paginert, søkbar på e-post)
 *   PATCH  /brukere/:id/rolle – Endre brukerrolle
 *   DELETE /brukere/:id       – Slett bruker og all relatert data
 */
import { Router } from "express";
import { z } from "zod";
import { RoleSchema } from "common/auth";
import { User } from "../../../database/models/User.js";
import { ChatHistory } from "../../../database/models/ChatHistory.js";
import { TaskBreakdown } from "../../../database/models/TaskBreakdown.js";
import { Arbeidsplan } from "../../../database/models/arbeidsplan.js";
import { ContentEmbedding } from "../../../database/models/ContentEmbedding.js";
import { apiError, requireUserId, sendZodError } from "../../../utils/apiError.js";
import { audit, AUDIT_ACTIONS } from "../../../utils/auditLog.js";
import { logger } from "../../../utils/logger.js";

const router = Router();

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;
const MAX_OFFSET = 10_000;

// ── GET /brukere ────────────────────────────────────────────────────────────
router.get("/brukere", async (req, res) => {
  const actorUserId = requireUserId(req, res);
  if (!actorUserId) return;

  const limit = Math.min(
    Math.max(0, parseInt(String(req.query.limit), 10) || DEFAULT_LIMIT),
    MAX_LIMIT,
  );
  const offset = Math.min(
    Math.max(0, parseInt(String(req.query.offset), 10) || 0),
    MAX_OFFSET,
  );
  const search = typeof req.query.search === "string" ? req.query.search.trim() : undefined;

  try {
    const filter: Record<string, unknown> = { deletedAt: { $exists: false } };
    if (search && search.length > 0) {
      filter.email = { $regex: search, $options: "i" };
    }

    const [brukere, total] = await Promise.all([
      User.find(filter)
        .select("email role username firstName lastName canvasBaseUrl authProvider createdAt")
        .sort({ createdAt: -1 })
        .skip(offset)
        .limit(limit)
        .lean(),
      User.countDocuments(filter),
    ]);

    await audit({
      actorUserId,
      action: AUDIT_ACTIONS.ADMIN_ACTION,
      category: "admin",
      outcome: "success",
      role: req.actorRole,
      metadata: { subAction: "brukere.list", limit, offset },
      req,
    });

    return res.json({
      brukere: brukere.map((b) => ({
        id: b._id,
        email: b.email,
        rolle: b.role,
        brukernavn: b.username,
        fornavn: b.firstName,
        etternavn: b.lastName,
        harCanvasToken: Boolean(b.canvasBaseUrl),
        authProvider: b.authProvider,
        opprettet: b.createdAt,
      })),
      total,
      limit,
      offset,
    });
  } catch (err) {
    logger.error({ err }, "Admin brukerliste feilet");
    return apiError.serverError(res);
  }
});

// ── PATCH /brukere/:id/rolle ────────────────────────────────────────────────
const EndreRolleSchema = z.object({
  rolle: RoleSchema,
});

router.patch("/brukere/:id/rolle", async (req, res) => {
  const actorUserId = requireUserId(req, res);
  if (!actorUserId) return;

  const targetId = req.params.id;

  // Kan ikke endre egen rolle
  if (targetId === actorUserId) {
    return apiError.badRequest(res, "Du kan ikke endre din egen rolle");
  }

  const parsed = EndreRolleSchema.safeParse(req.body);
  if (!parsed.success) {
    return sendZodError(res, parsed.error, "rolle");
  }

  try {
    const bruker = await User.findById(targetId);
    if (!bruker || bruker.deletedAt) {
      return apiError.notFound(res, "Bruker");
    }

    const gammelRolle = bruker.role;
    bruker.role = parsed.data.rolle;
    await bruker.save();

    await audit({
      actorUserId,
      action: AUDIT_ACTIONS.ADMIN_ACTION,
      category: "admin",
      outcome: "success",
      role: req.actorRole,
      targetUserId: targetId,
      metadata: {
        subAction: "brukere.endreRolle",
        gammelRolle,
        nyRolle: parsed.data.rolle,
      },
      req,
    });

    return res.json({ id: targetId, rolle: parsed.data.rolle });
  } catch (err) {
    logger.error({ err }, "Admin rolleendring feilet");
    return apiError.serverError(res);
  }
});

// ── DELETE /brukere/:id ─────────────────────────────────────────────────────
router.delete("/brukere/:id", async (req, res) => {
  const actorUserId = requireUserId(req, res);
  if (!actorUserId) return;

  const targetId = req.params.id;

  // Kan ikke slette seg selv
  if (targetId === actorUserId) {
    return apiError.badRequest(res, "Du kan ikke slette din egen konto herfra");
  }

  try {
    const bruker = await User.findById(targetId);
    if (!bruker || bruker.deletedAt) {
      return apiError.notFound(res, "Bruker");
    }

    // Slett relatert data parallelt
    await Promise.all([
      ChatHistory.deleteMany({ user: targetId }),
      TaskBreakdown.deleteMany({ user: targetId }),
      Arbeidsplan.deleteMany({ userId: targetId }),
      ContentEmbedding.deleteMany({ userId: targetId }),
    ]);

    // Soft-delete brukeren (setter deletedAt)
    bruker.deletedAt = new Date();
    await bruker.save();

    await audit({
      actorUserId,
      action: AUDIT_ACTIONS.ADMIN_ACTION,
      category: "admin",
      outcome: "success",
      role: req.actorRole,
      targetUserId: targetId,
      metadata: { subAction: "brukere.slett" },
      req,
    });

    return res.json({ slettet: true });
  } catch (err) {
    logger.error({ err }, "Admin brukersletting feilet");
    return apiError.serverError(res);
  }
});

export default router;
