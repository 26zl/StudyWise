/*
 * Bruker-API: Clerk-only auth. Ruter er beskyttet av global requireAuth.
 * GET /me, PUT /preferences, POST/DELETE /token, POST /logout.
 */
import { Router, type Request, type Response } from "express";
import crypto from "crypto";
import { User, type IUser } from "../../database/models/User.js";
import { CanvasUser } from "../../database/models/CanvasUser.js";
import { decrypt, encrypt } from "../../utils/kryptering.js";
import { logger } from "../../utils/logger.js";
import { ZodError } from "zod";
import { apiError, sendError, sendZodError, sendUnknownError } from "../../utils/apiError.js";
import { warmCanvasCache, fetchUserProfile } from "../canvas/canvasService.js";
import { invalidateCacheByPattern } from "../../cache/redis.js";
import {
  clearUserCanvasRuntimeState,
  invalidateUserCanvasCache,
  triggerInitialSync,
} from "../../services/canvas-sync.service.js";
import {
  CanvasTokenRequestSchema,
  CanvasTokenResponseSchema,
  CanvasContextPreferencesSchema,
  PreferencesUpdateSchema,
  PreferencesResponseSchema,
  AccountDeletionResponseSchema,
  AuthBrukerSchema,
  MeResponseSchema,
  LogoutResponseSchema,
  createDefaultCanvasContextPreferences,
  createDefaultVarslerState,
  normalizeVarslerState,
} from "common/auth";
import { rateLimitToken, rateLimitMe, rateLimitAccountDeletion } from "../../middleware/rate-limit.js";
import { noCache } from "../../middleware/no-cache.js";
import {
  audit,
  AUDIT_ACTIONS,
  anonymizeAuditTrailForDeletedUser,
  getDeletedAuditActorId,
} from "../../utils/auditLog.js";
import { deleteAccountData } from "./kontoSlett.js";
import type { CanvasApiError } from "../canvas/canvasErrors.js";

const router = Router();
const SHA256_HEX_REGEX = /^[a-f0-9]{64}$/i;

// Ikke cache auth-responser i browser eller mellomlagring
router.use(noCache);

// Hash funksjon for tokens
const hashToken = (token: string) => {
    return crypto.createHash("sha256").update(token).digest("hex");
};

function isValidSha256Hex(value: string | null | undefined): value is string {
    return typeof value === "string" && SHA256_HEX_REGEX.test(value);
}

function timingSafeHexEqual(storedHash: string | null | undefined, candidateHash: string): boolean {
    // Sjekk gyldighet først, men gjør alltid timing-safe sammenligning for å unngå lekkasje
    const aValid = isValidSha256Hex(storedHash);
    const bValid = isValidSha256Hex(candidateHash);
    const a = aValid ? storedHash : "0".repeat(64);
    const b = bValid ? candidateHash : "1".repeat(64);

    const equal = crypto.timingSafeEqual(
        Buffer.from(a, "hex"),
        Buffer.from(b, "hex"),
    );
    return equal && aValid && bValid;
}

