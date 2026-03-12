/*
 * Bruker Autentisering & Lokal Bruker Logikk
 * Håndterer registrering, innlogging, tokenlagring, tokenfornyelse,
 * og henting av brukerdata ved hjelp av JWT (JSON Web Tokens).
 */
import { Router, type Response } from "express";
import crypto from "crypto";
import { User } from "../../database/models/User.js";
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
} from "../../services/canvas-sync.service.js";
import {
    CanvasTokenRequestSchema,
    CanvasTokenResponseSchema,
    CanvasContextPreferencesSchema,
    PreferencesUpdateSchema,
    AuthBrukerSchema,
    LoginRequestSchema,
    LoginResponseSchema,
    RegisterRequestSchema,
    RegisterResponseSchema,
    MeResponseSchema,
    LogoutResponseSchema,
    RefreshResponseSchema,
    VarslerStateSchema,
    VARSLER_MAX_IDS,
} from "common/auth";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import {
    autentiserJwt,
    settTilgangsCookie,
    settRefreshCookie,
    fjernAuthCookies,
    hentCookieVerdi,
    JWT_REFRESH_COOKIE_NAVN,
    JWT_TILGANG_UTLOPER,
    JWT_REFRESH_UTLOPER,
    JWT_REFRESH_MS,
} from "../../middleware/auth.js";
import { rateLimitToken, rateLimitAuth, rateLimitMe, rateLimitRefresh } from "../../middleware/rate-limit.js";
import { noCache } from "../../middleware/no-cache.js";
import type { CanvasApiError } from "../canvas/canvasErrors.js";

const router = Router();
const SHA256_HEX_REGEX = /^[a-f0-9]{64}$/i;

const DEFAULT_CANVAS_CONTEXT_PREFERENCES: {
    announcements: boolean;
    courses: boolean;
    assignments: boolean;
    events: boolean;
} = {
    announcements: true,
    courses: true,
    assignments: true,
    events: true,
};

const DEFAULT_VARSLER_STATE: {
    lestIds: string[];
    toastVistIds: string[];
} = {
    lestIds: [],
    toastVistIds: [],
};

