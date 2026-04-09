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
  AdminBrukerDetaljSchema,
  AdminBrukereQuerySchema,
  AdminBrukerListeResponseSchema,
  AdminEndreRolleResponseSchema,
  AdminEndreRolleSchema,
  AdminLockUserResponseSchema,
  AdminLockUserSchema,
  AdminUnlockUserResponseSchema,
  AdminSlettBrukerResponseSchema,
  AdminSuccessResponseSchema,
  AdminRevokeSessionsResponseSchema,
} from "common/admin";
import { User } from "../../database/models/User.js";
import { ChatHistory } from "../../database/models/ChatHistory.js";
import { SharedChat } from "../../database/models/SharedChat.js";
import { TaskBreakdown } from "../../database/models/TaskBreakdown.js";
import { Arbeidsplan } from "../../database/models/arbeidsplan.js";
import { ContentEmbedding } from "../../database/models/ContentEmbedding.js";
import { CanvasStructureModel } from "../../database/models/CanvasStructure.js";
import { KnowledgeBase } from "../../database/models/Kunnskapsbase.js";
import { KBContentChunk } from "../../database/models/KBContentChunk.js";
import { WebPushSubscriptionModel } from "../../database/models/WebPushSubscription.js";
import { AuditLog } from "../../database/models/AuditLog.js";
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
import {
  revokeAllClerkSessions,
  resendClerkEmailVerification,
} from "../auth/clerkAuth.js";
import { escapeRegex } from "../../utils/regexUtils.js";
import { requireRecentAuth } from "../../middleware/auth.js";
import { deleteCacheKeys } from "../../cache/redis.js";
import { RELINK_STATE_KEY_PREFIX } from "../auth/relinkGuard.js";