function handleCanvasVerificationError(res: Response, error: unknown) {
    const canvasError = error as Partial<CanvasApiError>;

    if (canvasError?.name === "CanvasApiError" && canvasError.code) {
        switch (canvasError.code) {
            case "token_invalid":
                return apiError.badRequest(
                    res,
                    "Ugyldig Canvas-token",
                    "Canvas-tokenet ble avvist av den valgte institusjonen. Sjekk at tokenet er riktig og at du har valgt korrekt Canvas-instans.",
                );
            case "permission_denied":
                return apiError.badRequest(
                    res,
                    "Canvas-konto kunne ikke verifiseres",
                    "Canvas-tokenet og institusjonen stemmer ikke overens, eller tokenet mangler nødvendig tilgang. Sjekk at URL og token hører sammen.",
                );
            case "timeout":
                return apiError.timeout(
                    res,
                    "Canvas-instansen brukte for lang tid på å svare. Sjekk at institusjonen er riktig og prøv igjen.",
                );
            case "network_error":
            case "server_error":
            case "unknown":
                return sendError(res, "service_unavailable", {
                    melding: "Kunne ikke kontakte den valgte Canvas-instansen. Sjekk at institusjonen/URL-en er riktig, eller prøv \"Annen Instructure-instans\" hvis skolen bruker en annen Canvas-adresse.",
                });
            default:
                break;
        }
    }

    if (error instanceof Error) {
        const lowerMessage = error.message.toLowerCase();
        if (
            lowerMessage.includes("fetch") ||
            lowerMessage.includes("network") ||
            lowerMessage.includes("enotfound") ||
            lowerMessage.includes("getaddrinfo")
        ) {
            return sendError(res, "service_unavailable", {
                melding: "Kunne ikke kontakte den valgte Canvas-instansen. Sjekk at institusjonen/URL-en er riktig, eller prøv \"Annen Instructure-instans\" hvis skolen bruker en annen Canvas-adresse.",
            });
        }
        if (lowerMessage.includes("timeout")) {
            return apiError.timeout(
                res,
                "Canvas-instansen brukte for lang tid på å svare. Sjekk at institusjonen er riktig og prøv igjen.",
            );
        }
    }

    return apiError.badRequest(
        res,
        "Canvas-konto kunne ikke verifiseres",
        "Sjekk at du har valgt riktig Canvas-institusjon og at tokenet fortsatt er gyldig.",
    );
}

/** Invalider Redis Canvas-cache for et (kryptert) token. Brukes ved token-sletting eller -bytte. */
async function invalidateCanvasCacheForToken(encryptedToken: string | undefined): Promise<void> {
    if (!encryptedToken) return;
    try {
        const gammeltToken = decrypt(encryptedToken);
        const prefix = crypto.createHash("sha256").update(gammeltToken).digest("hex").slice(0, 12);
        await invalidateCacheByPattern(`canvas:*:${prefix}:*`).catch(() => {});
    } catch {
        // Ignorer dekrypteringsfeil – tokenet kan være korrupt
    }
}

async function invalidateStoredCanvasDataForUser(userId: string, encryptedToken?: string): Promise<void> {
    const invalidations: Array<Promise<unknown>> = [invalidateUserCanvasCache(userId)];
    if (encryptedToken) {
        invalidations.push(invalidateCanvasCacheForToken(encryptedToken));
    }
    await Promise.allSettled(invalidations);
}

/**
 * Henter autentisert bruker fra DB. Returnerer bruker eller sender 401 og null.
 */
async function hentAutentisertBruker(
  userId: string | undefined,
  res: Response,
  selectFields?: string,
) {
  if (!userId) {
    apiError.unauthorized(res);
    return null;
  }
  const query = User.findById(userId);
  if (selectFields) query.select(selectFields);
  const bruker = await query;
  if (!bruker) {
    apiError.unauthorized(res, "Bruker eksisterer ikke lenger.");
    return null;
  }
  return bruker;
}

