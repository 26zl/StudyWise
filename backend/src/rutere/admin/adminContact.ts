/**
 * Admin: Kontakt-innboks
 * Monteres under /api/admin (allerede beskyttet med requireAuth + requireRole("admin")).
 *
 * Endepunkter:
 *   GET    /contact/messages          – Liste over kontaktmeldinger (paginert, status-filtrert)
 *   PATCH  /contact/messages/:id      – Endre status (unread/read/replied)
 *   DELETE /contact/messages/:id      – Slett kontaktmelding permanent
 */
import { Router } from "express";
import {
  AdminContactMessageListResponseSchema,
  AdminContactMessageQuerySchema,
  AdminContactMessageSchema,
  AdminContactMessageUpdateSchema,
} from "common/admin";
import { ContactMessage } from "../../database/models/ContactMessage.js";
import { requireRecentAuth } from "../../middleware/auth.js";
import { apiError, requireUserId, sendUnknownError, sendZodError } from "../../utils/apiError.js";
import { audit, AUDIT_ACTIONS } from "../../utils/auditLog.js";
import { logger } from "../../utils/logger.js";
import { sendKontaktSvar } from "../../services/contact.service.js";
import { isValidMongoObjectId } from "../../utils/mongoId.js";

const router = Router();
const DEFAULT_LIMIT = 25;
const MAX_LIMIT = 100;
const MAX_OFFSET = 10_000;

// ── GET /contact/messages ───────────────────────────────────────────────────
router.get("/contact/messages", async (req, res) => {
  const actorUserId = requireUserId(req, res);
  if (!actorUserId) return;

  const parsed = AdminContactMessageQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    return sendZodError(res, parsed.error, "contactMessages.query");
  }

  const limit = Math.min(
    Math.max(1, parseInt(parsed.data.limit ?? String(DEFAULT_LIMIT), 10) || DEFAULT_LIMIT),
    MAX_LIMIT,
  );
  const offset = Math.min(
    Math.max(0, parseInt(parsed.data.offset ?? "0", 10) || 0),
    MAX_OFFSET,
  );
  const status = parsed.data.status ?? "all";

  try {
    const filter: Record<string, unknown> = {};
    if (status !== "all") filter.status = status;

    const [items, total, unread] = await Promise.all([
      ContactMessage.find(filter)
        .sort({ createdAt: -1 })
        .skip(offset)
        .limit(limit)
        .lean(),
      ContactMessage.countDocuments(filter),
      ContactMessage.countDocuments({ status: "unread" }),
    ]);

    const meldinger = items.map((m) =>
      AdminContactMessageSchema.parse({
        id: String(m._id),
        navn: m.navn,
        epost: m.epost,
        emne: m.emne,
        melding: m.melding,
        sideUrl: m.sideUrl,
        requestId: m.requestId,
        attachmentCount: m.attachmentCount,
        attachmentSummary: m.attachmentSummary,
        status: m.status,
        statusChangedBy: m.statusChangedBy,
        statusChangedAt: m.statusChangedAt,
        createdAt: m.createdAt,
      }),
    );

    return res.json(
      AdminContactMessageListResponseSchema.parse({
        meldinger,
        total,
        unread,
        limit,
        offset,
      }),
    );
  } catch (err) {
    return sendUnknownError(res, err, { kontekst: "admin.contact.list" });
  }
});

// ── PATCH /contact/messages/:id ─────────────────────────────────────────────
router.patch("/contact/messages/:id", requireRecentAuth, async (req, res) => {
  const actorUserId = requireUserId(req, res);
  if (!actorUserId) return;

  const targetId = String(req.params.id);
  if (!isValidMongoObjectId(targetId)) {
    return apiError.badRequest(res, "Ugyldig melding-ID");
  }

  const parsed = AdminContactMessageUpdateSchema.safeParse(req.body);
  if (!parsed.success) {
    return sendZodError(res, parsed.error, "contactMessages.update");
  }

  try {
    const updated = await ContactMessage.findByIdAndUpdate(
      targetId,
      {
        $set: {
          status: parsed.data.status,
          statusChangedBy: actorUserId,
          statusChangedAt: new Date(),
        },
      },
      { new: true },
    ).lean();

    if (!updated) return apiError.notFound(res, "Kontaktmelding");

    void audit({
      actorUserId,
      action: AUDIT_ACTIONS.ADMIN_ACTION,
      category: "admin",
      outcome: "success",
      role: req.actorRole,
      metadata: { subAction: "contact.updateStatus", status: parsed.data.status },
      req,
    });

    return res.json(
      AdminContactMessageSchema.parse({
        id: String(updated._id),
        navn: updated.navn,
        epost: updated.epost,
        emne: updated.emne,
        melding: updated.melding,
        sideUrl: updated.sideUrl,
        requestId: updated.requestId,
        attachmentCount: updated.attachmentCount,
        attachmentSummary: updated.attachmentSummary,
        status: updated.status,
        statusChangedBy: updated.statusChangedBy,
        statusChangedAt: updated.statusChangedAt,
        createdAt: updated.createdAt,
      }),
    );
  } catch (err) {
    return sendUnknownError(res, err, { kontekst: "admin.contact.update" });
  }
});

