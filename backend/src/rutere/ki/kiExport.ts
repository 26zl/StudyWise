/**
 * KI eksport-ruter.
 *
 * Gir endepunkter for å eksportere KI-generert innhold til ulike formater:
 * markdown, pdf, word, text, notion.
 *
 * POST /export         — Eksporter innhold til valgt mål
 * GET  /export/targets — List tilgjengelige eksportmål med konfigurasjonsstatus
 */

import { Router } from "express";
import { ExportRequestSchema, ExportResponseSchema, ExportTargetsResponseSchema } from "common/export";
import {
  executeExport,
  getAvailableTargets,
} from "../../services/export/export-service.js";
import type { RuntimeProviderOptions } from "../../services/export/export-types.js";
import { User } from "../../database/models/User.js";
import { decrypt, erGyldigKryptert } from "../../utils/kryptering.js";
import {
  apiError,
  requireUserId,
  sendZodError,
  sendUnknownError,
} from "../../utils/apiError.js";
import { logger } from "../../utils/logger.js";
import { createRateLimiter } from "../../middleware/rate-limit.js";

export const kiExportRouter = Router();

const exportRateLimit = createRateLimiter({
  points: 20,
  duration: 60,
  keyPrefix: "rlflx:ki-export",
});

/**
 * GET /export/targets
 * Returnerer liste over støttede eksportmål og om de er konfigurert.
 */
kiExportRouter.get("/export/targets", async (req, res) => {
  const userId = requireUserId(req, res);
  if (!userId) return;

  const bruker = await User.findOne({ _id: userId, deletedAt: { $exists: false } }).select("+notionApiKey");
  const notionConfigured = erGyldigKryptert(bruker?.notionApiKey);
  const targets = getAvailableTargets().map((targetInfo) =>
    targetInfo.target === "notion"
      ? { ...targetInfo, configured: notionConfigured }
      : targetInfo,
  );
  return res.json(ExportTargetsResponseSchema.parse({ targets }));
});

/**
 * POST /export
 * Eksporterer innhold til valgt mål.
 *
 * Body: { target, title, content, metadata?, options? }
 *
 * For serialiserbare mål (markdown/pdf/word/text):
 *   → { kind: "serialized", data: { target, content, mimeType, filename? } }
 *
 * For eksterne mål (notion):
 *   → { kind: "external", data: { target, resourceId, url?, title } }
 */
kiExportRouter.post("/export", exportRateLimit, async (req, res) => {
  try {
    const userId = requireUserId(req, res);
    if (!userId) return;

    const parseResult = ExportRequestSchema.safeParse(req.body);
    if (!parseResult.success) {
      return sendZodError(res, parseResult.error, "eksport");
    }

    const { target, title, content, metadata, options } = parseResult.data;
    let runtimeOptions: RuntimeProviderOptions | undefined = options;

    if (target === "notion") {
      const bruker = await User.findOne({ _id: userId, deletedAt: { $exists: false } }).select("+notionApiKey");
      if (!bruker?.notionApiKey) {
        return apiError.badRequest(
          res,
          "Notion-eksport er ikke konfigurert. Legg inn Notion API-nøkkel i innstillinger.",
        );
      }

      let decryptedNotionApiKey: string;
      try {
        decryptedNotionApiKey = decrypt(bruker.notionApiKey);
      } catch {
        return apiError.serviceUnavailable(
          res,
          "Notion-innstillinger er ugyldige. Lagre Notion API-nøkkel på nytt i innstillinger.",
        );
      }

      runtimeOptions = {
        ...options,
        notion: {
          ...options?.notion,
          apiKey: decryptedNotionApiKey,
          defaultPageId: bruker.notionDefaultPageId,
        },
      };
    }

    const result = await executeExport({
      target,
      title,
      content,
      metadata,
      options: runtimeOptions,
    });

    logger.info({ userId, target }, "Bruker eksporterte innhold");

    // Valider respons mot skjema før sending
    return res.json(ExportResponseSchema.parse(result));
  } catch (error) {
    // Håndter kjente konfigurasjonsfeil med 400/503
    if (error instanceof Error) {
      const normalizedErrorMessage = error.message.toLowerCase();
      // Logg detaljert feil server-side, send generisk melding til klient
      logger.warn({ err: error, target: req.body?.target }, "Eksportfeil");
      if (normalizedErrorMessage.includes("notion")) {
        return apiError.badRequest(res, "Kunne ikke eksportere til Notion. Sjekk innstillingene og prøv igjen.");
      }
      if (normalizedErrorMessage.includes("ikke konfigurert")) {
        return apiError.serviceUnavailable(res, "Eksporttjenesten");
      }
      if (normalizedErrorMessage.includes("påkrevd")) {
        return apiError.badRequest(res, "Manglende påkrevde felter for eksport.");
      }
    }

    return sendUnknownError(res, error, {
      kontekst: "POST ki export",
      melding: "Kunne ikke eksportere innholdet. Prøv igjen.",
    });
  }
});
