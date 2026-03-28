import mongoose, { Document, Schema } from "mongoose";

export interface IPendingClerkDeletion extends Document {
  clerkId: string;
  userId?: string;
  attempts: number;
  lastAttemptAt?: Date;
  nextRetryAt: Date;
  lastError?: string;
  createdAt: Date;
  updatedAt: Date;
}

const PendingClerkDeletionSchema = new Schema(
  {
    clerkId: {
      type: String,
      required: true,
      unique: true,
      trim: true,
    },
    userId: {
      type: String,
      default: undefined,
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

export const PendingClerkDeletionModel = mongoose.model<IPendingClerkDeletion>(
  "PendingClerkDeletion",
  PendingClerkDeletionSchema,
);
