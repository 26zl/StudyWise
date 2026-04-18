/**
 * Admin: global systemmelding (banner til alle innloggede brukere).
 * Monteres under /api/admin (allerede beskyttet med requireAuth + requireRole("admin")).
 *
 * Endepunkter:
 *   GET    /announcement         – Hent gjeldende melding (admin-visning)
 *   POST   /announcement         – Publiser/oppdater melding
 *   DELETE /announcement         – Deaktiver melding (skjuler banneret)
 */

import { Router } from "express";
import { PublishAnnouncementRequestSchema } from "common/system";
import { SystemAnnouncement } from "../../database/models/SystemAnnouncement.js";
import { apiError, requireUserId, sendZodError, sendUnknownError } from "../../utils/apiError.js";
import { audit, AUDIT_ACTIONS } from "../../utils/auditLog.js";
import { logger } from "../../utils/logger.js";
import { invalidateAnnouncementCache } from "../announcement.js";
import { invalidatePublicStatusCache } from "../publicStatus.js";

export const adminAnnouncementRouter = Router();

function serialize(doc: {
  active: boolean;
  severity: "info" | "warning" | "critical";
  melding: string;
  dismissible: boolean;
  showInBanner: boolean;
  showOnStatusPage: boolean;
  updatedAt: Date;
}) {
  return {
    active: doc.active,
    severity: doc.severity,
    melding: doc.melding,
    oppdatertAt: doc.updatedAt.toISOString(),
    dismissible: doc.dismissible,
    showInBanner: doc.showInBanner,
    showOnStatusPage: doc.showOnStatusPage,
  };
}

adminAnnouncementRouter.get("/announcement", async (_req, res) => {
  try {
    const existing = await SystemAnnouncement.findOne({ singletonKey: "global" }).lean();
    if (!existing) {
      return res.json({
        active: false,
        severity: "info" as const,
        melding: "",
        oppdatertAt: new Date(0).toISOString(),
        dismissible: true,
        showInBanner: true,
        showOnStatusPage: true,
      });
    }
    return res.json(serialize(existing));
  } catch (err) {
    return sendUnknownError(res, err, { kontekst: "hent systemmelding" });
  }
});

adminAnnouncementRouter.post("/announcement", async (req, res) => {
  const userId = requireUserId(req, res);
  if (!userId) return;

  const parsed = PublishAnnouncementRequestSchema.safeParse(req.body);
  if (!parsed.success) {
    return sendZodError(res, parsed.error, "Publiser systemmelding");
  }

  try {
    const updated = await SystemAnnouncement.findOneAndUpdate(
      { singletonKey: "global" },
      {
        $set: {
          active: true,
          severity: parsed.data.severity,
          melding: parsed.data.melding,
          dismissible: parsed.data.dismissible,
          showInBanner: parsed.data.showInBanner,
          showOnStatusPage: parsed.data.showOnStatusPage,
          publishedBy: userId,
        },
        $setOnInsert: { singletonKey: "global" },
      },
      { new: true, upsert: true },
    );

    // Invalider begge public cacher (banner + status-side) slik at alle
    // brukere på alle dyner ser ny tilstand umiddelbart uten å vente på TTL.
    // Hvis Redis er nede, vil andre dyner vise foreldet melding i opptil 30s
    // til neste cache-miss. Responsen inkluderer `cacheInvalidated` så admin
    // kan velge å re-publisere i så fall.
    const [bannerInv, statusInv] = await Promise.all([
      invalidateAnnouncementCache(),
      invalidatePublicStatusCache(),
    ]);
    const cacheInvalidated = bannerInv && statusInv;

    void audit({
      actorUserId: userId,
      action: AUDIT_ACTIONS.ADMIN_ANNOUNCEMENT_PUBLISHED,
      category: "admin",
      outcome: "success",
      req,
      metadata: {
        severity: parsed.data.severity,
        meldingLength: parsed.data.melding.length,
        cacheInvalidated,
      },
    });

    logger.info(
      { userId, severity: parsed.data.severity, cacheInvalidated },
      "Admin publiserte systemmelding",
    );

    return res.json({ ...serialize(updated), cacheInvalidated });
  } catch (err) {
    return sendUnknownError(res, err, { kontekst: "publiser systemmelding" });
  }
});

adminAnnouncementRouter.delete("/announcement", async (req, res) => {
  const userId = requireUserId(req, res);
  if (!userId) return;

  try {
    const existing = await SystemAnnouncement.findOne({ singletonKey: "global" });
    if (!existing) {
      // Logg forsøk også ved 404 — admin trykket deaktiver på en melding som
      // ikke finnes. Tett revisjonsspor selv i noop-tilfeller. Behandles som
      // "success" med noop-flagg for ikke å blande seg med ekte failures ved
      // filtrering av audit-logger på outcome=failure.
      void audit({
        actorUserId: userId,
        action: AUDIT_ACTIONS.ADMIN_ANNOUNCEMENT_CLEARED,
        category: "admin",
        outcome: "success",
        req,
        metadata: { noop: true, reason: "not_found" },
      });
      return apiError.notFound(res, "Systemmelding");
    }

    existing.active = false;
    await existing.save();

    // Invalider begge public cacher så brukere umiddelbart slutter å se både
    // banneret og meldingen på status-siden.
    const [bannerInv, statusInv] = await Promise.all([
      invalidateAnnouncementCache(),
      invalidatePublicStatusCache(),
    ]);
    const cacheInvalidated = bannerInv && statusInv;

    void audit({
      actorUserId: userId,
      action: AUDIT_ACTIONS.ADMIN_ANNOUNCEMENT_CLEARED,
      category: "admin",
      outcome: "success",
      req,
      metadata: { cacheInvalidated },
    });

    logger.info({ userId, cacheInvalidated }, "Admin deaktiverte systemmelding");

    return res.json({ ...serialize(existing), cacheInvalidated });
  } catch (err) {
    return sendUnknownError(res, err, { kontekst: "deaktiver systemmelding" });
  }
});
