import mongoose from "mongoose";

const ChatConversationSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    required: true,
    index: true,
  },
  title: {
    type: String,
    required: true,
    default: "Ny samtale",
    maxlength: 200,
  },
  messages: [
    {
      role: {
        type: String,
        enum: ["user", "assistant", "system"],
        required: true,
      },
      content: {
        type: String,
        required: true,
        maxlength: 10000,
      },
      timestamp: {
        type: Date,
        default: Date.now,
      },
    },
  ],
  createdAt: {
    type: Date,
    default: Date.now,
    index: true,
  },
  updatedAt: {
    type: Date,
    default: Date.now,
  },
});

// Index for rask søking
ChatConversationSchema.index({ userId: 1, createdAt: -1 });

// Auto-update updatedAt
ChatConversationSchema.pre("save", function (next) {
  this.updatedAt = new Date();
  next();
});

export const ChatConversation = mongoose.model("ChatConversation", ChatConversationSchema); 