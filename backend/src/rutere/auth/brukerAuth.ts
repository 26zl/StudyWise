/*
 * Bruker Autentisering & Lokal Bruker Logikk
 * Håndterer registrering, innlogging, tokenlagring, tokenfornyelse,
 * og henting av brukerdata ved hjelp av JWT (JSON Web Tokens).
 */
import { Router } from "express";
import crypto from "crypto";
import { User } from "../../database/models/User.js";
import { decrypt, encrypt } from "../../utils/kryptering.js";
import { logger } from "../../utils/logger.js";
import { ZodError } from "zod";
import { CanvasTokenRequestSchema, AuthBrukerSchema, LoginRequestSchema, RegisterRequestSchema } from "common";
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
import { rateLimitToken, rateLimitAuth, rateLimitMe } from "../../middleware/rate-limit.js";

import { noCache } from "../../middleware/no-cache.js";

const router = Router();

// Ikke cache auth-responser i browser eller mellomlagring
router.use(noCache);

// Hash funksjon for tokens
const hashToken = (token: string) => {
    return crypto.createHash("sha256").update(token).digest("hex");
};

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

// POST /register
// Registrerer en ny bruker med e-post og passord.
router.post("/register", rateLimitAuth, async (req, res) => {
    try {
        const { email, password, firstName, lastName } = RegisterRequestSchema.parse(req.body);

        const existingUser = await User.findOne({ email });
        if (existingUser) {
            return res.status(409).json({ feil: "Bruker eksisterer allerede" });
        }
        const passwordHash = await bcrypt.hash(password, 10);
        const user = await User.create({
            email,
            passwordHash,
            firstName,
            lastName,
        });
        logger.info({ userId: user._id }, "Ny bruker registrert");
        return res.status(201).json({
            melding: "Bruker opprettet",
            userId: user._id,
        });
    } catch (error) {
        if (error instanceof ZodError) {
            return res.status(400).json({ feil: error.issues });
        }
        logger.error({ err: error }, "Feil ved registrering");
        return res.status(500).json({ feil: "Kunne ikke registrere bruker" });
    }
});

// POST /login
// Logger inn en bruker og utsteder JWT tokens.
router.post("/login", rateLimitAuth, async (req, res) => {
    try {
        const { email, password } = LoginRequestSchema.parse(req.body);
        const user = await User.findOne({ email }).select("+canvasApiToken");
        if (!user) {
            return res.status(401).json({ feil: "Ugyldig e-post eller passord" });
        }
        const match = await bcrypt.compare(password, user.passwordHash);
        if (!match) {
            return res.status(401).json({ feil: "Ugyldig e-post eller passord" });
        }
        // JWT secrets er validert ved oppstart i validateEnv.ts
        const { tilgangSecret, refreshSecret } = hentJwtSecrets();
        const tilgangsToken = jwt.sign(
            { id: user._id, email: user.email, tokenType: "access" },
            tilgangSecret,
            { expiresIn: JWT_TILGANG_UTLOPER }
        );
        const refreshToken = jwt.sign(
            { id: user._id, email: user.email, tokenType: "refresh" },
            refreshSecret,
            { expiresIn: JWT_REFRESH_UTLOPER }
        );
        const harCanvasToken = !!user.canvasApiToken;
        user.refreshTokenHash = hashToken(refreshToken);
        user.refreshTokenExpiresAt = new Date(Date.now() + JWT_REFRESH_MS);
        await user.save();
        settTilgangsCookie(res, tilgangsToken);
        settRefreshCookie(res, refreshToken);
        return res.json({
            melding: "Innlogging vellykket",
            user: AuthBrukerSchema.parse({
                id: user._id.toString(),
                email: user.email,
                firstName: user.firstName,
                lastName: user.lastName,
                hasCanvasToken: harCanvasToken
            })
        });
    } catch (error) {
        if (error instanceof ZodError) {
            return res.status(400).json({ feil: error.issues });
        }
        logger.error({ err: error }, "Feil ved innlogging");
        return res.status(500).json({ feil: "Innlogging feilet" });
    }
});

