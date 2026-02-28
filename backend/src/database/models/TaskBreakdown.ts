import mongoose from "mongoose";

const SubTaskSchema = new mongoose.Schema({
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
});

const TaskBreakdownSchema = new mongoose.Schema({
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
  subtasks: [SubTaskSchema],
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

export const TaskBreakdown = mongoose.model("TaskBreakdown", TaskBreakdownSchema); 