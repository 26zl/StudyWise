/*
 * Bruker-API: Clerk-only auth. Ruter er beskyttet av global requireAuth.
 * GET /me, PUT /preferences, POST/DELETE /token, POST /logout.
 */
import { Router, type Request, type Response } from "express";
import crypto from "crypto";
import mongoose from "mongoose";
import { User, type IUser } from "../../database/models/User.js";
import { CanvasUser } from "../../database/models/CanvasUser.js";
import { decrypt, encrypt } from "../../utils/kryptering.js";
import { logger } from "../../utils/logger.js";
import { z, ZodError } from "zod";
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
  UIPreferencesSchema,
  PreferencesUpdateSchema,
  PreferencesResponseSchema,
  AccountDeletionResponseSchema,
  AuthBrukerSchema,
  MeResponseSchema,
  LogoutResponseSchema,
  ProfileUpdateSchema,
  ProfileUpdateResponseSchema,
  createDefaultCanvasContextPreferences,
  createDefaultManuellInnleveringState,
  createDefaultVarslerState,
  normalizeManuellInnleveringState,
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
import {
    buildCanvasUserPayload,
    isMongoDuplicateKeyError,
} from "../../utils/canvasUserSync.js";

const router = Router();
const SHA256_HEX_REGEX = /^[a-f0-9]{64}$/i;

type CanvasTokenConflictType = "token" | "account";

class CanvasTokenConflictError extends Error {
    conflictType: CanvasTokenConflictType;

    constructor(conflictType: CanvasTokenConflictType) {
        super(conflictType === "token"
            ? "Dette Canvas-tokenet er allerede koblet til en annen bruker. Hvis dette er din konto, kan du bruke 'Gjenopprett tilkobling' for å flytte den hit."
            : "Denne Canvas-kontoen er allerede koblet til en annen StudyWise-bruker. Hvis dette er din konto, kan du bruke 'Gjenopprett tilkobling' for å flytte den hit.");
        this.name = "CanvasTokenConflictError";
        this.conflictType = conflictType;
    }
}

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
                    melding: "Kunne ikke kontakte den valgte Canvas-instansen. Sjekk at institusjonen er riktig og prøv igjen.",
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
                melding: "Kunne ikke kontakte den valgte Canvas-instansen. Sjekk at institusjonen er riktig og prøv igjen.",
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

