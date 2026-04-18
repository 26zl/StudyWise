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
  AdminResetMfaResponseSchema,
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
  disableClerkUserMfa,
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
        .select("email role username firstName lastName canvasBaseUrl authProviders mfaEnabled createdAt lockedAt lockedReason deletedAt")
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
        mfaEnabled: b.mfaEnabled ?? false,
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
    const isAdminPromotion = gammelRolle !== "admin" && parsed.data.rolle === "admin";

    // Rate-limit admin-forfremmelser: maks 2 per 24 timer per admin
    if (isAdminPromotion) {
      const recentPromotions = await AuditLog.countDocuments({
        actorUserId,
        "metadata.securityAlert": "admin_promotion",
        createdAt: { $gte: new Date(Date.now() - 24 * 60 * 60 * 1000) },
      });
      if (recentPromotions >= 2) {
        logger.warn(
          { actorUserId, targetUserId: targetId, recentPromotions },
          "Admin-forfremmelses-grense nådd (maks 2 per 24t)",
        );
        return apiError.badRequest(
          res,
          "Du har nådd grensen for admin-forfremmelser (maks 2 per 24 timer)",
        );
      }
    }

    bruker.role = parsed.data.rolle;
    await bruker.save();

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

    // Audit brukerdetalj-visning — await med try/catch for å ikke miste oppføringer
    try {
      await audit({
        actorUserId,
        action: AUDIT_ACTIONS.ADMIN_ACTION,
        category: "admin",
        outcome: "success",
        role: req.actorRole,
        targetUserId: targetId,
        metadata: { subAction: "brukere.detalj" },
        req,
      });
    } catch (auditErr) {
      logger.warn({ err: auditErr }, "Audit for brukerdetalj-visning feilet");
    }

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

    const { total, revoked } = await revokeAllClerkSessions(bruker.clerkId);

    await audit({
      actorUserId,
      action: AUDIT_ACTIONS.ADMIN_ACTION,
      category: "security",
      outcome: "success",
      role: req.actorRole,
      targetUserId: targetId,
      metadata: { subAction: "brukere.revoke-sessions", revoked, total },
      req,
    });

    logger.info(
      { adminUserId: actorUserId, targetUserId: targetId, revoked, total },
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

// ── POST /brukere/:id/reset-mfa ─────────────────────────────────────────────
// Deaktiverer alle MFA-faktorer i Clerk for en bruker som har mistet tilgang
// til sin autentiseringsapp (mistet telefon, feilet app-migrering osv.).
// Etter dette kan brukeren logge inn uten MFA og sette opp 2FA på nytt.
// Krever requireRecentAuth — dette er en sikkerhetsfølsom handling og skal
// ha et tydelig step-up-spor i audit-loggen.
router.post("/brukere/:id/reset-mfa", requireRecentAuth, async (req, res) => {
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
    }).select("clerkId mfaEnabled");
    if (!bruker) return apiError.notFound(res, "Bruker");
    if (!bruker.clerkId) {
      return apiError.badRequest(res, "Brukeren har ingen Clerk-konto");
    }

    await disableClerkUserMfa(bruker.clerkId);

    // Speil endringen til lokal state umiddelbart — neste /me-sync henter
    // uansett fra Clerk (twoFactorEnabled=false), men forhindrer kort vindu
    // der admin-UI og andre MFA-baserte sjekker ser stale mfaEnabled=true.
    await User.updateOne(
      { _id: targetId, deletedAt: { $exists: false } },
      { $set: { mfaEnabled: false } },
    );

    // Revokér aktive Clerk-sesjoner: hvis kontoen er kompromittert og en
    // angriper hadde fått tilgang via gjenværende sesjoner, skal MFA-reset
    // ikke la dem fortsette uten å passere innlogging på nytt. Vi feiler
    // ikke hele operasjonen hvis revoke bommer (MFA er allerede deaktivert
    // i Clerk) — i stedet flagges `sessionsRevoked=false` i responsen slik
    // at admin-UI kan vise advarsel og eventuelt trigge "logg ut sesjoner"
    // som en egen manuell handling. Strict-sjekk: både kast fra helperen
    // OG partial failure (noen sesjoner feilet under revoke men ble svelget
    // intern i helperen) skal flagges som false — vi kan ellers love admin
    // at alle sesjoner er ute selv når bare noen faktisk er det.
    let sessionsRevoked = true;
    try {
      const { total, revoked } = await revokeAllClerkSessions(bruker.clerkId);
      if (revoked < total) {
        sessionsRevoked = false;
        logger.warn(
          { targetUserId: targetId, total, revoked },
          "Partial sesjonsrevoke ved MFA-reset — enkelte sesjoner feilet",
        );
      }
    } catch (revokeErr) {
      sessionsRevoked = false;
      logger.warn(
        { err: revokeErr, targetUserId: targetId },
        "Kunne ikke revokere Clerk-sesjoner ved MFA-reset",
      );
    }

    await audit({
      actorUserId,
      action: AUDIT_ACTIONS.ADMIN_ACTION,
      category: "security",
      outcome: "success",
      role: req.actorRole,
      targetUserId: targetId,
      metadata: { subAction: "brukere.reset-mfa", sessionsRevoked },
      req,
    });

    logger.info(
      { adminUserId: actorUserId, targetUserId: targetId, sessionsRevoked },
      "Admin deaktiverte MFA for bruker",
    );

    return res.json(
      AdminResetMfaResponseSchema.parse({ success: true, sessionsRevoked }),
    );
  } catch (err) {
    logger.error({ err }, "Admin reset-mfa feilet");
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

    // Revokér aktive Clerk-sesjoner slik at brukeren ikke kan fortsette
    // å gjøre requests med eksisterende token etter at kontoen er låst.
    if (bruker.clerkId) {
      try {
        await revokeAllClerkSessions(bruker.clerkId);
        logger.info(
          { adminUserId: actorUserId, targetUserId: targetId },
          "Clerk-sesjoner revokert etter kontolås",
        );
      } catch (revokeErr) {
        // Ikke blokker lås-operasjonen — neste token-verifisering fanger det uansett
        logger.warn(
          { err: revokeErr, targetUserId: targetId },
          "Kunne ikke revokere Clerk-sesjoner ved kontolås",
        );
      }
    }

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