/** Samme mønster som frontend (useVarsler, uiStore): dedupliser deretter slice(-VARSLER_MAX_IDS) slik at lagret state er konsistent. */
function getSanitizedVarslerState(
    varslerState?: { lestIds?: readonly string[]; toastVistIds?: readonly string[] } | null,
) {
    const lest = varslerState?.lestIds ?? [];
    const toast = varslerState?.toastVistIds ?? [];
    return VarslerStateSchema.parse({
        lestIds: Array.from(new Set(lest)).slice(-VARSLER_MAX_IDS),
        toastVistIds: Array.from(new Set(toast)).slice(-VARSLER_MAX_IDS),
    });
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
    if (!isValidSha256Hex(storedHash) || !isValidSha256Hex(candidateHash)) {
        return false;
    }

    return crypto.timingSafeEqual(
        Buffer.from(storedHash, "hex"),
        Buffer.from(candidateHash, "hex"),
    );
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

// Hent JWT secrets fra miljøvariabler (validert ved oppstart i validateEnv.ts)
const hentJwtSecrets = () => {
    const tilgangSecret = process.env.JWT_ACCESS_SECRET;
    const refreshSecret = process.env.JWT_REFRESH_SECRET;

    if (!tilgangSecret) {
        throw new Error("JWT_ACCESS_SECRET mangler");
    }
    if (!refreshSecret) {
        throw new Error("JWT_REFRESH_SECRET mangler - bruk en separat hemmelighet for refresh tokens");
    }

    return { tilgangSecret, refreshSecret };
};

// E-post kommer canonicalisert (trim + lowercase) fra common EmailSchema; ingen egen normalisering nødvendig.

// POST /register
// Registrerer en ny bruker med e-post og passord.
router.post("/register", rateLimitAuth, async (req, res) => {
    try {
        const parsed = RegisterRequestSchema.parse(req.body);
        const { email, password, firstName, lastName } = parsed;

        const existingUser = await User.findOne({ email });
        if (existingUser) {
            return apiError.conflict(res, "En bruker med denne e-postadressen eksisterer allerede.");
        }
        const passwordHash = await bcrypt.hash(password, 10);
        const user = await User.create({
            email,
            passwordHash,
            firstName,
            lastName,
        });
        logger.info({ userId: user._id }, "Ny bruker registrert");
        return res.status(201).json(RegisterResponseSchema.parse({
            melding: "Bruker opprettet",
            userId: user._id.toString(),
        }));
    } catch (error) {
        if (error instanceof ZodError) {
            return sendZodError(res, error, "Registrering");
        }
        return sendUnknownError(res, error, { kontekst: "registrering", melding: "Kunne ikke fullføre registrering. Prøv igjen." });
    }
});

// POST /login
// Logger inn en bruker og utsteder JWT tokens.
router.post("/login", rateLimitAuth, async (req, res) => {
    try {
        const { email, password } = LoginRequestSchema.parse(req.body);
        const user = await User.findOne({ email }).select("+canvasApiToken +canvasBaseUrl");
        if (!user) {
            // Logg mislykket forsøk for audit trail (uten å avsløre om brukeren finnes)
            logger.warn({ email: "[REDACTED]", reason: "user_not_found" }, "Mislykket innloggingsforsøk");
            return apiError.unauthorized(res, "Ugyldig e-postadresse eller passord.");
        }
        const match = await bcrypt.compare(password, user.passwordHash);
        if (!match) {
            // Logg mislykket forsøk for audit trail (bruker finnes, feil passord)
            logger.warn({ userId: user._id, reason: "invalid_password" }, "Mislykket innloggingsforsøk");
            return apiError.unauthorized(res, "Ugyldig e-postadresse eller passord.");
        }
        // JWT secrets er validert ved oppstart i validateEnv.ts
        const { tilgangSecret, refreshSecret } = hentJwtSecrets();
        const tilgangsToken = jwt.sign(
            { id: user._id, tokenType: "access" },
            tilgangSecret,
            { expiresIn: JWT_TILGANG_UTLOPER as jwt.SignOptions["expiresIn"] }
        );
        const refreshToken = jwt.sign(
            { id: user._id, tokenType: "refresh" },
            refreshSecret,
            { expiresIn: JWT_REFRESH_UTLOPER as jwt.SignOptions["expiresIn"] }
        );
        const harCanvasToken = !!user.canvasApiToken;
        user.refreshTokenHash = hashToken(refreshToken);
        user.refreshTokenExpiresAt = new Date(Date.now() + JWT_REFRESH_MS);
        await user.save();
        settTilgangsCookie(res, tilgangsToken);
        settRefreshCookie(res, refreshToken);

        // Varm opp cache i bakgrunnen hvis bruker har Canvas-token (ikke blokker respons)
        if (harCanvasToken && user.canvasApiToken && user.canvasBaseUrl) {
            const decryptedToken = decrypt(user.canvasApiToken);
            warmCanvasCache(decryptedToken, user.canvasBaseUrl).catch((err) => {
                // Logg feil men ikke blokker - cache warming er ikke kritisk
                logger.warn({ err, userId: user._id }, "Cache warming feilet ved innlogging (ikke kritisk)");
            });
        } else if (harCanvasToken) {
            logger.error({ userId: user._id }, "Bruker har Canvas-token uten canvasBaseUrl");
        }

        return res.json(LoginResponseSchema.parse({
            melding: "Innlogging vellykket",
            user: AuthBrukerSchema.parse({
                id: user._id.toString(),
                email: user.email,
                firstName: user.firstName,
                lastName: user.lastName,
                hasCanvasToken: harCanvasToken,
                canvasBaseUrl: user.canvasBaseUrl ?? null,
                canvasContextPreferences: user.canvasContextPreferences || DEFAULT_CANVAS_CONTEXT_PREFERENCES,
                varslerState: getSanitizedVarslerState(user.varslerState),
            })
        }));
    } catch (error) {
        if (error instanceof ZodError) {
            return sendZodError(res, error, "Innlogging");
        }
        return sendUnknownError(res, error, { kontekst: "innlogging", melding: "Kunne ikke logge inn. Prøv igjen." });
    }
});

// POST /token (Beskyttet rute)
// Lagre brukerens personlige Canvas API Token sikkert.
// Query params:
//   - force=true: Tving re-kobling av Canvas-konto fra annen bruker
router.post("/token", autentiserJwt, rateLimitToken, async (req, res) => {
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
        const bruker = await User.findById(userId).select("+canvasApiToken +canvasTokenHash");
        if (!bruker) {
            fjernAuthCookies(res);
            return apiError.unauthorized(res, "Bruker eksisterer ikke lenger.");
        }
        const nyTokenHash = hashToken(cleanToken);
        // Sjekk om tokenet er i bruk av en ANNEN bruker (samme token-hash = samme Canvas-konto)
        const eksisterendeTokenBruker = await User.findOne({
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
            await invalidateStoredCanvasDataForUser(userId.toString(), bruker.canvasApiToken);
            logger.info({ userId }, "Canvas token identisk (hash match)");
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
            await User.findByIdAndUpdate(eksisterendeTokenBruker._id, {
                $unset: { canvasApiToken: 1, canvasTokenHash: 1, canvasUser: 1, canvasBaseUrl: 1 }
            });
        }

        const kryptertToken = encrypt(cleanToken);
        const gammeltKryptertToken = bruker.canvasApiToken;
        bruker.canvasApiToken = kryptertToken;
        bruker.canvasTokenHash = nyTokenHash;
        bruker.canvasBaseUrl = canvasBaseUrl;
        await bruker.save();
        logger.info({ userId }, "Canvas token lagret for bruker");

        // Invalider cache ETTER lagring — slik at nytt token allerede er persistert
        await invalidateStoredCanvasDataForUser(userId.toString(), gammeltKryptertToken);

        usersToInvalidate.delete(userId.toString());
        await Promise.allSettled(
            [...usersToInvalidate].map((targetUserId) => invalidateStoredCanvasDataForUser(targetUserId))
        );

        warmCanvasCache(cleanToken, canvasBaseUrl).catch((err) => {
            logger.warn({ err, userId }, "Cache warming feilet etter token-lagring (ikke kritisk)");
        });

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
// Fjerner Canvas API token fra brukerens konto
router.delete("/token", autentiserJwt, rateLimitToken, async (req, res) => {
    try {
        const userId = req.user?.id;
        if (!userId) {
            return apiError.unauthorized(res, "Ikke autentisert");
        }
        const bruker = await User.findById(userId).select("+canvasApiToken +canvasTokenHash");
        if (!bruker) {
            fjernAuthCookies(res);
            return apiError.unauthorized(res, "Bruker eksisterer ikke lenger.");
        }
        // Sjekk om bruker har et Canvas token
        if (!bruker.canvasApiToken) {
            return apiError.badRequest(res, "Ingen Canvas-token å slette");
        }
        await invalidateStoredCanvasDataForUser(userId.toString(), bruker.canvasApiToken);
        // Slett koblingene i databasen fullstendig
        const slettetCanvasUsers = await CanvasUser.deleteMany({ localUser: bruker._id });
        logger.info({ userId, deletedCount: slettetCanvasUsers.deletedCount }, "Slettet CanvasUser-dokumenter fra database");

        // $unset fjerner Canvas-feltene atomisk — unngår setter-krasj på canvasBaseUrl (normalizeCanvasBaseUrl)
        await User.updateOne(
            { _id: bruker._id },
            { $unset: { canvasApiToken: 1, canvasTokenHash: 1, canvasUser: 1, canvasBaseUrl: 1 } },
        );

        logger.info({ userId }, "Canvas token slettet og bruker frakoblet fullstendig");
        return res.json(CanvasTokenResponseSchema.parse({
            melding: "Canvas-koblingen er slettet. Du må koble til på nytt for å hente data.",
            success: true,
        }));
    } catch (error) {
        return sendUnknownError(res, error, { kontekst: "token-sletting", melding: "Kunne ikke slette Canvas-token. Prøv igjen." });
    }
});

// POST /refresh (forny tilgangstoken)
// Fornyer tilgangstoken ved hjelp av et gyldig refresh-token.
router.post("/refresh", rateLimitRefresh, async (req, res) => {
    try {
        const refreshToken = hentCookieVerdi(req, JWT_REFRESH_COOKIE_NAVN);
        const erSsrRefresh = req.headers["x-studywise-ssr-refresh"] === "1";
        if (!refreshToken) {
            return apiError.unauthorized(res, "Ingen refresh-token funnet.");
        }
        const { tilgangSecret, refreshSecret } = hentJwtSecrets();

        // Verifiser JWT separat for å skille token-feil fra DB-feil
        let payload: jwt.JwtPayload;
        try {
            const decoded = jwt.verify(refreshToken, refreshSecret, { algorithms: ["HS256"] });
            if (typeof decoded === "string" || !decoded || typeof decoded !== "object") {
                return apiError.unauthorized(res, "Ugyldig refresh-token.");
            }
            payload = decoded;
        } catch {
            return apiError.unauthorized(res, "Ugyldig eller utløpt refresh-token.");
        }

        const tokenType = (payload as { tokenType?: string }).tokenType;
        if (tokenType !== "refresh") {
            return apiError.unauthorized(res, "Ugyldig token-type.");
        }
        const userId = (payload as { id?: string }).id;
        if (!userId) {
            return apiError.unauthorized(res, "Ugyldig refresh-token.");
        }
        const bruker = await User.findById(userId).select("+refreshTokenHash");
        if (!bruker || !bruker.refreshTokenHash) {
            return apiError.unauthorized(res, "Ugyldig refresh-token.");
        }
        if (bruker.refreshTokenExpiresAt && bruker.refreshTokenExpiresAt.getTime() < Date.now()) {
            return apiError.unauthorized(res, "Refresh-token er utløpt. Logg inn på nytt.");
        }
        const refreshHash = hashToken(refreshToken);
        if (!isValidSha256Hex(bruker.refreshTokenHash)) {
            logger.warn({ userId }, "Ugyldig format på lagret refreshTokenHash");
            return apiError.unauthorized(res, "Ugyldig refresh-token.");
        }
        if (!timingSafeHexEqual(bruker.refreshTokenHash, refreshHash)) {
            return apiError.unauthorized(res, "Ugyldig refresh-token.");
        }
        const nyttTilgangsToken = jwt.sign(
            { id: bruker._id, tokenType: "access" },
            tilgangSecret,
            { expiresIn: JWT_TILGANG_UTLOPER as jwt.SignOptions["expiresIn"] }
        );

        // Ved SSR-refresh (x-studywise-ssr-refresh: 1) roterer vi ikke refresh-token,
        // slik at browser-cookiene ikke desynkroniseres; kun ny access-cookie sendes.
        if (!erSsrRefresh) {
            const nyttRefreshToken = jwt.sign(
                { id: bruker._id, tokenType: "refresh" },
                refreshSecret,
                { expiresIn: JWT_REFRESH_UTLOPER as jwt.SignOptions["expiresIn"] }
            );
            bruker.refreshTokenHash = hashToken(nyttRefreshToken);
            bruker.refreshTokenExpiresAt = new Date(Date.now() + JWT_REFRESH_MS);
            await bruker.save();
            settRefreshCookie(res, nyttRefreshToken);
        }

        settTilgangsCookie(res, nyttTilgangsToken);
        return res.json(RefreshResponseSchema.parse({ melding: "Tilgang oppdatert" }));
    } catch (error) {
        // DB-feil (findById, save) — dette er server-error, ikke auth-feil
        logger.error({ err: error }, "Serverfeil ved token refresh");
        return sendError(res, "server_error", { melding: "Serverfeil ved fornyelse av sesjon. Prøv igjen." });
    }
});

// GET /me (Beskyttet rute)
// Hent informasjon om den autentiserte brukeren.
router.get("/me", autentiserJwt, rateLimitMe, async (req, res) => {
    try {
        const userId = req.user?.id;
        if (!userId) {
            return apiError.unauthorized(res);
        }
        const bruker = await User.findById(userId).select("+canvasApiToken");
        if (!bruker) {
            fjernAuthCookies(res);
            return apiError.unauthorized(res, "Bruker eksisterer ikke lenger.");
        }
        const harCanvasToken = !!bruker.canvasApiToken;
        if (harCanvasToken && !bruker.canvasBaseUrl) {
            logger.warn({ userId: bruker._id }, "Bruker har Canvas-token uten canvasBaseUrl (gammel konto – må velge institusjon ved neste token-oppdatering)");
        }
        const preferences = bruker.canvasContextPreferences || DEFAULT_CANVAS_CONTEXT_PREFERENCES;
        const varslerState = getSanitizedVarslerState(bruker.varslerState || DEFAULT_VARSLER_STATE);
        return res.json(MeResponseSchema.parse({
            user: AuthBrukerSchema.parse({
                id: bruker._id.toString(),
                email: bruker.email,
                firstName: bruker.firstName,
                lastName: bruker.lastName,
                hasCanvasToken: harCanvasToken,
                canvasBaseUrl: bruker.canvasBaseUrl ?? null,
                canvasContextPreferences: preferences,
                varslerState,
            }),
        }));
    } catch (error) {
        return sendUnknownError(res, error, { kontekst: "henting av brukerprofil", melding: "Kunne ikke laste brukerdata. Prøv igjen." });
    }
});

// PUT /preferences (Beskyttet rute)
// Oppdaterer brukerens preferanser (Canvas-kontekst)
router.put("/preferences", autentiserJwt, async (req, res) => {
    try {
        const userId = req.user?.id;
        if (!userId) {
            return apiError.unauthorized(res);
        }

        const { canvasContextPreferences, varslerState } = PreferencesUpdateSchema.parse(req.body);
        const updateFields: {
            canvasContextPreferences?: typeof DEFAULT_CANVAS_CONTEXT_PREFERENCES;
            varslerState?: ReturnType<typeof getSanitizedVarslerState>;
        } = {};
        if (canvasContextPreferences !== undefined) {
            updateFields.canvasContextPreferences = CanvasContextPreferencesSchema.parse(canvasContextPreferences);
        }
        if (varslerState !== undefined) {
            updateFields.varslerState = getSanitizedVarslerState(varslerState);
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

        return res.json({
            melding: "Preferanser oppdatert",
            canvasContextPreferences: oppdatertBruker.canvasContextPreferences || DEFAULT_CANVAS_CONTEXT_PREFERENCES,
            varslerState: getSanitizedVarslerState(oppdatertBruker.varslerState || DEFAULT_VARSLER_STATE),
        });
    } catch (error) {
        if (error instanceof ZodError) {
            return sendZodError(res, error, "Preferanser");
        }
        return sendUnknownError(res, error, { kontekst: "oppdatering av preferanser", melding: "Kunne ikke lagre preferanser. Prøv igjen." });
    }
});

// POST /logout (Beskyttet rute)
// Logger ut den autentiserte brukeren og fjerner alle tokens fra NETTLESER.
// Canvas-token forblir i database (kryptert) - den er knyttet til brukerkontoen.
router.post("/logout", autentiserJwt, async (req, res) => {
    try {
        const userId = req.user?.id;
        if (userId) {
            // Invalider Canvas-cache ved logout (sikkerhet - data skal ikke være tilgjengelig etter logout)
            await clearUserCanvasRuntimeState(userId.toString());

            // Fjern kun refresh token fra database (invaliderer sesjonen)
            // Canvas-token beholdes - den er kryptert og knyttet til brukerkontoen
            await User.findByIdAndUpdate(userId, {
                refreshTokenHash: undefined,
                refreshTokenExpiresAt: undefined,
            });
        }
    } catch (error) {
        // Logg feil, men ALLTID fjern cookies slik at brukeren kan logge ut
        logger.error({ err: error }, "Feil under logout-opprydding");
    }
    // Fjern JWT-cookies fra nettleseren — kjøres uansett
    fjernAuthCookies(res);
    return res.json(LogoutResponseSchema.parse({ melding: "Logget ut" }));
});

export default router;
