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
    if (!client.isOpen) {
        logger.warn({ key }, "Redis setCache: klient ikke åpen");
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
        logger.error({ err: error, key }, "Redis setCache feilet");
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
const VALID_CACHE_KEY_PATTERN = /^[a-zA-Z0-9:_/?.&=[\]-]+$/;
/**
 * Validerer at en cache-nøkkel er trygg å bruke.
 * Tillater URL-lignende nøkler mens den blokkerer potensielt farlige tegn.
 */
const isValidCacheKey = (key: string): boolean => {
    return typeof key === "string" &&
        key.length > 0 &&
        key.length < 512 && // Økt fra 256 for lange Canvas API URLs
        VALID_CACHE_KEY_PATTERN.test(key) &&
        !key.includes(".."); // Ekstra sjekk mot path traversal
};
/**
 * Bruker SCAN i stedet for KEYS for å unngå å blokkere Redis
 * ved store databaser. SCAN er ikke-blokkerende og itererer
 * gjennom nøkler i batches.
 */
export const invalidateCacheByPattern = async (pattern: string): Promise<number> => {
    if (!client.isOpen) return 0;
    // Valider at pattern er trygt (forhindrer injection i SCAN)
    // Tillat wildcard (*) og URL-tegn i tillegg til vanlige tegn
    const safePatternRegex = /^[a-zA-Z0-9:_/?.&=[\]*-]+$/;
    if (!safePatternRegex.test(pattern) || pattern.includes("..")) {
        logger.warn({ pattern }, "Ugyldig cache-mønster avvist");
        return 0;
    }
    try {
        // Bruk SCAN for ikke-blokkerende iterasjon (i stedet for KEYS som blokkerer)
        const keysToDelete: string[] = [];
        // scanIterator returnerer batches av keys per iterasjon
        for await (const keys of client.scanIterator({ MATCH: pattern, COUNT: 100 })) {
            // Hver iterasjon gir en batch av keys (array)
            if (Array.isArray(keys)) {
                keysToDelete.push(...keys);
            } else {
                keysToDelete.push(keys);
            }
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

/**
 * Sletter enkelt cache-nøkkel.
 */
export const deleteCache = async (key: string): Promise<boolean> => {
    if (!client.isOpen) return false;
    try {
        const result = await client.del(key);
        return result > 0;
    } catch (error) {
        logger.warn({ err: error }, "Cache delete feilet");
        return false;
    }
};

export default client;
