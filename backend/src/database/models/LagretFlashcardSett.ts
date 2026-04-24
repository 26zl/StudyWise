/**
 * LagretFlashcardSett – lagret flashcard-sett per bruker, med historikk over øvelsesøkter.
 * Økter er capped til LAGRET_FLASHCARD_MAX_OKTER (eldste droppes).
 */
import mongoose, { Schema, type HydratedDocument } from "mongoose";
import type { Flashcard } from "common/ki";
import type { FlashcardOkt } from "common/flashcardsLagret";

const FlashcardSubSchema = new Schema(
  {
    id: { type: String, required: true },
    front: { type: String, required: true },
    back: { type: String, required: true },
  },
  { _id: false },
);

const FlashcardOktSchema = new Schema(
  {
    sessionId: { type: String, required: true },
    date: { type: Date, required: true, default: Date.now },
    totalCards: { type: Number, required: true, min: 1 },
    knewCount: { type: Number, required: true, min: 0 },
    didNotKnowCount: { type: Number, required: true, min: 0 },
  },
  { _id: false },
);

export interface LagretFlashcardSettDocument {
  _id: mongoose.Types.ObjectId;
  userId: string;
  title: string;
  topic: string;
  cards: Flashcard[];
  sessions: FlashcardOkt[];
  createdAt: Date;
  updatedAt: Date;
}

export type LagretFlashcardSettHydratedDocument = HydratedDocument<LagretFlashcardSettDocument>;

const LagretFlashcardSettSchema = new Schema<LagretFlashcardSettDocument>(
  {
    userId: { type: String, required: true },
    title: { type: String, required: true, maxlength: 200 },
    topic: { type: String, required: true, maxlength: 200 },
    cards: { type: [FlashcardSubSchema], required: true },
    sessions: { type: [FlashcardOktSchema], default: [] },
  },
  { timestamps: true },
);

LagretFlashcardSettSchema.index({ userId: 1, createdAt: -1 });

export const LagretFlashcardSett = mongoose.model<LagretFlashcardSettDocument>(
  "LagretFlashcardSett",
  LagretFlashcardSettSchema,
);
