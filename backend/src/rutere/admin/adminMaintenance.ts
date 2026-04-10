/**
 * Admin vedlikeholdsoperasjoner.
 * Monteres under /api/admin (allerede beskyttet med requireAuth + requireRole("admin")).
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
} from "common/admin";
import { User } from "../../database/models/User.js";
import { ChatHistory } from "../../database/models/ChatHistory.js";
import { SharedChat } from "../../database/models/SharedChat.js";
import { TaskBreakdown } from "../../database/models/TaskBreakdown.js";
import { Arbeidsplan } from "../../database/models/arbeidsplan.js";
import { CanvasStructureModel } from "../../database/models/CanvasStructure.js";
import { CanvasUser } from "../../database/models/CanvasUser.js";
import { ContentEmbedding } from "../../database/models/ContentEmbedding.js";
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

/** Alle vedlikeholdsoperasjoner som kan kjøres. */
const MAINTENANCE_OPS = [
  "backfill-fulltext",
  "cleanup-orphaned",
  "rebuild-embeddings",
  "force-canvas-resync",
  "clean-expired-shares",
  "clean-old-chats",
  "reencrypt-tokens",
] as const;
type MaintenanceOp = (typeof MAINTENANCE_OPS)[number];

function cooldownKey(op: string): string {
  return `admin:maintenance:${op}:last-run`;
}

