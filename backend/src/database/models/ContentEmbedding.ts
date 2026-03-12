/**
 * ContentEmbedding – lagrer KI-innholdschunks for Canvas-filer i MongoDB.
 *
 * Brukes til:
 * - keyword-basert søk og rekonstruksjon av filkontekst
 * - id-referanse for semantisk søk (vektorer lagres i Pinecone, ikke her)
 *
 * Merk: Modellnavnet beholdes som "ContentEmbedding" for bakoverkompatibilitet
 * med eksisterende MongoDB-collection. Vektorer lagres kun i Pinecone.
 */

import mongoose, { Schema, type Document } from "mongoose";

export interface IContentEmbedding extends Document {
  userId: string;
  courseId: string;
  courseName: string;
  moduleTitle: string;
  fileName: string;
  fileId: number;
  fileHash: string;
  chunkIndex: number;
  /** Selve tekstinnholdet i chunken */
  text: string;
  createdAt: Date;
  updatedAt: Date;
}

const ContentEmbeddingSchema = new Schema<IContentEmbedding>(
  {
    userId: { type: String, required: true, index: true },
    courseId: { type: String, required: true },
    courseName: { type: String, required: true },
    moduleTitle: { type: String, required: true },
    fileName: { type: String, required: true },
    fileId: { type: Number, required: true },
    fileHash: { type: String, required: true },
    chunkIndex: { type: Number, required: true },
    text: { type: String, required: true },
  },
  { timestamps: true },
);

// Primære oppslag: bruker/kurs og bruker/fil
ContentEmbeddingSchema.index({ userId: 1, courseId: 1 });
ContentEmbeddingSchema.index({ userId: 1, courseId: 1, fileId: 1 });

// Unikt per bruker/kurs/fil/chunk for å unngå duplikater
ContentEmbeddingSchema.index(
  { userId: 1, courseId: 1, fileId: 1, chunkIndex: 1 },
  { unique: true },
);

export const ContentEmbedding = mongoose.model<IContentEmbedding>(
  "ContentEmbedding",
  ContentEmbeddingSchema,
);
