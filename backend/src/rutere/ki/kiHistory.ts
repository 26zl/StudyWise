import { Router } from "express";
import { z } from "zod";
import { ChatHistory } from "../../database/models/ChatHistory.js";
import { encrypt, decrypt } from "../../utils/kryptering.js";
import { logger } from "../../utils/logger.js";
import { audit, AUDIT_ACTIONS } from "../../utils/auditLog.js";
import {
  apiError,
  sendZodError,
  sendUnknownError,
  requireUserId,
} from "../../utils/apiError.js";
import {
  ChatMessageSchema,
  ChatSaveSchema,
  ChatSaveResponseSchema,
  ChatHistoryResponseSchema,
} from "common/chat";
import { isValidMongoObjectId } from "../../utils/mongoId.js";

export const kiHistoryRouter = Router();

// GET /chat/history - hent historikk for innlogget bruker (paginert)
kiHistoryRouter.get("/chat/history", async (req, res) => {
  try {
    const userId = requireUserId(req, res);
    if (!userId) return;

    const queryParsed = z.object({
      limit: z.coerce.number().int().min(1).max(100).default(20).catch(20),
      page: z.coerce.number().int().min(1).default(1).catch(1),
    }).safeParse(req.query);
    const { limit, page } = queryParsed.success ? queryParsed.data : { limit: 20, page: 1 };
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
            title: doc.title ?? "Samtale",
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
    return sendUnknownError(res, error, { kontekst: "GET chat-history", melding: "Kunne ikke laste samtalehistorikk. Prøv igjen." });
  }
});

// POST /chat/history - lagre ny historikkoppføring
kiHistoryRouter.post("/chat/history", async (req, res) => {
  try {
    const userId = requireUserId(req, res);
    if (!userId) return;

    const parsed = ChatSaveSchema.parse(req.body);
    const encryptedMessages = encrypt(JSON.stringify(parsed.messages));
    const title =
      (parsed.title != null && parsed.title !== ""
        ? parsed.title.trim().slice(0, 120)
        : "") || "Samtale";
    const doc = await ChatHistory.create({
      user: userId,
      title,
      encryptedMessages,
    });

    return res.status(201).json(
      ChatSaveResponseSchema.parse({
        chat: {
          id: doc._id.toString(),
          title: doc.title,
          messages: parsed.messages,
          timestamp: doc.createdAt,
        },
      }),
    );
  } catch (error) {
    if (error instanceof z.ZodError) {
      return sendZodError(res, error, "chat-history");
    }
    return sendUnknownError(res, error, { kontekst: "POST chat-history", melding: "Kunne ikke lagre samtalen. Prøv igjen." });
  }
});

// PUT /chat/history/:id - oppdater eksisterende historikk
kiHistoryRouter.put("/chat/history/:id", async (req, res) => {
  try {
    const userId = requireUserId(req, res);
    if (!userId) return;
    const { id } = req.params;
    // Valider ObjectId for å unngå CastError
    if (!isValidMongoObjectId(id)) {
      return apiError.badRequest(res, "Ugyldig samtale-ID");
    }
    const parsed = ChatSaveSchema.parse(req.body);
    const encryptedMessages = encrypt(JSON.stringify(parsed.messages));
    const update: { encryptedMessages: string; title?: string } = { encryptedMessages };
    if (parsed.title != null && parsed.title !== "") {
      update.title = parsed.title.trim().slice(0, 120) || "Samtale";
    }
    const doc = await ChatHistory.findOneAndUpdate(
      { _id: id, user: userId },
      update,
      { returnDocument: "after" },
    );
    if (!doc) return apiError.notFound(res, "Samtalen");

    return res.json(
      ChatSaveResponseSchema.parse({
        chat: {
          id: doc._id.toString(),
          title: doc.title,
          messages: parsed.messages,
          timestamp: doc.createdAt,
        },
      }),
    );
  } catch (error) {
    if (error instanceof z.ZodError) {
      return sendZodError(res, error, "chat-history");
    }
    return sendUnknownError(res, error, { kontekst: "PUT chat-history", melding: "Kunne ikke oppdatere samtalen. Prøv igjen." });
  }
});

// DELETE /chat/history/:id - slett én historikk
kiHistoryRouter.delete("/chat/history/:id", async (req, res) => {
  try {
    const userId = requireUserId(req, res);
    if (!userId) return;
    const { id } = req.params;
    // Valider ObjectId for å unngå CastError
    if (!isValidMongoObjectId(id)) {
      return apiError.badRequest(res, "Ugyldig samtale-ID");
    }
    await ChatHistory.deleteOne({ _id: id, user: userId });

    audit({
      actorUserId: userId,
      action: AUDIT_ACTIONS.KI_HISTORY_DELETED,
      category: "ki",
      outcome: "success",
      metadata: { chatId: id },
      req,
    });

    return res.status(204).send();
  } catch (error) {
    return sendUnknownError(res, error, { kontekst: "DELETE chat-history", melding: "Kunne ikke slette samtalen. Prøv igjen." });
  }
});

// DELETE /chat/history - slett all historikk for bruker
kiHistoryRouter.delete("/chat/history", async (req, res) => {
  try {
    const userId = requireUserId(req, res);
    if (!userId) return;
    await ChatHistory.deleteMany({ user: userId });

    audit({
      actorUserId: userId,
      action: AUDIT_ACTIONS.KI_HISTORY_ALL_DELETED,
      category: "ki",
      outcome: "success",
      req,
    });

    return res.status(204).send();
  } catch (error) {
    return sendUnknownError(res, error, { kontekst: "DELETE chat-history", melding: "Kunne ikke slette samtalehistorikken. Prøv igjen." });
  }
});
