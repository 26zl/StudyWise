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

export const adminAnnouncementRouter = Router();

function serialize(doc: {
  active: boolean;
  severity: "info" | "warning" | "critical";
  melding: string;
  dismissible: boolean;
  updatedAt: Date;
}) {
  return {
    active: doc.active,
    severity: doc.severity,
    melding: doc.melding,
    oppdatertAt: doc.updatedAt.toISOString(),
    dismissible: doc.dismissible,
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
          publishedBy: userId,
        },
        $setOnInsert: { singletonKey: "global" },
      },
      { new: true, upsert: true },
    );

    // Invalider public cache slik at alle brukere (på alle dyner) ser ny
    // tilstand umiddelbart uten å vente på 30s TTL-utløp.
    await invalidateAnnouncementCache();

    void audit({
      actorUserId: userId,
      action: AUDIT_ACTIONS.ADMIN_ANNOUNCEMENT_PUBLISHED,
      category: "admin",
      outcome: "success",
      req,
      metadata: { severity: parsed.data.severity, meldingLength: parsed.data.melding.length },
    });

    logger.info(
      { userId, severity: parsed.data.severity },
      "Admin publiserte systemmelding",
    );

    return res.json(serialize(updated));
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
      return apiError.notFound(res, "Systemmelding");
    }

    existing.active = false;
    await existing.save();

    // Invalider public cache (på tvers av alle dyner) så brukere umiddelbart
    // slutter å se banneret.
    await invalidateAnnouncementCache();

    void audit({
      actorUserId: userId,
      action: AUDIT_ACTIONS.ADMIN_ANNOUNCEMENT_CLEARED,
      category: "admin",
      outcome: "success",
      req,
    });

    logger.info({ userId }, "Admin deaktiverte systemmelding");

    return res.json(serialize(existing));
  } catch (err) {
    return sendUnknownError(res, err, { kontekst: "deaktiver systemmelding" });
  }
});
