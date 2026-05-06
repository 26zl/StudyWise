/**
 * Admin: Live-tail logger (backend + frontend)
 * Monteres under /api/admin (allerede beskyttet med requireAuth + requireRole("admin")).
 *
 * Endepunkter:
 *   GET  /logs/recent     – Returner siste N rader fra Redis Stream
 *   POST /logs/frontend   – Mottar frontend-logg-rader (console.error, window.onerror)
 *                          fra admin-brukere så de kan ses i samme fane.
 *
 * Frontend poller /logs/recent med sinceId-cursor i stedet for SSE — EventSource
 * kan ikke sende Bearer-token, og bufferet ligger nå uansett i Redis så polling
 * ser begge dynos sine logger.
 */
import { Router } from "express";
import { z } from "zod";
import { logBuffer } from "../../utils/logBuffer.js";
import { requireUserId, sendZodError } from "../../utils/apiError.js";
import { audit, AUDIT_ACTIONS } from "../../utils/auditLog.js";
import { logger } from "../../utils/logger.js";

const router = Router();

const LogLevelSchema = z.enum(["fatal", "error", "warn", "info", "debug", "trace"]);
const LogSourceSchema = z.enum(["backend", "frontend"]);

const LogQuerySchema = z.object({
  limit: z.string().regex(/^\d+$/).max(4).optional(),
  source: LogSourceSchema.optional(),
  minLevel: LogLevelSchema.optional(),
  // Redis Stream-ID-format: `<ms>-<seq>`
  sinceId: z.string().regex(/^\d+-\d+$/).max(40).optional(),
});

const FrontendLogPayloadSchema = z.object({
  level: LogLevelSchema,
  msg: z.string().trim().min(1).max(2_000),
  context: z
    .record(z.string(), z.unknown())
    .optional()
    .refine(
      (ctx) => !ctx || JSON.stringify(ctx).length <= 4_000,
      "context er for stor",
    ),
});

const FrontendLogBatchSchema = z.object({
  entries: z.array(FrontendLogPayloadSchema).min(1).max(50),
});

// GET /logs/recent
router.get("/logs/recent", async (req, res) => {
  const actorUserId = requireUserId(req, res);
  if (!actorUserId) return;

  const parsed = LogQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    return sendZodError(res, parsed.error, "logs.recent");
  }

  const limit = parsed.data.limit ? Number(parsed.data.limit) : 200;
  const entries = await logBuffer.recent({
    limit,
    source: parsed.data.source,
    minLevel: parsed.data.minLevel,
    sinceId: parsed.data.sinceId,
  });

  const bufferSize = await logBuffer.size();

  void audit({
    actorUserId,
    action: AUDIT_ACTIONS.ADMIN_ACTION,
    category: "admin",
    outcome: "success",
    role: req.actorRole,
    metadata: { subAction: "logs.recent", resultCount: entries.length },
    req,
  });

  return res.json({ entries, bufferSize });
});

// POST /logs/frontend
// Tar imot frontend-feil-rapporter fra admin-bruker sin nettleser slik at de
// dukker opp i samme buffer som backend-logger.
router.post("/logs/frontend", async (req, res) => {
  const actorUserId = requireUserId(req, res);
  if (!actorUserId) return;

  const parsed = FrontendLogBatchSchema.safeParse(req.body);
  if (!parsed.success) {
    return sendZodError(res, parsed.error, "logs.frontend");
  }

  for (const entry of parsed.data.entries) {
    logBuffer.push({
      source: "frontend",
      level: entry.level,
      msg: entry.msg,
      context: {
        ...(entry.context ?? {}),
        // Tag med admin-bruker-ID for å spore hvilken admin-økt logg-raden kom fra
        adminUserId: actorUserId,
      },
    });
  }

  return res.json({ accepted: parsed.data.entries.length });
});

// Buffer-stats endepunkt for debug
router.get("/logs/info", async (_req, res) => {
  return res.json({
    bufferSize: await logBuffer.size(),
    capacity: 500,
  });
});

// Bevisst no-op import for å sikre at logger.ts (og dermed hooks) er lastet
// før første kall til /logs/* — uten dette ville en helt fersk prosess kunne
// vise et tomt buffer fordi ingen kall til logger har skjedd ennå.
void logger;

export default router;