function sendCanvasConflictResponse(res: Response, conflictType: CanvasTokenConflictType) {
    const error = new CanvasTokenConflictError(conflictType);
    return res.status(409).json(CanvasTokenResponseSchema.parse({
        feil: "Canvas-konto konflikt",
        melding: error.message,
        canvasKonflikt: true,
    }));
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
                return sendCanvasConflictResponse(res, "token");
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
        let canvasProfile: Awaited<ReturnType<typeof fetchUserProfile>>["data"] | null = null;
        try {
            const { data } = await fetchUserProfile(cleanToken, canvasBaseUrl);
            canvasProfile = data;

            // Sjekk om denne Canvas-kontoen allerede er koblet til en ANNEN StudyWise-bruker
            const eksisterendeKobling = await CanvasUser.findOne({
                canvasId: canvasProfile.id,
                canvasBaseUrl: canvasBaseUrl,
            });

            if (eksisterendeKobling && eksisterendeKobling.localUser.toString() !== userId.toString()) {
                if (forceRelink) {
                    logger.info({ userId, oldUserId: eksisterendeKobling.localUser, canvasId: canvasProfile.id, canvasBaseUrl: canvasBaseUrl },
                        "Canvas-konto vil re-kobles til ny bruker (force relink) i transaksjon");
                } else {
                    // Avvis uten force-flagg - dette er en sikkerhetsrisiko
                    logger.warn({ userId, existingUserId: eksisterendeKobling.localUser, canvasId: canvasProfile.id, canvasBaseUrl: canvasBaseUrl },
                        "Canvas-konto tilhører allerede en annen bruker - avvist");
                    return sendCanvasConflictResponse(res, "account");
                }
            }
        } catch (canvasError) {
            logger.warn({ err: canvasError, userId }, "Kunne ikke verifisere Canvas-token");
            return handleCanvasVerificationError(res, canvasError);
        }
        const kryptertToken = encrypt(cleanToken);
        let gammeltKryptertToken: string | undefined;
        const session = await mongoose.startSession();
        try {
            await session.withTransaction(async () => {
                if (!canvasProfile) {
                    throw new Error("Canvas-profil mangler etter verifisering");
                }
                const brukerTx = await User.findById(userId)
                    .select("+canvasApiToken +canvasTokenHash")
                    .session(session);
                if (!brukerTx) {
                    throw new Error("Bruker ble ikke funnet under token-transaksjon");
                }

                gammeltKryptertToken = brukerTx.canvasApiToken;
                const brukerTxId = brukerTx._id.toString();
                const disconnectedUserIds = new Set<string>();

                const disconnectCanvasForUser = async (targetUserId: string) => {
                    if (targetUserId === brukerTxId || disconnectedUserIds.has(targetUserId)) {
                        return;
                    }
                    disconnectedUserIds.add(targetUserId);
                    usersToInvalidate.add(targetUserId);
                    await Promise.all([
                        User.updateOne(
                            { _id: targetUserId },
                            { $unset: { canvasApiToken: 1, canvasTokenHash: 1, canvasUser: 1, canvasBaseUrl: 1 } },
                            { session },
                        ),
                        CanvasUser.deleteMany({ localUser: targetUserId }, { session }),
                    ]);
                };

                const freshTokenBruker = await User.findOne({
                    canvasBaseUrl,
                    canvasTokenHash: nyTokenHash,
                    _id: { $ne: brukerTx._id },
                }).session(session);
                if (freshTokenBruker) {
                    if (!forceRelink) {
                        throw new CanvasTokenConflictError("token");
                    }
                    await disconnectCanvasForUser(freshTokenBruker._id.toString());
                }

                const freshKobling = await CanvasUser.findOne({
                    canvasId: canvasProfile.id,
                    canvasBaseUrl,
                }).session(session);
                if (freshKobling && freshKobling.localUser.toString() !== brukerTxId) {
                    if (!forceRelink) {
                        throw new CanvasTokenConflictError("account");
                    }
                    await disconnectCanvasForUser(freshKobling.localUser.toString());
                }

                await CanvasUser.deleteMany({ localUser: brukerTx._id }, { session });
                const nyCanvasBruker = new CanvasUser(
                    buildCanvasUserPayload(canvasProfile, canvasBaseUrl, brukerTx._id),
                );
                await nyCanvasBruker.save({ session });

                brukerTx.canvasApiToken = kryptertToken;
                brukerTx.canvasTokenHash = nyTokenHash;
                brukerTx.canvasBaseUrl = canvasBaseUrl;
                brukerTx.canvasUser = nyCanvasBruker._id;
                await brukerTx.save({ session });
            });
        } catch (error) {
            if (error instanceof CanvasTokenConflictError) {
                logger.warn({ userId, conflictType: error.conflictType }, "Canvas-token lagring stoppet på konflikt i transaksjon");
                return sendCanvasConflictResponse(res, error.conflictType);
            }
            if (isMongoDuplicateKeyError(error)) {
                logger.warn({ userId, canvasBaseUrl }, "Canvas-token lagring traff unikhetskonflikt i transaksjon");
                return sendCanvasConflictResponse(res, "account");
            }
            throw error;
        } finally {
            await session.endSession();
        }

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
        // Slett koblingene i databasen atomisk — sikrer at CanvasUser og User-feltene
        // enten begge slettes eller begge beholdes ved feil
        let deletedCanvasUsers = 0;
        const session = await mongoose.startSession();
        try {
            await session.withTransaction(async () => {
                const canvasRes = await CanvasUser.deleteMany({ localUser: bruker._id }, { session });
                deletedCanvasUsers = canvasRes.deletedCount;
                // $unset fjerner Canvas-feltene atomisk — unngår setter-krasj på canvasBaseUrl (normalizeCanvasBaseUrl)
                await User.updateOne(
                    { _id: bruker._id },
                    { $unset: { canvasApiToken: 1, canvasTokenHash: 1, canvasUser: 1, canvasBaseUrl: 1 } },
                    { session },
                );
            });
        } finally {
            await session.endSession();
        }
        logger.info({ userId, deletedCount: deletedCanvasUsers }, "Slettet CanvasUser-dokumenter fra database");

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
        const manuellInnleveringState = normalizeManuellInnleveringState(
            bruker.manuellInnleveringState || createDefaultManuellInnleveringState(),
        );
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
                manuellInnleveringState,
                uiPreferences: bruker.uiPreferences ?? undefined,
                role: bruker.role ?? "user",
                authProvider: bruker.authProvider,
            }),
        }));
    } catch (error) {
        return sendUnknownError(res, error, { kontekst: "henting av brukerprofil", melding: "Kunne ikke laste brukerdata. Prøv igjen." });
    }
});