// POST /token (Beskyttet av global requireAuth)
// Lagre brukerens personlige Canvas API Token sikkert.
// Query params:
//   - force=true: Tving re-kobling av Canvas-konto fra annen bruker
router.post("/token", rateLimitToken, async (req, res) => {
    try {
        const parsed = CanvasTokenRequestSchema.parse(req.body);
        const { token, canvasBaseUrl } = parsed;
        const userId = req.user?.id;
        const forceRelink = req.query.force === "true";
        const usersToInvalidate = new Set<string>();

        if (!token) {
            return apiError.badRequest(res, "Token mangler");
        }
        // Fjern "Bearer " hvis det ligger i tokenet
        const cleanToken = token.replace(/^Bearer\s+/i, "").trim();
        if (!userId) {
            return apiError.unauthorized(res);
        }
        if (!canvasBaseUrl) {
            return apiError.badRequest(res, "Canvas-institusjon mangler");
        }
        const bruker = await hentAutentisertBruker(userId, res, "+canvasApiToken +canvasTokenHash");
        if (!bruker) return;
        const nyTokenHash = hashToken(cleanToken);
        // Sjekk om tokenet er i bruk av en ANNEN bruker (samme token-hash = samme Canvas-konto)
        const eksisterendeTokenBruker = await User.findOne({
            canvasBaseUrl,
            canvasTokenHash: nyTokenHash,
            _id: { $ne: userId },
        });
        if (eksisterendeTokenBruker) {
            logger.warn({ userId, existingUserId: eksisterendeTokenBruker._id }, "Forsøk på å bruke eksisterende Canvas token");
            if (!forceRelink) {
                return res.status(409).json(CanvasTokenResponseSchema.parse({
                    feil: "Canvas-konto konflikt",
                    melding: "Dette Canvas-tokenet er allerede koblet til en annen bruker. " +
                        "Hvis dette er din konto, kan du bruke 'Gjenopprett tilkobling' for å flytte den hit.",
                    canvasKonflikt: true,
                }));
            }
        }
        // Sjekk hash først (timing-safe for SAMME bruker)
        if (bruker.canvasBaseUrl === canvasBaseUrl &&
            timingSafeHexEqual(bruker.canvasTokenHash, nyTokenHash)) {
            // Token er uendret — Canvas-data er fortsatt gyldig, ikke invalider
            // Varm cache i bakgrunnen i tilfelle Redis har utløpt
            warmCanvasCache(cleanToken, canvasBaseUrl).catch(() => {});
            logger.info({ userId }, "Canvas token identisk (hash match) — ingen invalidering");
            return res.json(CanvasTokenResponseSchema.parse({
                melding: "Token er allerede lagret",
                success: true,
            }));
        }
        // Verifiser Canvas-konto eierskap FØR lagring
        let canvasUserId: number | null = null;
        try {
            const { data: canvasProfile } = await fetchUserProfile(cleanToken, canvasBaseUrl);
            canvasUserId = canvasProfile.id;

            // Sjekk om denne Canvas-kontoen allerede er koblet til en ANNEN StudyWise-bruker
            const eksisterendeKobling = await CanvasUser.findOne({
                canvasId: canvasUserId,
                canvasBaseUrl: canvasBaseUrl,
            });

            if (eksisterendeKobling && eksisterendeKobling.localUser.toString() !== userId.toString()) {
                if (forceRelink) {
                    // Bruker har bedt om å gjenvinne kontoen - fjern gammel kobling
                    logger.info({ userId, oldUserId: eksisterendeKobling.localUser, canvasId: canvasUserId, canvasBaseUrl: canvasBaseUrl },
                        "Canvas-konto re-kobles til ny bruker (force relink)");
                    usersToInvalidate.add(eksisterendeKobling.localUser.toString());

                    await User.findByIdAndUpdate(eksisterendeKobling.localUser, {
                        $unset: { canvasApiToken: 1, canvasTokenHash: 1, canvasUser: 1, canvasBaseUrl: 1 }
                    });

                    // Oppdater CanvasUser til å peke på ny bruker
                    eksisterendeKobling.localUser = bruker._id;
                    eksisterendeKobling.canvasBaseUrl = canvasBaseUrl;
                    await eksisterendeKobling.save();
                    // Sett canvasUser-ref på ny bruker slik at data er konsistent (ellers mangler den til første /whoami)
                    await User.findByIdAndUpdate(bruker._id, {
                        canvasUser: eksisterendeKobling._id,
                    });
                } else {
                    // Avvis uten force-flagg - dette er en sikkerhetsrisiko
                    logger.warn({ userId, existingUserId: eksisterendeKobling.localUser, canvasId: canvasUserId, canvasBaseUrl: canvasBaseUrl },
                        "Canvas-konto tilhører allerede en annen bruker - avvist");
                    return res.status(409).json(CanvasTokenResponseSchema.parse({
                        feil: "Canvas-konto konflikt",
                        melding: "Denne Canvas-kontoen er allerede koblet til en annen StudyWise-bruker. " +
                            "Hvis dette er din konto, kan du bruke 'Gjenopprett tilkobling' for å flytte den hit.",
                        canvasKonflikt: true, // Frontend kan bruke dette til å vise "Gjenopprett"-knapp
                    }));
                }
            }
        } catch (canvasError) {
            logger.warn({ err: canvasError, userId }, "Kunne ikke verifisere Canvas-token");
            return handleCanvasVerificationError(res, canvasError);
        }
        if (forceRelink && eksisterendeTokenBruker) {
            usersToInvalidate.add(eksisterendeTokenBruker._id.toString());
            const oppdatert = await User.findByIdAndUpdate(eksisterendeTokenBruker._id, {
                $unset: { canvasApiToken: 1, canvasTokenHash: 1, canvasUser: 1, canvasBaseUrl: 1 }
            });
            if (!oppdatert) {
                logger.warn({ userId, targetUserId: eksisterendeTokenBruker._id }, "forceRelink: bruker ble slettet mellom sjekk og oppdatering");
            }
        }

        const kryptertToken = encrypt(cleanToken);
        const gammeltKryptertToken = bruker.canvasApiToken;
        bruker.canvasApiToken = kryptertToken;
        bruker.canvasTokenHash = nyTokenHash;
        bruker.canvasBaseUrl = canvasBaseUrl;
        await bruker.save();
        logger.info({ userId }, "Canvas token lagret for bruker");
        await audit({
          actorUserId: userId,
          action: gammeltKryptertToken ? AUDIT_ACTIONS.CANVAS_TOKEN_UPDATED : AUDIT_ACTIONS.CANVAS_TOKEN_CREATED,
          category: "integration",
          outcome: "success",
          role: req.actorRole,
          req,
        });

        // Invalider cache ETTER lagring — slik at nytt token allerede er persistert
        await invalidateStoredCanvasDataForUser(userId.toString(), gammeltKryptertToken);

        usersToInvalidate.delete(userId.toString());
        await Promise.allSettled(
            [...usersToInvalidate].map((targetUserId) => invalidateStoredCanvasDataForUser(targetUserId))
        );

        warmCanvasCache(cleanToken, canvasBaseUrl).catch((err) => {
            logger.warn({ err, userId }, "Cache warming feilet etter token-lagring (ikke kritisk)");
        });

        // Kjør full bakgrunns-sync for å (re-)fylle MongoDB permanent.
        // Kjøres alltid: invalidering over sletter CanvasStructure, og vi vil ha fersk data uansett.
        triggerInitialSync(userId.toString(), cleanToken, canvasBaseUrl);

        return res.json(CanvasTokenResponseSchema.parse({
            melding: "Token lagret og kryptert",
            success: true
        }));
    } catch (error) {
        if (error instanceof ZodError) {
            return sendZodError(res, error, "Token-lagring");
        }
        return sendUnknownError(res, error, { kontekst: "token-lagring", melding: "Kunne ikke lagre Canvas-token. Prøv igjen." });
    }
});

