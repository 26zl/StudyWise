/**
 * notionSettings.ts - Notion integration settings
 * GET/PUT /notion - Get/save Notion API settings for current user.
 */
import { Router } from "express";
import { z } from "zod";
import { decrypt, encrypt } from "../../utils/kryptering.js";
import { logger } from "../../utils/logger.js";
import { apiError, sendZodError, sendUnknownError } from "../../utils/apiError.js";
import { audit, AUDIT_ACTIONS } from "../../utils/auditLog.js";
import { User } from "../../database/models/User.js";
import { rateLimitToken } from "../../middleware/rate-limit.js";
import { normalizeNotionPageId } from "../../services/export/notion-id.js";

const router = Router();

/** Request schema for saving Notion settings. */
const NotionSettingsRequestSchema = z.object({
    apiKey: z.string().min(1, "API-nøkkel er påkrevd").optional(),
    defaultPageId: z.string().optional(),
    clearApiKey: z.boolean().optional(), // If true, delete existing API key
});

/** Response schema. */
const NotionSettingsResponseSchema = z.object({
    melding: z.string(),
    hasApiKey: z.boolean(),
    defaultPageId: z.string().nullable(),
});

/**
 * GET /notion - Check if user has Notion API key and get default page ID.
 */
router.get("/notion", async (req, res) => {
    try {
        const userId = req.user?.id;
        if (!userId) {
            return apiError.unauthorized(res);
        }

        const bruker = await User.findById(userId).select("+notionApiKey");
        if (!bruker) {
            return apiError.notFound(res, "Bruker");
        }

        let hasApiKey = false;
        if (bruker.notionApiKey) {
            try {
                decrypt(bruker.notionApiKey);
                hasApiKey = true;
            } catch {
                hasApiKey = false;
            }
        }

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
 * PUT /notion - Save or update Notion settings.
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

        const bruker = await User.findById(userId).select("+notionApiKey");
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

        // Handle API key
        if (clearApiKey) {
            // Clear existing key (applies atomically below)
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
            // Encrypt and save new key
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

        // Handle default page ID
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
            await User.findByIdAndUpdate(userId, updateOps);
        }

        // Fetch updated user to return current state
        const oppdatertBruker = await User.findById(userId).select("+notionApiKey");
        let hasApiKey = false;
        if (oppdatertBruker?.notionApiKey) {
            try {
                decrypt(oppdatertBruker.notionApiKey);
                hasApiKey = true;
            } catch {
                hasApiKey = false;
            }
        }

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
 * DELETE /notion - Remove Notion API key.
 */
router.delete("/notion", rateLimitToken, async (req, res) => {
    try {
        const userId = req.user?.id;
        if (!userId) {
            return apiError.unauthorized(res);
        }

        const bruker = await User.findById(userId).select("+notionApiKey");
        if (!bruker) {
            return apiError.notFound(res, "Bruker");
        }

        if (!bruker.notionApiKey) {
            return apiError.badRequest(res, "Ingen Notion API-nøkkel å slette");
        }

        await User.findByIdAndUpdate(userId, {
            $unset: { notionApiKey: 1, notionDefaultPageId: 1 },
        });

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
