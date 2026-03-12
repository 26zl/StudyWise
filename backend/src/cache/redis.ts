/*
 * Cache for Redis: Canvas API-svar, sync-struktur (canvas-sync), KI-sesjon, rate limiting.
 * Alle nøkler har TTL — ved full Redis avhenger oppførsel av maxmemory-policy:
 * - noeviction: SET feiler, vi logger og fortsetter uten cache (app fungerer).
 * - allkeys-lru / volatile-lru: Redis evicter eldre nøkler; anbefalt for å unngå "nesten full"-varsler.
 */
import { createClient } from "redis";
import { logger } from "../utils/logger.js";

import { isProd } from "../utils/env.js";
// Påkrevd av validateEnv ved serverstart; ingen fallback (én sannhetskilde).
const redisUrl = process.env.REDIS_URL!;

const RECONNECT_DELAY_MS = 3000;
const MAX_RECONNECT_DELAY_MS = 30000;
let reconnectAttempts = 0;
let isShuttingDown = false;

const client = createClient({
    url: redisUrl,
    socket: {
        reconnectStrategy: (retries: number) => {
            if (isShuttingDown) return false; // Ikke reconnect under shutdown
            // Exponential backoff: 3s, 6s, 12s, ... maks 30s
            const delay = Math.min(RECONNECT_DELAY_MS * Math.pow(2, retries), MAX_RECONNECT_DELAY_MS);
            logger.warn({ retries, delayMs: delay }, "Redis reconnect planlagt");
            return delay;
        },
    },
});

client.on("error", (err) => {
    // Unngå log-spam ved gjentatte feil — logg kun hvert 10. forsøk
    reconnectAttempts++;
    if (reconnectAttempts === 1 || reconnectAttempts % 10 === 0) {
        logger.error({ err, reconnectAttempts }, "Redis Client Error");
        if (isProd) {
            logger.warn("Redis er nede i produksjon - rate limiting fungerer kun per instans");
        }
    }
});
client.on("connect", () => {
    logger.info("Redis tilkoblet");
});
client.on("ready", () => {
    reconnectAttempts = 0; // Nullstill ved vellykket tilkobling
    logger.info("Redis klar til bruk");
});
client.on("end", () => {
    logger.info("Redis tilkobling lukket");
});

/** Markerer at vi er i shutdown — stopper reconnect-forsøk */
export const stopRedisReconnect = () => { isShuttingDown = true; };

