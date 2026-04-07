/**
 * StudyContext – lagrer KI-samtale-kontekst per bruker/kurs over tid.
 *
 * Formål: Gi KI-assistenten hukommelse på tvers av samtaler slik at den
 * kan referere til hva studenten har spurt om tidligere, hvilke temaer
 * som var vanskelige, og gi mer målrettede svar.
 *
 * Hver entry er et kompakt "studiekort" som oppdateres etter AI-svar.
 * TTL 90 dager — eldre kontekst er sjelden relevant.
 */

import mongoose, { Schema, type Document } from "mongoose";

export interface IStudyContextTopic {
  /** Kort tematittel (f.eks. "AVL-trær", "Normalisering") */
  topic: string;
  /** Antall ganger studenten har spurt om dette temaet */
  queryCount: number;
  /** Siste gang temaet ble diskutert */
  lastAskedAt: Date;
  /** Kort oppsummering av hva som ble diskutert (maks 200 tegn) */
  summary: string;
}

export interface IStudyContext extends Document {
  userId: string;
  courseId: string;
  courseName: string;
  /** Temaer studenten har utforsket i dette kurset */
  topics: IStudyContextTopic[];
  /** Antall KI-samtaler for dette kurset */
  totalInteractions: number;
  /** Implisitt lært preferanse for forklaringsnivå (basert på "forklar enklere" o.l.). */
  preferredExplanationLevel?: "simple" | "standard" | "detailed" | "expert";
  updatedAt: Date;
  createdAt: Date;
}

const StudyContextTopicSchema = new Schema<IStudyContextTopic>(
  {
    topic: { type: String, required: true },
    queryCount: { type: Number, required: true, default: 1 },
    lastAskedAt: { type: Date, required: true, default: Date.now },
    summary: { type: String, required: true, maxlength: 200 },
  },
  { _id: false },
);

const StudyContextSchema = new Schema<IStudyContext>(
  {
    userId: { type: String, required: true, index: true },
    courseId: { type: String, required: true },
    courseName: { type: String, required: true },
    topics: { type: [StudyContextTopicSchema], default: [] },
    totalInteractions: { type: Number, default: 0 },
    preferredExplanationLevel: {
      type: String,
      enum: ["simple", "standard", "detailed", "expert"],
      required: false,
    },
  },
  { timestamps: true },
);

// Unikt per bruker/kurs
StudyContextSchema.index({ userId: 1, courseId: 1 }, { unique: true });

// TTL 90 dager — gammel kontekst er sjelden relevant
StudyContextSchema.index({ updatedAt: 1 }, { expireAfterSeconds: 90 * 24 * 60 * 60 });

export const StudyContext = mongoose.model<IStudyContext>(
  "StudyContext",
  StudyContextSchema,
);
