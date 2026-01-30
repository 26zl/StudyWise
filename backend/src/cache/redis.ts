/*
* Cache for redis primært brukt for Canvas API og rate limiting
*/
import { createClient } from "redis";
import { logger } from "../utils/logger.js";

// Sjekk om vi er i produksjon og hent Redis URL fra miljøvariabler
const isProd = process.env.NODE_ENV === "production";
const redisUrl = process.env.REDIS_URL;

const client = createClient({
    url: redisUrl,
});
client.on("error", (err) => {
    logger.error({ err }, "Redis Client Error");
    if (isProd) {
        logger.warn("Redis er nede i produksjon - rate limiting fungerer kun per instans");
    }
});
client.on("connect", () => {
    logger.info("Redis tilkoblet");
});
client.on("ready", () => {
    logger.info("Redis klar til bruk");
});
client.on("end", () => {
    logger.info("Redis tilkobling lukket");
});

// Kobler til redis (hvis URL er konfigurert)
if (redisUrl) {
    client.connect().catch((err) => {
        logger.error({ err }, "Redis tilkobling feilet");
        if (isProd) {
            logger.warn(
                "ADVARSEL: Redis er ikke tilgjengelig i produksjon. " +
                "Rate limiting vil kun fungere per server-instans, " +
                "noe som kan tillate brute-force angrep på tvers av instanser."
            );
        }
    });
} else {
    logger.warn("REDIS_URL ikke konfigurert - bruker minne-basert rate limiting");
    if (isProd) {
        logger.warn(
            "ADVARSEL: Minne-basert rate limiting i produksjon er ikke anbefalt " +
            "for distribuerte systemer."
        );
    }
}

/** Sjekker om Redis er tilkoblet og klar */
export const isRedisReady = (): boolean => client.isOpen && client.isReady;

export const getCache = async (key: string): Promise<string | null> => {
    if (!client.isOpen)
        return null;
    try {
        return await client.get(key);
    } catch (error) {
        logger.warn({ err: error }, "Redis error");
        return null;
    }
};

// Setter cache (standard 10 minutter)
export const setCache = async (key: string, value: string, ttlSeconds: number = 600) => {
    if (!client.isOpen)
        return;
    try {
        await client.set(key, value, {
            EX: ttlSeconds,
        });
    } catch (error) {
        logger.warn({ err: error }, "Redis error");
    }
};

export default client;