// PUT /profile — oppdater brukerprofil (fornavn, etternavn). Synker til Clerk.
router.put("/profile", rateLimitMe, async (req, res) => {
    try {
        const userId = req.user?.id;
        if (!userId) {
            return apiError.unauthorized(res);
        }

        const parsed = ProfileUpdateSchema.parse(req.body);
        const bruker = await hentAutentisertBruker(userId, res, "+canvasApiToken");
        if (!bruker) return;

        // Oppdater i MongoDB
        const updateFields: Record<string, unknown> = {};
        const unsetFields: Record<string, 1> = {};

        if (parsed.firstName !== undefined) {
            if (parsed.firstName === "") {
                unsetFields.firstName = 1;
            } else {
                updateFields.firstName = parsed.firstName;
            }
        }
        if (parsed.lastName !== undefined) {
            if (parsed.lastName === "") {
                unsetFields.lastName = 1;
            } else {
                updateFields.lastName = parsed.lastName;
            }
        }

        const mongoUpdate: Record<string, unknown> = {};
        if (Object.keys(updateFields).length > 0) mongoUpdate.$set = updateFields;
        if (Object.keys(unsetFields).length > 0) mongoUpdate.$unset = unsetFields;

        const oppdatertBruker = await User.findByIdAndUpdate(userId, mongoUpdate, {
            returnDocument: "after",
        }).select("+canvasApiToken");
        if (!oppdatertBruker) {
            return apiError.notFound(res, "Bruker");
        }

        // Synkroniser til Clerk hvis brukeren har clerkId (hopp over hvis endringen allerede kom fra Clerk)
        if (oppdatertBruker.clerkId && !parsed.skipClerkSync) {
            const { updateClerkUserProfile } = await import("./clerkAuth.js");
            const clerkUpdates: { firstName?: string; lastName?: string } = {};
            if (parsed.firstName !== undefined) clerkUpdates.firstName = parsed.firstName || "";
            if (parsed.lastName !== undefined) clerkUpdates.lastName = parsed.lastName || "";
            const clerkSuccess = await updateClerkUserProfile(oppdatertBruker.clerkId, clerkUpdates);
            if (!clerkSuccess) {
                logger.warn({ userId }, "Profiloppdatering synket til MongoDB men ikke til Clerk");
            }
        }

        logger.info({ userId }, "Brukerprofil oppdatert");
        await audit({
            actorUserId: userId,
            action: AUDIT_ACTIONS.PREFERENCES_UPDATED,
            category: "profile",
            outcome: "success",
            metadata: { fields: Object.keys(parsed) },
            role: req.actorRole,
            req,
        });

        const harCanvasToken = !!oppdatertBruker.canvasApiToken;
        const preferences = oppdatertBruker.canvasContextPreferences || createDefaultCanvasContextPreferences();
        const varslerState = normalizeVarslerState(oppdatertBruker.varslerState || createDefaultVarslerState());
        const manuellInnleveringState = normalizeManuellInnleveringState(
            oppdatertBruker.manuellInnleveringState || createDefaultManuellInnleveringState(),
        );

        return res.json(ProfileUpdateResponseSchema.parse({
            melding: "Profil oppdatert",
            user: AuthBrukerSchema.parse({
                id: oppdatertBruker._id.toString(),
                email: oppdatertBruker.email,
                username: oppdatertBruker.username,
                firstName: oppdatertBruker.firstName,
                lastName: oppdatertBruker.lastName,
                hasCanvasToken: harCanvasToken,
                canvasBaseUrl: oppdatertBruker.canvasBaseUrl ?? null,
                canvasContextPreferences: preferences,
                varslerState,
                manuellInnleveringState,
                uiPreferences: oppdatertBruker.uiPreferences ?? undefined,
                role: oppdatertBruker.role ?? "user",
                authProvider: oppdatertBruker.authProvider,
            }),
        }));
    } catch (error) {
        if (error instanceof ZodError) {
            return sendZodError(res, error, "Profiloppdatering");
        }
        return sendUnknownError(res, error, { kontekst: "profiloppdatering", melding: "Kunne ikke oppdatere profil. Prøv igjen." });
    }
});

// PUT /preferences
router.put("/preferences", rateLimitMe, async (req, res) => {
    try {
        const userId = req.user?.id;
        if (!userId) {
            return apiError.unauthorized(res);
        }

        const bruker = await hentAutentisertBruker(userId, res);
        if (!bruker) return;

        const { canvasContextPreferences, varslerState, manuellInnleveringState, uiPreferences } = PreferencesUpdateSchema.parse(req.body);
        const updateFields: {
            canvasContextPreferences?: ReturnType<typeof createDefaultCanvasContextPreferences>;
            varslerState?: ReturnType<typeof normalizeVarslerState>;
            manuellInnleveringState?: ReturnType<typeof normalizeManuellInnleveringState>;
            uiPreferences?: z.infer<typeof UIPreferencesSchema>;
        } = {};
        if (canvasContextPreferences !== undefined) {
            updateFields.canvasContextPreferences = CanvasContextPreferencesSchema.parse(canvasContextPreferences);
        }
        if (varslerState !== undefined) {
            updateFields.varslerState = normalizeVarslerState(varslerState);
        }
        if (manuellInnleveringState !== undefined) {
            updateFields.manuellInnleveringState = normalizeManuellInnleveringState(manuellInnleveringState);
        }
        if (uiPreferences !== undefined) {
            updateFields.uiPreferences = UIPreferencesSchema.parse({
                ...(bruker.uiPreferences ?? {}),
                ...uiPreferences,
            });
        }

        const oppdatertBruker = await User.findByIdAndUpdate(
          userId,
          { $set: updateFields },
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
            manuellInnleveringState: normalizeManuellInnleveringState(
                oppdatertBruker.manuellInnleveringState || createDefaultManuellInnleveringState(),
            ),
            uiPreferences: oppdatertBruker.uiPreferences ?? undefined,
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
