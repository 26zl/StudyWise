/**
 * KI chat-deling (share links).
 *
 * Inneholder endepunkter for å opprette/administrere delingslenker,
 * og offentlig uthenting av delte samtaler.
 */
import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { randomBytes } from "crypto";
import mongoose from "mongoose";
import { ChatHistory, type ChatHistoryDocument } from "../../database/models/ChatHistory.js";
import { SharedChat, type SharedChatDocument } from "../../database/models/SharedChat.js";
import { decrypt } from "../../utils/kryptering.js";
import { logger } from "../../utils/logger.js";
import {
  apiError,
  requireUserId,
  sendUnknownError,
  sendZodError,
} from "../../utils/apiError.js";
import {
  ChatMessageSchema,
  ChatShareCreateSchema,
  ChatShareResponseSchema,
  SharedChatListResponseSchema,
  SharedChatPublicResponseSchema,
  SharedChatUpdateSchema,
} from "common/chat";
import { createRateLimiter } from "../../middleware/rate-limit.js";
import { isValidMongoObjectId } from "../../utils/mongoId.js";
import { tryAuthenticateRequest } from "../../middleware/auth.js";
import { audit, AUDIT_ACTIONS } from "../../utils/auditLog.js";

export const kiShareRouter = Router();
export const sharedChatRouter = Router();
export const SHARE_CLEANUP_INTERVAL_MS = 60 * 60 * 1000;
const SHARE_OPPORTUNISTIC_CLEANUP_INTERVAL_MS = 5 * 60 * 1000;

let lastOpportunisticCleanupAt = 0;
const SHARE_ID_REGEX = /^[A-Za-z0-9_-]{16,24}$/;

function createShareId(): string {
  return randomBytes(24).toString("base64url").slice(0, 24);
}

function triggerOpportunisticCleanup(): void {
  const now = Date.now();
  if (now - lastOpportunisticCleanupAt < SHARE_OPPORTUNISTIC_CLEANUP_INTERVAL_MS) {
    return;
  }
  lastOpportunisticCleanupAt = now;
  void cleanupExpiredSharedChats({ reason: "opportunistic_cleanup" }).catch((error) => {
    logger.warn({ err: error }, "Opportunistisk cleanup av utløpte delinger feilet");
  });
}

async function deactivateExpiredSharedChats(
  filter: Record<string, unknown> = {},
): Promise<number> {
  const result = await SharedChat.updateMany(
    {
      ...filter,
      isActive: true,
      expiresAt: { $lte: new Date() },
    },
    {
      $set: { isActive: false },
    },
  );
  return result.modifiedCount ?? 0;
}

async function deactivateSharedChat(shared: Pick<SharedChatDocument, "_id" | "isActive">): Promise<void> {
  if (!shared.isActive) {
    return;
  }

  await SharedChat.updateOne(
    { _id: shared._id, isActive: true },
    {
      $set: { isActive: false },
    },
  );
}

