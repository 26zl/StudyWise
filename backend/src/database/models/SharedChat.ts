/**
 * MongoDB modell: `SharedChat`.
 *
 * Lagrer delingslenker for chatter med metadata for tilgang, utløp og visninger.
 */
import { Schema, model, Types } from "mongoose";

export type SharedChatAccessType = "public" | "private";

export interface SharedChatDocument {
  _id: Types.ObjectId;
  shareId: string;
  chatId: Types.ObjectId;
  ownerId: Types.ObjectId;
  createdAt: Date;
  expiresAt?: Date | null;
  isActive: boolean;
  accessType: SharedChatAccessType;
  viewCount: number;
  updatedAt: Date;
}

const SharedChatSchema = new Schema<SharedChatDocument>(
  {
    shareId: { type: String, required: true, unique: true, index: true },
    chatId: { type: Schema.Types.ObjectId, ref: "ChatHistory", required: true, index: true },
    ownerId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    expiresAt: { type: Date, default: null },
    isActive: { type: Boolean, required: true, default: true, index: true },
    accessType: {
      type: String,
      enum: ["public", "private"],
      required: true,
      default: "public",
    },
    viewCount: { type: Number, required: true, default: 0 },
  },
  { timestamps: true },
);

SharedChatSchema.index({ ownerId: 1, createdAt: -1 });
SharedChatSchema.index({ chatId: 1, ownerId: 1, isActive: 1 });
SharedChatSchema.index(
  { chatId: 1, ownerId: 1 },
  { unique: true, partialFilterExpression: { isActive: true } },
);
SharedChatSchema.index({ isActive: 1, expiresAt: 1 });

export const SharedChat = model<SharedChatDocument>("SharedChat", SharedChatSchema, "sharedChats");
