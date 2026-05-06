/**
 * Lagrede flashcards – delte Zod-skjemaer og typer for lagrede flashcard-sett og øktshistorikk.
 * Brukes av frontend og backend for validering av API-grenser.
 */

import { z } from "zod";
import { FlashcardSchema } from "./ki.js";

// Konstanter

/** Maks antall økter som lagres per sett (eldste droppes) */
export const LAGRET_FLASHCARD_MAX_OKTER = 50;

/** Maks lengde på tittel */
export const LAGRET_FLASHCARD_MAX_TITTEL_LENGTH = 200;

/** Maks lengde på emne */
export const LAGRET_FLASHCARD_MAX_EMNE_LENGTH = 200;

/**
 * Fargeterskler for andel kjente kort (prosent).
 * Brukes av badge, trend-diagram og legende slik at alle tre er synkronisert.
 */
export const LAGRET_FLASHCARD_SCORE_TERSKLER = {
  /** >= dette er grønt (bra) */
  GOD: 80,
  /** >= dette er gult (middels) — under dette er rødt */
  MIDDELS: 50,
} as const;

// Økt (session)

/** Én fullført flashcard-øvelsesøkt. */
export const FlashcardOktSchema = z.object({
  sessionId: z.uuid(),
  date: z.coerce.date(),
  totalCards: z.number().int().min(1),
  knewCount: z.number().int().min(0),
  didNotKnowCount: z.number().int().min(0),
});

// Lagret flashcard-sett

export const LagretFlashcardSettSchema = z.object({
  id: z.string().min(1),
  title: z.string().trim().min(1).max(LAGRET_FLASHCARD_MAX_TITTEL_LENGTH),
  topic: z.string().trim().min(1).max(LAGRET_FLASHCARD_MAX_EMNE_LENGTH),
  cards: z.array(FlashcardSchema).min(1).max(50),
  createdAt: z.coerce.date(),
  sessions: z.array(FlashcardOktSchema),
});

// API-schemas

/** POST /api/flashcards/lagrede — body for å lagre et nytt sett. */
export const LagreFlashcardSettRequestSchema = z.object({
  title: z.string().trim().min(1).max(LAGRET_FLASHCARD_MAX_TITTEL_LENGTH),
  topic: z.string().trim().min(1).max(LAGRET_FLASHCARD_MAX_EMNE_LENGTH),
  cards: z.array(FlashcardSchema).min(1).max(50),
});

/** GET /api/flashcards/lagrede — listerespons. */
export const LagredeFlashcardSettResponseSchema = z.object({
  sett: z.array(LagretFlashcardSettSchema),
});

/** GET /api/flashcards/lagrede/:id — enkelt-respons. */
export const LagretFlashcardSettResponseSchema = z.object({
  sett: LagretFlashcardSettSchema,
});

/** PATCH /api/flashcards/lagrede/:id/okt — body for å registrere en økt. */
export const RegistrerFlashcardOktRequestSchema = z.object({
  totalCards: z.number().int().min(1),
  knewCount: z.number().int().min(0),
  didNotKnowCount: z.number().int().min(0),
});

// Typer

export type FlashcardOkt = z.infer<typeof FlashcardOktSchema>;
export type LagretFlashcardSett = z.infer<typeof LagretFlashcardSettSchema>;
export type LagreFlashcardSettRequest = z.infer<typeof LagreFlashcardSettRequestSchema>;
export type LagredeFlashcardSettResponse = z.infer<typeof LagredeFlashcardSettResponseSchema>;
export type LagretFlashcardSettResponse = z.infer<typeof LagretFlashcardSettResponseSchema>;
export type RegistrerFlashcardOktRequest = z.infer<typeof RegistrerFlashcardOktRequestSchema>;
