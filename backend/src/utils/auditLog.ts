/**
 * Sentralisert revisjonslogging: skriver til MongoDB AuditLog og valgfritt til app-logger
 * for korrelasjon. Aldri logg hemmeligheter, tokens eller rå PII i metadata.
 */
import type { Request } from "express";
import { AuditLog, type AuditCategory, type AuditOutcome, AUTH_PROVIDER_CLERK } from "../database/models/AuditLog.js";

export type AuditPayload = {
  actorUserId: string;
  targetUserId?: string;
  action: string;
  category: AuditCategory;
  outcome: AuditOutcome;
  role?: string;
  metadata?: Record<string, unknown>;
  req?: Request;
};

/** Handlinger brukt i revisjonslogger (konsekvent navngiving). */
export const AUDIT_ACTIONS = {
  SIGN_OUT: "sign_out",
  USER_CREATED: "user_created",
  ACCESS_DENIED: "access_denied",
  SHARE_CREATED: "share_created",
  SHARE_VIEWED: "share_viewed",
  SHARE_EXPIRED: "share_expired",
  INVALID_SHARE_ACCESS: "invalid_share_access",
  SHARE_REMOVED: "share_removed",
  CANVAS_TOKEN_CREATED: "canvas_token_created",
  CANVAS_TOKEN_UPDATED: "canvas_token_updated",
  CANVAS_TOKEN_DELETED: "canvas_token_deleted",
  TOKEN_VERIFICATION_FAILURE: "token_verification_failure",
  ADMIN_ACTION: "admin_action",
  ACCOUNT_DELETED: "account_deleted",
  PREFERENCES_UPDATED: "preferences_updated",
  ACCOUNT_RELINKED: "account_relinked",
  SECURITY_ALERT: "security_alert",
  CSRF_VIOLATION: "csrf_violation",
  RATE_LIMIT_EXCEEDED: "rate_limit_exceeded",
} as const;

export function getDeletedAuditActorId(userId: string): string {
  return `deleted:${userId}`;
}

function getRequestContext(req?: Request): { ip?: string; userAgent?: string; requestId?: string; traceId?: string; spanId?: string } {
  if (!req) return {};
  const span = (req as Request & { _dd?: { span_id?: string; trace_id?: string } })._dd;
  return {
    ip: req.ip ?? req.socket?.remoteAddress,
    userAgent: req.get("user-agent"),
    requestId: (req as Request & { id?: string }).id,
    traceId: span?.trace_id,
    spanId: span?.span_id,
  };
}

export async function audit(payload: AuditPayload): Promise<void> {
  const { actorUserId, targetUserId, action, category, outcome, role, metadata, req } = payload;
  const ctx = getRequestContext(req);
  try {
    const doc = await AuditLog.create({
      actorUserId,
      targetUserId,
      action,
      category,
      outcome,
      authProvider: AUTH_PROVIDER_CLERK,
      role,
      ip: ctx.ip,
      userAgent: ctx.userAgent,
      requestId: ctx.requestId,
      traceId: ctx.traceId,
      spanId: ctx.spanId,
      metadata: metadata ? sanitizeMetadata(metadata) : undefined,
    });
    const logger = (await import("./logger.js")).logger;
    logger.info(
      {
        requestId: ctx.requestId,
        traceId: ctx.traceId,
        spanId: ctx.spanId,
        auditId: doc._id.toString(),
        action,
        category,
        outcome,
        actorUserId,
        role,
      },
      `audit.${category}.${action}`,
    );
  } catch (err) {
    const logger = (await import("./logger.js")).logger;
    logger.warn({ err, action, category }, "Audit log write failed");
  }
}

export async function anonymizeAuditTrailForDeletedUser(userId: string): Promise<void> {
  const anonymizedActorId = getDeletedAuditActorId(userId);
  await Promise.all([
    AuditLog.updateMany(
      { actorUserId: userId },
      { $set: { actorUserId: anonymizedActorId } },
    ),
    AuditLog.updateMany(
      { targetUserId: userId },
      { $set: { targetUserId: anonymizedActorId } },
    ),
  ]);
}

function sanitizeMetadata(meta: Record<string, unknown>): Record<string, unknown> {
  const sanitized = sanitizeUnknownValue(meta, 0);
  return isPlainObject(sanitized) ? sanitized : {};
}

const MAX_METADATA_DEPTH = 4;
const MAX_METADATA_ARRAY_LENGTH = 20;
const MAX_METADATA_STRING_LENGTH = 500;
const REDACTED_METADATA_VALUE = "[redacted]";
const TRUNCATED_METADATA_VALUE = "[truncated]";

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isSensitiveMetadataKey(key: string): boolean {
  const normalized = key.toLowerCase().replace(/[^a-z0-9]/g, "");
  const exactMatches = new Set([
    "password",
    "passord",
    "secret",
    "cookie",
    "authorization",
    "email",
    "firstname",
    "lastname",
    "fullname",
    "phone",
    "studentnumber",
    "studentid",
    "token",
    "accesstoken",
    "refreshtoken",
    "idtoken",
    "apitoken",
    "canvasapitoken",
    "canvasapikey",
    "apikey",
    "sessiontoken",
    "sessionid",
    "jwt",
    "bearer",
  ]);

  if (exactMatches.has(normalized)) {
    return true;
  }

  return (
    normalized.endsWith("token") ||
    normalized.endsWith("secret") ||
    normalized.endsWith("cookie") ||
    normalized.endsWith("authorization") ||
    normalized.endsWith("apikey") ||
    normalized.endsWith("email") ||
    normalized.endsWith("phone")
  );
}

function sanitizeUnknownValue(
  value: unknown,
  depth: number,
  keyName?: string,
): unknown {
  if (keyName && isSensitiveMetadataKey(keyName)) {
    return REDACTED_METADATA_VALUE;
  }

  if (value == null) {
    return value;
  }

  if (depth >= MAX_METADATA_DEPTH) {
    return TRUNCATED_METADATA_VALUE;
  }

  if (typeof value === "string") {
    return value.length > MAX_METADATA_STRING_LENGTH
      ? `${value.slice(0, MAX_METADATA_STRING_LENGTH)}...${TRUNCATED_METADATA_VALUE}`
      : value;
  }

  if (typeof value === "number" || typeof value === "boolean") {
    return value;
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  if (value instanceof Error) {
    return {
      name: value.name,
      message:
        value.message.length > MAX_METADATA_STRING_LENGTH
          ? `${value.message.slice(0, MAX_METADATA_STRING_LENGTH)}...${TRUNCATED_METADATA_VALUE}`
          : value.message,
    };
  }

  if (Array.isArray(value)) {
    return value
      .slice(0, MAX_METADATA_ARRAY_LENGTH)
      .map((item) => sanitizeUnknownValue(item, depth + 1))
      .filter((item) => item !== undefined);
  }

  if (isPlainObject(value)) {
    const out: Record<string, unknown> = {};
    for (const [childKey, childValue] of Object.entries(value)) {
      const sanitizedChild = sanitizeUnknownValue(
        childValue,
        depth + 1,
        childKey,
      );
      if (sanitizedChild !== undefined) {
        out[childKey] = sanitizedChild;
      }
    }
    return out;
  }

  return String(value);
}
