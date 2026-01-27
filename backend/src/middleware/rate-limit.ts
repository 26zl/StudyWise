/*
 * Ratelimit middleware
 */

import type { Request, Response, NextFunction } from "express";
import { RateLimiterMemory, RateLimiterRedis, RateLimiterRes } from "rate-limiter-flexible";
import redisClient from "../cache/redis.js";
import { logger } from "../utils/logger.js";

type RateLimitOptions = {
    points: number;
    duration: number;
    keyPrefix?: string;
};

const getClientIp = (req: Request) => {
    return req.ip || req.socket?.remoteAddress || "unknown";
};

const setRateLimitHeaders = (res: Response, rateRes: RateLimiterRes, limit: number) => {
    res.setHeader("X-RateLimit-Limit", String(limit));
    res.setHeader("X-RateLimit-Remaining", String(rateRes.remainingPoints));
    res.setHeader(
        "X-RateLimit-Reset",
        String(Math.ceil((Date.now() + rateRes.msBeforeNext) / 1000))
    );
};

const isRateLimiterResult = (value: unknown): value is RateLimiterRes =>
    value instanceof RateLimiterRes ||
    (typeof value === "object" &&
        value !== null &&
        "msBeforeNext" in value &&
        "remainingPoints" in value);

export const createRateLimiter = ({ points, duration, keyPrefix = "rlflx" }: RateLimitOptions) => {
    const memoryLimiter = new RateLimiterMemory({
        points,
        duration,
        keyPrefix,
    });

    const redisLimiter = new RateLimiterRedis({
        storeClient: redisClient,
        points,
        duration,
        keyPrefix,
        useRedisPackage: true,
        rejectIfRedisNotReady: true,
    });

    return async (req: Request, res: Response, next: NextFunction) => {
        const key = getClientIp(req);
        const limiter = redisClient.isOpen ? redisLimiter : memoryLimiter;

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

export const rateLimitKi = createRateLimiter({
    points: 5,
    duration: 60,
    keyPrefix: "rlflx:ki",
});
