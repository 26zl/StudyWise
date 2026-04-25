/**
 * Lagrede flashcard-sett – CRUD + økthistorikk.
 * Ingen AI-kall; kun persistens i MongoDB.
 */
import { randomUUID } from "crypto";
import { Router, type Request, type Response } from "express";
import mongoose from "mongoose";
import { ZodError } from "zod";
import {
  LagreFlashcardSettRequestSchema,
  LagredeFlashcardSettResponseSchema,
  LagretFlashcardSettResponseSchema,
  LagretFlashcardSettSchema,
  RegistrerFlashcardOktRequestSchema,
  LAGRET_FLASHCARD_MAX_OKTER,
} from "common/flashcardsLagret";
import {
  LagretFlashcardSett,
  type LagretFlashcardSettDocument,
} from "../../database/models/LagretFlashcardSett.js";
import { apiError, sendZodError, sendUnknownError, requireUserId } from "../../utils/apiError.js";
import { rateLimitKi } from "../../middleware/rate-limit.js";
import { logger } from "../../utils/logger.js";

const router = Router();

function serialiser(doc: LagretFlashcardSettDocument) {
  return LagretFlashcardSettSchema.parse({
    id: String(doc._id),
    title: doc.title,
    topic: doc.topic,
    cards: doc.cards,
    createdAt: doc.createdAt,
    sessions: doc.sessions ?? [],
  });
}

// ─── POST /api/flashcards/lagrede — lagre et nytt sett ──────
router.post("/", rateLimitKi, async (req: Request, res: Response) => {
  const userId = requireUserId(req, res);
  if (!userId) return;

  const parsed = LagreFlashcardSettRequestSchema.safeParse(req.body);
  if (!parsed.success) {
    sendZodError(res, parsed.error, "Lagre flashcard-sett");
    return;
  }

  try {
    const created = await LagretFlashcardSett.create({
      userId,
      title: parsed.data.title,
      topic: parsed.data.topic,
      cards: parsed.data.cards,
      sessions: [],
    });

    const response = LagretFlashcardSettResponseSchema.parse({
      sett: serialiser(created.toObject()),
    });
    res.status(201).json(response);
  } catch (error) {
    sendUnknownError(res, error, {
      kontekst: "POST /api/flashcards/lagrede",
      melding: "Kunne ikke lagre flashcard-sett.",
    });
  }
});

// ─── GET /api/flashcards/lagrede — list ──────────────────────
router.get("/", rateLimitKi, async (req: Request, res: Response) => {
  const userId = requireUserId(req, res);
  if (!userId) return;

  try {
    const docs = await LagretFlashcardSett.find({ userId }).sort({ createdAt: -1 }).lean();
    const response = LagredeFlashcardSettResponseSchema.parse({
      sett: docs.map((d) => serialiser(d as LagretFlashcardSettDocument)),
    });
    res.json(response);
  } catch (error) {
    sendUnknownError(res, error, {
      kontekst: "GET /api/flashcards/lagrede",
      melding: "Kunne ikke hente lagrede flashcard-sett.",
    });
  }
});

// ─── GET /api/flashcards/lagrede/:id ─────────────────────────
router.get("/:id", rateLimitKi, async (req: Request, res: Response) => {
  const userId = requireUserId(req, res);
  if (!userId) return;

  const { id } = req.params;
  if (!mongoose.isValidObjectId(id)) {
    apiError.notFound(res, "Lagret flashcard-sett");
    return;
  }

  try {
    const doc = await LagretFlashcardSett.findOne({ _id: id, userId }).lean();
    if (!doc) {
      apiError.notFound(res, "Lagret flashcard-sett");
      return;
    }
    const response = LagretFlashcardSettResponseSchema.parse({
      sett: serialiser(doc as LagretFlashcardSettDocument),
    });
    res.json(response);
  } catch (error) {
    sendUnknownError(res, error, {
      kontekst: "GET /api/flashcards/lagrede/:id",
      melding: "Kunne ikke hente lagret flashcard-sett.",
    });
  }
});

// ─── DELETE /api/flashcards/lagrede/:id ──────────────────────
router.delete("/:id", rateLimitKi, async (req: Request, res: Response) => {
  const userId = requireUserId(req, res);
  if (!userId) return;

  const { id } = req.params;
  if (!mongoose.isValidObjectId(id)) {
    apiError.notFound(res, "Lagret flashcard-sett");
    return;
  }

  try {
    const result = await LagretFlashcardSett.deleteOne({ _id: id, userId });
    if (result.deletedCount === 0) {
      apiError.notFound(res, "Lagret flashcard-sett");
      return;
    }
    res.status(204).send();
  } catch (error) {
    sendUnknownError(res, error, {
      kontekst: "DELETE /api/flashcards/lagrede/:id",
      melding: "Kunne ikke slette lagret flashcard-sett.",
    });
  }
});

// ─── PATCH /api/flashcards/lagrede/:id/okt — registrer en økt ──
router.patch("/:id/okt", rateLimitKi, async (req: Request, res: Response) => {
  const userId = requireUserId(req, res);
  if (!userId) return;

  const { id } = req.params;
  if (!mongoose.isValidObjectId(id)) {
    apiError.notFound(res, "Lagret flashcard-sett");
    return;
  }

  const parsed = RegistrerFlashcardOktRequestSchema.safeParse(req.body);
  if (!parsed.success) {
    sendZodError(res, parsed.error, "Registrer flashcard-økt");
    return;
  }

  const body = parsed.data;
  if (body.knewCount + body.didNotKnowCount > body.totalCards) {
    apiError.badRequest(res, "Sum av kjente og ikke-kjente kan ikke overstige totalt antall kort");
    return;
  }

  const okt = {
    sessionId: randomUUID(),
    date: new Date(),
    totalCards: body.totalCards,
    knewCount: body.knewCount,
    didNotKnowCount: body.didNotKnowCount,
  };

  try {
    // Atomær push + slice — unngår race condition ved samtidige økter
    const doc = await LagretFlashcardSett.findOneAndUpdate(
      { _id: id, userId },
      { $push: { sessions: { $each: [okt], $slice: -LAGRET_FLASHCARD_MAX_OKTER } } },
      { returnDocument: "after" },
    );
    if (!doc) {
      apiError.notFound(res, "Lagret flashcard-sett");
      return;
    }

    logger.info(
      { userId, settId: id, knewCount: okt.knewCount, totalCards: okt.totalCards },
      "Flashcard-økt registrert",
    );

    const response = LagretFlashcardSettResponseSchema.parse({
      sett: serialiser(doc.toObject()),
    });
    res.json(response);
  } catch (error) {
    if (error instanceof ZodError) {
      sendZodError(res, error, "Registrer flashcard-økt");
      return;
    }
    sendUnknownError(res, error, {
      kontekst: "PATCH /api/flashcards/lagrede/:id/okt",
      melding: "Kunne ikke registrere økt.",
    });
  }
});

export default router;
