import mongoose, { Document, Schema } from "mongoose";

export interface IWebPushSubscription extends Document {
  userId: mongoose.Types.ObjectId;
  endpoint: string;
  expirationTime?: number | null;
  keys: {
    p256dh: string;
    auth: string;
  };
  userAgent?: string;
  createdAt: Date;
  updatedAt: Date;
}

const WebPushSubscriptionSchema = new Schema(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    endpoint: {
      type: String,
      required: true,
      unique: true,
      trim: true,
    },
    expirationTime: {
      type: Number,
      default: null,
    },
    keys: {
      p256dh: { type: String, required: true },
      auth: { type: String, required: true },
    },
    userAgent: {
      type: String,
      default: undefined,
    },
  },
  { timestamps: true },
);

WebPushSubscriptionSchema.index(
  { userId: 1, endpoint: 1 },
  { unique: true, name: "user_endpoint_unique" },
);

export const WebPushSubscriptionModel = mongoose.model<IWebPushSubscription>(
  "WebPushSubscription",
  WebPushSubscriptionSchema,
);
