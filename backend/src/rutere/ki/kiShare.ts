import { Router } from "express";
import { randomUUID } from "crypto";
import mongoose from "mongoose";
import { ChatHistory } from "../../database/models/ChatHistory.js";
import { decrypt } from "../../utils/kryptering.js";
import { logger } from "../../utils/logger.js";
import {
  apiError,
  sendUnknownError,
  requireUserId,
} from "../../utils/apiError.js";
import {
  ChatMessageSchema,
  ChatShareResponseSchema,
  SharedChatResponseSchema,
} from "common/chat";
import { z } from "zod";

export const kiShareRouter = Router();

const SHARE_TTL_DAYS = 30;
const REDACTED_USER_MESSAGE = "[Brukermelding skjult av personvernhensyn]";
const SHARED_CHAT_TITLE = "Delt StudyWise-samtale";

const isValidObjectId = (id: string): boolean =>
  mongoose.Types.ObjectId.isValid(id);

function buildShareExpiry(now = new Date()): Date {
  return new Date(now.getTime() + SHARE_TTL_DAYS * 24 * 60 * 60 * 1000);
}

function sanitizeSharedText(text: string): string {
  return text
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[e-post skjult]")
    // eslint-disable-next-line security/detect-unsafe-regex -- hardkodet JWT-mønster med faste segmentgrenser
    .replace(/\b(?:Bearer\s+)?eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, "[token skjult]")
    .replace(/\bsk-[A-Za-z0-9-]+\b/gi, "[api-nokkel skjult]")
    // eslint-disable-next-line security/detect-unsafe-regex -- hardkodet telefonmønster med faste gruppegrenser
    .replace(/\b(?:\+\d{1,3}[\s-]?)?\d{2}(?:[\s-]?\d{2}){3,5}\b/g, "[telefon skjult]")
    .replace(/https?:\/\/\S+/gi, "[lenke skjult]");
}

function sanitizeSharedMessages(messages: z.infer<typeof ChatMessageSchema>[]) {
  return messages.map((message) => ({
    ...message,
    innhold:
      message.rolle === "user"
        ? REDACTED_USER_MESSAGE
        : sanitizeSharedText(message.innhold),
  }));
}

async function clearExpiredShare(chatId: mongoose.Types.ObjectId): Promise<void> {
  await ChatHistory.updateOne(
    { _id: chatId },
    {
      $set: { isShared: false },
      $unset: { shareToken: 1, sharedAt: 1, shareExpiresAt: 1 },
    },
  );
}

// POST /chat/:chatId/share — aktiver deling og generer shareToken
kiShareRouter.post("/chat/:chatId/share", async (req, res) => {
  try {
    const userId = requireUserId(req, res);
    if (!userId) return;

    const { chatId } = req.params;
    if (!isValidObjectId(chatId)) {
      return apiError.badRequest(res, "Ugyldig samtale-ID");
    }

    const doc = await ChatHistory.findOne({ _id: chatId, user: userId });
    if (!doc) return apiError.notFound(res, "Samtalen");

    const now = new Date();

    // Gjenbruk eksisterende token hvis allerede delt
    if (
      doc.isShared &&
      doc.shareToken &&
      doc.shareExpiresAt &&
      doc.shareExpiresAt.getTime() > now.getTime()
    ) {
      return res.json(
        ChatShareResponseSchema.parse({
          shareToken: doc.shareToken,
          shareUrl: `/delt/${doc.shareToken}`,
          expiresAt: doc.shareExpiresAt,
        }),
      );
    }

    const shareToken = randomUUID();
    const shareExpiresAt = buildShareExpiry(now);
    doc.shareToken = shareToken;
    doc.sharedAt = now;
    doc.shareExpiresAt = shareExpiresAt;
    doc.isShared = true;
    await doc.save();

    logger.info({ userId, chatId, shareExpiresAt }, "Samtale delt");

    return res.json(
      ChatShareResponseSchema.parse({
        shareToken,
        shareUrl: `/delt/${shareToken}`,
        expiresAt: shareExpiresAt,
      }),
    );
  } catch (error) {
    return sendUnknownError(res, error, {
      kontekst: "POST chat share",
      melding: "Kunne ikke dele samtalen. Prøv igjen.",
    });
  }
});

// DELETE /chat/:chatId/share — fjern deling
kiShareRouter.delete("/chat/:chatId/share", async (req, res) => {
  try {
    const userId = requireUserId(req, res);
    if (!userId) return;

    const { chatId } = req.params;
    if (!isValidObjectId(chatId)) {
      return apiError.badRequest(res, "Ugyldig samtale-ID");
    }

    const doc = await ChatHistory.findOneAndUpdate(
      { _id: chatId, user: userId },
      {
        $set: { isShared: false },
        $unset: { shareToken: 1, sharedAt: 1, shareExpiresAt: 1 },
      },
      { returnDocument: "after" },
    );
    if (!doc) return apiError.notFound(res, "Samtalen");

    logger.info({ userId, chatId }, "Deling av samtale fjernet");

    return res.status(204).send();
  } catch (error) {
    return sendUnknownError(res, error, {
      kontekst: "DELETE chat share",
      melding: "Kunne ikke fjerne deling. Prøv igjen.",
    });
  }
});

// GET /shared/:shareToken — offentlig endepunkt, ingen auth
export const sharedChatRouter = Router();

sharedChatRouter.get("/shared/:shareToken", async (req, res) => {
  try {
    const { shareToken } = req.params;

    // Valider at token er en gyldig UUID
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(shareToken)) {
      return apiError.badRequest(res, "Ugyldig delingslenke");
    }

    const doc = await ChatHistory.findOne({
      shareToken,
      isShared: true,
    });

    if (!doc) return apiError.notFound(res, "Den delte samtalen");

    if (!doc.shareExpiresAt || doc.shareExpiresAt.getTime() <= Date.now()) {
      await clearExpiredShare(doc._id);
      return apiError.notFound(res, "Den delte samtalen");
    }

    // Dekrypter meldinger — fjern personlig kontekst
    let messages: z.infer<typeof ChatMessageSchema>[];
    try {
      const decrypted = JSON.parse(decrypt(doc.encryptedMessages));
      const parsedMessages = z.array(ChatMessageSchema).parse(decrypted);
      messages = sanitizeSharedMessages(parsedMessages);
    } catch {
      logger.warn({ shareToken }, "Kunne ikke dekryptere delt samtale");
      return apiError.serverError(res);
    }

    return res.json(SharedChatResponseSchema.parse({
      title: SHARED_CHAT_TITLE,
      messages,
      sharedAt: doc.sharedAt,
      createdAt: doc.createdAt,
      expiresAt: doc.shareExpiresAt,
      redacted: true,
    }));
  } catch (error) {
    return sendUnknownError(res, error, {
      kontekst: "GET shared chat",
      melding: "Kunne ikke hente delt samtale.",
    });
  }
});
