/**
 * Kun admin-ruter. Må monteres etter requireAuth og requireRole("admin").
 * Revisjonsliste returnerer formet liste (uten IP, userAgent, full metadata) for minimalt nødvendig innsyn.
 */
import type { Request } from "express";
import { Router } from "express";
import { AdminAuditItemSchema, AdminAuditQuerySchema, AdminAuditResponseSchema } from "common/admin";
import { AuditLog } from "../../database/models/AuditLog.js";
import { apiError, sendZodError } from "../../utils/apiError.js";
import { audit, AUDIT_ACTIONS } from "../../utils/auditLog.js";
import { logger } from "../../utils/logger.js";
import type { AuditCategory } from "../../database/models/AuditLog.js";
import { AUDIT_CATEGORIES } from "../../database/models/AuditLog.js";

const router = Router();
const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;
const MAX_OFFSET = 10_000;
const VALID_CATEGORIES = new Set<string>(AUDIT_CATEGORIES);

/** Trygge nøkler tillatt i revisjonsliste-metadata (ingen PII eller rå request-data). */
const ALLOWED_METADATA_KEYS = new Set([
  "subAction", "messageCount", "limit", "offset", "category", "reason",
  "shareType", "chatId", "model", "tokens", "fileType", "type",
  "tekstLengde", "assignmentId", "subtaskCount", "blockCount", "assignmentCount",
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
}) {
  const meta = raw.metadata;
  const safeMeta =
    meta && typeof meta === "object"
      ? Object.fromEntries(
          Object.entries(meta).filter(([k]) => ALLOWED_METADATA_KEYS.has(k)),
        )
      : undefined;
  return AdminAuditItemSchema.parse({
    id: String(raw._id),
    action: raw.action,
    category: raw.category,
    outcome: raw.outcome,
    actorUserId: raw.actorUserId,
    targetUserId: raw.targetUserId,
    role: raw.role,
    metadata: Object.keys(safeMeta ?? {}).length > 0 ? safeMeta : undefined,
    createdAt: raw.createdAt,
  });
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

  const parsedQuery = AdminAuditQuerySchema.safeParse(req.query);
  if (!parsedQuery.success) {
    return sendZodError(res, parsedQuery.error, "adminAudit.query");
  }

  const limit = Math.min(
    Math.max(1, parseInt(parsedQuery.data.limit ?? String(DEFAULT_LIMIT), 10) || DEFAULT_LIMIT),
    MAX_LIMIT,
  );
  const offset = Math.min(
    Math.max(0, parseInt(parsedQuery.data.offset ?? "0", 10) || 0),
    MAX_OFFSET,
  );
  const rawCategory = parsedQuery.data.category;
  const category: AuditCategory | undefined =
    rawCategory && VALID_CATEGORIES.has(rawCategory) ? (rawCategory as AuditCategory) : undefined;
  const outcome = parsedQuery.data.outcome;
  const targetUserId = parsedQuery.data.targetUserId;
  const actorUserIdFilter = parsedQuery.data.actorUserId;

  try {
    const filter: Record<string, unknown> = {};
    if (category) filter.category = category;
    if (outcome) filter.outcome = outcome;
    if (targetUserId) filter.targetUserId = targetUserId;
    if (actorUserIdFilter) filter.actorUserId = actorUserIdFilter;
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
      metadata: {
        subAction: "audit.list",
        limit,
        offset,
        category: category ?? null,
        outcome: outcome ?? null,
        targetUserId: targetUserId ?? null,
      },
      req,
    });

    return res.json(
      AdminAuditResponseSchema.parse({
      items: items.map((item) => shapeAuditItem(item as Parameters<typeof shapeAuditItem>[0])),
      total,
      limit,
      offset,
      }),
    );
  } catch (err) {
    logger.error({ err, requestId }, "Admin audit list failed");
    return apiError.serverError(res);
  }
});

