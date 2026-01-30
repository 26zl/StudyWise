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

// ============================================================================
// MIDLERTIDIG DISABLED FOR UTVIKLING - KI og AUTH
// ============================================================================

// No-op middleware (gjør ingenting, lar alt gå gjennom)
const noOpMiddleware = (_req: Request, _res: Response, next: NextFunction) => next();

// Rate limiter for KI-endepunkter (DISABLED)
export const rateLimitKi = noOpMiddleware;

// Rate limiter for autentisering (DISABLED)
export const rateLimitAuth = noOpMiddleware;

// ============================================================================
// AKTIVE RATE LIMITERS (Canvas osv.)
// ============================================================================

// Rate limiter for Canvas-endepunkter
export const rateLimitCanvas = createRateLimiter({
    points: 30,
    duration: 60,
    keyPrefix: "rlflx:canvas",
});

// Strengere rate limiter for tunge Canvas-operasjoner
export const rateLimitCanvasTung = createRateLimiter({
    points: 10,
    duration: 60,
    keyPrefix: "rlflx:canvas:tung",
});

// Rate limiter for token-lagring
export const rateLimitToken = createRateLimiter({
    points: 5,
    duration: 60,
    keyPrefix: "rlflx:token",
});

// Rate limiter for brukerinfo-endepunkt
export const rateLimitMe = createRateLimiter({
    points: 30,
    duration: 60,
    keyPrefix: "rlflx:me",
}); 