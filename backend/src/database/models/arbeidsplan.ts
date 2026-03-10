/*
 * MongoDB Schema for Arbeidsplan (Work Plan)
 * Lagrer godkjente studieblokker fra KI-ukeplanen
 */

import mongoose, { Schema, Document } from "mongoose";

// Interface for StudyBlock (enkelt studiepass)
export interface IStudyBlock {
  day: string; // "Mandag", "Tirsdag", etc.
  timeSlot: string; // "08:00-10:00"
  task: string; // Oppgavetittel
  duration: string; // "2 timer"
  priority: "high" | "medium" | "low";
  courseName: string;
  assignmentId?: string; // Kobling til Canvas assignment (valgfri)
  completed: boolean;
  completedAt?: Date;
}

// Interface for hele arbeidsplanen
export interface IArbeidsplan extends Document {
  userId: string; // Bruker som eier planen
  week: string; // "Uke 10, 2025"
  weekNumber: number; // 10
  year: number; // 2025
  blocks: IStudyBlock[];
  totalHours: number;
  createdAt: Date;
  updatedAt: Date;
}

// Mongoose Schema for StudyBlock
const StudyBlockSchema = new Schema({
  day: { type: String, required: true },
  timeSlot: { type: String, required: true },
  task: { type: String, required: true },
  duration: { type: String, required: true },
  priority: { 
    type: String, 
    enum: ["high", "medium", "low"], 
    required: true 
  },
  courseName: { type: String, required: true },
  assignmentId: { type: String },
  completed: { type: Boolean, default: false },
  completedAt: { type: Date },
});

// Mongoose Schema for Arbeidsplan
const ArbeidsplanSchema = new Schema(
  {
    userId: { 
      type: String, 
      required: true,
      index: true // Index for rask søk
    },
    week: { type: String, required: true },
    weekNumber: { type: Number, required: true },
    year: { type: Number, required: true },
    blocks: [StudyBlockSchema],
    totalHours: { type: Number, required: true },
  },
  {
    timestamps: true, // Automatisk createdAt og updatedAt
  }
);

// Compound index for å finne brukerens plan for en spesifikk uke
ArbeidsplanSchema.index({ userId: 1, year: 1, weekNumber: 1 }, { unique: true });

export const Arbeidsplan = mongoose.model<IArbeidsplan>("Arbeidsplan", ArbeidsplanSchema);  