// POST /token (Beskyttet rute)
// Lagre brukerens personlige Canvas API Token sikkert.
router.post("/token", autentiserJwt, rateLimitToken, async (req, res) => {
    try {
        const { token } = CanvasTokenRequestSchema.parse(req.body);
        const userId = req.user?.id;
        if (!token) {
            return res.status(400).json({ feil: "Token mangler" });
        }
        // Fjern "Bearer " hvis det ligger i tokenet
        const cleanToken = token.replace(/^Bearer\s+/i, "").trim();
        if (!userId) {
            return res.status(401).json({ feil: "Ikke autentisert" });
        }
        const bruker = await User.findById(userId).select("+canvasApiToken +canvasTokenHash");
        if (!bruker) {
            return res.status(404).json({ feil: "Bruker ikke funnet" });
        }
        const nyTokenHash = hashToken(cleanToken);
        // Sjekk om tokenet er i bruk av en ANNEN bruker
        const eksisterendeTokenBruker = await User.findOne({
            canvasTokenHash: nyTokenHash,
            _id: { $ne: userId } // Ikke den samme brukeren
        });
        if (eksisterendeTokenBruker) {
            logger.warn({ userId, existingUserId: eksisterendeTokenBruker._id }, "Forsøk på å bruke eksisterende Canvas token");
            return res.status(409).json({
                feil: "Dette Canvas-tokenet er allerede koblet til en annen bruker."
            });
        }
        // Sjekk hash først (raskt og sikkert for SAMME bruker)
        if (bruker.canvasTokenHash && bruker.canvasTokenHash === nyTokenHash) {
            logger.info({ userId }, "Canvas token identisk (hash match)");
            return res.json({
                melding: "Token er allerede lagret",
                success: true,
            });
        }
        // Fallback: Sjekk dekryptert token (for gamle brukere uten hash)
        if (bruker.canvasApiToken && !bruker.canvasTokenHash) {
            try {
                const eksisterendeToken = decrypt(bruker.canvasApiToken);
                if (eksisterendeToken === cleanToken) {
                    // Oppdater hash for fremtidige sjekker
                    bruker.canvasTokenHash = nyTokenHash;
                    await bruker.save();

                    logger.info({ userId }, "Canvas token identisk (dekryptert match)");
                    return res.json({
                        melding: "Token er allerede lagret",
                        success: true,
                    });
                }
            } catch (error) {
                logger.error({ err: error, userId }, "Feil ved dekryptering av eksisterende Canvas token");
            }
        }
        // Krypter token
        const kryptertToken = encrypt(cleanToken);
        // Lagre til database (både kryptert og hash)
        bruker.canvasApiToken = kryptertToken;
        bruker.canvasTokenHash = nyTokenHash;
        await bruker.save();
        logger.info({ userId }, "Canvas token lagret for bruker");
        return res.json({
            melding: "Token lagret og kryptert",
            success: true
        });
    } catch (error) {
        if (error instanceof ZodError) {
            const feilmelding = error.issues[0]?.message || "Ugyldig input";
            return res.status(400).json({ feil: feilmelding });
        }
        logger.error({ err: error }, "Feil ved lagring av token");
        return res.status(500).json({ feil: "Kunne ikke lagre token" });
    }
});

