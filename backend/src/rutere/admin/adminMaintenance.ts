/**
 * Admin vedlikeholdsoperasjoner (asynkron jobb-mønster).
 * Monteres under /api/admin (allerede beskyttet med requireAuth + requireRole("admin")).
 *
 * Alle POST-endepunkter returnerer 202 Accepted umiddelbart og kjører
 * operasjonen i bakgrunnen. Resultatet lagres i Redis og hentes via:
 *   GET /maintenance/result/:op
 *
 * Endepunkter:
 *   POST /maintenance/backfill-fulltext      — Backfill manglende fulltekst
 *   POST /maintenance/cleanup-orphaned       — Slett foreldreløse data
 *   POST /maintenance/rebuild-embeddings     — Re-embed usynkroniserte chunks til Pinecone
 *   POST /maintenance/force-canvas-resync    — Tving Canvas-resynk (invalider cache)
 *   POST /maintenance/clean-expired-shares   — Slett utgåtte delelinker
 *   POST /maintenance/clean-old-chats        — Slett gamle samtaler
 *   GET  /maintenance/encryption-status      — Krypteringsnøkkel-rotasjonsstatus
 *   POST /maintenance/reencrypt-tokens       — Re-krypter Canvas-tokens med gjeldende nøkkel
 *   GET  /maintenance/database-health        — Database-helsekontroll
 *   GET  /maintenance/status                 — Running/cooldown for alle operasjoner
 *   GET  /maintenance/result/:op             — Hent resultat fra ferdig bakgrunnsjobb
 */
import { Router } from "express";
import mongoose from "mongoose";
import {
  AdminMaintenanceFullTextBackfillResponseSchema,
  AdminMaintenanceCleanupOrphanedResponseSchema,
  AdminMaintenanceRebuildEmbeddingsResponseSchema,
  AdminMaintenanceForceCanvasResyncResponseSchema,
  AdminMaintenanceCleanExpiredSharesResponseSchema,
  AdminMaintenanceCleanOldChatsRequestSchema,
  AdminMaintenanceCleanOldChatsResponseSchema,
  AdminMaintenanceEncryptionStatusResponseSchema,
  AdminMaintenanceReencryptResponseSchema,
  AdminMaintenanceDatabaseHealthResponseSchema,
  AdminMaintenanceRetryCrawlsResponseSchema,
  AdminMaintenanceReindexMissingResponseSchema,
  AdminMaintenanceReextractTruncatedResponseSchema,
} from "common/admin";
import { User } from "../../database/models/User.js";
import { ChatHistory } from "../../database/models/ChatHistory.js";
import { SharedChat } from "../../database/models/SharedChat.js";
import { TaskBreakdown } from "../../database/models/TaskBreakdown.js";
import { Arbeidsplan } from "../../database/models/arbeidsplan.js";
import { CanvasStructureModel } from "../../database/models/CanvasStructure.js";
import { CanvasUser } from "../../database/models/CanvasUser.js";
import { ContentEmbedding } from "../../database/models/ContentEmbedding.js";
import { FileExtractionStatus } from "../../database/models/FileExtractionStatus.js";
import { KnowledgeBase } from "../../database/models/Kunnskapsbase.js";
import { KBContentChunk } from "../../database/models/KBContentChunk.js";
import { requireRecentAuth } from "../../middleware/auth.js";
import { apiError, requireUserId } from "../../utils/apiError.js";
import { audit, AUDIT_ACTIONS } from "../../utils/auditLog.js";
import { logger } from "../../utils/logger.js";
import { getCache, setCache, setCacheNX, deleteCacheKeys, invalidateCacheByPattern, isRedisReady } from "../../cache/redis.js";
import { encrypt, decrypt } from "../../utils/kryptering.js";
import { pineconeDeleteByFilter, pineconeUpsert, isPineconeConfigured } from "../../services/pinecone.service.js";
import { backfillMissingFullText } from "../../services/embedding.service.js";

const router = Router();

const ACTIVE_FILTER = { deletedAt: { $exists: false } };
const DAY_MS = 24 * 60 * 60 * 1000;

/** TTL for lagrede jobb-resultater i Redis (10 minutter) */
const RESULT_TTL_SECONDS = 600;

/** Alle vedlikeholdsoperasjoner som kan kjøres. */
const MAINTENANCE_OPS = [
  "backfill-fulltext",
  "cleanup-orphaned",
  "rebuild-embeddings",
  "force-canvas-resync",
  "clean-expired-shares",
  "clean-old-chats",
  "reencrypt-tokens",
  "retry-failed-crawls",
  "reindex-missing-files",
  "reextract-truncated-files",
] as const;
type MaintenanceOp = (typeof MAINTENANCE_OPS)[number];

function cooldownKey(op: string): string {
  return `admin:maintenance:${op}:last-run`;
}

function runningKey(op: string): string {
  return `admin:maintenance:${op}:running`;
}

function resultKey(op: string): string {
  return `admin:maintenance:${op}:result`;
}

/**
 * Forsøker å skaffe en atomisk lås for en vedlikeholdsoperasjon.
 * Bruker setCacheNX (SET NX) slik at bare én admin kan starte jobben.
 * Sjekker også cooldown. Returnerer false (og sender 429) hvis blokkert.
 */
