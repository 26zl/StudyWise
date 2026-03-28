/*
 * Ratelimit middleware
 */

import type { Request, Response, NextFunction } from "express";
import { RateLimiterMemory, RateLimiterRedis, RateLimiterRes } from "rate-limiter-flexible";
import redisClient, { isRedisReady } from "../cache/redis.js";
import { logger } from "../utils/logger.js";
import { apiError, sendError } from "../utils/apiError.js";
import { audit, AUDIT_ACTIONS } from "../utils/auditLog.js";


// Ratelimit konfigurasjonstype
type RateLimitOptions = {
    points: number;
    duration: number;
    keyPrefix?: string;
    keyGenerator?: (req: Request) => string;
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
export const createRateLimiter = ({
    points,
    duration,
    keyPrefix = "rlflx",
    keyGenerator = getClientIp,
}: RateLimitOptions) => {
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
        const key = keyGenerator(req);
        const limiter = isRedisReady() ? redisLimiter : memoryLimiter;
        try {
            const rateRes = await limiter.consume(key);
            setRateLimitHeaders(res, rateRes, points);
            return next();
        } catch (err) {
            if (isRateLimiterResult(err)) {
                setRateLimitHeaders(res, err, points);
                res.setHeader("Retry-After", String(Math.ceil(err.msBeforeNext / 1000)));
                void audit({
                    actorUserId: (req as Request & { user?: { id?: string } }).user?.id ?? key,
                    action: AUDIT_ACTIONS.RATE_LIMIT_EXCEEDED,
                    category: "security",
                    outcome: "failure",
                    req,
                    metadata: {
                        keyPrefix,
                        endpoint: req.path,
                        method: req.method,
                        limit: points,
                        duration,
                    },
                });
                return apiError.rateLimited(res, "Du har nådd grensen for forespørsler. Prøv igjen senere.");
            }
            logger.error({ err }, "Rate limiter feil");
            return sendError(res, "server_error", { melding: "Kunne ikke verifisere rate limit. Prøv igjen senere." });
        }
    };
};

import { isProd } from "../utils/env.js";
// Miljø-avhengige begrensninger (balansert beskyttelse)

// Sjenerøse grenser i utvikling for god utvikleropplevelse
const devKiLimit = { points: 300, duration: 60, keyPrefix: "rlflx:ki:dev" };
const devCanvasLimit = { points: 200, duration: 60, keyPrefix: "rlflx:canvas:dev" };
const devCanvasTungLimit = { points: 100, duration: 60, keyPrefix: "rlflx:canvas:tung:dev" };
const devTokenLimit = { points: 75, duration: 60, keyPrefix: "rlflx:token:dev" };
const devMeLimit = { points: 200, duration: 60, keyPrefix: "rlflx:me:dev" };
const devAuthTurnstileLimit = { points: 60, duration: 60, keyPrefix: "rlflx:auth-turnstile:dev" };

// Rate limiter for KI-endepunkter (balansert - 50 requests per 5 minutter)
// Tillater god brukeropplevelse og burst, med beskyttelse mot misbruk
export const rateLimitKi = isProd
    ? createRateLimiter({ points: 50, duration: 300, keyPrefix: "rlflx:ki" })
    : createRateLimiter(devKiLimit);

// Rate limiter for Canvas-endepunkter (balansert for normal bruk)
export const rateLimitCanvas = isProd
    ? createRateLimiter({ points: 50, duration: 60, keyPrefix: "rlflx:canvas" })
    : createRateLimiter(devCanvasLimit);

// Rate limiter for tunge Canvas-operasjoner (fil-nedlastinger, etc.)
export const rateLimitCanvasTung = isProd
    ? createRateLimiter({ points: 20, duration: 60, keyPrefix: "rlflx:canvas:tung" })
    : createRateLimiter(devCanvasTungLimit);

// Rate limiter for token-lagring (balansert)
export const rateLimitToken = isProd
    ? createRateLimiter({ points: 10, duration: 60, keyPrefix: "rlflx:token" })
    : createRateLimiter(devTokenLimit);

// Rate limiter for brukerinfo-endepunkt (tillater hyppige SSR-/klientkall til /me)
export const rateLimitMe = isProd
    ? createRateLimiter({ points: 50, duration: 60, keyPrefix: "rlflx:me" })
    : createRateLimiter(devMeLimit);

// Account deletion: maks 2 forsøk per time per bruker (sensitiv operasjon)
export const rateLimitAccountDeletion = createRateLimiter({
  points: 2,
  duration: 3600,
  keyPrefix: "rlflx:account-delete",
  keyGenerator: (req) => req.user?.id ?? getClientIp(req),
});

// Kontaktskjema: streng i prod (5 per 10 min), generøs i dev (50 per minutt)
// IP-basert for å forhindre spam uten å kreve autentisering
export const rateLimitContact = isProd
  ? createRateLimiter({
      points: 5,
      duration: 600, // 10 minutter
      keyPrefix: "rlflx:contact",
      keyGenerator: getClientIp,
    })
  : createRateLimiter({
      points: 50,
      duration: 60,
      keyPrefix: "rlflx:contact:dev",
      keyGenerator: getClientIp,
    });

// Auth Turnstile: moderat grense på offentlig verifisering foran Clerk
export const rateLimitAuthTurnstile = isProd
  ? createRateLimiter({
      points: 10,
      duration: 600, // 10 minutter
      keyPrefix: "rlflx:auth-turnstile",
      keyGenerator: getClientIp,
    })
  : createRateLimiter(devAuthTurnstileLimit);
