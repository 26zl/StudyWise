/**
 * Revisjonslogg for sikkerhets- og personvernrelevante handlinger.
 * Schema støtter korrelasjon med request-logger og traces (requestId, traceId, spanId).
 */
import mongoose, { Schema, Document } from "mongoose";

export const AUDIT_OUTCOMES = ["success", "failure"] as const;
export type AuditOutcome = (typeof AUDIT_OUTCOMES)[number];

export const AUDIT_CATEGORIES = [
  "auth",
  "profile",
  "integration",
  "admin",
  "security",
  "privacy",
] as const;
export type AuditCategory = (typeof AUDIT_CATEGORIES)[number];

export const AUTH_PROVIDER_CLERK = "clerk" as const;

export interface IAuditLog extends Document {
  actorUserId: string;
  targetUserId?: string;
  action: string;
  category: AuditCategory;
  outcome: AuditOutcome;
  authProvider: typeof AUTH_PROVIDER_CLERK;
  role?: string;
  ip?: string;
  userAgent?: string;
  requestId?: string;
  traceId?: string;
  spanId?: string;
  metadata?: Record<string, unknown>;
  createdAt: Date;
}

const AuditLogSchema = new Schema<IAuditLog>(
  {
    actorUserId: { type: String, required: true, index: true },
    targetUserId: { type: String, index: true },
    action: { type: String, required: true, index: true },
    category: { type: String, required: true, enum: AUDIT_CATEGORIES, index: true },
    outcome: { type: String, required: true, enum: AUDIT_OUTCOMES, index: true },
    authProvider: { type: String, required: true, default: AUTH_PROVIDER_CLERK },
    role: { type: String, index: true },
    ip: { type: String },
    userAgent: { type: String },
    requestId: { type: String },
    traceId: { type: String, index: true },
    spanId: { type: String },
    metadata: { type: Schema.Types.Mixed },
  },
  { timestamps: true },
);

AuditLogSchema.index({ createdAt: -1 });
AuditLogSchema.index({ actorUserId: 1, createdAt: -1 });
AuditLogSchema.index({ category: 1, createdAt: -1 });
// Én indeks på requestId (sparse). Ikke index: true på feltet for å unngå duplikat med schema.index().
AuditLogSchema.index({ requestId: 1 }, { sparse: true });

AuditLogSchema.index({ createdAt: 1 }, { expireAfterSeconds: 63072000 });

export const AuditLog = mongoose.model<IAuditLog>("AuditLog", AuditLogSchema);
