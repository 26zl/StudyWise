/**
 * Lagrede quizer – CRUD + forsøkshistorikk.
 * Ingen AI-kall; kun persistens i MongoDB.
 */
import { randomUUID } from "crypto";
import { Router, type Request, type Response } from "express";
import mongoose from "mongoose";
import { ZodError } from "zod";
import {
  LagreQuizRequestSchema,
  LagredeQuizerResponseSchema,
  LagretQuizResponseSchema,
  LagretQuizSchema,
  RegistrerQuizForsokRequestSchema,
  LAGRET_QUIZ_MAX_FORSOK,
} from "common/quizLagret";
import { LagretQuiz, type LagretQuizDocument } from "../../database/models/LagretQuiz.js";
import { apiError, sendZodError, sendUnknownError, requireUserId } from "../../utils/apiError.js";
import { rateLimitKi } from "../../middleware/rate-limit.js";
import { logger } from "../../utils/logger.js";

const router = Router();

/** Serialiser et lagret quiz-dokument til API-responsformat (validert med Zod). */
function serialiser(doc: LagretQuizDocument) {
  return LagretQuizSchema.parse({
    id: String(doc._id),
    title: doc.title,
    topic: doc.topic,
    questions: doc.questions,
    createdAt: doc.createdAt,
    attempts: doc.attempts ?? [],
  });
}

// ─── POST /api/quiz/lagrede — lagre en ny quiz ──────────────
router.post("/", rateLimitKi, async (req: Request, res: Response) => {
  const userId = requireUserId(req, res);
  if (!userId) return;

  const parsed = LagreQuizRequestSchema.safeParse(req.body);
  if (!parsed.success) {
    sendZodError(res, parsed.error, "Lagre quiz");
    return;
  }

  try {
    const created = await LagretQuiz.create({
      userId,
      title: parsed.data.title,
      topic: parsed.data.topic,
      questions: parsed.data.questions,
      attempts: [],
    });

    const response = LagretQuizResponseSchema.parse({ quiz: serialiser(created.toObject()) });
    res.status(201).json(response);
  } catch (error) {
    sendUnknownError(res, error, {
      kontekst: "POST /api/quiz/lagrede",
      melding: "Kunne ikke lagre quiz.",
    });
  }
});

// ─── GET /api/quiz/lagrede — list ────────────────────────────
router.get("/", rateLimitKi, async (req: Request, res: Response) => {
  const userId = requireUserId(req, res);
  if (!userId) return;

  try {
    const docs = await LagretQuiz.find({ userId }).sort({ createdAt: -1 }).lean();
    const response = LagredeQuizerResponseSchema.parse({
      quizer: docs.map((d) => serialiser(d as LagretQuizDocument)),
    });
    res.json(response);
  } catch (error) {
    sendUnknownError(res, error, {
      kontekst: "GET /api/quiz/lagrede",
      melding: "Kunne ikke hente lagrede quizer.",
    });
  }
});

// ─── GET /api/quiz/lagrede/:id — enkelt quiz (for replay + stats) ──
router.get("/:id", rateLimitKi, async (req: Request, res: Response) => {
  const userId = requireUserId(req, res);
  if (!userId) return;

  const { id } = req.params;
  if (!mongoose.isValidObjectId(id)) {
    apiError.notFound(res, "Lagret quiz");
    return;
  }

  try {
    const doc = await LagretQuiz.findOne({ _id: id, userId }).lean();
    if (!doc) {
      apiError.notFound(res, "Lagret quiz");
      return;
    }
    const response = LagretQuizResponseSchema.parse({
      quiz: serialiser(doc as LagretQuizDocument),
    });
    res.json(response);
  } catch (error) {
    sendUnknownError(res, error, {
      kontekst: "GET /api/quiz/lagrede/:id",
      melding: "Kunne ikke hente lagret quiz.",
    });
  }
});

// ─── DELETE /api/quiz/lagrede/:id ────────────────────────────
router.delete("/:id", rateLimitKi, async (req: Request, res: Response) => {
  const userId = requireUserId(req, res);
  if (!userId) return;

  const { id } = req.params;
  if (!mongoose.isValidObjectId(id)) {
    apiError.notFound(res, "Lagret quiz");
    return;
  }

  try {
    const result = await LagretQuiz.deleteOne({ _id: id, userId });
    if (result.deletedCount === 0) {
      apiError.notFound(res, "Lagret quiz");
      return;
    }
    res.status(204).send();
  } catch (error) {
    sendUnknownError(res, error, {
      kontekst: "DELETE /api/quiz/lagrede/:id",
      melding: "Kunne ikke slette lagret quiz.",
    });
  }
});

// ─── PATCH /api/quiz/lagrede/:id/forsok — registrer et forsøk ──
router.patch("/:id/forsok", rateLimitKi, async (req: Request, res: Response) => {
  const userId = requireUserId(req, res);
  if (!userId) return;

  const { id } = req.params;
  if (!mongoose.isValidObjectId(id)) {
    apiError.notFound(res, "Lagret quiz");
    return;
  }

  const parsed = RegistrerQuizForsokRequestSchema.safeParse(req.body);
  if (!parsed.success) {
    sendZodError(res, parsed.error, "Registrer quiz-forsøk");
    return;
  }

  const body = parsed.data;
  if (body.score > body.total) {
    apiError.badRequest(res, "Score kan ikke være høyere enn total");
    return;
  }

  try {
    const doc = await LagretQuiz.findOne({ _id: id, userId });
    if (!doc) {
      apiError.notFound(res, "Lagret quiz");
      return;
    }

    // Valider at hvert svar peker på et spørsmål som eksisterer i quizen
    const questionIds = new Set(doc.questions.map((q) => q.id));
    const ukjenteSpm = body.answers.filter((a) => !questionIds.has(a.questionId));
    if (ukjenteSpm.length > 0) {
      apiError.badRequest(res, "Ett eller flere svar peker på ukjente spørsmål");
      return;
    }

    const forsok = {
      attemptId: randomUUID(),
      date: new Date(),
      score: body.score,
      total: body.total,
      durationSeconds: body.durationSeconds,
      answers: body.answers,
    };

    doc.attempts.push(forsok);
    // Behold kun de siste N forsøkene — eldste droppes
    if (doc.attempts.length > LAGRET_QUIZ_MAX_FORSOK) {
      doc.attempts = doc.attempts.slice(-LAGRET_QUIZ_MAX_FORSOK);
    }
    await doc.save();

    logger.info(
      { userId, quizId: id, score: forsok.score, total: forsok.total },
      "Quiz-forsøk registrert",
    );

    const response = LagretQuizResponseSchema.parse({ quiz: serialiser(doc.toObject()) });
    res.json(response);
  } catch (error) {
    if (error instanceof ZodError) {
      sendZodError(res, error, "Registrer quiz-forsøk");
      return;
    }
    sendUnknownError(res, error, {
      kontekst: "PATCH /api/quiz/lagrede/:id/forsok",
      melding: "Kunne ikke registrere forsøk.",
    });
  }
});

export default router;
