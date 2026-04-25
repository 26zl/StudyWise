/**
 * LagretQuiz – lagret quiz per bruker, med historikk over forsøk.
 * Forsøk er capped til LAGRET_QUIZ_MAX_FORSOK (eldste droppes).
 */
import mongoose, { Schema } from "mongoose";
import type { QuizQuestion } from "common/ki";
import type { QuizForsok } from "common/quizLagret";

const QuizOptionsSchema = new Schema(
  {
    id: { type: String, required: true },
    question: { type: String, required: true },
    options: { type: [String], required: true },
    correctIndex: { type: Number, required: true, min: 0, max: 3 },
    explanation: { type: String, required: true },
  },
  { _id: false },
);

const QuizForsokSvarSchema = new Schema(
  {
    questionId: { type: String, required: true },
    selectedOption: { type: String, required: true },
    correct: { type: Boolean, required: true },
  },
  { _id: false },
);

const QuizForsokSchema = new Schema(
  {
    attemptId: { type: String, required: true },
    date: { type: Date, required: true, default: Date.now },
    score: { type: Number, required: true, min: 0 },
    total: { type: Number, required: true, min: 1 },
    durationSeconds: { type: Number, required: true, min: 0 },
    answers: { type: [QuizForsokSvarSchema], required: true },
  },
  { _id: false },
);

export interface LagretQuizDocument {
  _id: mongoose.Types.ObjectId;
  userId: string;
  title: string;
  topic: string;
  questions: QuizQuestion[];
  attempts: QuizForsok[];
  createdAt: Date;
  updatedAt: Date;
}

const LagretQuizSchema = new Schema<LagretQuizDocument>(
  {
    userId: { type: String, required: true },
    title: { type: String, required: true, maxlength: 200 },
    topic: { type: String, required: true, maxlength: 200 },
    questions: { type: [QuizOptionsSchema], required: true },
    attempts: { type: [QuizForsokSchema], default: [] },
  },
  { timestamps: true },
);

LagretQuizSchema.index({ userId: 1, createdAt: -1 });

export const LagretQuiz = mongoose.model<LagretQuizDocument>("LagretQuiz", LagretQuizSchema);
