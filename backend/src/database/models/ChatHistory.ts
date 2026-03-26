/**
 * MongoDB modell: `ChatHistory`.
 *
 * Lagrer kryptert KI-chat-historikk per bruker, samt metadata for deling (share link/snapshot).
 */
import { Schema, model, Types } from "mongoose";

export interface ChatHistoryDocument {
  _id: Types.ObjectId;
  user: Types.ObjectId;
  title: string;
  encryptedMessages: string;
  shareTokenHash?: string;
  sharedAt?: Date;
  shareExpiresAt?: Date;
  /** Snapshot for delt chat (kun type full_chat). */
  sharedSnapshot?: {
    version: number;
    type: "full_chat";
    title?: string;
    encryptedMessages?: string;
    messageCount?: number;
    sourceHash?: string;
    generatedAt: Date;
  };
  isShared: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const SharedChatSnapshotSchema = new Schema(
  {
    version: { type: Number, required: true },
    type: { type: String, enum: ["full_chat"], required: true },
    title: { type: String, default: undefined },
    encryptedMessages: { type: String, default: undefined },
    messageCount: { type: Number, default: undefined },
    sourceHash: { type: String, default: undefined },
    generatedAt: { type: Date, required: true },
  },
  { _id: false },
);

const ChatHistorySchema = new Schema<ChatHistoryDocument>(
  {
    user: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    title: { type: String, required: true },
    encryptedMessages: { type: String, required: true },
    shareTokenHash: { type: String, default: undefined },
    sharedAt: { type: Date, default: undefined },
    shareExpiresAt: { type: Date, default: undefined },
    sharedSnapshot: { type: SharedChatSnapshotSchema, default: undefined },
    isShared: { type: Boolean, default: false },
  },
  { timestamps: true }
);

ChatHistorySchema.index({ user: 1, createdAt: -1 });
ChatHistorySchema.index({ shareTokenHash: 1 }, { unique: true, sparse: true });
ChatHistorySchema.index({ isShared: 1, shareExpiresAt: 1 });

export const ChatHistory = model<ChatHistoryDocument>("ChatHistory", ChatHistorySchema);
