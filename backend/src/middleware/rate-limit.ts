/*
 * Ratelimit middleware
 */

import type { Request, Response, NextFunction } from "express";
import { RateLimiterMemory, RateLimiterRedis, RateLimiterRes } from "rate-limiter-flexible";
import redisClient, { isRedisReady } from "../cache/redis.js";
import { logger } from "../utils/logger.js";
import { apiError, sendError } from "../utils/apiError.js";
import { audit, AUDIT_ACTIONS } from "../utils/auditLog.js";
import { isProd } from "../utils/env.js";


// Ratelimit konfigurasjonstype
type RateLimitOptions = {
    points: number;
    duration: number;
    keyPrefix?: string;
    keyGenerator?: (req: Request) => string;
    // Fail-closed i prod når Redis er utilgjengelig. Default true for sensitive limiters.
    // Når false, faller vi tilbake til in-memory per dyno (kan omgås ved flere dynos).
    failClosedInProd?: boolean;
};
// Hent klientens IP-adresse — avvis requests uten identifiserbar klient
const getClientIp = (req: Request): string => {
    const ip = req.ip || req.socket?.remoteAddress;
    if (!ip) {
        return `no-ip:${req.get("x-forwarded-for")?.slice(0, 45) ?? "none"}`;
    }
    return ip;
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
// Middleware med refund-evne. Kallesteder kan bruke den som vanlig Express-middleware,
// og evt. kalle .reward(req) for å refundere et token (best-effort, brukes ved transient feil).
export type RateLimiterMiddleware = ((
    req: Request,
    res: Response,
    next: NextFunction,
) => Promise<void | Response>) & {
    reward: (req: Request) => Promise<void>;
};

// Oppretter rate limiter middleware
export const createRateLimiter = ({
    points,
    duration,
    keyPrefix = "rlflx",
    keyGenerator = getClientIp,
    failClosedInProd = false,
}: RateLimitOptions): RateLimiterMiddleware => {
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
    const middleware = async (req: Request, res: Response, next: NextFunction) => {
        const key = keyGenerator(req);
        const useRedis = isRedisReady();
        if (!useRedis) {
            // Fail-closed i prod for sensitive limiters: flere dynos + in-memory fallback
            // betyr at en angriper kan omgå grensen ved å treffe forskjellige dynos.
            if (isProd && failClosedInProd) {
                logger.error({ keyPrefix, path: req.path }, "Rate limiter: Redis utilgjengelig i prod — fail-closed");
                return apiError.serviceUnavailable(res, "Begrenseren");
            }
            logger.warn({ keyPrefix }, "Rate limiter: Redis utilgjengelig, faller tilbake til in-memory (per-instans)");
        }
        const limiter = useRedis ? redisLimiter : memoryLimiter;
        try {
            const rateRes = await limiter.consume(key);
            setRateLimitHeaders(res, rateRes, points);
            return next();
        } catch (err) {
            if (isRateLimiterResult(err)) {
                setRateLimitHeaders(res, err, points);
                res.setHeader("Retry-After", String(Math.ceil(err.msBeforeNext / 1000)));
                audit({
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
                }).catch((auditErr) => {
                    logger.error({ err: auditErr, keyPrefix, path: req.path }, "Audit-logging feilet for RATE_LIMIT_EXCEEDED");
                });
                return apiError.rateLimited(res, "Du har nådd grensen for forespørsler. Prøv igjen senere.");
            }
            logger.error({ err }, "Rate limiter feil");
            return sendError(res, "server_error", { melding: "Kunne ikke verifisere rate limit. Prøv igjen senere." });
        }
    };

    // Refunderer ett token for nøkkelen til req. Brukes når en operasjon feiler transient
    // og brukeren ikke skal bli straffet. Best-effort: feiler stille (loggføres) for å
    // ikke maskere den opprinnelige feilen som returneres til klienten.
    const reward = async (req: Request): Promise<void> => {
        const key = keyGenerator(req);
        const limiter = isRedisReady() ? redisLimiter : memoryLimiter;
        try {
            await limiter.reward(key, 1);
        } catch (err) {
            logger.warn({ err, keyPrefix, key }, "Kunne ikke refundere rate-limit-token");
        }
    };

    return Object.assign(middleware, { reward }) as RateLimiterMiddleware;
};

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
    ? createRateLimiter({ points: 10, duration: 60, keyPrefix: "rlflx:token", failClosedInProd: true })
    : createRateLimiter(devTokenLimit);

// Rate limiter for brukerinfo-endepunkt (tillater hyppige SSR-/klientkall til /me)
export const rateLimitMe = isProd
    ? createRateLimiter({ points: 50, duration: 60, keyPrefix: "rlflx:me" })
    : createRateLimiter(devMeLimit);

// Brukernavn-sjekk: streng for å begrense enumeration-angrep (10 per minutt per IP)
export const rateLimitUsernameCheck = isProd
  ? createRateLimiter({ points: 10, duration: 60, keyPrefix: "rlflx:username-check", failClosedInProd: true })
  : createRateLimiter(devMeLimit);

// Kontosletting: maks 1 forsøk per 24 timer per bruker.
// Irreversibel operasjon — beskyttes i tillegg av requireRecentAuth (10 min step-up).
// Bruk .reward(req) i sletteruten for å refundere tokenet ved transient feil.
export const rateLimitAccountDeletion = createRateLimiter({
  points: 1,
  duration: 86_400,
  keyPrefix: "rlflx:account-delete",
  keyGenerator: (req) => req.user?.id ?? getClientIp(req),
  failClosedInProd: true,
});

// Kontaktskjema: streng i prod (5 per 10 min), generøs i dev (50 per minutt)
// IP-basert for å forhindre spam uten å kreve autentisering
export const rateLimitContact = isProd
  ? createRateLimiter({
      points: 5,
      duration: 600, // 10 minutter
      keyPrefix: "rlflx:contact",
      keyGenerator: getClientIp,
      failClosedInProd: true,
    })
  : createRateLimiter({
      points: 50,
      duration: 60,
      keyPrefix: "rlflx:contact:dev",
      keyGenerator: getClientIp,
    });

// Clerk Webhook: begrenset for å forhindre brute-force mot signatur
export const rateLimitClerkWebhook = createRateLimiter({
  points: 20,
  duration: 60,
  keyPrefix: "rlflx:clerk-webhook",
  keyGenerator: getClientIp,
  failClosedInProd: true,
});

// Kunnskapsbase: moderat grense (30 per minutt i prod, generøs i dev)
export const rateLimitKB = isProd
  ? createRateLimiter({ points: 30, duration: 60, keyPrefix: "rlflx:kb" })
  : createRateLimiter({ points: 200, duration: 60, keyPrefix: "rlflx:kb:dev" });

// Kunnskapsbase write-operasjoner: strengere grense for å beskytte crawling/parsing-ressurser
export const rateLimitKBWrite = isProd
  ? createRateLimiter({
      points: 10,
      duration: 60,
      keyPrefix: "rlflx:kb:write",
      keyGenerator: (req) => req.user?.id ?? getClientIp(req),
      failClosedInProd: true,
    })
  : createRateLimiter({
      points: 60,
      duration: 60,
      keyPrefix: "rlflx:kb:write:dev",
      keyGenerator: (req) => req.user?.id ?? getClientIp(req),
    });

// Auth Turnstile: moderat grense på offentlig verifisering foran Clerk
export const rateLimitAuthTurnstile = isProd
  ? createRateLimiter({
      points: 10,
      duration: 600, // 10 minutter
      keyPrefix: "rlflx:auth-turnstile",
      keyGenerator: getClientIp,
      failClosedInProd: true,
    })
  : createRateLimiter(devAuthTurnstileLimit);