async function acquireLock(
  op: MaintenanceOp,
  cooldownSeconds: number,
  maxDurationSeconds: number,
  res: Parameters<typeof apiError.rateLimited>[0],
): Promise<boolean> {
  // Sjekk cooldown først (lesning, ingen race)
  const lastRun = await getCache(cooldownKey(op));
  if (lastRun) {
    const agoMs = Date.now() - Number(lastRun);
    if (agoMs < cooldownSeconds * 1000) {
      const remainingMin = Math.ceil((cooldownSeconds * 1000 - agoMs) / 60_000);
      apiError.rateLimited(res, `Operasjonen ble nylig kjørt. Prøv igjen om ~${remainingMin} minutt(er).`);
      return false;
    }
  }

  // Redis må være tilgjengelig for at låsemekanismen skal fungere.
  if (!isRedisReady()) {
    apiError.serverError(res);
    return false;
  }

  // Atomisk lås: SET NX — bare én admin kan vinne denne
  const acquired = await setCacheNX(runningKey(op), Date.now().toString(), maxDurationSeconds);
  if (!acquired) {
    apiError.rateLimited(res, "Operasjonen kjører allerede. Vent til den er ferdig.");
    return false;
  }

  return true;
}

/**
 * Fjern running-markør og sett cooldown etter suksess. Lagre resultat i Redis.
 *
 * Rekkefølge er kritisk: resultKey MÅ være skrevet før runningKey slettes.
 * Frontend poller status og henter resultat i det `running` går til false —
 * hvis vi sletter running parallelt med resultatskrivingen kan admin få en
 * falsk "Kunne ikke hente resultat" selv om jobben var vellykket.
 */
async function completeOperation(op: MaintenanceOp, cooldownSeconds: number, result: unknown): Promise<void> {
  await setCache(resultKey(op), JSON.stringify(result), RESULT_TTL_SECONDS);
  await Promise.all([
    setCache(cooldownKey(op), Date.now().toString(), cooldownSeconds),
    deleteCacheKeys([runningKey(op)]),
  ]);
}

/**
 * Fjern running-markør etter feil (uten å sette cooldown). Lagre feilmelding.
 * Samme rekkefølge-krav som completeOperation — skriv resultat før running
 * slettes, ellers ser frontend en tom "ferdig"-tilstand.
 */
async function failOperation(op: MaintenanceOp, errorMessage: string): Promise<void> {
  await setCache(resultKey(op), JSON.stringify({ suksess: false, error: errorMessage }), RESULT_TTL_SECONDS);
  await deleteCacheKeys([runningKey(op)]);
}

// ── GET /maintenance/status ────────────────────────────────────────────────
// Returnerer running/cooldown-status for alle operasjoner.
// Frontend poller dette for å vise global status til alle admins.

router.get("/maintenance/status", async (req, res) => {
  const actorUserId = requireUserId(req, res);
  if (!actorUserId) return;

  try {
    const ops: Record<string, { running: boolean; cooldownUntil: string | null }> = {};

    for (const op of MAINTENANCE_OPS) {
      const [runningVal, cooldownVal] = await Promise.all([
        getCache(runningKey(op)),
        getCache(cooldownKey(op)),
      ]);

      let cooldownUntil: string | null = null;
      if (cooldownVal) {
        const lastRunMs = Number(cooldownVal);
        const ttl = op === "rebuild-embeddings" || op === "force-canvas-resync" || op === "reencrypt-tokens" ? 1800 : 600;
        const expiresMs = lastRunMs + ttl * 1000;
        if (expiresMs > Date.now()) {
          cooldownUntil = new Date(expiresMs).toISOString();
        }
      }

      ops[op] = {
        running: Boolean(runningVal),
        cooldownUntil,
      };
    }

    return res.json({ ops });
  } catch (err) {
    logger.error({ err }, "Admin maintenance status feilet");
    return apiError.serverError(res);
  }
});

// ── GET /maintenance/result/:op ──────────────────────────────────────────
// Henter lagret resultat for en vedlikeholdsoperasjon.

router.get("/maintenance/result/:op", async (req, res) => {
  const actorUserId = requireUserId(req, res);
  if (!actorUserId) return;

  const op = req.params.op;
  if (!MAINTENANCE_OPS.includes(op as MaintenanceOp)) {
    return apiError.badRequest(res, "Ugyldig operasjon");
  }

  try {
    const cached = await getCache(resultKey(op));
    if (!cached) {
      return apiError.notFound(res, "Ingen resultat funnet (utløpt eller ikke kjørt ennå)");
    }
    return res.json(JSON.parse(cached));
  } catch (err) {
    logger.error({ err, op }, "Admin maintenance result feilet");
    return apiError.serverError(res);
  }
});

// ── POST /maintenance/backfill-fulltext ─────────────────────────────────────

router.post("/maintenance/backfill-fulltext", requireRecentAuth, async (req, res) => {
  const actorUserId = requireUserId(req, res);
  if (!actorUserId) return;

  if (!(await acquireLock("backfill-fulltext", 600, 300, res))) return;

  res.status(202).json({ accepted: true });

  void (async () => {
    try {
      const result = await backfillMissingFullText();

      await audit({
        actorUserId,
        action: AUDIT_ACTIONS.ADMIN_ACTION,
        category: "admin",
        outcome: "success",
        role: req.actorRole,
        metadata: {
          subAction: "maintenance.backfillFullText",
          scannedFiles: result.scannedFiles,
          updatedFiles: result.updatedFiles,
        },
        req,
      });

      const payload = AdminMaintenanceFullTextBackfillResponseSchema.parse({
        suksess: true,
        ...result,
      });
      await completeOperation("backfill-fulltext", 600, payload);
    } catch (err) {
      logger.error({ err }, "Admin fullText-backfill feilet");
      await failOperation("backfill-fulltext", "Fulltekst-backfill feilet. Sjekk loggene.");
    }
  })();
});

