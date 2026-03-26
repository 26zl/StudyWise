import { Router } from "express";
import { createHash, randomBytes } from "crypto";
import mongoose from "mongoose";
import { z } from "zod";
import { ChatHistory, type ChatHistoryDocument } from "../../database/models/ChatHistory.js";
import { decrypt, encrypt } from "../../utils/kryptering.js";
import { logger } from "../../utils/logger.js";
import {
  apiError,
  requireUserId,
  sendUnknownError,
  sendZodError,
} from "../../utils/apiError.js";
import { audit, AUDIT_ACTIONS } from "../../utils/auditLog.js";
import {
  ChatMessageSchema,
  ChatShareCreateSchema,
  ChatShareResponseSchema,
  SharedChatResponseSchema,
} from "common/chat";
import { createRateLimiter } from "../../middleware/rate-limit.js";
import { isValidMongoObjectId } from "../../utils/mongoId.js";

export const kiShareRouter = Router();
export const sharedChatRouter = Router();

const SHARE_TTL_DAYS = 30;
export const SHARE_CLEANUP_INTERVAL_MS = 60 * 60 * 1000;
const OPPORTUNISTIC_CLEANUP_INTERVAL_MS = 10 * 60 * 1000;
const SHARE_TOKEN_BYTES = 32;
const SHARE_TYPE = "full_chat";
const PUBLIC_SHARE_RATE_LIMIT = createRateLimiter({
  points: 60,
  duration: 60,
  keyPrefix: "rlflx:share-public",
});

let lastOpportunisticCleanupAt = 0;

function buildShareExpiry(now = new Date()): Date {
  return new Date(now.getTime() + SHARE_TTL_DAYS * 24 * 60 * 60 * 1000);
}

function createShareToken(): string {
  return randomBytes(SHARE_TOKEN_BYTES).toString("base64url");
}

function hashShareToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