// Kobler til redis (hvis URL er konfigurert)
if (redisUrl) {
    client.connect().catch((err) => {
        logger.error({ err }, "Redis tilkobling feilet (reconnect vil prøve automatisk)");
        if (isProd) {
            logger.warn(
                "ADVARSEL: Redis er ikke tilgjengelig i produksjon. " +
                "Rate limiting vil kun fungere per server-instans. " +
                "Automatisk reconnect er aktivert."
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

/** Validerer cache-nøkkel for å unngå cache injection og farlige tegn (eksporteres for tester) */
export const isValidCacheKey = (key: string): boolean => {
    return typeof key === "string" &&
        key.length > 0 &&
        key.length < 512 &&
        VALID_CACHE_KEY_PATTERN.test(key) &&
        !key.includes("..");
};
// Henter cache-verdi for gitt nøkkel, eller null hvis ikke tilgjengelig eller ved feil
export const getCache = async (key: string): Promise<string | null> => {
    if (!client.isOpen)
        return null;
    if (!isValidCacheKey(key)) {
        logger.warn({ key: key.slice(0, 50) }, "Redis getCache: ugyldig nøkkel avvist");
        return null;
    }
    try {
        return await client.get(key);
    } catch (error) {
        logger.warn({ err: error }, "Redis error");
        return null;
    }
};

// Setter cache (standard 10 minutter)
export const setCache = async (key: string, value: string, ttlSeconds: number = 600) => {
    if (!client.isOpen) {
        logger.warn({ key }, "Redis setCache: klient ikke åpen");
        return;
    }
    if (!isValidCacheKey(key)) {
        logger.warn({ key: key.slice(0, 50) }, "Redis setCache: ugyldig nøkkel avvist");
        return;
    }
    try {
        const valueSize = Buffer.byteLength(value, "utf8");
        // Redis maks value størrelse er 512MB, men vi advarer ved 1MB
        if (valueSize > 1024 * 1024) {
            logger.warn({ key, valueSize }, "Redis setCache: stor verdi (> 1MB)");
        }
        await client.set(key, value, {
            EX: ttlSeconds,
        });
        logger.debug({ key, ttlSeconds, valueSize }, "Redis cache SET");
    } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        const likelyFull = /OOM|maxmemory|command not allowed when used memory/i.test(msg);
        if (likelyFull) {
            logger.warn(
                { key: key.slice(0, 80) },
                "Redis setCache avvist (sannsynligvis full). Sett maxmemory-policy til allkeys-lru eller øk minne.",
            );
        } else {
            logger.error({ err: error, key }, "Redis setCache feilet");
        }
    }
};

// Sletter spesifikke cache-nøkler (brukes til opprydding av legacy-nøkler)
export const deleteCacheKeys = async (keys: string[]): Promise<number> => {
    if (!client.isOpen || keys.length === 0) {
        return 0;
    }

    const validKeys = keys.filter((key) => {
        if (!isValidCacheKey(key)) {
            logger.warn({ key: key.slice(0, 50) }, "Redis deleteCacheKeys: ugyldig nøkkel avvist");
            return false;
        }
        return true;
    });

    if (validKeys.length === 0) {
        return 0;
    }

    try {
        const deletedCount = await client.del(validKeys);
        if (deletedCount > 0) {
            logger.debug({ deletedCount }, "Redis cache-nøkler slettet");
        }
        return deletedCount;
    } catch (error) {
        logger.warn({ err: error, keyCount: validKeys.length }, "Redis deleteCacheKeys feilet");
        return 0;
    }
};

// Regex for å validere cache-nøkler
// Tillater tegn som brukes i Canvas API cache-nøkler:
// - Alfanumerisk, kolon, bindestrek, understrek (basis)
// - Skråstrek (/) for URL-paths
// - Spørsmålstegn (?) for query string
// - Ampersand (&) og likhetstegn (=) for query params
// - Hakeparenteser ([]) for array-params som include[]
// Blokkerer farlige tegn som kan brukes til injection (newlines, null bytes, etc.)
// NB: Tillater IKKE wildcard (*) — bruk invalidateCacheByPattern() for glob-matching
// Inkluderer norske tegn (æøåÆØÅ) for nøkler som "kunngjøringer"
const VALID_CACHE_KEY_PATTERN = /^[a-zA-Z0-9æøåÆØÅ:_/?.&=[\]-]+$/;
/**
 * Validerer at en cache-nøkkel er trygg å bruke.
 * Tillater URL-lignende nøkler mens den blokkerer potensielt farlige tegn.
 */
/**
 * Bruker SCAN i stedet for KEYS for å unngå å blokkere Redis
 * ved store databaser. SCAN er ikke-blokkerende og itererer
 * gjennom nøkler i batches.
 */
export const invalidateCacheByPattern = async (pattern: string): Promise<number> => {
    if (!client.isOpen) return 0;
    // Valider at pattern er trygt (forhindrer injection i SCAN)
    // Bruker VALID_CACHE_KEY_PATTERN + wildcard (*) for konsistens
    const safePatternRegex = /^[a-zA-Z0-9æøåÆØÅ:_/?.&=[\]*-]+$/;
    if (!safePatternRegex.test(pattern) || pattern.includes("..")) {
        logger.warn({ pattern }, "Ugyldig cache-mønster avvist");
        return 0;
    }
    try {
        // Bruk SCAN for ikke-blokkerende iterasjon (i stedet for KEYS som blokkerer)
        const keysToDelete: string[] = [];
        // scanIterator gir en batch av keys (string[]) per iterasjon i node-redis 5.x
        for await (const keys of client.scanIterator({ MATCH: pattern, COUNT: 100 })) {
            keysToDelete.push(...keys);
        }
        if (keysToDelete.length === 0) {
            return 0;
        }
        // Filtrer til kun gyldige nøkler (defense in depth)
        const validKeys = keysToDelete.filter(key => {
            if (!isValidCacheKey(key)) {
                logger.warn({ key: key.slice(0, 50) }, "Ugyldig cache-nøkkel hoppet over");
                return false;
            }
            return true;
        });
        if (validKeys.length === 0) {
            return 0;
        }
        // Slett alle gyldige nøkler med Redis DEL-kommando
        // Merk: Dette er Redis DEL (database-operasjon), IKKE fs.unlink (filsystem)
        const deletedCount = await client.del(validKeys);
        logger.info({ pattern, deletedCount }, "Cache invalidert");
        return deletedCount;
    } catch (error) {
        logger.warn({ err: error, pattern }, "Cache invalidering feilet");
        return 0;
    }
};

export default client;