// POST /refresh (forny tilgangstoken)
// Fornyer tilgangstoken ved hjelp av et gyldig refresh-token.
router.post("/refresh", async (req, res) => {
    try {
        const refreshToken = hentCookieVerdi(req, JWT_REFRESH_COOKIE_NAVN);
        if (!refreshToken) {
            return res.status(401).json({ feil: "Ingen refresh-token" });
        }
        const { tilgangSecret, refreshSecret } = hentJwtSecrets();
        const payload = jwt.verify(refreshToken, refreshSecret, { algorithms: ["HS256"] });
        if (typeof payload === "string" || !payload || typeof payload !== "object") {
            return res.status(403).json({ feil: "Ugyldig refresh-token" });
        }
        const tokenType = (payload as { tokenType?: string }).tokenType;
        if (tokenType !== "refresh") {
            return res.status(403).json({ feil: "Ugyldig token-type" });
        }
        const userId = (payload as { id?: string }).id;
        if (!userId) {
            return res.status(403).json({ feil: "Ugyldig refresh-token" });
        }
        const bruker = await User.findById(userId).select("+refreshTokenHash");
        if (!bruker || !bruker.refreshTokenHash) {
            return res.status(401).json({ feil: "Ugyldig refresh-token" });
        }
        if (bruker.refreshTokenExpiresAt && bruker.refreshTokenExpiresAt.getTime() < Date.now()) {
            return res.status(401).json({ feil: "Refresh-token er utløpt" });
        }
        const refreshHash = hashToken(refreshToken);
        const hashBuffer = Buffer.from(refreshHash, "hex");
        const storedHashBuffer = Buffer.from(bruker.refreshTokenHash, "hex");
        if (!crypto.timingSafeEqual(hashBuffer, storedHashBuffer)) {
            return res.status(403).json({ feil: "Ugyldig refresh-token" });
        }
        const nyttTilgangsToken = jwt.sign(
            { id: bruker._id, email: bruker.email, tokenType: "access" },
            tilgangSecret,
            { expiresIn: JWT_TILGANG_UTLOPER }
        );
        const nyttRefreshToken = jwt.sign(
            { id: bruker._id, email: bruker.email, tokenType: "refresh" },
            refreshSecret,
            { expiresIn: JWT_REFRESH_UTLOPER }
        );
        bruker.refreshTokenHash = hashToken(nyttRefreshToken);
        bruker.refreshTokenExpiresAt = new Date(Date.now() + JWT_REFRESH_MS);
        await bruker.save();
        settTilgangsCookie(res, nyttTilgangsToken);
        settRefreshCookie(res, nyttRefreshToken);
        return res.json({ melding: "Tilgang oppdatert" });
    } catch (error) {
        logger.error({ err: error }, "Feil ved refresh");
        return res.status(403).json({ feil: "Ugyldig refresh-token" });
    }
});

// GET /me (Beskyttet rute)
// Hent informasjon om den autentiserte brukeren.
router.get("/me", autentiserJwt, rateLimitMe, async (req, res) => {
    try {
        const userId = req.user?.id;
        if (!userId) {
            return res.status(401).json({ feil: "Ikke autentisert" });
        }
        const bruker = await User.findById(userId).select("+canvasApiToken");
        if (!bruker) {
            return res.status(404).json({ feil: "Bruker ikke funnet" });
        }
        const harCanvasToken = !!bruker.canvasApiToken;
        return res.json({
            user: AuthBrukerSchema.parse({
                id: bruker._id.toString(),
                email: bruker.email,
                firstName: bruker.firstName,
                lastName: bruker.lastName,
                hasCanvasToken: harCanvasToken
            }),
        });
    } catch (error) {
        logger.error({ err: error }, "Feil ved henting av brukerprofil");
        return res.status(500).json({ feil: "Kunne ikke hente brukerprofil" });
    }
});

// POST /logout (Beskyttet rute)
// Logger ut den autentiserte brukeren.
router.post("/logout", autentiserJwt, async (req, res) => {
    const userId = req.user?.id;
    if (userId) {
        await User.findByIdAndUpdate(userId, {
            refreshTokenHash: undefined,
            refreshTokenExpiresAt: undefined,
        });
    }
    fjernAuthCookies(res);
    return res.json({ melding: "Logget ut" });
});

export default router;