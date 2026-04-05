import mongoose, { Document, Schema } from "mongoose";

export interface IPendingVectorDeletion extends Document {
  userId: string;
  attempts: number;
  lastAttemptAt?: Date;
  nextRetryAt: Date;
  lastError?: string;
  createdAt: Date;
  updatedAt: Date;
}

const PendingVectorDeletionSchema = new Schema(
  {
    userId: {
      type: String,
      required: true,
      unique: true,
      trim: true,
    },
    attempts: {
      type: Number,
      default: 0,
    },
    lastAttemptAt: {
      type: Date,
      default: undefined,
    },
    nextRetryAt: {
      type: Date,
      required: true,
      index: true,
    },
    lastError: {
      type: String,
      default: undefined,
    },
  },
  { timestamps: true },
);

export const PendingVectorDeletionModel = mongoose.model<IPendingVectorDeletion>(
  "PendingVectorDeletion",
  PendingVectorDeletionSchema,
);
