/**
 * KBContentChunk – lagrer innholdschunks fra personlige kunnskapsbaser.
 *
 * Tilsvarer ContentEmbedding, men for brukerens egne lenker og filer
 * i stedet for Canvas-data. Vektorer lagres i Pinecone med baseId som filter.
 */

import mongoose, { Schema, type Document } from "mongoose";

export interface IKBContentChunk extends Document {
  userId: string;
  /** Referanse til KnowledgeBase._id */
  baseId: string;
  /** Kilde-ID: enten lenke-_id eller fil-_id fra KnowledgeBase */
  sourceId: string;
  /** Type kilde */
  sourceType: "link" | "file";
  /** Kildenavn for visning (filnavn eller URL) */
  sourceName: string;
  chunkIndex: number;
  /** Tekstinnholdet i chunken */
  text: string;
  /** Omtrentlig token-antall */
  tokenCount: number;
  /** SHA-256-hash av chunk-teksten */
  contentHash: string;
  /** Om chunken er synkronisert til Pinecone */
  pineconeSynced: boolean;
  /** URL til kilden (for crawlede nettsider) */
  sourceUrl?: string;
  /** Parent URL (for crawlede undersider) */
  parentUrl?: string;
  /** Crawl-dybde (0 = seed) */
  depth?: number;
  /** Content-type (html, pdf, docx) */
  contentType?: string;
  /** Domene (for URL-matching) */
  domain?: string;
  /** Path (for URL-matching) */
  path?: string;
  createdAt: Date;
  updatedAt: Date;
}

const KBContentChunkSchema = new Schema<IKBContentChunk>(
  {
    userId: { type: String, required: true, index: true },
    baseId: { type: String, required: true },
    sourceId: { type: String, required: true },
    sourceType: { type: String, required: true, enum: ["link", "file"] },
    sourceName: { type: String, required: true },
    chunkIndex: { type: Number, required: true },
    text: { type: String, required: true },
    tokenCount: { type: Number, required: true },
    contentHash: { type: String, required: true },
    pineconeSynced: { type: Boolean, default: false },
    // Crawl-metadata
    sourceUrl: { type: String },
    parentUrl: { type: String },
    depth: { type: Number },
    contentType: { type: String },
    domain: { type: String },
    path: { type: String },
  },
  { timestamps: true },
);

// Primære oppslag
KBContentChunkSchema.index({ userId: 1, baseId: 1 });
KBContentChunkSchema.index({ userId: 1, baseId: 1, sourceId: 1 });

// URL-matching for automatisk KB-kontekst
KBContentChunkSchema.index({ userId: 1, sourceUrl: 1 });
KBContentChunkSchema.index({ userId: 1, domain: 1, path: 1 });

// Unikt per bruker/base/kilde/chunk
KBContentChunkSchema.index(
  { userId: 1, baseId: 1, sourceId: 1, chunkIndex: 1 },
  { unique: true },
);

export const KBContentChunk = mongoose.model<IKBContentChunk>(
  "KBContentChunk",
  KBContentChunkSchema,
);
