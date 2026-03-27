/**
 * CanvasStructure – permanent lagring av Canvas kursstruktur i MongoDB.
 *
 * Gir rask fallback når Redis TTL utløper, slik at chat aldri trenger
 * å kalle Canvas API direkte. Oppdateres av canvas-sync.service.ts
 * ved hver vellykket sync.
 */

import mongoose, { Schema, type Document } from "mongoose";

export interface ICanvasModuleItem {
  id?: number;
  title: string;
  type: string;
  content_id?: number;
  external_url?: string;
  /** Per-item hash for endringsdeteksjon: hash(id + title + external_url) */
  contentHash?: string;
  /** Hash av hentet ExternalUrl-innhold (for å unngå re-indeksering av uendrede sider) */
  crawledHash?: string;
  /** Tidspunkt for siste crawl av ExternalUrl */
  crawledAt?: Date;
  /** Liste over PDF-URL-er som er crawlet fra denne ExternalUrl-en */
  crawledPdfs?: string[];
}

export interface ICanvasModule {
  id: number;
  name: string;
  items: ICanvasModuleItem[];
}

export interface ICanvasAssignment {
  name: string;
  due_at?: string | null;
  description?: string | null;
  points_possible?: number | null;
  submission?: {
    workflow_state?: string | null;
    submitted_at?: string | null;
  } | null;
}

export interface ICanvasAnnouncement {
  title: string;
  message?: string | null;
  posted_at?: string | null;
}

export interface ICanvasStructure extends Document {
  userId: string;
  courseId: string;
  courseName: string;
  course_code: string;
  moduler: ICanvasModule[];
  oppgaver: ICanvasAssignment[];
  kunngjøringer: ICanvasAnnouncement[];
  syncedAt: Date;
  dataHash: string;
}

const CanvasStructureSchema = new Schema<ICanvasStructure>(
  {
    userId: { type: String, required: true },
    courseId: { type: String, required: true },
    courseName: { type: String, required: true },
    course_code: { type: String, default: "" },
    moduler: { type: Schema.Types.Mixed, default: [] },
    oppgaver: { type: Schema.Types.Mixed, default: [] },
    kunngjøringer: { type: Schema.Types.Mixed, default: [] },
    syncedAt: { type: Date, default: Date.now },
    dataHash: { type: String, required: true },
  },
  {
    timestamps: false,
    collection: "canvasstructures",
  },
);

// Compound unique index: én rad per bruker+kurs (dekker også rene userId-oppslag via prefiks)
CanvasStructureSchema.index({ userId: 1, courseId: 1 }, { unique: true });

export const CanvasStructureModel = mongoose.model<ICanvasStructure>(
  "CanvasStructure",
  CanvasStructureSchema,
);