// DELETE /token (slett Canvas token)
router.delete("/token", rateLimitToken, async (req, res) => {
    try {
        const bruker = await hentAutentisertBruker(req.user?.id, res, "+canvasApiToken +canvasTokenHash");
        if (!bruker) return;
        const userId = bruker._id.toString();
        // Sjekk om bruker har et Canvas token
        if (!bruker.canvasApiToken) {
            return apiError.badRequest(res, "Ingen Canvas-token å slette");
        }
        await invalidateStoredCanvasDataForUser(userId, bruker.canvasApiToken);
        // Slett koblingene i databasen fullstendig
        const slettetCanvasUsers = await CanvasUser.deleteMany({ localUser: bruker._id });
        logger.info({ userId, deletedCount: slettetCanvasUsers.deletedCount }, "Slettet CanvasUser-dokumenter fra database");

        // $unset fjerner Canvas-feltene atomisk — unngår setter-krasj på canvasBaseUrl (normalizeCanvasBaseUrl)
        await User.updateOne(
            { _id: bruker._id },
            { $unset: { canvasApiToken: 1, canvasTokenHash: 1, canvasUser: 1, canvasBaseUrl: 1 } },
        );

        logger.info({ userId }, "Canvas token slettet og bruker frakoblet fullstendig");
        await audit({
          actorUserId: userId,
          action: AUDIT_ACTIONS.CANVAS_TOKEN_DELETED,
          category: "integration",
          outcome: "success",
          role: req.actorRole,
          req,
        });
        return res.json(CanvasTokenResponseSchema.parse({
            melding: "Canvas-koblingen er slettet. Du må koble til på nytt for å hente data.",
            success: true,
        }));
    } catch (error) {
        return sendUnknownError(res, error, { kontekst: "token-sletting", melding: "Kunne ikke slette Canvas-token. Prøv igjen." });
    }
});

