/**
 * Notion-integrasjonsinnstillinger.
 * GET/PUT /notion — hent/lagre Notion API-nøkkel og standard side-ID for innlogget bruker.
 */
import { Router } from "express";
import { NotionSettingsRequestSchema, NotionSettingsResponseSchema } from "common/export";
import { encrypt, decrypt, erGyldigKryptert } from "../../utils/kryptering.js";
import { logger } from "../../utils/logger.js";
import { apiError, sendZodError, sendUnknownError } from "../../utils/apiError.js";
import { audit, AUDIT_ACTIONS } from "../../utils/auditLog.js";
import { User } from "../../database/models/User.js";
import { rateLimitToken } from "../../middleware/rate-limit.js";
import { normalizeNotionPageId } from "../../services/export/notion-id.js";

const router = Router();

const NOTION_API_VERSION = "2022-06-28";

/**
 * Verifiserer en Notion API-nøkkel mot Notion API.
 * Returnerer null ved suksess, ellers en feilmelding.
 */
async function verifiserNotionApiKey(apiKey: string): Promise<string | null> {
  try {
    const response = await fetch("https://api.notion.com/v1/users/me", {
      method: "GET",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Notion-Version": NOTION_API_VERSION,
      },
      signal: AbortSignal.timeout(10_000),
    });

    if (response.ok) return null;

    if (response.status === 401) {
      return "Ugyldig Notion API-nøkkel. Sjekk at nøkkelen er korrekt og ikke utløpt.";
    }
    if (response.status === 403) {
      return "Notion API-nøkkelen mangler nødvendige tilganger. Sjekk integrasjonens rettigheter.";
    }

    logger.warn({ status: response.status }, "Uventet svar fra Notion API ved verifisering");
    return `Kunne ikke verifisere Notion API-nøkkelen (HTTP ${response.status}). Prøv igjen senere.`;
  } catch (error) {
    logger.warn({ error }, "Feil ved verifisering av Notion API-nøkkel");
    return "Kunne ikke kontakte Notion API for verifisering. Sjekk nettverket og prøv igjen.";
  }
}

/**
 * Verifiserer at en Notion side-ID er tilgjengelig med gitt API-nøkkel.
 * Returnerer null ved suksess, ellers en feilmelding.
 */
async function verifiserNotionPageId(apiKey: string, pageId: string): Promise<string | null> {
  try {
    const response = await fetch(`https://api.notion.com/v1/pages/${pageId}`, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Notion-Version": NOTION_API_VERSION,
      },
      signal: AbortSignal.timeout(10_000),
    });

    if (response.ok) return null;

    if (response.status === 404) {
      return "Notion-siden ble ikke funnet. Sjekk at side-ID er riktig og at siden er delt med integrasjonen din i Notion (Connections → legg til integrasjonen).";
    }
    if (response.status === 401) {
      return "Notion API-nøkkelen er ugyldig. Lagre en ny nøkkel først.";
    }

    logger.warn(
      { status: response.status, pageId },
      "Uventet svar fra Notion API ved verifisering av side-ID",
    );
    return `Kunne ikke verifisere Notion side-ID (HTTP ${response.status}). Prøv igjen senere.`;
  } catch (error) {
    logger.warn({ error, pageId }, "Feil ved verifisering av Notion side-ID");
    return "Kunne ikke kontakte Notion API for verifisering av side-ID. Sjekk nettverket og prøv igjen.";
  }
}

// Skjemaer importert fra common/export

/**
 * GET /notion — sjekk om bruker har Notion API-nøkkel og hent standard side-ID.
 */
router.get("/notion", async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return apiError.unauthorized(res);
    }

    const bruker = await User.findOne({ _id: userId, deletedAt: { $exists: false } }).select(
      "+notionApiKey",
    );
    if (!bruker) {
      return apiError.notFound(res, "Bruker");
    }

    const hasApiKey = erGyldigKryptert(bruker.notionApiKey);

    return res.json(
      NotionSettingsResponseSchema.parse({
        melding: hasApiKey ? "Notion er konfigurert" : "Notion er ikke konfigurert",
        hasApiKey,
        defaultPageId: bruker.notionDefaultPageId ?? null,
      }),
    );
  } catch (error) {
    return sendUnknownError(res, error, {
      kontekst: "hent-notion-innstillinger",
      melding: "Kunne ikke hente Notion-innstillinger.",
    });
  }
});

/**
 * PUT /notion — lagre eller oppdater Notion-innstillinger.
 */
