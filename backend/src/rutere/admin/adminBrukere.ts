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
import {
  AdminBrukereQuerySchema,
  AdminBrukerListeResponseSchema,
  AdminEndreRolleResponseSchema,
  AdminEndreRolleSchema,
  AdminSlettBrukerResponseSchema,
} from "common/admin";
import { User } from "../../database/models/User.js";
import { apiError, requireUserId, sendZodError } from "../../utils/apiError.js";
import {
  anonymizeAuditTrailForDeletedUser,
  audit,
  AUDIT_ACTIONS,
  getDeletedAuditActorId,
} from "../../utils/auditLog.js";
import { logger } from "../../utils/logger.js";
import { isValidMongoObjectId } from "../../utils/mongoId.js";
import { deleteAccountData } from "../auth/kontoSlett.js";

const router = Router();

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;
const MAX_OFFSET = 10_000;

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// ── GET /brukere ────────────────────────────────────────────────────────────
router.get("/brukere", async (req, res) => {
  const actorUserId = requireUserId(req, res);
  if (!actorUserId) return;

  const parsedQuery = AdminBrukereQuerySchema.safeParse(req.query);
  if (!parsedQuery.success) {
    return sendZodError(res, parsedQuery.error, "adminBrukere.query");
  }

  const limit = Math.min(
    Math.max(1, parseInt(parsedQuery.data.limit ?? String(DEFAULT_LIMIT), 10) || DEFAULT_LIMIT),
    MAX_LIMIT,
  );
  const offset = Math.min(
    Math.max(0, parseInt(parsedQuery.data.offset ?? "0", 10) || 0),
    MAX_OFFSET,
  );
  const search = parsedQuery.data.search?.trim();

  try {
    const filter: Record<string, unknown> = { deletedAt: { $exists: false } };
    if (search && search.length > 0) {
      filter.email = { $regex: escapeRegex(search), $options: "i" };
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

    const response = AdminBrukerListeResponseSchema.parse({
      brukere: brukere.map((b) => ({
        id: String(b._id),
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
    return res.json(response);
  } catch (err) {
    logger.error({ err }, "Admin brukerliste feilet");
    return apiError.serverError(res);
  }
});

// ── PATCH /brukere/:id/rolle ────────────────────────────────────────────────
router.patch("/brukere/:id/rolle", async (req, res) => {
  const actorUserId = requireUserId(req, res);
  if (!actorUserId) return;

  const targetId = req.params.id;

  if (!isValidMongoObjectId(targetId)) {
    return apiError.badRequest(res, "Ugyldig bruker-ID");
  }

  // Kan ikke endre egen rolle
  if (targetId === actorUserId) {
    return apiError.badRequest(res, "Du kan ikke endre din egen rolle");
  }

  const parsed = AdminEndreRolleSchema.safeParse(req.body);
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

    return res.json(
      AdminEndreRolleResponseSchema.parse({ id: targetId, rolle: parsed.data.rolle }),
    );
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

  if (!isValidMongoObjectId(targetId)) {
    return apiError.badRequest(res, "Ugyldig bruker-ID");
  }

  // Kan ikke slette seg selv
  if (targetId === actorUserId) {
    return apiError.badRequest(res, "Du kan ikke slette din egen konto herfra");
  }

  try {
    const bruker = await User.findById(targetId);
    if (!bruker || bruker.deletedAt) {
      return apiError.notFound(res, "Bruker");
    }

    const deletionResult = await deleteAccountData(targetId);
    const deletedAuditActorId = getDeletedAuditActorId(targetId);

    await audit({
      actorUserId,
      action: AUDIT_ACTIONS.ADMIN_ACTION,
      category: "admin",
      outcome: "success",
      role: req.actorRole,
      targetUserId: deletedAuditActorId,
      metadata: {
        subAction: "brukere.slett",
        deleted: deletionResult.deleted,
        providerAccountDeleted: deletionResult.providerAccountDeleted,
        vectorCleanupSucceeded: deletionResult.vectorCleanupSucceeded,
      },
      req,
    });

    try {
      await anonymizeAuditTrailForDeletedUser(targetId);
    } catch (auditError) {
      logger.warn(
        { err: auditError, targetUserId: targetId },
        "Klarte ikke å anonymisere revisjonsspor etter admin-sletting",
      );
    }

    return res.json(
      AdminSlettBrukerResponseSchema.parse({
      slettet: true,
      deleted: deletionResult.deleted,
      providerAccountDeleted: deletionResult.providerAccountDeleted,
      vectorCleanupSucceeded: deletionResult.vectorCleanupSucceeded,
      }),
    );
  } catch (err) {
    logger.error({ err }, "Admin brukersletting feilet");
    return apiError.serverError(res);
  }
});

export default router;