// GET /me (Beskyttet av global requireAuth)
// Hent informasjon om den autentiserte brukeren. Gjenbruker req.authenticatedUser fra requireAuth for å unngå dobbel MongoDB-henting.
router.get("/me", rateLimitMe, async (req, res) => {
    try {
        const userId = req.user?.id;
        const authenticatedUser = (req as Request & { authenticatedUser?: IUser }).authenticatedUser;
        const bruker = authenticatedUser ?? await hentAutentisertBruker(userId, res, "+canvasApiToken");
        if (!bruker) return;
        const harCanvasToken = !!bruker.canvasApiToken;
        if (harCanvasToken && !bruker.canvasBaseUrl) {
            logger.warn({ userId: bruker._id }, "Bruker har Canvas-token uten canvasBaseUrl (gammel konto – må velge institusjon ved neste token-oppdatering)");
        }
        const preferences = bruker.canvasContextPreferences || createDefaultCanvasContextPreferences();
        const varslerState = normalizeVarslerState(bruker.varslerState || createDefaultVarslerState());
        return res.json(MeResponseSchema.parse({
            user: AuthBrukerSchema.parse({
                id: bruker._id.toString(),
                email: bruker.email,
                username: bruker.username,
                firstName: bruker.firstName,
                lastName: bruker.lastName,
                hasCanvasToken: harCanvasToken,
                canvasBaseUrl: bruker.canvasBaseUrl ?? null,
                canvasContextPreferences: preferences,
                varslerState,
                role: bruker.role ?? "user",
            }),
        }));
    } catch (error) {
        return sendUnknownError(res, error, { kontekst: "henting av brukerprofil", melding: "Kunne ikke laste brukerdata. Prøv igjen." });
    }
});