/**
 * GET /api/admin/audit/export.csv
 * Eksporterer audit-logg som CSV. Støtter samme filtre som /audit pluss
 * `from`/`to` ISO-datoer for å begrense tidsvindu (default: siste 90 dager).
 * Maks 10 000 rader per eksport for å unngå minneblåsing.
 */
router.get("/audit/export.csv", async (req, res) => {
  const actorUserId = req.user?.id;
  if (!actorUserId) {
    return apiError.unauthorized(res);
  }

  const rawCategory = typeof req.query.category === "string" ? req.query.category : undefined;
  const category: AuditCategory | undefined =
    rawCategory && VALID_CATEGORIES.has(rawCategory) ? (rawCategory as AuditCategory) : undefined;
  const fromRaw = typeof req.query.from === "string" ? req.query.from : undefined;
  const toRaw = typeof req.query.to === "string" ? req.query.to : undefined;
  const targetUserIdRaw =
    typeof req.query.targetUserId === "string" ? req.query.targetUserId.trim() : undefined;

  const fromDate = fromRaw ? new Date(fromRaw) : new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
  const toDate = toRaw ? new Date(toRaw) : new Date();
  if (Number.isNaN(fromDate.getTime()) || Number.isNaN(toDate.getTime())) {
    return apiError.badRequest(res, "Ugyldig from/to-dato — bruk ISO-format");
  }

  const filter: Record<string, unknown> = {
    createdAt: { $gte: fromDate, $lte: toDate },
  };
  if (category) filter.category = category;
  if (targetUserIdRaw && targetUserIdRaw.length > 0) filter.targetUserId = targetUserIdRaw;

  const MAX_EXPORT_ROWS = 10_000;

  try {
    const rows = await AuditLog.find(filter)
      .sort({ createdAt: -1 })
      .limit(MAX_EXPORT_ROWS)
      .lean();

    // CSV-escape: quote felt med komma, quote eller newline; escape quotes ved å doble dem
    const csvEscape = (value: unknown): string => {
      if (value == null) return "";
      const s = typeof value === "string" ? value : JSON.stringify(value);
      if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
      return s;
    };

    const header = [
      "id",
      "createdAt",
      "category",
      "action",
      "outcome",
      "actorUserId",
      "targetUserId",
      "role",
      "metadata",
    ].join(",");

    const lines = [header];
    for (const row of rows) {
      const r = row as Parameters<typeof shapeAuditItem>[0];
      // Sanitiser metadata gjennom samme allowlist som /audit-listen
      const meta = r.metadata;
      const safeMeta =
        meta && typeof meta === "object"
          ? Object.fromEntries(
              Object.entries(meta).filter(([k]) => ALLOWED_METADATA_KEYS.has(k)),
            )
          : undefined;
      lines.push(
        [
          csvEscape(String(r._id)),
          csvEscape(r.createdAt.toISOString()),
          csvEscape(r.category),
          csvEscape(r.action),
          csvEscape(r.outcome),
          csvEscape(r.actorUserId),
          csvEscape(r.targetUserId),
          csvEscape(r.role),
          csvEscape(safeMeta && Object.keys(safeMeta).length > 0 ? safeMeta : undefined),
        ].join(","),
      );
    }

    await audit({
      actorUserId,
      action: AUDIT_ACTIONS.ADMIN_ACTION,
      category: "admin",
      outcome: "success",
      role: req.actorRole,
      metadata: {
        subAction: "audit.export",
        category: category ?? null,
        rowCount: rows.length,
      },
      req,
    });

    const filename = `audit-${fromDate.toISOString().slice(0, 10)}-${toDate.toISOString().slice(0, 10)}.csv`;
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.setHeader("Cache-Control", "no-store");
    return res.send(lines.join("\n"));
  } catch (err) {
    logger.error({ err }, "Admin audit CSV export failed");
    return apiError.serverError(res);
  }
});

export default router;