// ── POST /maintenance/cleanup-orphaned ─────────────────────────────────────

router.post("/maintenance/cleanup-orphaned", requireRecentAuth, async (req, res) => {
  const actorUserId = requireUserId(req, res);
  if (!actorUserId) return;

  if (!(await acquireLock("cleanup-orphaned", 600, 300, res))) return;

  res.status(202).json({ accepted: true });

  void (async () => {
    try {
      const alleBrukere = await User.find(ACTIVE_FILTER, { _id: 1 }).lean();
      const alleBrukerObjectIds = alleBrukere.map((b) => b._id);
      const alleBrukerIds = alleBrukerObjectIds.map((id) => id.toString());

      const orphanedEmbeddingAgg = await ContentEmbedding.aggregate<{ _id: string }>([
        { $match: { userId: { $nin: alleBrukerIds } } },
        { $group: { _id: "$userId" } },
      ]);
      const orphanedEmbeddingUserIds = orphanedEmbeddingAgg.map((r) => r._id);

      let pineconeFailures = 0;
      for (const userId of orphanedEmbeddingUserIds) {
        try {
          await pineconeDeleteByFilter({ userId });
        } catch (err) {
          pineconeFailures++;
          logger.warn({ err, userId }, "Pinecone-opprydding feilet for orphaned bruker");
        }
      }

      const [
        samtaler,
        oppgaveoppdelinger,
        dokumentfragmenter,
        arbeidsplaner,
        canvasStrukturer,
        canvasBrukere,
        delingslenker,
        kunnskapsbaser,
        kbChunks,
      ] = await Promise.all([
        ChatHistory.deleteMany({ user: { $nin: alleBrukerObjectIds } }).then((r) => r.deletedCount),
        TaskBreakdown.deleteMany({ userId: { $nin: alleBrukerObjectIds } }).then((r) => r.deletedCount),
        ContentEmbedding.deleteMany({ userId: { $nin: alleBrukerIds } }).then((r) => r.deletedCount),
        Arbeidsplan.deleteMany({ userId: { $nin: alleBrukerIds } }).then((r) => r.deletedCount),
        CanvasStructureModel.deleteMany({ userId: { $nin: alleBrukerIds } }).then((r) => r.deletedCount),
        CanvasUser.deleteMany({ localUser: { $nin: alleBrukerObjectIds } }).then((r) => r.deletedCount),
        SharedChat.deleteMany({ ownerId: { $nin: alleBrukerObjectIds } }).then((r) => r.deletedCount),
        KnowledgeBase.deleteMany({ userId: { $nin: alleBrukerIds } }).then((r) => r.deletedCount),
        KBContentChunk.deleteMany({ userId: { $nin: alleBrukerIds } }).then((r) => r.deletedCount),
      ]);

      // Rydd FileExtractionStatus for foreldreløse brukere — ikke kritisk,
      // så vi gjør det etter hovedopprydningen og logger uten å telle i respons.
      try {
        await FileExtractionStatus.deleteMany({ userId: { $nin: alleBrukerIds } });
      } catch (err) {
        logger.warn({ err }, "Opprydding av foreldreløse FileExtractionStatus feilet");
      }

      const deleted = {
        samtaler,
        oppgaveoppdelinger,
        dokumentfragmenter,
        arbeidsplaner,
        canvasStrukturer,
        canvasBrukere,
        delingslenker,
        kunnskapsbaser,
        kbChunks,
      };

      await audit({
        actorUserId,
        action: AUDIT_ACTIONS.ADMIN_ACTION,
        category: "admin",
        outcome: "success",
        role: req.actorRole,
        metadata: { subAction: "maintenance.cleanupOrphaned", ...deleted, pineconeFailures },
        req,
      });

      if (pineconeFailures > 0) {
        logger.warn({ pineconeFailures }, "Noen Pinecone-oppryddinger feilet under cleanup-orphaned");
      }

      const payload = AdminMaintenanceCleanupOrphanedResponseSchema.parse({ suksess: true, deleted });
      await completeOperation("cleanup-orphaned", 600, payload);
    } catch (err) {
      logger.error({ err }, "Admin cleanup-orphaned feilet");
      await failOperation("cleanup-orphaned", "Opprydding av foreldreløse data feilet.");
    }
  })();
});

// ── POST /maintenance/rebuild-embeddings ───────────────────────────────────