router.put("/notion", rateLimitToken, async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return apiError.unauthorized(res);
    }

    const parseResult = NotionSettingsRequestSchema.safeParse(req.body);
    if (!parseResult.success) {
      return sendZodError(res, parseResult.error);
    }
    const { apiKey, defaultPageId, clearApiKey } = parseResult.data;

    const bruker = await User.findOne({ _id: userId, deletedAt: { $exists: false } }).select(
      "+notionApiKey",
    );
    if (!bruker) {
      return apiError.notFound(res, "Bruker");
    }

    const setFields: {
      notionApiKey?: string;
      notionDefaultPageId?: string;
    } = {};
    const unsetFields: {
      notionApiKey?: 1;
      notionDefaultPageId?: 1;
    } = {};

    // Håndter API-nøkkel
    if (clearApiKey) {
      // Fjern eksisterende nøkkel (appliseres atomisk lenger ned)
      unsetFields.notionApiKey = 1;
      logger.info({ userId }, "Notion API-nøkkel slettet");
      await audit({
        actorUserId: userId,
        action: AUDIT_ACTIONS.PREFERENCES_UPDATED,
        category: "profile",
        outcome: "success",
        role: req.actorRole,
        metadata: { field: "notionApiKey", action: "deleted" },
        req,
      });
    } else if (apiKey) {
      // Verifiser nøkkelen mot Notion API før lagring
      const verifikasjonsFeil = await verifiserNotionApiKey(apiKey.trim());
      if (verifikasjonsFeil) {
        return apiError.badRequest(res, verifikasjonsFeil);
      }

      // Krypter og lagre ny nøkkel
      const kryptertKey = encrypt(apiKey);
      setFields.notionApiKey = kryptertKey;
      logger.info({ userId }, "Notion API-nøkkel lagret");
      await audit({
        actorUserId: userId,
        action: AUDIT_ACTIONS.PREFERENCES_UPDATED,
        category: "profile",
        outcome: "success",
        role: req.actorRole,
        metadata: { field: "notionApiKey", action: "saved" },
        req,
      });
    }

    // Håndter standard side-ID
    if (defaultPageId !== undefined) {
      if (!defaultPageId.trim()) {
        unsetFields.notionDefaultPageId = 1;
      } else {
        const normalizedPageId = normalizeNotionPageId(defaultPageId);
        if (!normalizedPageId) {
          return apiError.badRequest(
            res,
            "Ugyldig Notion side-ID. Lim inn en gyldig side-ID eller Notion-lenke.",
          );
        }
        // Verifiser at siden er tilgjengelig med API-nøkkelen
        const klartekstApiKey =
          apiKey?.trim() ||
          (erGyldigKryptert(bruker.notionApiKey) ? decrypt(bruker.notionApiKey!) : null);
        if (klartekstApiKey) {
          const pageVerifikasjonsFeil = await verifiserNotionPageId(
            klartekstApiKey,
            normalizedPageId,
          );
          if (pageVerifikasjonsFeil) {
            return apiError.badRequest(res, pageVerifikasjonsFeil);
          }
        }

        setFields.notionDefaultPageId = normalizedPageId;
      }
    }

    // Atomisk oppdatering av Notion-felter for å unngå inkonsistent mellomtilstand.
    const updateOps: { $set?: typeof setFields; $unset?: typeof unsetFields } = {};
    if (Object.keys(setFields).length > 0) {
      updateOps.$set = setFields;
    }
    if (Object.keys(unsetFields).length > 0) {
      updateOps.$unset = unsetFields;
    }
    if (Object.keys(updateOps).length > 0) {
      await User.findOneAndUpdate({ _id: userId, deletedAt: { $exists: false } }, updateOps);
    }

    // Hent oppdatert bruker for å returnere gjeldende tilstand
    const oppdatertBruker = await User.findOne({
      _id: userId,
      deletedAt: { $exists: false },
    }).select("+notionApiKey");
    const hasApiKey = erGyldigKryptert(oppdatertBruker?.notionApiKey);

    return res.json(
      NotionSettingsResponseSchema.parse({
        melding: clearApiKey
          ? "Notion API-nøkkel slettet"
          : apiKey
            ? "Notion-innstillinger lagret"
            : "Innstillinger oppdatert",
        hasApiKey,
        defaultPageId: oppdatertBruker?.notionDefaultPageId ?? null,
      }),
    );
  } catch (error) {
    return sendUnknownError(res, error, {
      kontekst: "lagre-notion-innstillinger",
      melding: "Kunne ikke lagre Notion-innstillinger.",
    });
  }
});

/**
 * DELETE /notion — fjern Notion API-nøkkel.
 */
router.delete("/notion", rateLimitToken, async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return apiError.unauthorized(res);
    }

    const bruker = await User.findOne({ _id: userId, deletedAt: { $exists: false } }).select(
      "+notionApiKey",
    );
    if (!bruker) {
      return apiError.notFound(res, "Bruker");
    }

    if (!bruker.notionApiKey) {
      return apiError.badRequest(res, "Ingen Notion API-nøkkel å slette");
    }

    await User.findOneAndUpdate(
      { _id: userId, deletedAt: { $exists: false } },
      {
        $unset: { notionApiKey: 1, notionDefaultPageId: 1 },
      },
    );

    logger.info({ userId }, "Notion API-nøkkel og innstillinger slettet");
    await audit({
      actorUserId: userId,
      action: AUDIT_ACTIONS.PREFERENCES_UPDATED,
      category: "profile",
      outcome: "success",
      role: req.actorRole,
      metadata: { field: "notion", action: "deleted" },
      req,
    });

    return res.json(
      NotionSettingsResponseSchema.parse({
        melding: "Notion-tilkobling fjernet",
        hasApiKey: false,
        defaultPageId: null,
      }),
    );
  } catch (error) {
    return sendUnknownError(res, error, {
      kontekst: "slett-notion-innstillinger",
      melding: "Kunne ikke slette Notion-innstillinger.",
    });
  }
});

export { router as notionSettingsRouter };
