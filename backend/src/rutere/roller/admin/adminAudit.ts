/**
 * Kun admin-ruter. Må monteres etter requireAuth og requireRole("admin").
 * Revisjonsliste returnerer formet liste (uten IP, userAgent, full metadata) for minimalt nødvendig innsyn.
 */
import type { Request } from "express";
import { Router } from "express";
import { AuditLog } from "../../../database/models/AuditLog.js";
import { apiError } from "../../../utils/apiError.js";
import { audit, AUDIT_ACTIONS } from "../../../utils/auditLog.js";
import { logger } from "../../../utils/logger.js";
import type { AuditCategory } from "../../../database/models/AuditLog.js";
import { AUDIT_CATEGORIES } from "../../../database/models/AuditLog.js";

const router = Router();
const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;
const MAX_OFFSET = 10_000;
const VALID_CATEGORIES = new Set<string>(AUDIT_CATEGORIES);

/** Trygge nøkler tillatt i revisjonsliste-metadata (ingen PII eller rå request-data). */
const ALLOWED_METADATA_KEYS = new Set([
  "subAction", "messageCount", "limit", "offset", "category", "reason",
  "shareType", "chatId",
]);

function shapeAuditItem(raw: {
  _id: unknown;
  actorUserId: string;
  targetUserId?: string;
  action: string;
  category: string;
  outcome: string;
  role?: string;
  metadata?: Record<string, unknown>;
  createdAt: Date;
}): Record<string, unknown> {
  const meta = raw.metadata;
  const safeMeta =
    meta && typeof meta === "object"
      ? Object.fromEntries(
          Object.entries(meta).filter(([k]) => ALLOWED_METADATA_KEYS.has(k)),
        )
      : undefined;
  return {
    id: raw._id,
    action: raw.action,
    category: raw.category,
    outcome: raw.outcome,
    actorUserId: raw.actorUserId,
    targetUserId: raw.targetUserId,
    role: raw.role,
    metadata: Object.keys(safeMeta ?? {}).length > 0 ? safeMeta : undefined,
    createdAt: raw.createdAt,
  };
}

/**
 * GET /api/admin/audit
 * Lister nylige revisjonslogg-poster. Kun admin.
 * Query: limit (default 50, max 200), offset (default 0), category (valgfri)
 */
router.get("/audit", async (req, res) => {
  const requestId = (req as Request & { id?: string }).id;
  const actorUserId = req.user?.id;
  if (!actorUserId) {
    return apiError.unauthorized(res);
  }

  const limit = Math.min(
    Math.max(0, parseInt(String(req.query.limit), 10) || DEFAULT_LIMIT),
    MAX_LIMIT,
  );
  const offset = Math.min(Math.max(0, parseInt(String(req.query.offset), 10) || 0), MAX_OFFSET);
  const rawCategory = typeof req.query.category === "string" ? req.query.category : undefined;
  const category: AuditCategory | undefined =
    rawCategory && VALID_CATEGORIES.has(rawCategory) ? (rawCategory as AuditCategory) : undefined;

  try {
    const filter = category ? { category } : {};
    const [items, total] = await Promise.all([
      AuditLog.find(filter).sort({ createdAt: -1 }).skip(offset).limit(limit).lean(),
      AuditLog.countDocuments(filter),
    ]);

    await audit({
      actorUserId,
      action: AUDIT_ACTIONS.ADMIN_ACTION,
      category: "admin",
      outcome: "success",
      role: req.actorRole,
      metadata: { subAction: "audit.list", limit, offset, category: category ?? null },
      req,
    });

    return res.json({
      items: items.map((item) => shapeAuditItem(item as Parameters<typeof shapeAuditItem>[0])),
      total,
      limit,
      offset,
    });
  } catch (err) {
    logger.error({ err, requestId }, "Admin audit list failed");
    return apiError.serverError(res);
  }
});

export default router;
