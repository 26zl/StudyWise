/**
 * KI chat-historikk API.
 *
 * CRUD-lignende endepunkter for å lagre og hente kryptert chat-historikk per bruker.
 */
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
  ChatPinUpdateSchema,
  ChatMessageSchema,
  ChatTitleUpdateSchema,
  ChatTopicUpdateSchema,
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
            topic: doc.topic,
            pinned: doc.pinned ?? false,
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
      topic: parsed.topic?.trim() || undefined,
      pinned: parsed.pinned ?? false,
      encryptedMessages,
    });

    return res.status(201).json(
      ChatSaveResponseSchema.parse({
        chat: {
          id: doc._id.toString(),
          title: doc.title,
          topic: doc.topic,
          pinned: doc.pinned ?? false,
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
    const update: { encryptedMessages: string; title?: string; topic?: string; pinned?: boolean } = { encryptedMessages };
    if (parsed.title != null && parsed.title !== "") {
      update.title = parsed.title.trim().slice(0, 120) || "Samtale";
    }
    if (parsed.topic !== undefined) {
      update.topic = parsed.topic?.trim() || undefined;
    }
    if (parsed.pinned !== undefined) {
      update.pinned = parsed.pinned;
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
          topic: doc.topic,
          pinned: doc.pinned ?? false,
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

kiHistoryRouter.patch("/chat/history/:id/pin", async (req, res) => {
  try {
    const userId = requireUserId(req, res);
    if (!userId) return;
    const { id } = req.params;
    if (!isValidMongoObjectId(id)) {
      return apiError.badRequest(res, "Ugyldig samtale-ID");
    }
    const parsed = ChatPinUpdateSchema.parse(req.body);
    const doc = await ChatHistory.findOneAndUpdate(
      { _id: id, user: userId },
      { pinned: parsed.pinned },
      { returnDocument: "after" },
    ).select("_id pinned");
    if (!doc) return apiError.notFound(res, "Samtalen");
    return res.json({ id: doc._id.toString(), pinned: doc.pinned ?? false });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return sendZodError(res, error, "chat-pin");
    }
    return sendUnknownError(res, error, { kontekst: "PATCH chat-pin", melding: "Kunne ikke oppdatere pin." });
  }
});

kiHistoryRouter.patch("/chat/history/:id/topic", async (req, res) => {
  try {
    const userId = requireUserId(req, res);
    if (!userId) return;
    const { id } = req.params;
    if (!isValidMongoObjectId(id)) {
      return apiError.badRequest(res, "Ugyldig samtale-ID");
    }
    const parsed = ChatTopicUpdateSchema.parse(req.body);
    const doc = await ChatHistory.findOneAndUpdate(
      { _id: id, user: userId },
      { topic: parsed.topic?.trim() || undefined },
      { returnDocument: "after" },
    ).select("_id topic");
    if (!doc) return apiError.notFound(res, "Samtalen");
    return res.json({ id: doc._id.toString(), topic: doc.topic });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return sendZodError(res, error, "chat-topic");
    }
    return sendUnknownError(res, error, { kontekst: "PATCH chat-topic", melding: "Kunne ikke oppdatere tema." });
  }
});

kiHistoryRouter.patch("/chat/history/:id/title", async (req, res) => {
  try {
    const userId = requireUserId(req, res);
    if (!userId) return;
    const { id } = req.params;
    if (!isValidMongoObjectId(id)) {
      return apiError.badRequest(res, "Ugyldig samtale-ID");
    }
    const parsed = ChatTitleUpdateSchema.parse(req.body);
    const nextTitle = parsed.title.trim().slice(0, 120) || "Samtale";
    const doc = await ChatHistory.findOneAndUpdate(
      { _id: id, user: userId },
      { title: nextTitle },
      { returnDocument: "after" },
    ).select("_id title");
    if (!doc) return apiError.notFound(res, "Samtalen");
    return res.json({ id: doc._id.toString(), title: doc.title });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return sendZodError(res, error, "chat-title");
    }
    return sendUnknownError(res, error, { kontekst: "PATCH chat-title", melding: "Kunne ikke oppdatere tittel." });
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