router.post("/maintenance/rebuild-embeddings", requireRecentAuth, async (req, res) => {
  const actorUserId = requireUserId(req, res);
  if (!actorUserId) return;

  if (!isPineconeConfigured()) {
    return apiError.badRequest(res, "Pinecone er ikke konfigurert.");
  }

  if (!(await acquireLock("rebuild-embeddings", 1800, 600, res))) return;

  res.status(202).json({ accepted: true });

  void (async () => {
    try {
      const BATCH_SIZE = 100;
      let scannedChunks = 0;
      let reembeddedChunks = 0;
      let failedChunks = 0;

      const unsyncedChunks = await ContentEmbedding.find(
        { pineconesynced: { $ne: true }, isFullDocument: { $ne: true } },
        { _id: 1, userId: 1, courseId: 1, moduleId: 1, fileId: 1, chunkIndex: 1, text: 1 },
      ).lean();

      scannedChunks = unsyncedChunks.length;

      for (let i = 0; i < unsyncedChunks.length; i += BATCH_SIZE) {
        const batch = unsyncedChunks.slice(i, i + BATCH_SIZE);
        try {
          await pineconeUpsert(
            batch.map((chunk) => ({
              id: chunk._id.toString(),
              text: chunk.text,
              metadata: {
                userId: chunk.userId,
                courseId: chunk.courseId,
                moduleId: chunk.moduleId,
                fileId: chunk.fileId,
                chunkIndex: chunk.chunkIndex,
              },
            })),
          );

          await ContentEmbedding.updateMany(
            { _id: { $in: batch.map((c) => c._id) } },
            { $set: { pineconesynced: true } },
          );

          reembeddedChunks += batch.length;
        } catch (err) {
          logger.warn({ err, batchStart: i, batchSize: batch.length }, "Pinecone re-embed batch feilet");
          failedChunks += batch.length;
        }
      }

      await audit({
        actorUserId,
        action: AUDIT_ACTIONS.ADMIN_ACTION,
        category: "admin",
        outcome: "success",
        role: req.actorRole,
        metadata: { subAction: "maintenance.rebuildEmbeddings", scannedChunks, reembeddedChunks, failedChunks },
        req,
      });

      const payload = AdminMaintenanceRebuildEmbeddingsResponseSchema.parse({
        suksess: true,
        scannedChunks,
        reembeddedChunks,
        failedChunks,
      });
      await completeOperation("rebuild-embeddings", 1800, payload);
    } catch (err) {
      logger.error({ err }, "Admin rebuild-embeddings feilet");
      await failOperation("rebuild-embeddings", "Gjenoppbygging av embeddings feilet.");
    }
  })();
});

// ── POST /maintenance/force-canvas-resync ──────────────────────────────────

router.post("/maintenance/force-canvas-resync", requireRecentAuth, async (req, res) => {
  const actorUserId = requireUserId(req, res);
  if (!actorUserId) return;

  if (!(await acquireLock("force-canvas-resync", 1800, 300, res))) return;

  res.status(202).json({ accepted: true });

  void (async () => {
    try {
      const canvasUsers = await User.find(
        { canvasBaseUrl: { $exists: true }, ...ACTIVE_FILTER },
        { _id: 1 },
      ).lean();

      let keysDeleted = 0;
      const userIds = canvasUsers.map((u) => u._id.toString());

      for (const userId of userIds) {
        const patterns = [
          `canvas:user:${userId}:*`,
          `db:user:${userId}:*`,
          `ki:session:${userId}:*`,
        ];
        for (const pattern of patterns) {
          keysDeleted += await invalidateCacheByPattern(pattern);
        }
      }

      const structureResult = await CanvasStructureModel.deleteMany({ userId: { $in: userIds } });

      await audit({
        actorUserId,
        action: AUDIT_ACTIONS.ADMIN_ACTION,
        category: "admin",
        outcome: "success",
        role: req.actorRole,
        metadata: {
          subAction: "maintenance.forceCanvasResync",
          usersInvalidated: canvasUsers.length,
          keysDeleted,
          structuresDeleted: structureResult.deletedCount,
        },
        req,
      });

      const payload = AdminMaintenanceForceCanvasResyncResponseSchema.parse({
        suksess: true,
        usersInvalidated: canvasUsers.length,
        keysDeleted,
      });
      await completeOperation("force-canvas-resync", 1800, payload);
    } catch (err) {
      logger.error({ err }, "Admin force-canvas-resync feilet");
      await failOperation("force-canvas-resync", "Canvas-resynk feilet.");
    }
  })();
});

// ── POST /maintenance/clean-expired-shares ─────────────────────────────────

router.post("/maintenance/clean-expired-shares", requireRecentAuth, async (req, res) => {
  const actorUserId = requireUserId(req, res);
  if (!actorUserId) return;

  if (!(await acquireLock("clean-expired-shares", 600, 300, res))) return;

  res.status(202).json({ accepted: true });

  void (async () => {
    try {
      const result = await SharedChat.deleteMany({
        expiresAt: { $ne: null, $lt: new Date() },
      });

      await audit({
        actorUserId,
        action: AUDIT_ACTIONS.ADMIN_ACTION,
        category: "admin",
        outcome: "success",
        role: req.actorRole,
        metadata: { subAction: "maintenance.cleanExpiredShares", deletedCount: result.deletedCount },
        req,
      });

      const payload = AdminMaintenanceCleanExpiredSharesResponseSchema.parse({
        suksess: true,
        deletedCount: result.deletedCount,
      });
      await completeOperation("clean-expired-shares", 600, payload);
    } catch (err) {
      logger.error({ err }, "Admin clean-expired-shares feilet");
      await failOperation("clean-expired-shares", "Opprydding av utgåtte delelinker feilet.");
    }
  })();
});

// ── POST /maintenance/clean-old-chats ──────────────────────────────────────

