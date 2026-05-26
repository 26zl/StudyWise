/**
 * Lagret quiz – delte Zod-skjemaer og typer for lagrede quizer og forsøk.
 * Brukes av frontend og backend for validering av API-grenser.
 */

import { z } from "zod";
import { QuizQuestionSchema } from "./ki.js";

// Konstanter

/** Maks antall forsøk som lagres per quiz (eldste droppes) */
export const LAGRET_QUIZ_MAX_FORSOK = 50;

/** Maks lengde på tittel */
export const LAGRET_QUIZ_MAX_TITTEL_LENGTH = 200;

/** Maks lengde på emne */
export const LAGRET_QUIZ_MAX_EMNE_LENGTH = 200;

/** Maks varighet for ett quiz-forsøk (24 timer) */
export const LAGRET_QUIZ_MAX_VARIGHET_SEKUNDER = 86400;

/**
 * Fargeterskler for score-visning (prosent).
 * Brukes av badge, trend-diagram og legende slik at alle tre er synkronisert.
 */
export const LAGRET_QUIZ_SCORE_TERSKLER = {
  /** >= dette er grønt (bra) */
  GOD: 80,
  /** >= dette er gult (middels) — under dette er rødt */
  MIDDELS: 50,
} as const;

// Forsøk

/** Ett enkelt svar gitt under et quiz-forsøk. */
export const QuizForsokSvarSchema = z.object({
  questionId: z.uuid(),
  selectedOption: z.string().min(1),
  correct: z.boolean(),
});

/** Ett fullført quiz-forsøk med score, varighet og per-spørsmål-resultat. */
export const QuizForsokSchema = z.object({
  attemptId: z.uuid(),
  date: z.coerce.date(),
  score: z.number().int().min(0),
  total: z.number().int().min(1),
  durationSeconds: z.number().int().min(0).max(LAGRET_QUIZ_MAX_VARIGHET_SEKUNDER),
  answers: z.array(QuizForsokSvarSchema).min(1),
});

// Lagret quiz

export const LagretQuizSchema = z.object({
  id: z.string().min(1),
  title: z.string().trim().min(1).max(LAGRET_QUIZ_MAX_TITTEL_LENGTH),
  topic: z.string().trim().min(1).max(LAGRET_QUIZ_MAX_EMNE_LENGTH),
  questions: z.array(QuizQuestionSchema).min(1).max(50),
  createdAt: z.coerce.date(),
  attempts: z.array(QuizForsokSchema),
});

// API-schemas

/** POST /api/quiz/lagrede — body for å lagre en ny quiz. */
export const LagreQuizRequestSchema = z.object({
  title: z.string().trim().min(1).max(LAGRET_QUIZ_MAX_TITTEL_LENGTH),
  topic: z.string().trim().min(1).max(LAGRET_QUIZ_MAX_EMNE_LENGTH),
  questions: z.array(QuizQuestionSchema).min(1).max(50),
});

/** GET /api/quiz/lagrede — listerespons. */
export const LagredeQuizerResponseSchema = z.object({
  quizer: z.array(LagretQuizSchema),
});

/** GET /api/quiz/lagrede/:id — enkelt-respons. */
export const LagretQuizResponseSchema = z.object({
  quiz: LagretQuizSchema,
});

/** PATCH /api/quiz/lagrede/:id/forsok — body for å registrere et forsøk. */
export const RegistrerQuizForsokRequestSchema = z.object({
  score: z.number().int().min(0),
  total: z.number().int().min(1),
  durationSeconds: z.number().int().min(0).max(LAGRET_QUIZ_MAX_VARIGHET_SEKUNDER),
  answers: z.array(QuizForsokSvarSchema).min(1),
});

// Typer

export type QuizForsokSvar = z.infer<typeof QuizForsokSvarSchema>;
export type QuizForsok = z.infer<typeof QuizForsokSchema>;
export type LagretQuiz = z.infer<typeof LagretQuizSchema>;
export type LagreQuizRequest = z.infer<typeof LagreQuizRequestSchema>;
export type LagredeQuizerResponse = z.infer<typeof LagredeQuizerResponseSchema>;
export type LagretQuizResponse = z.infer<typeof LagretQuizResponseSchema>;
export type RegistrerQuizForsokRequest = z.infer<typeof RegistrerQuizForsokRequestSchema>;