// PUT /preferences
router.put("/preferences", async (req, res) => {
    try {
        const userId = req.user?.id;
        if (!userId) {
            return apiError.unauthorized(res);
        }

        const { canvasContextPreferences, varslerState } = PreferencesUpdateSchema.parse(req.body);
        const updateFields: {
            canvasContextPreferences?: ReturnType<typeof createDefaultCanvasContextPreferences>;
            varslerState?: ReturnType<typeof normalizeVarslerState>;
        } = {};
        if (canvasContextPreferences !== undefined) {
            updateFields.canvasContextPreferences = CanvasContextPreferencesSchema.parse(canvasContextPreferences);
        }
        if (varslerState !== undefined) {
            updateFields.varslerState = normalizeVarslerState(varslerState);
        }

        const oppdatertBruker = await User.findByIdAndUpdate(
          userId,
          updateFields,
          { returnDocument: "after" },
        );

        if (!oppdatertBruker) {
            return apiError.notFound(res, "Bruker");
        }

        logger.info({ userId }, "Brukerpreferanser oppdatert");
        await audit({
          actorUserId: userId,
          action: AUDIT_ACTIONS.PREFERENCES_UPDATED,
          category: "profile",
          outcome: "success",
          role: req.actorRole,
          req,
        });

        return res.json(
          PreferencesResponseSchema.parse({
            melding: "Preferanser oppdatert",
            canvasContextPreferences:
                oppdatertBruker.canvasContextPreferences || createDefaultCanvasContextPreferences(),
            varslerState: normalizeVarslerState(
                oppdatertBruker.varslerState || createDefaultVarslerState(),
            ),
          }),
        );
    } catch (error) {
        if (error instanceof ZodError) {
            return sendZodError(res, error, "Preferanser");
        }
        return sendUnknownError(res, error, { kontekst: "oppdatering av preferanser", melding: "Kunne ikke lagre preferanser. Prøv igjen." });
    }
});

// POST /logout (Clerk session cleared on frontend; backend clears Canvas runtime cache)
router.post("/logout", async (req, res) => {
  const userId = req.user?.id;
  try {
    if (userId) {
      await clearUserCanvasRuntimeState(userId);
    }
  } catch (error) {
    logger.error({ err: error }, "Feil under logout-opprydding");
  }
  if (userId) {
    await audit({
      actorUserId: userId,
      action: AUDIT_ACTIONS.SIGN_OUT,
      category: "auth",
      outcome: "success",
      role: req.actorRole,
      req,
    });
  }
  return res.json(LogoutResponseSchema.parse({ melding: "Logget ut" }));
});

// DELETE /account — slett egen konto og all tilknyttet data (GDPR). Krever auth.
router.delete("/account", rateLimitAccountDeletion, async (req, res) => {
  const userId = req.user?.id;
  if (!userId) {
    return apiError.unauthorized(res);
  }
  try {
    const deletionResult = await deleteAccountData(userId);
    const deletedAuditActorId = getDeletedAuditActorId(userId);
    await audit({
      actorUserId: deletedAuditActorId,
      action: AUDIT_ACTIONS.ACCOUNT_DELETED,
      category: "privacy",
      outcome: "success",
      role: req.actorRole,
      metadata: {
        deleted: deletionResult.deleted,
        providerAccountDeleted: deletionResult.providerAccountDeleted,
      },
      req,
    });
    try {
      await anonymizeAuditTrailForDeletedUser(userId);
    } catch (auditError) {
      logger.warn(
        { err: auditError, userId },
        "Klarte ikke å anonymisere revisjonsspor etter kontosletting",
      );
    }
    return res.json(AccountDeletionResponseSchema.parse({
      melding: deletionResult.providerAccountDeleted
        ? "Konto og tilknyttet data er slettet"
        : "StudyWise-kontoen er slettet, men innloggingskontoen kunne ikke fjernes automatisk.",
      deleted: deletionResult.deleted,
      providerAccountDeleted: deletionResult.providerAccountDeleted,
    }));
  } catch (err) {
    await audit({
      actorUserId: userId,
      action: AUDIT_ACTIONS.ACCOUNT_DELETED,
      category: "privacy",
      outcome: "failure",
      role: req.actorRole,
      metadata: { error: err instanceof Error ? err.message : String(err) },
      req,
    });
    const requestId = (req as Request & { id?: string }).id;
    logger.error({ err, requestId, path: req.path }, "Account deletion failed");
    return sendUnknownError(res, err, {
      kontekst: "sletting av konto",
      melding: "Kunne ikke slette kontoen. Prøv igjen eller kontakt support.",
    });
  }
});

export default router;