function runningKey(op: string): string {
  return `admin:maintenance:${op}:running`;
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
  // Uten Redis kan vi ikke garantere at bare én admin kjører operasjonen.
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

/** Fjern running-markør og sett cooldown etter suksess. */
async function completeOperation(op: MaintenanceOp, cooldownSeconds: number): Promise<void> {
  await Promise.all([
    deleteCacheKeys([runningKey(op)]),
    setCache(cooldownKey(op), Date.now().toString(), cooldownSeconds),
  ]);
}

/** Fjern running-markør etter feil (uten å sette cooldown). */
async function clearRunning(op: MaintenanceOp): Promise<void> {
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
        // Beregn basert på operasjonens definerte cooldown (bruker konservativt estimat)
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

// ── POST /maintenance/backfill-fulltext ─────────────────────────────────────

router.post("/maintenance/backfill-fulltext", requireRecentAuth, async (req, res) => {
  const actorUserId = requireUserId(req, res);
  if (!actorUserId) return;

  if (!(await acquireLock("backfill-fulltext", 600, 300, res))) return;

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
    await completeOperation("backfill-fulltext", 600);

    if (res.headersSent) return;
    return res.json(
      AdminMaintenanceFullTextBackfillResponseSchema.parse({
        suksess: true,
        ...result,
      }),
    );
  } catch (err) {
    await clearRunning("backfill-fulltext");
    logger.error({ err }, "Admin fullText-backfill feilet");
    if (res.headersSent) return;
    return apiError.serverError(res);
  }
});

// ── POST /maintenance/cleanup-orphaned ─────────────────────────────────────

router.post("/maintenance/cleanup-orphaned", requireRecentAuth, async (req, res) => {
  const actorUserId = requireUserId(req, res);
  if (!actorUserId) return;

  if (!(await acquireLock("cleanup-orphaned", 600, 300, res))) return;

  try {
    const alleBrukere = await User.find(ACTIVE_FILTER, { _id: 1 }).lean();
    const alleBrukerObjectIds = alleBrukere.map((b) => b._id);
    const alleBrukerIds = alleBrukerObjectIds.map((id) => id.toString());

    // Finn orphaned userIds i ContentEmbedding for Pinecone-opprydding
    // Bruker aggregate i stedet for distinct (distinct er ikke i MongoDB Stable API v1)
    const orphanedEmbeddingAgg = await ContentEmbedding.aggregate<{ _id: string }>([
      { $match: { userId: { $nin: alleBrukerIds } } },
      { $group: { _id: "$userId" } },
    ]);
    const orphanedEmbeddingUserIds = orphanedEmbeddingAgg.map((r) => r._id);

    // Slett Pinecone-vektorer for foreldreløse brukere
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
    await completeOperation("cleanup-orphaned", 600);

    if (pineconeFailures > 0) {
      logger.warn({ pineconeFailures }, "Noen Pinecone-oppryddinger feilet under cleanup-orphaned");
    }

    return res.json(AdminMaintenanceCleanupOrphanedResponseSchema.parse({ suksess: true, deleted }));
  } catch (err) {
    await clearRunning("cleanup-orphaned");
    logger.error({ err }, "Admin cleanup-orphaned feilet");
    return apiError.serverError(res);
  }
});

// ── POST /maintenance/rebuild-embeddings ───────────────────────────────────

router.post("/maintenance/rebuild-embeddings", requireRecentAuth, async (req, res) => {
  const actorUserId = requireUserId(req, res);
  if (!actorUserId) return;

  if (!isPineconeConfigured()) {
    return apiError.badRequest(res, "Pinecone er ikke konfigurert.");
  }

  if (!(await acquireLock("rebuild-embeddings", 1800, 600, res))) return;

  try {
    const BATCH_SIZE = 100;
    let scannedChunks = 0;
    let reembeddedChunks = 0;
    let failedChunks = 0;

    // Finn chunks som ikke er synkronisert til Pinecone
    const unsyncedChunks = await ContentEmbedding.find(
      { pineconesynced: { $ne: true }, isFullDocument: { $ne: true } },
      { _id: 1, userId: 1, courseId: 1, moduleId: 1, fileId: 1, chunkIndex: 1, text: 1 },
    ).lean();

    scannedChunks = unsyncedChunks.length;

    // Prosesser i batches
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

        // Marker som synkronisert
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
    await completeOperation("rebuild-embeddings", 1800);

    return res.json(
      AdminMaintenanceRebuildEmbeddingsResponseSchema.parse({
        suksess: true,
        scannedChunks,
        reembeddedChunks,
        failedChunks,
      }),
    );
  } catch (err) {
    await clearRunning("rebuild-embeddings");
    logger.error({ err }, "Admin rebuild-embeddings feilet");
    return apiError.serverError(res);
  }
});

// ── POST /maintenance/force-canvas-resync ──────────────────────────────────

router.post("/maintenance/force-canvas-resync", requireRecentAuth, async (req, res) => {
  const actorUserId = requireUserId(req, res);
  if (!actorUserId) return;

  if (!(await acquireLock("force-canvas-resync", 1800, 300, res))) return;

  try {
    const canvasUsers = await User.find(
      { canvasBaseUrl: { $exists: true }, ...ACTIVE_FILTER },
      { _id: 1 },
    ).lean();

    let keysDeleted = 0;
    const userIds = canvasUsers.map((u) => u._id.toString());

    for (const userId of userIds) {
      // canvas:user:{id}:* — Canvas API-cache (emner, moduler, oppgaver, sync-meta)
      // db:user:{id}:courses — prosessert kursdata for chat-kontekst
      // ki:session:{id}:* — KI-sesjonscache som kan referere til gammel Canvas-data
      const patterns = [
        `canvas:user:${userId}:*`,
        `db:user:${userId}:*`,
        `ki:session:${userId}:*`,
      ];
      for (const pattern of patterns) {
        keysDeleted += await invalidateCacheByPattern(pattern);
      }
    }

    // Slett MongoDB CanvasStructure slik at context-loader ikke serverer gammel data
    // via Mongo-fallback. Neste request trigger en full sync fra Canvas.
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
    await completeOperation("force-canvas-resync", 1800);

    return res.json(
      AdminMaintenanceForceCanvasResyncResponseSchema.parse({
        suksess: true,
        usersInvalidated: canvasUsers.length,
        keysDeleted,
      }),
    );
  } catch (err) {
    await clearRunning("force-canvas-resync");
    logger.error({ err }, "Admin force-canvas-resync feilet");
    return apiError.serverError(res);
  }
});

// ── POST /maintenance/clean-expired-shares ─────────────────────────────────

router.post("/maintenance/clean-expired-shares", requireRecentAuth, async (req, res) => {
  const actorUserId = requireUserId(req, res);
  if (!actorUserId) return;

  if (!(await acquireLock("clean-expired-shares", 600, 300, res))) return;

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
    await completeOperation("clean-expired-shares", 600);

    return res.json(
      AdminMaintenanceCleanExpiredSharesResponseSchema.parse({
        suksess: true,
        deletedCount: result.deletedCount,
      }),
    );
  } catch (err) {
    await clearRunning("clean-expired-shares");
    logger.error({ err }, "Admin clean-expired-shares feilet");
    return apiError.serverError(res);
  }
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

  try {
    const cutoffDate = new Date(Date.now() - parsed.data.dager * DAY_MS);

    // Finn samtaler som skal slettes (hopp over festede)
    const chatsToDelete = await ChatHistory.find(
      { createdAt: { $lt: cutoffDate }, pinned: { $ne: true } },
      { _id: 1 },
    ).lean();

    const chatIds = chatsToDelete.map((c) => c._id);

    // Slett tilhørende delelinker
    const sharedResult = await SharedChat.deleteMany({ chatId: { $in: chatIds } });

    // Slett samtalene
    const chatResult = await ChatHistory.deleteMany({ _id: { $in: chatIds } });

    await audit({
      actorUserId,
      action: AUDIT_ACTIONS.ADMIN_ACTION,
      category: "admin",
      outcome: "success",
      role: req.actorRole,
      metadata: {
        subAction: "maintenance.cleanOldChats",
        dager: parsed.data.dager,
        deletedChats: chatResult.deletedCount,
        deletedShares: sharedResult.deletedCount,
      },
      req,
    });
    await completeOperation("clean-old-chats", 600);

    return res.json(
      AdminMaintenanceCleanOldChatsResponseSchema.parse({
        suksess: true,
        deletedChats: chatResult.deletedCount,
        deletedShares: sharedResult.deletedCount,
        cutoffDate: cutoffDate.toISOString(),
      }),
    );
  } catch (err) {
    await clearRunning("clean-old-chats");
    logger.error({ err }, "Admin clean-old-chats feilet");
    return apiError.serverError(res);
  }
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
        // Sjekk om det er versjonert format (v1:...) eller legacy (iv:authTag:encrypted)
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
            { _id: user._id },
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
        // Kan ikke dekryptere — hopp over
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
    await completeOperation("reencrypt-tokens", 1800);

    return res.json(
      AdminMaintenanceReencryptResponseSchema.parse({
        suksess: true,
        processed,
        reencrypted,
        alreadyCurrent,
        failed,
      }),
    );
  } catch (err) {
    await clearRunning("reencrypt-tokens");
    logger.error({ err }, "Admin reencrypt-tokens feilet");
    return apiError.serverError(res);
  }
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

        // Bruk dbStats-kommandoen for størrelsesinformasjon per collection
        let sizeBytes = 0;
        let indexSizeBytes = 0;
        try {
          const collStats = await db.command({ collStats: coll.name, scale: 1 });
          sizeBytes = collStats.size ?? 0;
          indexSizeBytes = collStats.totalIndexSize ?? 0;
        } catch {
          // collStats kan feile på Atlas Stable API — hopp over størrelse
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

    // Sorter etter størrelse (største først)
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

export default router;
