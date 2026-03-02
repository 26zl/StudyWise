import { Router } from "express";
import { z } from "zod";
import mongoose from "mongoose";
import { ChatHistory } from "../../database/models/ChatHistory.js";
import { encrypt, decrypt } from "../../utils/kryptering.js";
import { logger } from "../../utils/logger.js";
import {
  apiError,
  sendZodError,
  sendUnknownError,
} from "../../utils/apiError.js";
import {
  ChatMessageSchema,
  ChatSaveSchema,
  ChatHistoryResponseSchema,
} from "common/chat";

export const kiHistoryRouter = Router();

// Hjelpefunksjon for å validere MongoDB ObjectId
const isValidObjectId = (id: string): boolean =>
  mongoose.Types.ObjectId.isValid(id);

// GET /chat/history - hent historikk for innlogget bruker (paginert)
kiHistoryRouter.get("/chat/history", async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) return apiError.unauthorized(res);

    const limit = Math.min(Math.max(Number(req.query.limit) || 20, 1), 100);
    const page = Math.max(Number(req.query.page) || 1, 1);
    const skip = (page - 1) * limit;

    const [docs, total] = await Promise.all([
      ChatHistory.find({ user: userId })
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      ChatHistory.countDocuments({ user: userId }),
    ]);
    const chats = docs.flatMap((doc) => {
      try {
        // Dekrypter og valider med Zod for å sikre data-integritet
        const decryptedData = JSON.parse(decrypt(doc.encryptedMessages));
        const messages = z.array(ChatMessageSchema).parse(decryptedData);
        return [
          {
            id: doc._id.toString(),
            title: doc.title,
            messages,
            timestamp: doc.createdAt,
          },
        ];
      } catch (err) {
        // Hopp over korrupte oppføringer — én ødelagt samtale skal ikke blokkere resten
        logger.warn(
          { err, chatId: doc._id.toString() },
          "Korrupt chat-historikk-oppføring hoppet over",
        );
        return [];
      }
    });
    return res.json(
      ChatHistoryResponseSchema.parse({
        chats,
        meta: {
          page,
          limit,
          total,
          pages: Math.ceil(total / limit),
        },
      }),
    );
  } catch (error) {
    sendUnknownError(res, error, { kontekst: "GET chat-history" });
  }
});

// POST /chat/history - lagre ny historikkoppføring
kiHistoryRouter.post("/chat/history", async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) return apiError.unauthorized(res);

    const parsed = ChatSaveSchema.parse(req.body);
    const firstUser = parsed.messages.find((m) => m.rolle === "user");
    const title =
      parsed.title ||
      (firstUser
        ? firstUser.innhold.slice(0, 80) +
          (firstUser.innhold.length > 80 ? "..." : "")
        : "Samtale");

    const encryptedMessages = encrypt(JSON.stringify(parsed.messages));
    const doc = await ChatHistory.create({
      user: userId,
      title,
      encryptedMessages,
    });

    return res.status(201).json({
      chat: {
        id: doc._id.toString(),
        title: doc.title,
        messages: parsed.messages,
        timestamp: doc.createdAt,
      },
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return sendZodError(res, error, "chat-history");
    }
    sendUnknownError(res, error, { kontekst: "POST chat-history" });
  }
});

// PUT /chat/history/:id - oppdater eksisterende historikk
kiHistoryRouter.put("/chat/history/:id", async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) return apiError.unauthorized(res);
    const { id } = req.params;
    // Valider ObjectId for å unngå CastError
    if (!isValidObjectId(id)) {
      return apiError.badRequest(res, "Ugyldig samtale-ID");
    }
    const parsed = ChatSaveSchema.parse(req.body);
    const firstUser = parsed.messages.find((m) => m.rolle === "user");
    const title =
      parsed.title ||
      (firstUser
        ? firstUser.innhold.slice(0, 80) +
          (firstUser.innhold.length > 80 ? "..." : "")
        : "Samtale");

    const encryptedMessages = encrypt(JSON.stringify(parsed.messages));
    const doc = await ChatHistory.findOneAndUpdate(
      { _id: id, user: userId },
      { title, encryptedMessages },
      { new: true },
    );
    if (!doc) return apiError.notFound(res, "Samtale");

    return res.json({
      chat: {
        id: doc._id.toString(),
        title: doc.title,
        messages: parsed.messages,
        timestamp: doc.createdAt,
      },
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return sendZodError(res, error, "chat-history");
    }
    sendUnknownError(res, error, { kontekst: "PUT chat-history" });
  }
});

// DELETE /chat/history/:id - slett én historikk
kiHistoryRouter.delete("/chat/history/:id", async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) return apiError.unauthorized(res);
    const { id } = req.params;
    // Valider ObjectId for å unngå CastError
    if (!isValidObjectId(id)) {
      return apiError.badRequest(res, "Ugyldig samtale-ID");
    }
    await ChatHistory.deleteOne({ _id: id, user: userId });
    return res.status(204).send();
  } catch (error) {
    sendUnknownError(res, error, { kontekst: "DELETE chat-history" });
  }
});

// DELETE /chat/history - slett all historikk for bruker
kiHistoryRouter.delete("/chat/history", async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) return apiError.unauthorized(res);
    await ChatHistory.deleteMany({ user: userId });
    return res.status(204).send();
  } catch (error) {
    sendUnknownError(res, error, { kontekst: "DELETE chat-history" });
  }
});