const router = Router();

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;
const MAX_OFFSET = 10_000;

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

  const status = parsedQuery.data.status ?? "active";

  try {
    // Status-filter: aktive (default) / låste / slettede / alle
    const filter: Record<string, unknown> = {};
    if (status === "active") {
      filter.deletedAt = { $exists: false };
      filter.lockedAt = { $exists: false };
    } else if (status === "locked") {
      filter.deletedAt = { $exists: false };
      filter.lockedAt = { $exists: true };
    } else if (status === "deleted") {
      filter.deletedAt = { $exists: true };
    }
    // "all" → ingen filter på deletedAt eller lockedAt — vis ALT

    // Søk på e-post ELLER navn ELLER brukernavn
    if (search && search.length > 0) {
      const safe = escapeRegex(search);
      filter.$or = [
        { email: { $regex: safe, $options: "i" } },
        { firstName: { $regex: safe, $options: "i" } },
        { lastName: { $regex: safe, $options: "i" } },
        { username: { $regex: safe, $options: "i" } },
      ];
    }

    // allow-deleted-users: status-filteret styrer eksplisitt om vi inkluderer deleted/locked
    // brukere via filter-objektet over (lint-scriptet ser ikke gjennom dynamisk filter-bygging)
    const [brukere, total] = await Promise.all([
      User.find(filter)
        .select("email role username firstName lastName canvasBaseUrl authProviders createdAt lockedAt lockedReason deletedAt")
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
        authProviders: b.authProviders ?? [],
        opprettet: b.createdAt,
        locked: !!b.lockedAt,
        lockedAt: b.lockedAt ?? undefined,
        lockedReason: b.lockedReason ?? undefined,
        deletedAt: b.deletedAt ?? undefined,
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
router.patch("/brukere/:id/rolle", requireRecentAuth, async (req, res) => {
  const actorUserId = requireUserId(req, res);
  if (!actorUserId) return;

  const targetId = String(req.params.id);

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

    // Sikkerhetsvarsel ved oppgradering til admin-rolle
    const isAdminPromotion = gammelRolle !== "admin" && parsed.data.rolle === "admin";

    await audit({
      actorUserId,
      action: AUDIT_ACTIONS.ADMIN_ACTION,
      category: isAdminPromotion ? "security" : "admin",
      outcome: "success",
      role: req.actorRole,
      targetUserId: targetId,
      metadata: {
        subAction: "brukere.endreRolle",
        gammelRolle,
        nyRolle: parsed.data.rolle,
        ...(isAdminPromotion && { securityAlert: "admin_promotion" }),
      },
      req,
    });

    if (isAdminPromotion) {
      logger.warn(
        { actorUserId, targetUserId: targetId },
        "SIKKERHETSVARSEL: Admin forfremmet en bruker til admin-rolle",
      );
    }

    return res.json(
      AdminEndreRolleResponseSchema.parse({ id: targetId, rolle: parsed.data.rolle }),
    );
  } catch (err) {
    logger.error({ err }, "Admin rolleendring feilet");
    return apiError.serverError(res);
  }
});

// ── DELETE /brukere/:id ─────────────────────────────────────────────────────
router.delete("/brukere/:id", requireRecentAuth, async (req, res) => {
  const actorUserId = requireUserId(req, res);
  if (!actorUserId) return;

  const targetId = String(req.params.id);

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

// ── DELETE /brukere/:id/relink-guard ────────────────────────────────────────
// Tømmer Redis relink-state for en bruker som har satt seg fast i ping-pong-
// guarden (typisk etter Clerk dev/prod-bytte). Lar brukeren logge inn på nytt
// uten å vente på TTL.
router.delete("/brukere/:id/relink-guard", requireRecentAuth, async (req, res) => {
  const actorUserId = requireUserId(req, res);
  if (!actorUserId) return;

  const targetId = String(req.params.id);
  if (!isValidMongoObjectId(targetId)) {
    return apiError.badRequest(res, "Ugyldig bruker-ID");
  }

  try {
    const bruker = await User.findOne({
      _id: targetId,
      deletedAt: { $exists: false },
    }).select("_id");
    if (!bruker) return apiError.notFound(res, "Bruker");

    await deleteCacheKeys([`${RELINK_STATE_KEY_PREFIX}${targetId}`]);

    await audit({
      actorUserId,
      action: AUDIT_ACTIONS.ADMIN_ACTION,
      category: "admin",
      outcome: "success",
      role: req.actorRole,
      targetUserId: targetId,
      metadata: { subAction: "brukere.clear_relink_guard" },
      req,
    });

    logger.info(
      { adminUserId: actorUserId, targetUserId: targetId },
      "Admin tømte relink-guard for bruker",
    );

    return res.json(AdminSuccessResponseSchema.parse({ success: true }));
  } catch (err) {
    logger.error({ err }, "Admin clear relink-guard feilet");
    return apiError.serverError(res);
  }
});

// ── GET /brukere/:id/detalj ────────────────────────────────────────────────
// Aggregert brukerdetalj for admin-modal. PRIVACY-PRINSIPP: returnerer ALDRI
// chat-innhold, tokens, Canvas-data, dokument-innhold eller noe som kan brukes
// til å lese brukerens private data. Kun metadata, tellinger og status.
router.get("/brukere/:id/detalj", async (req, res) => {
  const actorUserId = requireUserId(req, res);
  if (!actorUserId) return;

  const targetId = String(req.params.id);
  if (!isValidMongoObjectId(targetId)) {
    return apiError.badRequest(res, "Ugyldig bruker-ID");
  }

  try {
    // allow-deleted-users: admin må kunne se detaljer på slettede brukere
    // for forensikk og GDPR-feilsøking. Vi markerer deleted-status i responsen.
    const bruker = await User.findById(targetId)
      .select(
        "email role username firstName lastName createdAt updatedAt clerkId clerkEnv " +
          "clerkProfileSyncedAt authProviders mfaEnabled oauthAccounts canvasBaseUrl " +
          "canvasUser notionApiKey lockedAt lockedReason lockedBy deletedAt syncConflicts uiPreferences",
      )
      .lean();

    if (!bruker) {
      return apiError.notFound(res, "Bruker");
    }

    const userObjectId = bruker._id;
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

    // Kjør alle counts parallelt for å holde p99 lav
    const [
      chatHistoryCount,
      sharedChatCount,
      taskBreakdownCount,
      arbeidsplanCount,
      contentEmbeddingCount,
      canvasStructureCount,
      knowledgeBaseCount,
      knowledgeBaseChunkCount,
      webPushSubscriptionCount,
      recentAuditEntries,
      auditFailureCount30d,
    ] = await Promise.all([
      ChatHistory.countDocuments({ user: userObjectId }),
      SharedChat.countDocuments({ ownerId: userObjectId }),
      TaskBreakdown.countDocuments({ userId: targetId }),
      Arbeidsplan.countDocuments({ userId: targetId }),
      ContentEmbedding.countDocuments({ userId: targetId }),
      CanvasStructureModel.countDocuments({ userId: targetId }),
      KnowledgeBase.countDocuments({ userId: targetId }),
      KBContentChunk.countDocuments({ userId: targetId }),
      WebPushSubscriptionModel.countDocuments({ userId: targetId }),
      AuditLog.find({
        $or: [{ targetUserId: targetId }, { actorUserId: targetId }],
      })
        .sort({ createdAt: -1 })
        .limit(20)
        .select("action category outcome createdAt")
        .lean(),
      AuditLog.countDocuments({
        $or: [{ targetUserId: targetId }, { actorUserId: targetId }],
        outcome: "failure",
        createdAt: { $gte: thirtyDaysAgo },
      }),
    ]);

    void audit({
      actorUserId,
      action: AUDIT_ACTIONS.ADMIN_ACTION,
      category: "admin",
      outcome: "success",
      role: req.actorRole,
      targetUserId: targetId,
      metadata: { subAction: "brukere.detalj" },
      req,
    });

    const detalj = AdminBrukerDetaljSchema.parse({
      id: String(bruker._id),
      email: bruker.email,
      brukernavn: bruker.username,
      fornavn: bruker.firstName,
      etternavn: bruker.lastName,
      rolle: bruker.role,
      opprettet: bruker.createdAt,
      oppdatert: bruker.updatedAt,
      clerkId: bruker.clerkId,
      clerkEnv: bruker.clerkEnv,
      clerkProfileSyncedAt: bruker.clerkProfileSyncedAt,
      authProviders: bruker.authProviders,
      mfaEnabled: !!bruker.mfaEnabled,
      oauthAccountCount: Array.isArray(bruker.oauthAccounts) ? bruker.oauthAccounts.length : 0,
      locked: !!bruker.lockedAt,
      lockedAt: bruker.lockedAt ?? undefined,
      lockedReason: bruker.lockedReason,
      lockedBy: bruker.lockedBy ? String(bruker.lockedBy) : undefined,
      deleted: !!bruker.deletedAt,
      deletedAt: bruker.deletedAt ?? undefined,
      canvasConnected: !!bruker.canvasBaseUrl,
      canvasBaseUrl: bruker.canvasBaseUrl,
      canvasUserCached: !!bruker.canvasUser,
      counts: {
        chatHistory: chatHistoryCount,
        sharedChats: sharedChatCount,
        taskBreakdowns: taskBreakdownCount,
        arbeidsplaner: arbeidsplanCount,
        contentEmbeddings: contentEmbeddingCount,
        canvasStructures: canvasStructureCount,
        knowledgeBases: knowledgeBaseCount,
        knowledgeBaseChunks: knowledgeBaseChunkCount,
        webPushSubscriptions: webPushSubscriptionCount,
      },
      syncConflictCount: Array.isArray(bruker.syncConflicts) ? bruker.syncConflicts.length : 0,
      syncConflictTypes: Array.isArray(bruker.syncConflicts)
        ? bruker.syncConflicts
            .map((c) => (c as { type?: string }).type)
            .filter((t): t is string => typeof t === "string")
        : undefined,
      recentAuditEntries: recentAuditEntries.map((entry) => ({
        id: String(entry._id),
        action: entry.action,
        category: entry.category,
        outcome: entry.outcome,
        createdAt: entry.createdAt,
      })),
      auditFailureCount30d,
      notionConfigured: !!bruker.notionApiKey,
      language: bruker.uiPreferences?.language,
      theme: bruker.uiPreferences?.theme,
    });

    return res.json(detalj);
  } catch (err) {
    logger.error({ err, targetUserId: targetId }, "Admin brukerdetalj feilet");
    return apiError.serverError(res);
  }
});

// ── POST /brukere/:id/revoke-sessions ──────────────────────────────────────
// Tilbakekaller alle aktive Clerk-sesjoner for en bruker. Brukes ved sikkerhetshendelser
// — bruker tvinges til å logge inn på nytt på alle enheter.
router.post("/brukere/:id/revoke-sessions", requireRecentAuth, async (req, res) => {
  const actorUserId = requireUserId(req, res);
  if (!actorUserId) return;

  const targetId = String(req.params.id);
  if (!isValidMongoObjectId(targetId)) {
    return apiError.badRequest(res, "Ugyldig bruker-ID");
  }

  try {
    const bruker = await User.findOne({
      _id: targetId,
      deletedAt: { $exists: false },
    }).select("clerkId");
    if (!bruker) return apiError.notFound(res, "Bruker");
    if (!bruker.clerkId) {
      return apiError.badRequest(res, "Brukeren har ingen Clerk-konto");
    }

    const revoked = await revokeAllClerkSessions(bruker.clerkId);

    await audit({
      actorUserId,
      action: AUDIT_ACTIONS.ADMIN_ACTION,
      category: "security",
      outcome: "success",
      role: req.actorRole,
      targetUserId: targetId,
      metadata: { subAction: "brukere.revoke-sessions", revoked },
      req,
    });

    logger.info(
      { adminUserId: actorUserId, targetUserId: targetId, revoked },
      "Admin tilbakekalte alle Clerk-sesjoner for bruker",
    );

    return res.json(AdminRevokeSessionsResponseSchema.parse({ success: true, revoked }));
  } catch (err) {
    logger.error({ err }, "Admin revoke-sessions feilet");
    return apiError.serverError(res);
  }
});

// ── POST /brukere/:id/resend-verification ──────────────────────────────────
// Trigger Clerk til å sende verifiseringsepost på nytt for stuck brukere.
router.post("/brukere/:id/resend-verification", requireRecentAuth, async (req, res) => {
  const actorUserId = requireUserId(req, res);
  if (!actorUserId) return;

  const targetId = String(req.params.id);
  if (!isValidMongoObjectId(targetId)) {
    return apiError.badRequest(res, "Ugyldig bruker-ID");
  }

  try {
    const bruker = await User.findOne({
      _id: targetId,
      deletedAt: { $exists: false },
    }).select("clerkId");
    if (!bruker) return apiError.notFound(res, "Bruker");
    if (!bruker.clerkId) {
      return apiError.badRequest(res, "Brukeren har ingen Clerk-konto");
    }

    await resendClerkEmailVerification(bruker.clerkId);

    await audit({
      actorUserId,
      action: AUDIT_ACTIONS.ADMIN_ACTION,
      category: "admin",
      outcome: "success",
      role: req.actorRole,
      targetUserId: targetId,
      metadata: { subAction: "brukere.resend-verification" },
      req,
    });

    logger.info(
      { adminUserId: actorUserId, targetUserId: targetId },
      "Admin trigget re-verifisering av e-post via Clerk",
    );

    return res.json(AdminSuccessResponseSchema.parse({ success: true }));
  } catch (err) {
    logger.error({ err }, "Admin resend-verification feilet");
    return apiError.serverError(res);
  }
});

// ── POST /brukere/:id/lock ──────────────────────────────────────────────────
// Låser en bruker ute av StudyWise uten å slette dataene. Brukeren får 403
// med en tydelig melding ved alle innloggingsforsøk inntil admin låser opp.
// Krever requireRecentAuth fordi dette er en privilegert handling.
router.post("/brukere/:id/lock", requireRecentAuth, async (req, res) => {
  const actorUserId = requireUserId(req, res);
  if (!actorUserId) return;

  const targetId = String(req.params.id);
  if (!isValidMongoObjectId(targetId)) {
    return apiError.badRequest(res, "Ugyldig bruker-ID");
  }
  if (targetId === actorUserId) {
    return apiError.badRequest(res, "Du kan ikke låse din egen konto");
  }

  const parsed = AdminLockUserSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    return sendZodError(res, parsed.error, "lock");
  }

  try {
    const bruker = await User.findOne({
      _id: targetId,
      deletedAt: { $exists: false },
    });
    if (!bruker) {
      return apiError.notFound(res, "Bruker");
    }
    if (bruker.role === "admin") {
      return apiError.badRequest(
        res,
        "Admin-brukere kan ikke låses — endre rollen først hvis dette er nødvendig",
      );
    }

    const lockedAt = new Date();
    bruker.lockedAt = lockedAt;
    bruker.lockedReason = parsed.data.reason?.trim() || undefined;
    bruker.lockedBy = actorUserId;
    await bruker.save();

    await audit({
      actorUserId,
      action: AUDIT_ACTIONS.ADMIN_ACTION,
      category: "security",
      outcome: "success",
      role: req.actorRole,
      targetUserId: targetId,
      metadata: {
        subAction: "brukere.lock",
        reason: parsed.data.reason ?? null,
      },
      req,
    });

    logger.info(
      { adminUserId: actorUserId, targetUserId: targetId },
      "Admin låste brukerkonto",
    );

    const response = AdminLockUserResponseSchema.parse({
      id: targetId,
      locked: true,
      lockedAt,
      lockedReason: bruker.lockedReason,
    });
    return res.json(response);
  } catch (err) {
    logger.error({ err }, "Admin lås brukerkonto feilet");
    return apiError.serverError(res);
  }
});

// ── POST /brukere/:id/unlock ────────────────────────────────────────────────
router.post("/brukere/:id/unlock", requireRecentAuth, async (req, res) => {
  const actorUserId = requireUserId(req, res);
  if (!actorUserId) return;

  const targetId = String(req.params.id);
  if (!isValidMongoObjectId(targetId)) {
    return apiError.badRequest(res, "Ugyldig bruker-ID");
  }
  if (targetId === actorUserId) {
    return apiError.badRequest(res, "Du kan ikke låse opp din egen konto");
  }

  try {
    const bruker = await User.findOne({
      _id: targetId,
      deletedAt: { $exists: false },
    });
    if (!bruker) {
      return apiError.notFound(res, "Bruker");
    }

    bruker.lockedAt = undefined;
    bruker.lockedReason = undefined;
    bruker.lockedBy = undefined;
    await bruker.save();

    await audit({
      actorUserId,
      action: AUDIT_ACTIONS.ADMIN_ACTION,
      category: "security",
      outcome: "success",
      role: req.actorRole,
      targetUserId: targetId,
      metadata: { subAction: "brukere.unlock" },
      req,
    });

    logger.info(
      { adminUserId: actorUserId, targetUserId: targetId },
      "Admin låste opp brukerkonto",
    );

    const response = AdminUnlockUserResponseSchema.parse({
      id: targetId,
      locked: false,
    });
    return res.json(response);
  } catch (err) {
    logger.error({ err }, "Admin lås opp brukerkonto feilet");
    return apiError.serverError(res);
  }
});

export default router;