router.post("/maintenance/clean-old-chats", requireRecentAuth, async (req, res) => {
  const actorUserId = requireUserId(req, res);
  if (!actorUserId) return;

  const parsed = AdminMaintenanceCleanOldChatsRequestSchema.safeParse(req.body);
  if (!parsed.success) {
    return apiError.badRequest(res, "Ugyldig antall dager (minimum 30, maksimum 3650).");
  }

  if (!(await acquireLock("clean-old-chats", 600, 300, res))) return;

  const dager = parsed.data.dager;
  res.status(202).json({ accepted: true });

  void (async () => {
    try {
      const cutoffDate = new Date(Date.now() - dager * DAY_MS);

      const chatsToDelete = await ChatHistory.find(
        { createdAt: { $lt: cutoffDate }, pinned: { $ne: true } },
        { _id: 1 },
      ).lean();

      const chatIds = chatsToDelete.map((c) => c._id);

      const sharedResult = await SharedChat.deleteMany({ chatId: { $in: chatIds } });
      const chatResult = await ChatHistory.deleteMany({ _id: { $in: chatIds } });

      await audit({
        actorUserId,
        action: AUDIT_ACTIONS.ADMIN_ACTION,
        category: "admin",
        outcome: "success",
        role: req.actorRole,
        metadata: {
          subAction: "maintenance.cleanOldChats",
          dager,
          deletedChats: chatResult.deletedCount,
          deletedShares: sharedResult.deletedCount,
        },
        req,
      });

      const payload = AdminMaintenanceCleanOldChatsResponseSchema.parse({
        suksess: true,
        deletedChats: chatResult.deletedCount,
        deletedShares: sharedResult.deletedCount,
        cutoffDate: cutoffDate.toISOString(),
      });
      await completeOperation("clean-old-chats", 600, payload);
    } catch (err) {
      logger.error({ err }, "Admin clean-old-chats feilet");
      await failOperation("clean-old-chats", "Opprydding av gamle samtaler feilet.");
    }
  })();
});

// ── GET /maintenance/encryption-status ─────────────────────────────────────

router.get("/maintenance/encryption-status", async (req, res) => {
  const actorUserId = requireUserId(req, res);
  if (!actorUserId) return;

  try {
    const previousKeyConfigured = Boolean(process.env.ENCRYPTION_KEY_PREV);

    const usersWithToken = await User.find(
      { canvasApiToken: { $exists: true, $ne: null }, ...ACTIVE_FILTER },
    ).select("+canvasApiToken").lean();

    let currentKeyOk = 0;
    let legacyFormat = 0;
    let undecryptable = 0;

    for (const user of usersWithToken) {
      const token = user.canvasApiToken;
      if (!token) continue;

      try {
        decrypt(token);
        const parts = token.split(":");
        if (parts.length === 4 && /^v\d+$/.test(parts[0])) {
          currentKeyOk++;
        } else {
          legacyFormat++;
        }
      } catch {
        undecryptable++;
      }
    }

    await audit({
      actorUserId,
      action: AUDIT_ACTIONS.ADMIN_ACTION,
      category: "admin",
      outcome: "success",
      role: req.actorRole,
      metadata: { subAction: "maintenance.encryptionStatus" },
      req,
    });

    return res.json(
      AdminMaintenanceEncryptionStatusResponseSchema.parse({
        previousKeyConfigured,
        usersWithToken: usersWithToken.length,
        currentKeyOk,
        legacyFormat,
        undecryptable,
      }),
    );
  } catch (err) {
    logger.error({ err }, "Admin encryption-status feilet");
    return apiError.serverError(res);
  }
});

// ── POST /maintenance/reencrypt-tokens ─────────────────────────────────────

router.post("/maintenance/reencrypt-tokens", requireRecentAuth, async (req, res) => {
  const actorUserId = requireUserId(req, res);
  if (!actorUserId) return;

  if (!(await acquireLock("reencrypt-tokens", 1800, 600, res))) return;

  res.status(202).json({ accepted: true });

  void (async () => {
    try {
      const usersWithToken = await User.find(
        { canvasApiToken: { $exists: true, $ne: null }, ...ACTIVE_FILTER },
      ).select("+canvasApiToken").lean();

      let processed = 0;
      let reencrypted = 0;
      let alreadyCurrent = 0;
      let failed = 0;

      for (const user of usersWithToken) {
        processed++;
        const token = user.canvasApiToken;
        if (!token) continue;

        try {
          const plaintext = decrypt(token);
          const parts = token.split(":");
          const isLegacy = !(parts.length === 4 && /^v\d+$/.test(parts[0]));

          try {
            const reencryptedToken = encrypt(plaintext);
            await User.updateOne(
              { _id: user._id, ...ACTIVE_FILTER },
              { $set: { canvasApiToken: reencryptedToken } },
            );
            if (isLegacy) {
              reencrypted++;
            } else {
              alreadyCurrent++;
            }
          } catch {
            failed++;
          }
        } catch {
          failed++;
        }
      }

      await audit({
        actorUserId,
        action: AUDIT_ACTIONS.ADMIN_ACTION,
        category: "admin",
        outcome: "success",
        role: req.actorRole,
        metadata: { subAction: "maintenance.reencryptTokens", processed, reencrypted, alreadyCurrent, failed },
        req,
      });

      const payload = AdminMaintenanceReencryptResponseSchema.parse({
        suksess: true,
        processed,
        reencrypted,
        alreadyCurrent,
        failed,
      });
      await completeOperation("reencrypt-tokens", 1800, payload);
    } catch (err) {
      logger.error({ err }, "Admin reencrypt-tokens feilet");
      await failOperation("reencrypt-tokens", "Re-kryptering av tokens feilet.");
    }
  })();
});

