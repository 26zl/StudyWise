import { Router } from "express";
import { z } from "zod";
import { ChatHistory } from "../../database/models/ChatHistory.js";
import { encrypt, decrypt } from "../../utils/kryptering.js";
import { logger } from "../../utils/logger.js";
import { ChatMessageSchema, ChatSaveSchema, ChatHistoryResponseSchema } from "common/chat";

export const kiHistoryRouter = Router();

// GET /chat/history - hent historikk for innlogget bruker (paginert)
kiHistoryRouter.get("/chat/history", async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ feil: "Ikke autentisert" });

    const limit = Math.min(Math.max(Number(req.query.limit) || 20, 1), 100);
    const page = Math.max(Number(req.query.page) || 1, 1);
    const skip = (page - 1) * limit;

    const [docs, total] = await Promise.all([
      ChatHistory.find({ user: userId }).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
      ChatHistory.countDocuments({ user: userId }),
    ]);

    const chats = docs.map((doc) => {
      const messages = JSON.parse(decrypt(doc.encryptedMessages)) as z.infer<typeof ChatMessageSchema>[];
      return {
        id: doc._id.toString(),
        title: doc.title,
        messages,
        timestamp: doc.createdAt,
      };
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
      })
    );
  } catch (error) {
    logger.error({ err: error }, "Feil ved henting av chat-historikk");
    return res.status(500).json({ feil: "Kunne ikke hente historikk" });
  }
});

// POST /chat/history - lagre ny historikkoppføring
kiHistoryRouter.post("/chat/history", async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ feil: "Ikke autentisert" });

    const parsed = ChatSaveSchema.parse(req.body);
    const firstUser = parsed.messages.find((m) => m.rolle === "user");
    const title =
      parsed.title ||
      (firstUser ? firstUser.innhold.slice(0, 80) + (firstUser.innhold.length > 80 ? "..." : "") : "Samtale");

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
      return res.status(400).json({ feil: "Ugyldig payload", detaljer: error.issues });
    }
    logger.error({ err: error }, "Feil ved lagring av chat-historikk");
    return res.status(500).json({ feil: "Kunne ikke lagre historikk" });
  }
});

// PUT /chat/history/:id - oppdater eksisterende historikk
kiHistoryRouter.put("/chat/history/:id", async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ feil: "Ikke autentisert" });
    const { id } = req.params;
    const parsed = ChatSaveSchema.parse(req.body);
    const firstUser = parsed.messages.find((m) => m.rolle === "user");
    const title =
      parsed.title ||
      (firstUser ? firstUser.innhold.slice(0, 80) + (firstUser.innhold.length > 80 ? "..." : "") : "Samtale");

    const encryptedMessages = encrypt(JSON.stringify(parsed.messages));
    const doc = await ChatHistory.findOneAndUpdate(
      { _id: id, user: userId },
      { title, encryptedMessages },
      { new: true }
    );
    if (!doc) return res.status(404).json({ feil: "Fant ikke samtalen" });

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
      return res.status(400).json({ feil: "Ugyldig payload", detaljer: error.issues });
    }
    logger.error({ err: error }, "Feil ved oppdatering av chat-historikk");
    return res.status(500).json({ feil: "Kunne ikke oppdatere historikk" });
  }
});

// DELETE /chat/history/:id - slett én historikk
kiHistoryRouter.delete("/chat/history/:id", async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ feil: "Ikke autentisert" });
    const { id } = req.params;
    await ChatHistory.deleteOne({ _id: id, user: userId });
    return res.status(204).send();
  } catch (error) {
    logger.error({ err: error }, "Feil ved sletting av chat-historikk");
    return res.status(500).json({ feil: "Kunne ikke slette historikk" });
  }
});

// DELETE /chat/history - slett all historikk for bruker
kiHistoryRouter.delete("/chat/history", async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ feil: "Ikke autentisert" });
    await ChatHistory.deleteMany({ user: userId });
    return res.status(204).send();
  } catch (error) {
    logger.error({ err: error }, "Feil ved sletting av all chat-historikk");
    return res.status(500).json({ feil: "Kunne ikke slette historikk" });
  }
}); 