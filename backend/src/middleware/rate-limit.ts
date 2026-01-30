/*
 * Ratelimit middleware
 */

import type { Request, Response, NextFunction } from "express";
import { RateLimiterMemory, RateLimiterRedis, RateLimiterRes } from "rate-limiter-flexible";
import redisClient, { isRedisReady } from "../cache/redis.js";
import { logger } from "../utils/logger.js";


// Ratelimit konfigurasjonstype
type RateLimitOptions = {
    points: number;
    duration: number;
    keyPrefix?: string;
};
// Hent klientens IP-adresse
const getClientIp = (req: Request) => {
    return req.ip || req.socket?.remoteAddress || "unknown";
};
// Sett rate limit headers i responsen
const setRateLimitHeaders = (res: Response, rateRes: RateLimiterRes, limit: number) => {
    res.setHeader("X-RateLimit-Limit", String(limit));
    res.setHeader("X-RateLimit-Remaining", String(rateRes.remainingPoints));
    res.setHeader(
        "X-RateLimit-Reset",
        String(Math.ceil((Date.now() + rateRes.msBeforeNext) / 1000))
    );
};
// Type guard for RateLimiterRes
const isRateLimiterResult = (value: unknown): value is RateLimiterRes =>
    value instanceof RateLimiterRes ||
    (typeof value === "object" &&
        value !== null &&
        "msBeforeNext" in value &&
        "remainingPoints" in value);
// Oppretter rate limiter middleware
export const createRateLimiter = ({ points, duration, keyPrefix = "rlflx" }: RateLimitOptions) => {
    const memoryLimiter = new RateLimiterMemory({
        points,
        duration,
        keyPrefix,
    });
    // Redis-basert limiter
    const redisLimiter = new RateLimiterRedis({
        storeClient: redisClient,
        points,
        duration,
        keyPrefix,
        useRedisPackage: true,
        rejectIfRedisNotReady: true,
    });
    // Returnerer middleware-funksjon
    return async (req: Request, res: Response, next: NextFunction) => {
        const key = getClientIp(req);
        const limiter = isRedisReady() ? redisLimiter : memoryLimiter;
        try {
            const rateRes = await limiter.consume(key);
            setRateLimitHeaders(res, rateRes, points);
            return next();
        } catch (err) {
            if (isRateLimiterResult(err)) {
                setRateLimitHeaders(res, err, points);
                res.setHeader("Retry-After", String(Math.ceil(err.msBeforeNext / 1000)));
                return res.status(429).json({
                    feil: "For mange forespørsler",
                    melding: "Du har nådd grensen for forespørsler. Prøv igjen senere.",
                });
            }
            logger.error({ err }, "Rate limiter feil");
            return res.status(500).json({
                feil: "Rate limiter feil",
                melding: "Kunne ikke verifisere rate limit. Prøv igjen senere.",
            });
        }
    };
};
// Spesifikk rate limiter for KI-endepunkter
export const rateLimitKi = createRateLimiter({
    points: 10,
    duration: 60,
    keyPrefix: "rlflx:ki",
});

// Rate limiter for Canvas-endepunkter
// Mer generøs enn KI, men beskytter mot å tømme Canvas API-kvoten
export const rateLimitCanvas = createRateLimiter({
    points: 30,      // 30 requests
    duration: 60,    // per minutt
    keyPrefix: "rlflx:canvas",
});

// Strengere rate limiter for tunge Canvas-operasjoner (paginering, bulk)
export const rateLimitCanvasTung = createRateLimiter({
    points: 10,      // 10 requests
    duration: 60,    // per minutt
    keyPrefix: "rlflx:canvas:tung",
});

// Rate limiter for token-lagring (forhindre spamming)
export const rateLimitToken = createRateLimiter({
    points: 5,       // 5 requests
    duration: 60,    // per minutt
    keyPrefix: "rlflx:token",
});

// Rate limiter for autentisering (login/register) - strengere for å hindre brute-force
export const rateLimitAuth = createRateLimiter({
    points: 5,       // 5 forsøk
    duration: 60 * 15, // per 15 minutter (standard brute-force beskyttelse)
    keyPrefix: "rlflx:auth",
});

// Rate limiter for brukerinfo-endepunkt (GET /me) - forhindre token-enumerering
export const rateLimitMe = createRateLimiter({
    points: 30,      // 30 requests
    duration: 60,    // per minutt
    keyPrefix: "rlflx:me",
});
