/**
 * MongoDB modell: `ChatHistory`.
 *
 * Lagrer kryptert KI-chat-historikk per bruker. Delingsmetadata bor i en egen
 * `SharedChat`-kolleksjon (se models/SharedChat.ts). Delingslenker leser live fra
 * `encryptedMessages` her, så senere redigeringer reflekteres i den delte lenken.
 * Gamle snapshot-baserte share-felter ble ryddet av migrasjonen
 * `2026-03-13-revoke-legacy-chat-share-links`.
 */
import { Schema, model, Types } from "mongoose";

export interface ChatHistoryDocument {
  _id: Types.ObjectId;
  user: Types.ObjectId;
  title: string;
  topic?: string;
  pinned?: boolean;
  encryptedMessages: string;
  // Kurs-lås per samtale. Settes første gang et kurs identifiseres i samtalen,
  // og brukes som fallback-scope for tvetydige etterfølgende spørsmål (f.eks.
  // "modul 7") slik at retrieval ikke lekker innhold fra andre kurs. Overstyres
  // av eksplisitt emne-referanse i meldingen (f.eks. "i 6105N, modul 7").
  primaryCourseId?: string;
  primaryCourseHint?: string;
  createdAt: Date;
  updatedAt: Date;
}

const ChatHistorySchema = new Schema<ChatHistoryDocument>(
  {
    user: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    title: { type: String, required: true },
    topic: { type: String, default: undefined, index: true },
    pinned: { type: Boolean, default: false, index: true },
    encryptedMessages: { type: String, required: true },
    primaryCourseId: { type: String, default: undefined },
    primaryCourseHint: { type: String, default: undefined },
  },
  { timestamps: true },
);

ChatHistorySchema.index({ user: 1, createdAt: -1 });
ChatHistorySchema.index({ user: 1, topic: 1, createdAt: -1 });
ChatHistorySchema.index({ user: 1, pinned: 1, createdAt: -1 });

export const ChatHistory = model<ChatHistoryDocument>("ChatHistory", ChatHistorySchema);
