import { Schema, model, Types } from "mongoose";

export interface ConversationDocument {
  _id: Types.ObjectId;
  user: Types.ObjectId;
  encryptedMessages: string;
  model?: string;
  createdAt: Date;
  updatedAt: Date;
}

const ConversationSchema = new Schema<ConversationDocument>(
  {
    user: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    encryptedMessages: { type: String, required: true },
    model: { type: String, required: false },
  },
  { timestamps: true }
);

ConversationSchema.index({ user: 1, createdAt: -1 });

export const Conversation = model<ConversationDocument>("Conversation", ConversationSchema);