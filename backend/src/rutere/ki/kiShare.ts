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
import { ChatMessageSchema } from "common/chat";
import { z } from "zod";

export const kiShareRouter = Router();

const isValidObjectId = (id: string): boolean =>
  mongoose.Types.ObjectId.isValid(id);

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

    // Gjenbruk eksisterende token hvis allerede delt
    if (doc.isShared && doc.shareToken) {
      return res.json({
        shareToken: doc.shareToken,
        shareUrl: `/delt/${doc.shareToken}`,
      });
    }

    const shareToken = randomUUID();
    doc.shareToken = shareToken;
    doc.sharedAt = new Date();
    doc.isShared = true;
    await doc.save();

    logger.info({ userId, chatId }, "Samtale delt");

    return res.json({
      shareToken,
      shareUrl: `/delt/${shareToken}`,
    });
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
      { $set: { isShared: false }, $unset: { shareToken: 1, sharedAt: 1 } },
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
    }).lean();

    if (!doc) return apiError.notFound(res, "Den delte samtalen");

    // Dekrypter meldinger — fjern personlig kontekst
    let messages: z.infer<typeof ChatMessageSchema>[];
    try {
      const decrypted = JSON.parse(decrypt(doc.encryptedMessages));
      messages = z.array(ChatMessageSchema).parse(decrypted);
    } catch {
      logger.warn({ shareToken }, "Kunne ikke dekryptere delt samtale");
      return apiError.serverError(res);
    }

    return res.json({
      title: doc.title,
      messages,
      sharedAt: doc.sharedAt,
      createdAt: doc.createdAt,
    });
  } catch (error) {
    return sendUnknownError(res, error, {
      kontekst: "GET shared chat",
      melding: "Kunne ikke hente delt samtale.",
    });
  }
});
