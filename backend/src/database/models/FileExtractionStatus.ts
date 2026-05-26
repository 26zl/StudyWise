/**
 * FileExtractionStatus – tracker Canvas-filer som finnes i kursstrukturen
 * men som ikke kan leses av tekstekstraksjonen (typisk bilde-baserte PPTX,
 * korrupte filer, filer som er for store, eller uspøttede filformater).
 *
 * Hvorfor:
 * - Uten denne vet vi ikke hvilke filer som feilet utenom via logg-grep.
 * - Context-loader kan injisere en konkret beskjed til KI-en når brukeren
 *   spør om en fil vi kjenner er tom ("last opp manuelt") istedenfor å la
 *   KI-en gjette fra prompt-regel.
 * - Admin får en liste over alle mislykkede ekstraksjoner på tvers av brukere.
 *
 * Levetid:
 * - Opprettes/oppdateres når sync prøver å ekstrahere og får null innhold.
 * - Slettes når en senere sync lykkes (filen er oppdatert eller OCR er lagt til).
 * - Slettes som del av kurs-/brukersletting.
 */
import mongoose, { Schema, type Document } from "mongoose";

export type FileExtractionStatusCode =
  | "empty" // Ekstraksjon kjørte men returnerte 0 tegn (typisk bilde-basert PPTX).
  | "sparse" // Ekstraksjon ga noe tekst, men mye mindre enn forventet for filstørrelsen
  // (typisk bilde-tung PPTX der kun slide-titler og fottekst blir tekst).
  // Chunks blir fortsatt lagret, men KI får beskjed om at innholdet er partielt.
  | "failed" // Exception under ekstraksjon (korrupt fil, ukjent feil).
  | "too_large" // Filen oversteg max-size-grensen.
  | "unsupported"; // Filtype vi ikke støtter (.zip, .mp4 osv.).

export interface IFileExtractionStatus extends Document {
  userId: string;
  courseId: string;
  courseName: string;
  moduleId?: number;
  moduleTitle?: string;
  fileName: string;
  fileId: number;
  status: FileExtractionStatusCode;
  /** Menneskelig lesbar grunn — brukes i admin-UI og som del av KI-notat. */
  reason?: string;
  /** Antall ganger sync har prøvd og feilet — akkumulert. */
  attemptCount: number;
  /** Tidspunkt for siste forsøk. */
  lastAttempt: Date;
  createdAt: Date;
  updatedAt: Date;
}

const FileExtractionStatusSchema = new Schema<IFileExtractionStatus>(
  {
    userId: { type: String, required: true, index: true },
    courseId: { type: String, required: true },
    courseName: { type: String, required: true },
    moduleId: { type: Number, required: false },
    moduleTitle: { type: String, required: false },
    fileName: { type: String, required: true },
    fileId: { type: Number, required: true },
    status: {
      type: String,
      required: true,
      enum: ["empty", "sparse", "failed", "too_large", "unsupported"],
    },
    reason: { type: String, required: false },
    attemptCount: { type: Number, required: true, default: 1 },
    lastAttempt: { type: Date, required: true, default: () => new Date() },
  },
  { timestamps: true },
);

FileExtractionStatusSchema.index({ userId: 1, courseId: 1 });
FileExtractionStatusSchema.index({ userId: 1, courseId: 1, fileId: 1 }, { unique: true });

export const FileExtractionStatus = mongoose.model<IFileExtractionStatus>(
  "FileExtractionStatus",
  FileExtractionStatusSchema,
);