// ── GET /maintenance/database-health ───────────────────────────────────────

router.get("/maintenance/database-health", async (req, res) => {
  const actorUserId = requireUserId(req, res);
  if (!actorUserId) return;

  try {
    const db = mongoose.connection.db;
    if (!db) {
      return apiError.serverError(res);
    }

    const collectionsList = await db.listCollections().toArray();
    const collections: Array<{
      name: string;
      documentCount: number;
      sizeBytes: number;
      indexCount: number;
      indexSizeBytes: number;
    }> = [];

    let totalSizeBytes = 0;
    let totalDocuments = 0;
    let totalIndexSizeBytes = 0;

    for (const coll of collectionsList) {
      try {
        const collection = db.collection(coll.name);
        const [documentCount, indexes] = await Promise.all([
          collection.estimatedDocumentCount(),
          collection.listIndexes().toArray().catch(() => []),
        ]);

        let sizeBytes = 0;
        let indexSizeBytes = 0;
        try {
          const collStats = await db.command({ collStats: coll.name, scale: 1 });
          sizeBytes = collStats.size ?? 0;
          indexSizeBytes = collStats.totalIndexSize ?? 0;
        } catch {
          // collStats kan feile på Atlas Stable API
        }

        const entry = {
          name: coll.name,
          documentCount,
          sizeBytes,
          indexCount: indexes.length,
          indexSizeBytes,
        };
        collections.push(entry);
        totalSizeBytes += entry.sizeBytes;
        totalDocuments += entry.documentCount;
        totalIndexSizeBytes += entry.indexSizeBytes;
      } catch (err) {
        logger.warn({ err, collection: coll.name }, "Kunne ikke hente stats for collection");
        collections.push({
          name: coll.name,
          documentCount: 0,
          sizeBytes: 0,
          indexCount: 0,
          indexSizeBytes: 0,
        });
      }
    }

    collections.sort((a, b) => b.sizeBytes - a.sizeBytes);

    await audit({
      actorUserId,
      action: AUDIT_ACTIONS.ADMIN_ACTION,
      category: "admin",
      outcome: "success",
      role: req.actorRole,
      metadata: { subAction: "maintenance.databaseHealth", collectionCount: collections.length },
      req,
    });

    return res.json(
      AdminMaintenanceDatabaseHealthResponseSchema.parse({
        suksess: true,
        collections,
        totalSizeBytes,
        totalDocuments,
        totalIndexSizeBytes,
      }),
    );
  } catch (err) {
    logger.error({ err }, "Admin database-health feilet");
    return apiError.serverError(res);
  }
});

// ── POST /maintenance/retry-failed-crawls ──────────────────────────────────
// Nullstiller crawl-state for ExternalUrl-items som faller inn under
// canvas-sync sine retry-kriterier (never_crawled, empty_crawl >24t, stale >7d).
// Neste gang hver berørte bruker trigger sync, vil eksisterende retry-logikk
// plukke opp disse automatisk — admin slipper altså å vente på at brukerne
// selv logger inn.

const CRAWL_STALE_THRESHOLD_MS = 7 * 24 * 60 * 60 * 1000;
const CRAWL_EMPTY_RETRY_MS = 24 * 60 * 60 * 1000;