async function loadSharedChatForRead(req: Request, res: Response, shareId: string): Promise<{
  shared: SharedChatDocument;
  chat: Pick<ChatHistoryDocument, "_id" | "title" | "encryptedMessages">;
  messages: z.infer<typeof ChatMessageSchema>[];
} | null> {
  triggerOpportunisticCleanup();

  const shared = await SharedChat.findOne({ shareId });
  if (!shared || !shared.isActive) {
    apiError.notFound(res, "Den delte samtalen");
    return null;
  }

  const sharedDoc = shared as SharedChatDocument;
  if (isExpired(shared.expiresAt)) {
    await deactivateSharedChat(sharedDoc);
    apiError.notFound(res, "Den delte samtalen");
    return null;
  }

  if (shared.accessType === "private") {
    const isAuthed = await tryAuthenticateRequest(req);
    // Private delinger skal oppføre seg som "finnes ikke" for uvedkommende.
    if (!isAuthed || req.user?.id !== shared.ownerId.toString()) {
      apiError.notFound(res, "Den delte samtalen");
      return null;
    }
  }

  const chat = await ChatHistory.findById(shared.chatId).select("title encryptedMessages");
  if (!chat) {
    await deactivateSharedChat(sharedDoc);
    apiError.notFound(res, "Samtalen");
    return null;
  }

  const chatDoc = chat as Pick<ChatHistoryDocument, "_id" | "title" | "encryptedMessages">;

  let messages: z.infer<typeof ChatMessageSchema>[];
  try {
    messages = await parseStoredChatMessages(chatDoc);
  } catch (error) {
    logger.warn(
      { err: error, shareId, chatId: shared.chatId.toString() },
      "Korrupt delt samtale — deaktiverer share-lenke",
    );
    await deactivateSharedChat(sharedDoc);
    apiError.notFound(res, "Den delte samtalen");
    return null;
  }
  if (messages.length === 0) {
    await deactivateSharedChat(sharedDoc);
    apiError.notFound(res, "Den delte samtalen");
    return null;
  }

  await SharedChat.updateOne({ _id: sharedDoc._id }, { $inc: { viewCount: 1 } });
  return {
    shared: sharedDoc,
    chat: chatDoc,
    messages,
  };
}

const PUBLIC_SHARE_RATE_LIMIT = createRateLimiter({
  points: 30,
  duration: 60,
  keyPrefix: "rlflx:share-public",
});
const DEFAULT_SHARE_TTL_DAYS = 30;

