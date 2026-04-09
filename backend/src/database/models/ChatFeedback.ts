/**
 * MongoDB modell: `ChatFeedback`.
 *
 * Brukerfeedback (tommel opp/ned) på enkelt-svar fra KI-assistenten.
 * Brukes til admin-dashboard for å oppdage svake svar og forbedre prompt/retrieval.
 */
import { Schema, model, Types } from "mongoose";

const CHAT_FEEDBACK_TTL_DAYS = 180;

export interface ChatFeedbackDocument {
  _id: Types.ObjectId;
  user: Types.ObjectId;
  /** Stabil id på meldingen i frontend (Date.now()-streng). */
  messageId: string;
  /** Valgfri referanse til ChatHistory hvis chatten er lagret. */
  chatId?: string;
  rating: "up" | "down";
  /** Tilhørende brukerspørsmål (truncert). */
  question?: string;
  /** Selve KI-svaret (truncert). */
  answer?: string;
  createdAt: Date;
  updatedAt: Date;
}

const ChatFeedbackSchema = new Schema<ChatFeedbackDocument>(
  {
    user: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    messageId: { type: String, required: true },
    chatId: { type: String, required: false },
    rating: { type: String, enum: ["up", "down"], required: true },
    question: { type: String, maxlength: 2000 },
    answer: { type: String, maxlength: 5000 },
  },
  { timestamps: true },
);

ChatFeedbackSchema.index({ user: 1, messageId: 1 }, { unique: true });
ChatFeedbackSchema.index({ rating: 1, createdAt: -1 });
// Feedback brukes til kvalitetsforbedring, men skal ikke lagres på ubestemt tid.
ChatFeedbackSchema.index(
  { createdAt: 1 },
  { expireAfterSeconds: CHAT_FEEDBACK_TTL_DAYS * 24 * 60 * 60 },
);

export const ChatFeedback = model<ChatFeedbackDocument>("ChatFeedback", ChatFeedbackSchema);