router.post("/maintenance/retry-failed-crawls", requireRecentAuth, async (req, res) => {
  const actorUserId = requireUserId(req, res);
  if (!actorUserId) return;

  if (!(await acquireLock("retry-failed-crawls", 600, 300, res))) return;

  res.status(202).json({ accepted: true });

  void (async () => {
    try {
      const structures = await CanvasStructureModel.find(
        {},
        { userId: 1, courseId: 1, moduler: 1 },
      ).lean();

      let scannedItems = 0;
      let flaggedItems = 0;
      const now = Date.now();
      const affectedUsers = new Set<string>();
      const bulkOps: Array<{
        updateOne: {
          filter: Record<string, unknown>;
          update: Record<string, unknown>;
        };
      }> = [];

      for (const struct of structures) {
        const itemsToReset: Array<{ modIdx: number; itemIdx: number }> = [];
        for (let mi = 0; mi < (struct.moduler?.length ?? 0); mi++) {
          const modul = struct.moduler[mi];
          for (let ii = 0; ii < (modul.items?.length ?? 0); ii++) {
            const item = modul.items[ii];
            if (!item.external_url) continue;
            scannedItems++;

            const hasCrawl = Boolean(item.crawledHash);
            const crawledAtMs = item.crawledAt
              ? new Date(item.crawledAt).getTime()
              : null;
            const pdfCount = item.crawledPdfs?.length ?? 0;
            const subpageCount = item.crawledSubpages?.length ?? 0;
            const isEmptyCrawl =
              hasCrawl
              && pdfCount === 0
              && subpageCount === 0
              && (crawledAtMs === null || now - crawledAtMs > CRAWL_EMPTY_RETRY_MS);
            const isStale =
              hasCrawl
              && !isEmptyCrawl
              && crawledAtMs !== null
              && now - crawledAtMs > CRAWL_STALE_THRESHOLD_MS;
            const needsReset = !hasCrawl || isEmptyCrawl || isStale;
            if (needsReset) {
              itemsToReset.push({ modIdx: mi, itemIdx: ii });
            }
          }
        }

        if (itemsToReset.length > 0) {
          flaggedItems += itemsToReset.length;
          affectedUsers.add(String(struct.userId));
          // Bygger positional-update per item. $unset fjerner feltene helt
          // slik at canvas-sync klassifiserer dem som crawlNeverSucceeded og
          // kjører full re-crawl — samme effekt som om de aldri var crawlet.
          for (const { modIdx, itemIdx } of itemsToReset) {
            bulkOps.push({
              updateOne: {
                filter: { _id: struct._id },
                update: {
                  $unset: {
                    [`moduler.${modIdx}.items.${itemIdx}.crawledHash`]: "",
                    [`moduler.${modIdx}.items.${itemIdx}.crawledAt`]: "",
                    [`moduler.${modIdx}.items.${itemIdx}.crawledPdfs`]: "",
                    [`moduler.${modIdx}.items.${itemIdx}.crawledSubpages`]: "",
                  },
                },
              },
            });
          }
        }
      }

      let resetItems = 0;
      if (bulkOps.length > 0) {
        const bulkResult = await CanvasStructureModel.bulkWrite(bulkOps, { ordered: false });
        resetItems = bulkResult.modifiedCount ?? 0;
      }

      // Invalider sync-cache for berørte brukere så neste dashboard-visning
      // trigger en ny sync-runde og crawl-retry-logikken faktisk kjører.
      // `affectedUsers` = brukere med flaggede items (disse får re-crawl på
      // neste naturlige sync); `cachesInvalidated` = delsett hvor Redis
      // faktisk hadde en sync-skip-gate som måtte ryddes. Brukere uten cache
      // (ikke nylig aktive) kjører sync uansett ved neste login.
      let cachesInvalidated = 0;
      for (const userId of affectedUsers) {
        const deleted = await invalidateCacheByPattern(`canvas:user:${userId}:*`);
        if (deleted > 0) cachesInvalidated++;
      }
      const affectedUserCount = affectedUsers.size;

      await audit({
        actorUserId,
        action: AUDIT_ACTIONS.ADMIN_ACTION,
        category: "admin",
        outcome: "success",
        role: req.actorRole,
        metadata: {
          subAction: "maintenance.retryFailedCrawls",
          scannedItems,
          flaggedItems,
          resetItems,
          affectedUsers: affectedUserCount,
          cachesInvalidated,
        },
        req,
      });

      const payload = AdminMaintenanceRetryCrawlsResponseSchema.parse({
        suksess: true,
        scannedItems,
        flaggedItems,
        resetItems,
        affectedUsers: affectedUserCount,
        cachesInvalidated,
      });
      await completeOperation("retry-failed-crawls", 600, payload);
    } catch (err) {
      logger.error({ err }, "Admin retry-failed-crawls feilet");
      await failOperation("retry-failed-crawls", "Re-crawl feilet.");
    }
  })();
});

// ── POST /maintenance/reindex-missing-files ────────────────────────────────
// Finner Canvas-filer uten ContentEmbedding-rader (ekstraksjonen hoppet over
// filen eller produserte 0 chunks). Canvas-sync sjekker fileHash per fil —
// uten lagret fileHash vil sync kjøre full ekstraksjon neste gang brukeren
// logger inn. Vi invaliderer sync-cachen slik at det faktisk skjer.

router.post("/maintenance/reindex-missing-files", requireRecentAuth, async (req, res) => {
  const actorUserId = requireUserId(req, res);
  if (!actorUserId) return;

  if (!(await acquireLock("reindex-missing-files", 600, 300, res))) return;

  res.status(202).json({ accepted: true });

  void (async () => {
    try {
      const structures = await CanvasStructureModel.find(
        {},
        { userId: 1, courseId: 1, moduler: 1 },
      ).lean();

      const userFileSet = new Set<string>();
      const userFiles: Array<{ userId: string; courseId: string; fileId: number }> = [];
      for (const struct of structures) {
        for (const modul of struct.moduler ?? []) {
          for (const item of modul.items ?? []) {
            if (item.type !== "File") continue;
            const fileId = item.content_id ?? item.id;
            if (typeof fileId !== "number") continue;
            const userId = String(struct.userId);
            const courseId = String(struct.courseId);
            const key = `${userId}:${courseId}:${fileId}`;
            if (userFileSet.has(key)) continue;
            userFileSet.add(key);
            userFiles.push({ userId, courseId, fileId });
          }
        }
      }

      const indexed = await ContentEmbedding.aggregate<{
        _id: { userId: string; courseId: string; fileId: number };
      }>([
        { $group: { _id: { userId: "$userId", courseId: "$courseId", fileId: "$fileId" } } },
      ]);
      const indexedSet = new Set(
        indexed.map((row) => `${row._id.userId}:${row._id.courseId}:${row._id.fileId}`),
      );

      let indexedFiles = 0;
      const affectedUsers = new Set<string>();
      for (const f of userFiles) {
        const key = `${f.userId}:${f.courseId}:${f.fileId}`;
        if (indexedSet.has(key)) {
          indexedFiles++;
        } else {
          affectedUsers.add(f.userId);
        }
      }

      let cachesInvalidated = 0;
      for (const userId of affectedUsers) {
        const deleted = await invalidateCacheByPattern(`canvas:user:${userId}:*`);
        if (deleted > 0) cachesInvalidated++;
      }
      const affectedUserCount = affectedUsers.size;

      await audit({
        actorUserId,
        action: AUDIT_ACTIONS.ADMIN_ACTION,
        category: "admin",
        outcome: "success",
        role: req.actorRole,
        metadata: {
          subAction: "maintenance.reindexMissingFiles",
          canvasFiles: userFiles.length,
          indexedFiles,
          missingFiles: userFiles.length - indexedFiles,
          affectedUsers: affectedUserCount,
          cachesInvalidated,
        },
        req,
      });

      const payload = AdminMaintenanceReindexMissingResponseSchema.parse({
        suksess: true,
        canvasFiles: userFiles.length,
        indexedFiles,
        missingFiles: userFiles.length - indexedFiles,
        affectedUsers: affectedUserCount,
        cachesInvalidated,
      });
      await completeOperation("reindex-missing-files", 600, payload);
    } catch (err) {
      logger.error({ err }, "Admin reindex-missing-files feilet");
      await failOperation("reindex-missing-files", "Reindeksering feilet.");
    }
  })();
});