function hashSharedSource(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

function notFoundSharedChat(res: Parameters<typeof apiError.notFound>[0]) {
  return apiError.notFound(res, "Den delte samtalen");
}

async function parseEncryptedMessages(
  encryptedMessages: string,
): Promise<z.infer<typeof ChatMessageSchema>[]> {
  const decrypted = JSON.parse(decrypt(encryptedMessages));
  return z.array(ChatMessageSchema).parse(decrypted);
}

async function parseStoredChatMessages(
  doc: Pick<ChatHistoryDocument, "encryptedMessages">,
): Promise<z.infer<typeof ChatMessageSchema>[]> {
  return parseEncryptedMessages(doc.encryptedMessages);
}

async function clearShareState(chatId: mongoose.Types.ObjectId): Promise<void> {
  await ChatHistory.updateOne(
    { _id: chatId },
    {
      $set: { isShared: false },
      $unset: {
        shareToken: 1,
        shareTokenHash: 1,
        sharedAt: 1,
        shareExpiresAt: 1,
        sharedSnapshot: 1,
      },
    },
  );
}

async function auditShareExpired(
  doc: Pick<ChatHistoryDocument, "_id" | "user" | "shareExpiresAt">,
  reason: "expired_on_access" | "scheduled_cleanup" | "opportunistic_cleanup",
): Promise<void> {
  await audit({
    actorUserId: "system",
    targetUserId: doc.user.toString(),
    action: AUDIT_ACTIONS.SHARE_EXPIRED,
    category: "privacy",
    outcome: "success",
    metadata: {
      chatId: doc._id.toString(),
      expiresAt: doc.shareExpiresAt?.toISOString(),
      reason,
    },
  });
}

async function auditInvalidShareAccess(
  req: Parameters<typeof audit>[0]["req"],
  reason:
    | "invalid_format"
    | "unknown_token"
    | "missing_snapshot"
    | "expired"
    | "corrupt_share",
): Promise<void> {
  await audit({
    actorUserId: "anonymous",
    action: AUDIT_ACTIONS.INVALID_SHARE_ACCESS,
    category: "privacy",
    outcome: "failure",
    metadata: {
      reason,
      path: req?.path,
      method: req?.method,
    },
    req,
  });
}

function scheduleOpportunisticCleanup(): void {
  const now = Date.now();
  if (now - lastOpportunisticCleanupAt < OPPORTUNISTIC_CLEANUP_INTERVAL_MS) {
    return;
  }

  lastOpportunisticCleanupAt = now;
  void cleanupExpiredSharedChats({
    limit: 25,
    reason: "opportunistic_cleanup",
  }).catch((error) => {
    logger.warn({ err: error }, "Opportunistisk cleanup av utløpte delinger feilet");
  });
}

export async function cleanupExpiredSharedChats(options?: {
  limit?: number;
  reason?: "scheduled_cleanup" | "opportunistic_cleanup";
}): Promise<number> {
  const limit = options?.limit ?? 100;
  const reason = options?.reason ?? "scheduled_cleanup";
  const expiredShares = await ChatHistory.find({
    isShared: true,
    shareExpiresAt: { $lte: new Date() },
  })
    .select("_id user shareExpiresAt")
    .sort({ shareExpiresAt: 1 })
    .limit(limit);

  if (expiredShares.length === 0) {
    return 0;
  }

  const ids = expiredShares.map((share) => share._id);
  await ChatHistory.updateMany(
    { _id: { $in: ids } },
    {
      $set: { isShared: false },
      $unset: {
        shareToken: 1,
        shareTokenHash: 1,
        sharedAt: 1,
        shareExpiresAt: 1,
        sharedSnapshot: 1,
      },
    },
  );

  const auditResults = await Promise.allSettled(
    expiredShares.map((share) => auditShareExpired(share, reason)),
  );
  for (const r of auditResults) {
    if (r.status === "rejected") {
      logger.warn({ err: r.reason, reason }, "Feil ved audit-logging av utløpt deling");
    }
  }

  logger.info(
    { count: expiredShares.length, reason },
    "Utløpte delinger ryddet",
  );

  return expiredShares.length;
}

kiShareRouter.post("/chat/:chatId/share", async (req, res) => {
  try {
    scheduleOpportunisticCleanup();

    const userId = requireUserId(req, res);
    if (!userId) return;

    const { chatId } = req.params;
    if (!isValidMongoObjectId(chatId)) {
      return apiError.badRequest(res, "Ugyldig samtale-ID");
    }

    const parseResult = ChatShareCreateSchema.safeParse(req.body ?? {});
    if (!parseResult.success) {
      return sendZodError(res, parseResult.error, "share create");
    }

    const doc = await ChatHistory.findOne({ _id: chatId, user: userId });
    if (!doc) {
      return apiError.notFound(res, "Samtalen");
    }

    let messages: z.infer<typeof ChatMessageSchema>[];
    try {
      messages = await parseStoredChatMessages(doc);
    } catch (error) {
      logger.warn(
        { err: error, chatId: doc._id.toString(), userId },
        "Kunne ikke lese chat-meldinger før deling",
      );
      return apiError.serverError(res);
    }

    if (messages.length === 0) {
      return apiError.badRequest(res, "Samtalen er tom og kan ikke deles");
    }

    const now = new Date();
    const snapshotPayload = JSON.stringify(messages);
    const shareToken = createShareToken();
    const shareExpiresAt = buildShareExpiry(now);

    doc.shareTokenHash = hashShareToken(shareToken);
    doc.sharedAt = now;
    doc.shareExpiresAt = shareExpiresAt;
    doc.sharedSnapshot = {
      version: 2,
      type: SHARE_TYPE,
      title: doc.title?.trim() || "Samtale",
      encryptedMessages: encrypt(snapshotPayload),
      messageCount: messages.length,
      sourceHash: hashSharedSource(snapshotPayload),
      generatedAt: now,
    };
    doc.isShared = true;
    await doc.save();

    await audit({
      actorUserId: userId,
      action: AUDIT_ACTIONS.SHARE_CREATED,
      category: "privacy",
      outcome: "success",
      role: req.actorRole,
      metadata: {
        chatId: doc._id.toString(),
        expiresAt: shareExpiresAt.toISOString(),
        shareType: SHARE_TYPE,
        messageCount: messages.length,
      },
      req,
    });

    logger.info(
      {
        userId,
        chatId: doc._id.toString(),
        shareExpiresAt,
        shareType: SHARE_TYPE,
        messageCount: messages.length,
      },
      "Opprettet delingslenke for full chat",
    );

    return res.json(
      ChatShareResponseSchema.parse({
        shareToken,
        shareUrl: `/delt-chat/${shareToken}`,
        expiresAt: shareExpiresAt,
        shareType: SHARE_TYPE,
      }),
    );
  } catch (error) {
    return sendUnknownError(res, error, {
      kontekst: "POST chat share",
      melding: "Kunne ikke opprette delingslenke. Prøv igjen.",
    });
  }
});

kiShareRouter.delete("/chat/:chatId/share", async (req, res) => {
  try {
    const userId = requireUserId(req, res);
    if (!userId) return;

    const { chatId } = req.params;
    if (!isValidMongoObjectId(chatId)) {
      return apiError.badRequest(res, "Ugyldig samtale-ID");
    }

    const doc = await ChatHistory.findOne({ _id: chatId, user: userId });
    if (!doc) {
      return apiError.notFound(res, "Samtalen");
    }

    await clearShareState(doc._id);
    await audit({
      actorUserId: userId,
      action: AUDIT_ACTIONS.SHARE_REMOVED,
      category: "privacy",
      outcome: "success",
      role: req.actorRole,
      metadata: {
        chatId: doc._id.toString(),
      },
      req,
    });

    logger.info({ userId, chatId }, "Deling av chat fjernet");
    return res.status(204).send();
  } catch (error) {
    return sendUnknownError(res, error, {
      kontekst: "DELETE chat share",
      melding: "Kunne ikke fjerne deling. Prøv igjen.",
    });
  }
});

sharedChatRouter.get("/shared/:shareToken", PUBLIC_SHARE_RATE_LIMIT, async (req, res) => {
  try {
    scheduleOpportunisticCleanup();

    const shareToken = Array.isArray(req.params.shareToken)
      ? req.params.shareToken[0]
      : req.params.shareToken;
    const tokenPattern = /^[A-Za-z0-9_-]{40,45}$/;
    if (!shareToken || !tokenPattern.test(shareToken)) {
      await auditInvalidShareAccess(req, "invalid_format");
      return notFoundSharedChat(res);
    }

    const shareTokenHash = hashShareToken(shareToken);
    const doc = await ChatHistory.findOne({
      shareTokenHash,
      isShared: true,
    }).select("_id user shareExpiresAt sharedAt sharedSnapshot");

    if (!doc) {
      await auditInvalidShareAccess(req, "unknown_token");
      return notFoundSharedChat(res);
    }

    if (!doc.shareExpiresAt || doc.shareExpiresAt.getTime() <= Date.now()) {
      await clearShareState(doc._id);
      await Promise.all([
        auditShareExpired(doc, "expired_on_access"),
        auditInvalidShareAccess(req, "expired"),
      ]);
      return notFoundSharedChat(res);
    }

    if (!doc.sharedSnapshot || !doc.sharedAt) {
      await clearShareState(doc._id);
      await auditInvalidShareAccess(req, "missing_snapshot");
      return notFoundSharedChat(res);
    }

    let title = doc.sharedSnapshot.title?.trim() || "";
    let messages: z.infer<typeof ChatMessageSchema>[] = [];
    if (doc.sharedSnapshot.type !== "full_chat") {
      await clearShareState(doc._id);
      await auditInvalidShareAccess(req, "corrupt_share");
      return notFoundSharedChat(res);
    }

    title = title || "Delt StudyWise-chat";
    if (!doc.sharedSnapshot.encryptedMessages) {
      await clearShareState(doc._id);
      await auditInvalidShareAccess(req, "missing_snapshot");
      return notFoundSharedChat(res);
    }

    try {
      messages = await parseEncryptedMessages(doc.sharedSnapshot.encryptedMessages);
    } catch (error) {
      logger.warn(
        { err: error, chatId: doc._id.toString() },
        "Kunne ikke dekryptere delt chat-snapshot",
      );
      await clearShareState(doc._id);
      await auditInvalidShareAccess(req, "corrupt_share");
      return notFoundSharedChat(res);
    }

    await audit({
      actorUserId: "anonymous",
      targetUserId: doc.user.toString(),
      action: AUDIT_ACTIONS.SHARE_VIEWED,
      category: "privacy",
      outcome: "success",
      metadata: {
        chatId: doc._id.toString(),
        shareType: doc.sharedSnapshot.type,
        messageCount: messages.length,
      },
      req,
    });

    return res.json(
      SharedChatResponseSchema.parse({
        title,
        messages,
        sharedAt: doc.sharedAt,
        expiresAt: doc.shareExpiresAt,
        shareType: doc.sharedSnapshot.type,
      }),
    );
  } catch (error) {
    await auditInvalidShareAccess(req, "corrupt_share");
    return sendUnknownError(res, error, {
      kontekst: "GET shared chat",
      melding: "Kunne ikke hente delt samtale.",
    });
  }
});