async function parseStoredChatMessages(
  doc: Pick<ChatHistoryDocument, "encryptedMessages">,
): Promise<z.infer<typeof ChatMessageSchema>[]> {
  let decryptedJson: string;
  try {
    decryptedJson = decrypt(doc.encryptedMessages);
  } catch (err) {
    throw new Error(
      `Dekryptering av chat-meldinger feilet: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  const decrypted = JSON.parse(decryptedJson);
  return z.array(ChatMessageSchema).parse(decrypted);
}

function buildShareUrl(shareId: string): string {
  return `/share/${shareId}`;
}

function isExpired(expiresAt?: Date | null): boolean {
  return Boolean(expiresAt && expiresAt.getTime() <= Date.now());
}

export async function cleanupExpiredSharedChats(_options?: {
  reason?: "scheduled_cleanup" | "opportunistic_cleanup";
}): Promise<number> {
  return deactivateExpiredSharedChats();
}

function parseShareIdParam(req: Request): string | null {
  const shareId = Array.isArray(req.params.shareId) ? req.params.shareId[0] : req.params.shareId;
  if (!shareId || !SHARE_ID_REGEX.test(shareId)) {
    return null;
  }
  return shareId;
}

function buildSharedChatPublicPayload(
  loaded: Awaited<ReturnType<typeof loadSharedChatForRead>>,
) {
  if (!loaded) return null;
  const { shared, chat, messages } = loaded;
  return SharedChatPublicResponseSchema.parse({
    shareId: shared.shareId,
    chatTitle: chat.title?.trim() || "Samtale",
    messages,
    createdAt: shared.createdAt,
    expiresAt: shared.expiresAt ?? null,
  });
}

async function handleSharedChatRead(
  req: Request,
  res: Response,
  buildPayload: (
    loaded: Awaited<ReturnType<typeof loadSharedChatForRead>>,
  ) => ReturnType<typeof SharedChatPublicResponseSchema.parse> | null,
): Promise<void> {
  const shareId = parseShareIdParam(req);
  if (!shareId) {
    apiError.notFound(res, "Den delte samtalen");
    return;
  }

  const loaded = await loadSharedChatForRead(req, res, shareId);
  if (!loaded) return;
  res.json(buildPayload(loaded));
}

kiShareRouter.post("/chat/:chatId/share", async (req, res) => {
  try {
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

    const shareId = createShareId();
    const ownerObjectId = new mongoose.Types.ObjectId(userId);
    await deactivateExpiredSharedChats({ ownerId: ownerObjectId, chatId: doc._id });
    const shared = await SharedChat.findOneAndUpdate(
      {
        chatId: doc._id,
        ownerId: ownerObjectId,
        isActive: true,
      },
      {
        $set: {
          chatId: doc._id,
          ownerId: ownerObjectId,
          expiresAt: new Date(Date.now() + DEFAULT_SHARE_TTL_DAYS * 24 * 60 * 60 * 1000),
          isActive: true,
          accessType: "public",
        },
        $setOnInsert: {
          shareId,
          viewCount: 0,
        },
      },
      { upsert: true, returnDocument: "after" },
    );

    logger.info(
      {
        userId,
        chatId: doc._id.toString(),
        shareId: shared.shareId,
        accessType: shared.accessType,
      },
      "Opprettet delingslenke for chat",
    );

    void audit({
      actorUserId: userId,
      action: AUDIT_ACTIONS.SHARE_CREATED,
      category: "ki",
      outcome: "success",
      metadata: {
        chatId: doc._id.toString(),
        shareId: shared.shareId,
        accessType: shared.accessType,
      },
      req,
    });

    return res.json(
      ChatShareResponseSchema.parse({
        shareId: shared.shareId,
        shareUrl: buildShareUrl(shared.shareId),
        expiresAt: shared.expiresAt ?? null,
        accessType: shared.accessType,
      }),
    );
  } catch (error) {
    return sendUnknownError(res, error, {
      kontekst: "POST chat share",
      melding: "Kunne ikke opprette delingslenke. Prøv igjen.",
    });
  }
});

kiShareRouter.get("/chat/shared", async (req, res) => {
  try {
    const userId = requireUserId(req, res);
    if (!userId) return;

    const ownerObjId = new mongoose.Types.ObjectId(userId);
    await deactivateExpiredSharedChats({ ownerId: ownerObjId });

    const docs = await SharedChat.find({
      ownerId: ownerObjId,
      isActive: true,
    })
      .sort({ createdAt: -1 })
      .populate("chatId", "title topic");

    const links = docs
      .filter((doc) => !isExpired(doc.expiresAt))
      .map((doc) => {
        const chatTitle =
          doc.chatId &&
          typeof doc.chatId === "object" &&
          "title" in doc.chatId &&
          typeof doc.chatId.title === "string" &&
          doc.chatId.title.trim().length > 0
            ? doc.chatId.title.trim()
            : "Samtale";

        return {
          shareId: doc.shareId,
          chatId: typeof doc.chatId === "object" && doc.chatId && "_id" in doc.chatId
            ? String(doc.chatId._id)
            : String(doc.chatId),
          chatTitle,
          topic:
            doc.chatId &&
            typeof doc.chatId === "object" &&
            "topic" in doc.chatId &&
            typeof doc.chatId.topic === "string"
              ? doc.chatId.topic
              : undefined,
          shareUrl: buildShareUrl(doc.shareId),
          createdAt: doc.createdAt,
          expiresAt: doc.expiresAt ?? null,
          isActive: doc.isActive,
          accessType: doc.accessType,
          viewCount: doc.viewCount,
        };
      });

    return res.json(
      SharedChatListResponseSchema.parse({ links }),
    );
  } catch (error) {
    return sendUnknownError(res, error, {
      kontekst: "GET chat shared",
      melding: "Kunne ikke hente delte samtaler.",
    });
  }
});

kiShareRouter.delete("/chat/shared", async (req, res) => {
  try {
    const userId = requireUserId(req, res);
    if (!userId) return;

    const ownerObjId = new mongoose.Types.ObjectId(userId);
    await deactivateExpiredSharedChats({ ownerId: ownerObjId });

    const result = await SharedChat.updateMany(
      {
        ownerId: ownerObjId,
        isActive: true,
      },
      {
        $set: { isActive: false },
      },
    );

    const deletedCount = result.modifiedCount ?? 0;

    logger.info(
      { userId, deletedCount },
      "Deaktiverte alle delingslenker for bruker",
    );

    void audit({
      actorUserId: userId,
      action: AUDIT_ACTIONS.SHARE_REMOVED,
      category: "ki",
      outcome: "success",
      metadata: { deletedCount, scope: "all" },
      req,
    });

    return res.json({
      ok: true,
      deletedCount,
    });
  } catch (error) {
    return sendUnknownError(res, error, {
      kontekst: "DELETE chat shared all",
      melding: "Kunne ikke slette delte samtaler.",
    });
  }
});

kiShareRouter.patch("/chat/shared/:shareId", async (req, res) => {
  try {
    const userId = requireUserId(req, res);
    if (!userId) return;

    const parsed = SharedChatUpdateSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      return sendZodError(res, parsed.error, "chat shared update");
    }

    const ownerObjId = new mongoose.Types.ObjectId(userId);
    const doc = await SharedChat.findOne({
      shareId: req.params.shareId,
      ownerId: ownerObjId,
    });

    if (!doc) {
      return apiError.notFound(res, "Delt lenke");
    }

    if (isExpired(doc.expiresAt)) {
      if (doc.isActive) {
        doc.isActive = false;
        await doc.save();
      }
      return apiError.notFound(res, "Delt lenke");
    }

    if (parsed.data.expiresAt !== undefined && parsed.data.expiresAt !== null && isExpired(parsed.data.expiresAt)) {
      return apiError.badRequest(res, "Utløpstidspunkt må være i fremtiden");
    }

    if (parsed.data.isActive !== undefined) {
      doc.isActive = parsed.data.isActive;
    }
    if (parsed.data.accessType !== undefined) {
      doc.accessType = parsed.data.accessType;
    }
    if (parsed.data.expiresAt !== undefined) {
      doc.expiresAt = parsed.data.expiresAt;
    }

    await doc.save();

    void audit({
      actorUserId: userId,
      action: AUDIT_ACTIONS.SHARE_UPDATED,
      category: "ki",
      outcome: "success",
      metadata: {
        shareId: req.params.shareId,
        updates: Object.keys(parsed.data),
      },
      req,
    });

    return res.json({
      ok: true,
    });
  } catch (error) {
    return sendUnknownError(res, error, {
      kontekst: "PATCH chat shared",
      melding: "Kunne ikke oppdatere delt lenke.",
    });
  }
});

kiShareRouter.delete("/chat/shared/:shareId", async (req, res) => {
  try {
    const userId = requireUserId(req, res);
    if (!userId) return;

    const ownerObjId = new mongoose.Types.ObjectId(userId);
    const doc = await SharedChat.findOne({
      shareId: req.params.shareId,
      ownerId: ownerObjId,
    });
    if (!doc) {
      return apiError.notFound(res, "Delt lenke");
    }

    if (isExpired(doc.expiresAt)) {
      if (doc.isActive) {
        doc.isActive = false;
        await doc.save();
      }
      return res.status(204).send();
    }

    doc.isActive = false;
    await doc.save();

    void audit({
      actorUserId: userId,
      action: AUDIT_ACTIONS.SHARE_REMOVED,
      category: "ki",
      outcome: "success",
      metadata: { shareId: req.params.shareId },
      req,
    });

    return res.status(204).send();
  } catch (error) {
    return sendUnknownError(res, error, {
      kontekst: "DELETE chat shared",
      melding: "Kunne ikke slette delt lenke.",
    });
  }
});

sharedChatRouter.get("/ki/share/:shareId", PUBLIC_SHARE_RATE_LIMIT, async (req, res) => {
  try {
    await handleSharedChatRead(req, res, buildSharedChatPublicPayload);
    return;
  } catch (error) {
    return sendUnknownError(res, error, {
      kontekst: "GET shared conversation",
      melding: "Kunne ikke hente delt samtale.",
    });
  }
});