// ── DELETE /contact/messages/:id ────────────────────────────────────────────
router.delete("/contact/messages/:id", requireRecentAuth, async (req, res) => {
  const actorUserId = requireUserId(req, res);
  if (!actorUserId) return;

  const targetId = String(req.params.id);
  if (!isValidMongoObjectId(targetId)) {
    return apiError.badRequest(res, "Ugyldig melding-ID");
  }

  try {
    const deleted = await ContactMessage.findByIdAndDelete(targetId).lean();
    if (!deleted) return apiError.notFound(res, "Kontaktmelding");

    void audit({
      actorUserId,
      action: AUDIT_ACTIONS.ADMIN_ACTION,
      category: "admin",
      outcome: "success",
      role: req.actorRole,
      metadata: { subAction: "contact.delete" },
      req,
    });

    logger.info(
      { adminUserId: actorUserId, messageId: targetId },
      "Admin slettet kontaktmelding",
    );

    return res.json({ success: true });
  } catch (err) {
    return sendUnknownError(res, err, { kontekst: "admin.contact.delete" });
  }
});

// ── POST /contact/messages/:id/reply ───────────────────────────────────────
router.post("/contact/messages/:id/reply", requireRecentAuth, async (req, res) => {
  const actorUserId = requireUserId(req, res);
  if (!actorUserId) return;

  const targetId = String(req.params.id);
  if (!isValidMongoObjectId(targetId)) {
    return apiError.badRequest(res, "Ugyldig melding-ID");
  }

  const body = req.body as { melding?: unknown };
  if (typeof body.melding !== "string" || body.melding.trim().length === 0) {
    return apiError.badRequest(res, "Svartekst er påkrevd");
  }
  if (body.melding.length > 10_000) {
    return apiError.badRequest(res, "Svartekst kan ikke overstige 10 000 tegn");
  }

  try {
    const original = await ContactMessage.findById(targetId).lean();
    if (!original) return apiError.notFound(res, "Kontaktmelding");

    const result = await sendKontaktSvar({
      toEmail: original.epost,
      toName: original.navn,
      subject: `Re: ${original.emne}`,
      body: body.melding.trim(),
      originalMessageId: targetId,
    });

    if (!result.success) {
      logger.error(
        { messageId: targetId, error: result.error },
        "Kunne ikke sende kontaktsvar",
      );
      void audit({
        actorUserId,
        action: AUDIT_ACTIONS.ADMIN_ACTION,
        category: "admin",
        outcome: "failure",
        role: req.actorRole,
        metadata: { subAction: "contact.reply", messageId: targetId },
        req,
      });
      return apiError.serverError(res);
    }

    // Oppdater status til "replied"
    await ContactMessage.findByIdAndUpdate(targetId, {
      $set: {
        status: "replied",
        statusChangedBy: actorUserId,
        statusChangedAt: new Date(),
      },
    });

    void audit({
      actorUserId,
      action: AUDIT_ACTIONS.ADMIN_ACTION,
      category: "admin",
      outcome: "success",
      role: req.actorRole,
      metadata: { subAction: "contact.reply", messageId: targetId },
      req,
    });

    logger.info(
      { adminUserId: actorUserId, messageId: targetId },
      "Admin sendte kontaktsvar",
    );

    return res.json({ success: true });
  } catch (err) {
    return sendUnknownError(res, err, { kontekst: "admin.contact.reply" });
  }
});

export default router;
