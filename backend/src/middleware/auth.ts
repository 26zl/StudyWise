/*
* Middleware for autentisering og autorisering ved bruk av JWT (JSON Web Tokens).
* Inkluderer funksjoner for å hente tokens fra cookies eller Authorization headers,
* verifisere tokens, og knytte bruker- og Canvas API-token til request-objektet.
*/

import { Request, Response, NextFunction } from "express";
import jwt, { JwtPayload } from "jsonwebtoken";
import { User } from "../database/models/User.js";
import { decrypt } from "../utils/kryptering.js";
import { logger } from "../utils/logger.js";
import { apiError } from "../utils/apiError.js";
import { isProd } from "../utils/env.js";
import type { JwtBrukerPayload } from "../typer/express.js";

// Påkrevd av validateEnv ved serverstart; ingen fallback (én sannhetskilde).
export const JWT_COOKIE_NAVN = process.env.JWT_COOKIE_NAVN!;
export const JWT_REFRESH_COOKIE_NAVN = process.env.JWT_REFRESH_COOKIE_NAVN!;
export const JWT_TILGANG_UTLOPER = process.env.JWT_ACCESS_EXPIRES!;
export const JWT_REFRESH_UTLOPER = process.env.JWT_REFRESH_EXPIRES!;

// Parse utløpstid til millisekunder for cookie maxAge
function parseUtlopTilMs(utlopStreng: string, defaultMs: number): number {
    const match = utlopStreng.match(/^(\d+)([smhd])$/);
    if (!match) return defaultMs;
    const verdi = parseInt(match[1], 10);
    const enhet = match[2];
    switch (enhet) {
        case "s": return verdi * 1000;
        case "m": return verdi * 60 * 1000;
        case "h": return verdi * 60 * 60 * 1000;
        case "d": return verdi * 24 * 60 * 60 * 1000;
        default: return defaultMs;
    }
}

// Millisekunder for cookie maxAge (beregnet fra utløpsstrenger)
export const JWT_TILGANG_MS = parseUtlopTilMs(JWT_TILGANG_UTLOPER, 30 * 60 * 1000);
export const JWT_REFRESH_MS = parseUtlopTilMs(JWT_REFRESH_UTLOPER, 14 * 24 * 60 * 60 * 1000);

// Hent token fra Authorization header
const hentBearerToken = (req: Request): string | null => {
    const authHeader = req.headers.authorization;
    if (!authHeader) return null;
    const [type, token] = authHeader.split(" ");
    if (type !== "Bearer" || !token) return null;
    return token;
};

// Hent cookie-verdi fra request
export const hentCookieVerdi = (req: Request, cookieNavn: string): string | null => {
    const cookieHeader = req.headers.cookie;
    if (!cookieHeader) return null;
    const cookies = cookieHeader.split(";").map((cookie) => cookie.trim());
    for (const cookie of cookies) {
        if (!cookie.startsWith(`${cookieNavn}=`)) continue;
        const value = cookie.slice(cookieNavn.length + 1);
        try {
            return decodeURIComponent(value);
        } catch {
            return value;
        }
    }
    return null;
};

// Type guard for å sjekke om payload er av typen JwtBrukerPayload
const erGyldigBrukerPayload = (payload: string | JwtPayload): payload is JwtBrukerPayload => {
    return typeof payload === "object" && payload !== null && "id" in payload && "email" in payload;
};

// Sett cookies for tilgangs- og refresh-tokens
export const settTilgangsCookie = (res: Response, token: string) => {
    res.cookie(JWT_COOKIE_NAVN, token, {
        httpOnly: true,
        secure: isProd,
        sameSite: isProd ? "none" : "lax",
        maxAge: JWT_TILGANG_MS,
        path: "/",
    });
};

// Setter refresh-token cookie
export const settRefreshCookie = (res: Response, token: string) => {
    res.cookie(JWT_REFRESH_COOKIE_NAVN, token, {
        httpOnly: true,
        secure: isProd,
        sameSite: isProd ? "none" : "lax",
        maxAge: JWT_REFRESH_MS,
        path: "/",
    });
};

// Fjern autentiseringscookies
export const fjernAuthCookies = (res: Response) => {
    res.clearCookie(JWT_COOKIE_NAVN, {
        httpOnly: true,
        secure: isProd,
        sameSite: isProd ? "none" : "lax",
        path: "/",
    });
    res.clearCookie(JWT_REFRESH_COOKIE_NAVN, {
        httpOnly: true,
        secure: isProd,
        sameSite: isProd ? "none" : "lax",
        path: "/",
    });
};

// Middleware for å autentisere JWT og knytte brukerinfo til request
export const autentiserJwt = (req: Request, res: Response, next: NextFunction) => {
    if (req.method === "OPTIONS") {
        return next();
    }
    const token = hentBearerToken(req) ?? hentCookieVerdi(req, JWT_COOKIE_NAVN);

    if (!token) {
        return apiError.unauthorized(res, "Ingen JWT token gitt");
    }

    if (!process.env.JWT_ACCESS_SECRET) {
        logger.error("JWT_ACCESS_SECRET er ikke definert i miljøvariabler");
        return apiError.serverError(res);
    }
    // Verifiser JWT-token
    jwt.verify(token, process.env.JWT_ACCESS_SECRET, { algorithms: ["HS256"] }, (err, payload) => {
        if (err || !payload || typeof payload === "string") {
            return apiError.unauthorized(res, "Ugyldig eller utløpt token");
        }
        if (!erGyldigBrukerPayload(payload)) {
            return apiError.unauthorized(res, "Ugyldig token-payload");
        }
        // Token-type KREVES for å forhindre misbruk av refresh-tokens som access-tokens
        if (!payload.tokenType || payload.tokenType !== "access") {
            return apiError.unauthorized(res, "Ugyldig token-type");
        }

        req.user = { id: payload.id, email: payload.email };
        next();
    });
};

// Middleware for å knytte Canvas API-token til request
export const knyttCanvasToken = async (req: Request, res: Response, next: NextFunction) => {
    if (!req.user?.id) {
        return apiError.unauthorized(res);
    }
    try {
        const user = await User.findById(req.user.id).select("+canvasApiToken");
        if (!user) {
            return apiError.unauthorized(res, "Ugyldig bruker");
        }

        if (user?.canvasApiToken) {
            const decryptedToken = decrypt(user.canvasApiToken);
            req.canvasToken = decryptedToken;
        }
    } catch (error) {
        logger.error({ err: error, userId: req.user.id }, "Feil ved henting av Canvas token for bruker");
        return next(error);
    }
    next();
};