// ── POST /maintenance/reextract-truncated-files ────────────────────────────
// Finner alle filer der lagringen stille kuttet teksten (charCount >
// fullText.length), nuller fileHash på deres chunk-rader slik at neste
// Canvas-sync trigger full re-ekstraksjon — denne gangen med den aktive
// storage-cap-en (200 000 tegn). Målrettet alternativ til forceCanvasResync
// som er langt billigere siden kun berørte filer re-prosesseres.

router.post("/maintenance/reextract-truncated-files", requireRecentAuth, async (req, res) => {
  const actorUserId = requireUserId(req, res);
  if (!actorUserId) return;

  if (!(await acquireLock("reextract-truncated-files", 600, 300, res))) return;

  res.status(202).json({ accepted: true });

  void (async () => {
    try {
      // Finn alle fil-IDer der lagringen er kortere enn originalen. Med
      // chunked-lagring summerer vi på tvers av parter (chunkIndex < 0)
      // per (userId, courseId, fileId). I praksis skal denne queryen
      // returnere 0 rader etter B — men vi beholder den som sikkerhets-
      // nett for gammel single-row-data eller fremtidige edge cases.
      const truncated = await ContentEmbedding.aggregate<{
        userId: string;
        courseId: string;
        fileId: number;
      }>([
        {
          $match: {
            chunkIndex: { $lt: 0 },
            fullText: { $exists: true, $type: "string" },
          },
        },
        {
          $group: {
            _id: { userId: "$userId", courseId: "$courseId", fileId: "$fileId" },
            originalChars: { $max: { $ifNull: ["$charCount", 0] } },
            storedChars: { $sum: { $strLenCP: "$fullText" } },
          },
        },
        { $match: { $expr: { $lt: ["$storedChars", "$originalChars"] } } },
        {
          $project: {
            _id: 0,
            userId: "$_id.userId",
            courseId: "$_id.courseId",
            fileId: "$_id.fileId",
          },
        },
      ]);

      const affectedUsers = new Set<string>();
      const bulkOps = truncated.map((t) => {
        affectedUsers.add(t.userId);
        return {
          // Canvas-sync sjekker `existingStatus.fileHash === metaHash` på
          // regulære chunks (chunkIndex >= 0) for å avgjøre om re-ekstraksjon
          // trengs. Ved å nullstille fileHash på disse radene, mismatcher
          // sjekken og full re-ekstraksjon kjører — som oppretter nye parter
          // (chunkIndex < 0) via upsertStoredFullText.
          updateMany: {
            filter: {
              userId: t.userId,
              courseId: t.courseId,
              fileId: t.fileId,
              chunkIndex: { $gte: 0 },
            },
            update: { $unset: { fileHash: 1 as const } },
          },
        };
      });

      let invalidatedRows = 0;
      if (bulkOps.length > 0) {
        const result = await ContentEmbedding.bulkWrite(bulkOps, { ordered: false });
        invalidatedRows = result.modifiedCount ?? 0;
      }

      let cachesInvalidated = 0;
      for (const userId of affectedUsers) {
        const deleted = await invalidateCacheByPattern(`canvas:user:${userId}:*`);
        if (deleted > 0) cachesInvalidated++;
      }

      await audit({
        actorUserId,
        action: AUDIT_ACTIONS.ADMIN_ACTION,
        category: "admin",
        outcome: "success",
        role: req.actorRole,
        metadata: {
          subAction: "maintenance.reextractTruncatedFiles",
          truncatedFiles: truncated.length,
          invalidatedRows,
          affectedUsers: affectedUsers.size,
          cachesInvalidated,
        },
        req,
      });

      const payload = AdminMaintenanceReextractTruncatedResponseSchema.parse({
        suksess: true,
        truncatedFiles: truncated.length,
        invalidatedRows,
        affectedUsers: affectedUsers.size,
        cachesInvalidated,
      });
      await completeOperation("reextract-truncated-files", 600, payload);
    } catch (err) {
      logger.error({ err }, "Admin reextract-truncated-files feilet");
      await failOperation("reextract-truncated-files", "Re-ekstraksjon feilet.");
    }
  })();
});

export default router;
