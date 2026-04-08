/**
 * ContactMessage — persistent kopi av kontaktskjema-innsendinger.
 *
 * Cloudflare Worker forwarder fortsatt henvendelsen til epost (primær flyt),
 * men vi lagrer også en kopi i MongoDB slik at admin kan se innboksen i panelet
 * uten å måtte sjekke epost. Vedlegg lagres IKKE her — kun metadata
 * (filnavn + størrelse) for at admin skal vite at det fantes vedlegg.
 *
 * Sletting: 365 dagers TTL via createdAt-index. Admin kan også slette manuelt.
 */
import mongoose, { Document, Schema } from "mongoose";

export type ContactMessageStatus = "unread" | "read" | "replied";
export const CONTACT_MESSAGE_STATUSES: ContactMessageStatus[] = [
  "unread",
  "read",
  "replied",
];

export interface IContactMessage extends Document {
  /** Avsenderens navn slik de skrev det inn */
  navn: string;
  /** Avsenderens e-post (validert i route via Zod før lagring) */
  epost: string;
  emne: string;
  melding: string;
  /** Side-URL bruker var på da de sendte (kun lagret hvis sendt) */
  sideUrl?: string;
  /** Request-ID for å korrelere mot Pino-logger og audit-logg */
  requestId?: string;
  /** Antall vedlegg + summary; selve filene lagres ikke */
  attachmentCount: number;
  attachmentSummary?: Array<{ filnavn: string; sizeBytes: number; mimeType: string }>;
  status: ContactMessageStatus;
  /** Hvilken admin som markerte status (for audit) */
  statusChangedBy?: string;
  statusChangedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const ContactMessageSchema = new Schema<IContactMessage>(
  {
    navn: { type: String, required: true, trim: true, maxlength: 200 },
    epost: { type: String, required: true, trim: true, lowercase: true, maxlength: 320 },
    emne: { type: String, required: true, trim: true, maxlength: 300 },
    melding: { type: String, required: true, maxlength: 10_000 },
    sideUrl: { type: String, trim: true, maxlength: 2_000, default: undefined },
    requestId: { type: String, trim: true, default: undefined },
    attachmentCount: { type: Number, default: 0, min: 0 },
    attachmentSummary: {
      type: [
        {
          filnavn: { type: String, required: true, maxlength: 300 },
          sizeBytes: { type: Number, required: true, min: 0 },
          mimeType: { type: String, required: true, maxlength: 200 },
        },
      ],
      default: undefined,
    },
    status: {
      type: String,
      enum: CONTACT_MESSAGE_STATUSES,
      default: "unread",
      index: true,
    },
    statusChangedBy: { type: String, trim: true, default: undefined },
    statusChangedAt: { type: Date, default: undefined },
  },
  { timestamps: true },
);

// TTL: slettes automatisk etter 365 dager
ContactMessageSchema.index(
  { createdAt: 1 },
  { expireAfterSeconds: 365 * 24 * 60 * 60 },
);

// Indeks for sortering på status + nylige meldinger først
ContactMessageSchema.index({ status: 1, createdAt: -1 });

export const ContactMessage = mongoose.model<IContactMessage>(
  "ContactMessage",
  ContactMessageSchema,
);
