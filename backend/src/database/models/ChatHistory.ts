import { Schema, model, Types } from "mongoose";

export interface ChatHistoryDocument {
  _id: Types.ObjectId;
  user: Types.ObjectId;
  title: string;
  encryptedMessages: string;
  shareToken?: string;
  sharedAt?: Date;
  shareExpiresAt?: Date;
  isShared: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const ChatHistorySchema = new Schema<ChatHistoryDocument>(
  {
    user: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    title: { type: String, required: true },
    encryptedMessages: { type: String, required: true },
    shareToken: { type: String, default: undefined },
    sharedAt: { type: Date, default: undefined },
    shareExpiresAt: { type: Date, default: undefined },
    isShared: { type: Boolean, default: false },
  },
  { timestamps: true }
);

ChatHistorySchema.index({ user: 1, createdAt: -1 });
ChatHistorySchema.index({ shareToken: 1 }, { unique: true, sparse: true });

export const ChatHistory = model<ChatHistoryDocument>("ChatHistory", ChatHistorySchema);
