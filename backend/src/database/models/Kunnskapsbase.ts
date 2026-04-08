/**
 * KnowledgeBase – personlig kunnskapsbase per bruker.
 *
 * Brukeren kan opprette flere baser med egne navn (f.eks. "Algoritmer", "Bacheloroppgave").
 * Hver base har lenker (URLer) og filer (opplastede dokumenter).
 * Innholdet indekseres til Pinecone for semantisk søk, med baseId som metadata-filter.
 */

import mongoose, { Schema, type Document, type Types } from "mongoose";
import type { KBCrawlStatus } from "common/kunnskapsbase";

// ─── Lenke (URL) ─────────────────────────────────────────

export interface IKBLink {
  _id?: Types.ObjectId;
  url: string;
  tittel: string;
  /** SHA-256-hash av crawlet innhold (for endringsdeteksjon) */
  contentHash?: string;
  /** Om innholdet er indeksert til Pinecone */
  indexed: boolean;
  createdAt: Date;
  /** Deep crawl-status */
  crawlStatus: KBCrawlStatus;
  /** Konfigurasjon for crawling */
  crawlConfig?: {
    maxDepth?: number;
    maxPages?: number;
    maxDocuments?: number;
    samePathOnly?: boolean;
  };
  /** Antall crawlede HTML-sider */
  crawledPages?: number;
  /** Antall crawlede dokumenter (PDF, DOCX) */
  crawledDocuments?: number;
  /** Feilmelding hvis crawl feilet */
  crawlError?: string;
  /** Tidspunkt for siste crawl */
  lastCrawledAt?: Date;
}

const KBLinkSchema = new Schema<IKBLink>(
  {
    url: { type: String, required: true },
    tittel: { type: String, required: true, default: "" },
    contentHash: { type: String },
    indexed: { type: Boolean, default: false },
    createdAt: { type: Date, default: Date.now },
    crawlStatus: {
      type: String,
      enum: ["pending", "crawling", "completed", "failed"],
      default: "pending",
    },
    crawlConfig: {
      type: new Schema(
        {
          maxDepth: Number,
          maxPages: Number,
          maxDocuments: Number,
          samePathOnly: Boolean,
        },
        { _id: false },
      ),
      default: undefined,
    },
    crawledPages: { type: Number, default: 0 },
    crawledDocuments: { type: Number, default: 0 },
    crawlError: { type: String },
    lastCrawledAt: { type: Date },
  },
  { _id: true },
);

// ─── Fil (opplastet dokument) ────────────────────────────

export interface IKBFile {
  _id?: Types.ObjectId;
  filnavn: string;
  mimeType: string;
  /** Filstørrelse i bytes */
  storrelse: number;
  /** SHA-256-hash av filinnholdet */
  contentHash: string;
  /** Om innholdet er indeksert til Pinecone */
  indexed: boolean;
  createdAt: Date;
}

const KBFileSchema = new Schema<IKBFile>(
  {
    filnavn: { type: String, required: true },
    mimeType: { type: String, required: true },
    storrelse: { type: Number, required: true },
    contentHash: { type: String, required: true },
    indexed: { type: Boolean, default: false },
    createdAt: { type: Date, default: Date.now },
  },
  { _id: true },
);

// ─── Kunnskapsbase ───────────────────────────────────────

export interface IKnowledgeBase extends Document {
  userId: string;
  navn: string;
  lenker: IKBLink[];
  filer: IKBFile[];
  createdAt: Date;
  updatedAt: Date;
}

const KnowledgeBaseSchema = new Schema<IKnowledgeBase>(
  {
    userId: { type: String, required: true, index: true },
    navn: { type: String, required: true },
    lenker: { type: [KBLinkSchema], default: [] },
    filer: { type: [KBFileSchema], default: [] },
  },
  { timestamps: true },
);

// Oppslag: alle baser for en bruker
KnowledgeBaseSchema.index({ userId: 1, createdAt: -1 });

// Unikt basenavn per bruker (kan ikke ha to baser med samme navn)
KnowledgeBaseSchema.index({ userId: 1, navn: 1 }, { unique: true });

export const KnowledgeBase = mongoose.model<IKnowledgeBase>(
  "KnowledgeBase",
  KnowledgeBaseSchema,
);
