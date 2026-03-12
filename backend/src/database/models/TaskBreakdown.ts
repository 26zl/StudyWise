/**
 * TaskBreakdown – lagrer AI-genererte deloppgaver per bruker/oppgave.
 * Subtasks lagres som plaintext (ikke kryptert).
 */
import mongoose, { type HydratedDocument } from "mongoose";
import type { SubTask } from "common/ki";

const SubTaskSchema = new mongoose.Schema(
  {
  id: {
    type: String,
    required: true,
  },
  title: {
    type: String,
    required: true,
    maxlength: 200,
  },
  description: {
    type: String,
    required: true,
    maxlength: 1000,
  },
  estimatedTime: {
    type: String,
    required: true,
  },
  priority: {
    type: String,
    enum: ["low", "medium", "high"],
    required: true,
  },
  completed: {
    type: Boolean,
    default: false,
  },
  approved: {
    type: Boolean,
    default: true,
  },
  },
  { _id: false },
);

export interface TaskBreakdownDocument {
  _id: mongoose.Types.ObjectId;
  userId: mongoose.Types.ObjectId;
  assignmentId: string;
  subtasks?: SubTask[];
  createdAt: Date;
  updatedAt: Date;
}

export type TaskBreakdownHydratedDocument = HydratedDocument<TaskBreakdownDocument>;

const TaskBreakdownSchema = new mongoose.Schema<TaskBreakdownDocument>({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    required: true,
    index: true,
  },
  assignmentId: {
    type: String,
    required: true,
    index: true,
  },
  subtasks: {
    type: [SubTaskSchema],
    required: false,
  },
  createdAt: {
    type: Date,
    default: Date.now,
  },
  updatedAt: {
    type: Date,
    default: Date.now,
  },
});

TaskBreakdownSchema.index({ userId: 1, assignmentId: 1 }, { unique: true });

export const TaskBreakdown = mongoose.model<TaskBreakdownDocument>("TaskBreakdown", TaskBreakdownSchema);
