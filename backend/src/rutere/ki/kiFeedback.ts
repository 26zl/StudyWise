/**
 * KI Chat Feedback – tommel opp/ned på enkelt-svar.
 *
 * Brukeren kan rate et svar; admin kan se de dårligste svarene for å forbedre prompt/retrieval.
 */
import { Router } from "express";
import { ChatFeedback } from "../../database/models/ChatFeedback.js";
import { logger } from "../../utils/logger.js";
import { sendZodError, sendUnknownError, requireUserId } from "../../utils/apiError.js";
import { ChatFeedbackRequestSchema, ChatFeedbackResponseSchema } from "common/ki";
import { audit, AUDIT_ACTIONS } from "../../utils/auditLog.js";
import mongoose from "mongoose";
import { z } from "zod";

export const kiFeedbackRouter = Router();

// POST /feedback - lagre feedback (upsert per (user, messageId))
kiFeedbackRouter.post("/feedback", async (req, res) => {
  try {
    const userId = requireUserId(req, res);
    if (!userId) return;

    const parsed = ChatFeedbackRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      return sendZodError(res, parsed.error, "feedback");
    }

    await ChatFeedback.findOneAndUpdate(
      { user: new mongoose.Types.ObjectId(userId), messageId: parsed.data.messageId },
      {
        $set: {
          rating: parsed.data.rating,
          chatId: parsed.data.chatId,
          question: parsed.data.question,
          answer: parsed.data.answer,
        },
      },
      { upsert: true, returnDocument: "after" },
    );

    void audit({
      req,
      actorUserId: userId,
      action: AUDIT_ACTIONS.KI_CHAT,
      category: "ki",
      outcome: "success",
      metadata: { rating: parsed.data.rating, messageId: parsed.data.messageId, kind: "feedback" },
    });

    res.json(ChatFeedbackResponseSchema.parse({ suksess: true }));
  } catch (error) {
    logger.error({ error }, "Feil ved lagring av feedback");
    sendUnknownError(res, error, { kontekst: "feedback" });
  }
});

// DELETE /feedback/:messageId - fjern feedback
kiFeedbackRouter.delete("/feedback/:messageId", async (req, res) => {
  try {
    const userId = requireUserId(req, res);
    if (!userId) return;

    const messageId = z.string().min(1).max(100).parse(req.params.messageId);
    await ChatFeedback.deleteOne({
      user: new mongoose.Types.ObjectId(userId),
      messageId,
    });

    res.json(ChatFeedbackResponseSchema.parse({ suksess: true }));
  } catch (error) {
    sendUnknownError(res, error, { kontekst: "feedback-delete" });
  }
});
