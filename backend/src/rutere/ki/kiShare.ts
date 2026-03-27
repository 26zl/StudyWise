/**
 * KI chat-deling (share links).
 *
 * Inneholder endepunkter for å opprette/administrere delingslenker,
 * og offentlig uthenting av delte chatter.
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
  SharedChatResponseSchema,
  SharedChatPublicResponseSchema,
  SharedChatUpdateSchema,
} from "common/chat";
import { createRateLimiter } from "../../middleware/rate-limit.js";
import { isValidMongoObjectId } from "../../utils/mongoId.js";
import { requireAuth } from "../../middleware/auth.js";

export const kiShareRouter = Router();
export const sharedChatRouter = Router();
export const SHARE_CLEANUP_INTERVAL_MS = 60 * 60 * 1000;
const SHARE_OPPORTUNISTIC_CLEANUP_INTERVAL_MS = 5 * 60 * 1000;

let lastOpportunisticCleanupAt = 0;

function createShareId(): string {
  return randomBytes(18).toString("base64url").slice(0, 12);
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

async function loadSharedChatForRead(req: Request, res: Response, shareId: string): Promise<{
  shared: SharedChatDocument;
  chat: Pick<ChatHistoryDocument, "_id" | "title" | "encryptedMessages">;
  messages: z.infer<typeof ChatMessageSchema>[];
  updatedViewCount: number;
} | null> {
  triggerOpportunisticCleanup();

  const shared = await SharedChat.findOne({ shareId });
  if (!shared || !shared.isActive || isExpired(shared.expiresAt)) {
    apiError.notFound(res, "Den delte samtalen");
    return null;
  }

  if (shared.accessType === "private") {
    const isAuthed = await ensureAuthenticated(req, res);
    if (!isAuthed) return null;
    // Kun eieren kan lese private delinger — returner 404 (ikke 403) for å unngå å avsløre at lenken eksisterer
    if (req.user!.id !== shared.ownerId.toString()) {
      apiError.notFound(res, "Den delte samtalen");
      return null;
    }
  }

  const chat = await ChatHistory.findById(shared.chatId).select("title encryptedMessages");
  if (!chat) {
    apiError.notFound(res, "Samtalen");
    return null;
  }

  const sharedDoc = shared as SharedChatDocument;
  const chatDoc = chat as Pick<ChatHistoryDocument, "_id" | "title" | "encryptedMessages">;

  const messages = await parseStoredChatMessages(chatDoc);
  if (messages.length === 0) {
    apiError.notFound(res, "Den delte samtalen");
    return null;
  }

  await SharedChat.updateOne({ _id: sharedDoc._id }, { $inc: { viewCount: 1 } });
  return {
    shared: sharedDoc,
    chat: chatDoc,
    messages,
    updatedViewCount: sharedDoc.viewCount + 1,
  };
}
const PUBLIC_SHARE_RATE_LIMIT = createRateLimiter({
  points: 120,
  duration: 60,
  keyPrefix: "rlflx:share-public",
});
const DEFAULT_SHARE_TTL_DAYS = 30;

async function parseStoredChatMessages(
  doc: Pick<ChatHistoryDocument, "encryptedMessages">,
): Promise<z.infer<typeof ChatMessageSchema>[]> {
  const decrypted = JSON.parse(decrypt(doc.encryptedMessages));
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
  const result = await SharedChat.updateMany(
    {
      isActive: true,
      expiresAt: { $lte: new Date() },
    },
    {
      $set: { isActive: false },
    },
  );
  return result.modifiedCount ?? 0;
}

async function ensureAuthenticated(
  req: Request,
  res: Response,
): Promise<boolean> {
  if (req.user?.id) return true;
  let authenticated = false;
  await requireAuth(req, res, () => {
    authenticated = true;
  });
  return authenticated;
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

    ChatShareCreateSchema.parse(parseResult.data);

    const shareId = createShareId();
    const ownerObjectId = new mongoose.Types.ObjectId(userId);
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
        },
        $setOnInsert: {
          shareId,
          accessType: "public",
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

    const docs = await SharedChat.find({
      ownerId: userId,
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
            ? doc.chatId.title
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
      melding: "Kunne ikke hente delte chatter.",
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

    const doc = await SharedChat.findOne({
      shareId: req.params.shareId,
      ownerId: userId,
    });

    if (!doc) {
      return apiError.notFound(res, "Delt lenke");
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

    const doc = await SharedChat.findOne({
      shareId: req.params.shareId,
      ownerId: userId,
    });
    if (!doc) {
      return apiError.notFound(res, "Delt lenke");
    }

    doc.isActive = false;
    await doc.save();
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
    const shareId = Array.isArray(req.params.shareId) ? req.params.shareId[0] : req.params.shareId;
    if (!shareId || !/^[A-Za-z0-9_-]{12}$/.test(shareId)) {
      return apiError.notFound(res, "Den delte samtalen");
    }

    const loaded = await loadSharedChatForRead(req, res, shareId);
    if (!loaded) return;
    const { shared, chat, messages, updatedViewCount } = loaded;

    return res.json(
      SharedChatPublicResponseSchema.parse({
        shareId: shared.shareId,
        chatId: chat._id.toString(),
        chatTitle: chat.title?.trim() || "Samtale",
        messages,
        createdAt: shared.createdAt,
        expiresAt: shared.expiresAt ?? null,
        accessType: shared.accessType,
        isActive: shared.isActive,
        viewCount: updatedViewCount,
      }),
    );
  } catch (error) {
    return sendUnknownError(res, error, {
      kontekst: "GET shared chat",
      melding: "Kunne ikke hente delt samtale.",
    });
  }
});

sharedChatRouter.get("/shared/:shareId", PUBLIC_SHARE_RATE_LIMIT, async (req, res) => {
  try {
    const shareId = Array.isArray(req.params.shareId) ? req.params.shareId[0] : req.params.shareId;
    if (!shareId || !/^[A-Za-z0-9_-]{12}$/.test(shareId)) {
      return apiError.notFound(res, "Den delte samtalen");
    }

    const loaded = await loadSharedChatForRead(req, res, shareId);
    if (!loaded) return;
    const { shared, chat, messages } = loaded;

    return res.json(
      SharedChatResponseSchema.parse({
        title: chat.title?.trim() || "Delt StudyWise-chat",
        messages,
        sharedAt: shared.createdAt,
        expiresAt: shared.expiresAt ?? new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        shareType: "full_chat",
      }),
    );
  } catch (error) {
    return sendUnknownError(res, error, {
      kontekst: "GET shared chat",
      melding: "Kunne ikke hente delt samtale.",
    });
  }
});

