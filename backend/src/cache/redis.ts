/*
 * Cache for Redis: Canvas API-svar, sync-struktur (canvas-sync), KI-sesjon, rate limiting.
 * Alle nøkler har TTL — ved full Redis avhenger oppførsel av maxmemory-policy:
 * - noeviction: SET feiler, vi logger og fortsetter uten cache (app fungerer).
 * - allkeys-lru / volatile-lru: Redis evicter eldre nøkler; anbefalt for å unngå "nesten full"-varsler.
 */
import { createClient } from "redis";
import { brotliCompressSync, brotliDecompressSync, constants as zlibConstants } from "node:zlib";
import { logger } from "../utils/logger.js";
import { configureRedisLogBuffer } from "../utils/logBuffer.js";

import { isProd } from "../utils/env.js";

/**
 * Marker-prefiks for brotli-komprimerte cache-verdier. Kontrolltegn (0x01) som
 * IKKE kan forekomme i gyldig JSON-strenginnhold uten escape — så vi unngår
 * kollisjon med ekte data. Verdier større enn `COMPRESS_THRESHOLD` lagres
 * komprimert (typisk 70–80 % reduksjon på JSON-respons fra Canvas).
 */
const COMPRESSED_VALUE_PREFIX = "\x01BR1:";
const COMPRESS_THRESHOLD = 100 * 1024; // 100 KB
// Påkrevd av validateEnv ved serverstart; ingen fallback (én sannhetskilde).
const redisUrl = process.env.REDIS_URL!;

const RECONNECT_DELAY_MS = 3000;
const MAX_RECONNECT_DELAY_MS = 30000;
let reconnectAttempts = 0;
let isShuttingDown = false;

const client = createClient({
  url: redisUrl,
  socket: {
    // Redis Cloud kald-start: TLS-handshake + auth kan ta 6-10s når
    // instansen har vært inaktiv. Default node-redis socket connectTimeout
    // er 5s som gir falsk-positiv "ConnectionTimeoutError" → reconnect.
    // 15s gir nok slack til å fange opp første kald-start uten å maskere
    // ekte nettverksfeil.
    connectTimeout: 15000,
    reconnectStrategy: (retries: number) => {
      if (isShuttingDown) return false; // Ikke reconnect under shutdown
      // Exponential backoff: 3s, 6s, 12s, ... maks 30s
      const delay = Math.min(RECONNECT_DELAY_MS * Math.pow(2, retries), MAX_RECONNECT_DELAY_MS);
      logger.warn({ retries, delayMs: delay }, "Redis reconnect planlagt");
      return delay;
    },
  },
});

configureRedisLogBuffer({
  isReady: () => client.isOpen && client.isReady,
  xAdd: (key, id, message, options) => client.xAdd(key, id, message, options),
  xRange: (key, start, end, options) => client.xRange(key, start, end, options),
  xRevRange: (key, start, end, options) => client.xRevRange(key, start, end, options),
  xLen: (key) => client.xLen(key),
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
export const stopRedisReconnect = () => {
  isShuttingDown = true;
};

void client.connect().catch((err) => {
  try {
    logger.error({ err }, "Redis tilkobling feilet (reconnect vil prøve automatisk)");
    if (isProd) {
      logger.warn(
        "ADVARSEL: Redis er ikke tilgjengelig i produksjon. " +
          "Rate limiting vil kun fungere per server-instans. " +
          "Automatisk reconnect er aktivert.",
      );
    }
  } catch {
    // Redis-oppstart må aldri trigge en ny unhandled rejection hvis loggeren
    // selv ikke er fullt initialisert ennå.
  }
});

/** Sjekker om Redis er tilkoblet og klar */
export const isRedisReady = (): boolean => client.isOpen && client.isReady;

/**
 * Redis-kommandoer må kun kjøres når klienten er helt klar.
 * `isOpen` alene er ikke nok: under reconnect kan node-redis fortsatt være "open"
 * men køe kommandoer til ubestemt tid. Da kan auth-/API-kall henge til browseren
 * avbryter requesten. Vi failer derfor raskt når klienten ikke er `ready`.
 */
const canUseRedisCommands = (): boolean => client.isOpen && client.isReady;

/** Validerer cache-nøkkel for å unngå cache injection og farlige tegn (eksporteres for tester) */
export const isValidCacheKey = (key: string): boolean => {
  if (typeof key !== "string") return false;
  const k = key.trim();
  return k.length > 0 && k.length < 512 && VALID_CACHE_KEY_PATTERN.test(k) && !k.includes("..");
};
// Henter cache-verdi for gitt nøkkel, eller null hvis ikke tilgjengelig eller ved feil
export const getCache = async (key: string): Promise<string | null> => {
  if (!canUseRedisCommands()) return null;
  const keyToUse = typeof key === "string" ? key.trim() : key;
  if (!isValidCacheKey(keyToUse)) {
    logger.warn({ key: keyToUse.slice(0, 50) }, "Redis getCache: ugyldig nøkkel avvist");
    return null;
  }
  try {
    const raw = await client.get(keyToUse);
    if (raw === null) return null;
    if (raw.startsWith(COMPRESSED_VALUE_PREFIX)) {
      try {
        const base64 = raw.slice(COMPRESSED_VALUE_PREFIX.length);
        const compressed = Buffer.from(base64, "base64");
        return brotliDecompressSync(compressed).toString("utf8");
      } catch (decompressErr) {
        logger.warn(
          { err: decompressErr, key: keyToUse.slice(0, 80) },
          "Redis getCache: brotli-dekomprimering feilet — returnerer null",
        );
        return null;
      }
    }
    return raw;
  } catch (error) {
    logger.warn({ err: error }, "Redis error");
    return null;
  }
};

// Setter cache (standard 10 minutter)
export const setCache = async (key: string, value: string, ttlSeconds: number = 600) => {
  if (!canUseRedisCommands()) {
    logger.debug({ key }, "Redis setCache hoppet over: klient ikke klar");
    return;
  }
  const keyToUse = typeof key === "string" ? key.trim() : key;
  if (!isValidCacheKey(keyToUse)) {
    logger.warn({ key: keyToUse.slice(0, 50) }, "Redis setCache: ugyldig nøkkel avvist");
    return;
  }
  try {
    const originalSize = Buffer.byteLength(value, "utf8");
    let payload = value;
    let compressed = false;
    let storedSize = originalSize;
    if (originalSize > COMPRESS_THRESHOLD) {
      try {
        const compressedBuf = brotliCompressSync(Buffer.from(value, "utf8"), {
          params: { [zlibConstants.BROTLI_PARAM_QUALITY]: 4 },
        });
        const base64 = compressedBuf.toString("base64");
        const candidate = COMPRESSED_VALUE_PREFIX + base64;
        const candidateSize = Buffer.byteLength(candidate, "utf8");
        // Bruk komprimert kun hvis det faktisk reduserer størrelsen.
        if (candidateSize < originalSize) {
          payload = candidate;
          compressed = true;
          storedSize = candidateSize;
        }
      } catch (compressErr) {
        logger.warn(
          { err: compressErr, key, originalSize },
          "Redis setCache: brotli-komprimering feilet — lagrer ukomprimert",
        );
      }
    }
    // Redis maks value størrelse er 512MB, men vi advarer ved 1MB lagret.
    if (storedSize > 1024 * 1024) {
      logger.warn({ key, storedSize, originalSize, compressed }, "Redis setCache: stor verdi (> 1MB)");
    }
    await client.set(keyToUse, payload, {
      EX: ttlSeconds,
    });
    logger.debug(
      { key, ttlSeconds, originalSize, storedSize, compressed },
      "Redis cache SET",
    );
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

/**
 * Atomisk SET NX (set-if-not-exists) med TTL.
 * Returnerer true hvis nøkkelen ble satt (dvs. den fantes ikke fra før), false ellers.
 * Brukes for single-use nonce-forbruk der GET+SET har et race-vindu.
 */
export const setCacheNX = async (
  key: string,
  value: string,
  ttlSeconds: number,
): Promise<boolean> => {
  if (!canUseRedisCommands()) {
    return false;
  }
  const keyToUse = typeof key === "string" ? key.trim() : key;
  if (!isValidCacheKey(keyToUse)) {
    logger.warn({ key: keyToUse.slice(0, 50) }, "Redis setCacheNX: ugyldig nøkkel avvist");
    return false;
  }
  try {
    const result = await client.set(keyToUse, value, {
      EX: ttlSeconds,
      NX: true,
    });
    // Redis returnerer "OK" ved suksess, null hvis nøkkelen allerede finnes
    return result === "OK";
  } catch (error) {
    logger.error({ err: error, key }, "Redis setCacheNX feilet");
    return false;
  }
};

// Sletter spesifikke cache-nøkler (brukes til opprydding av legacy-nøkler)
export const deleteCacheKeys = async (keys: string[]): Promise<number> => {
  if (!canUseRedisCommands() || keys.length === 0) {
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
/** Samme som VALID_CACHE_KEY_PATTERN, men tillater wildcard (*) for SCAN-basert invalidering */
const VALID_CACHE_PATTERN_WITH_WILDCARD = /^[a-zA-Z0-9æøåÆØÅ:_/?.&=[\]*-]+$/;
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
  if (!canUseRedisCommands()) return 0;
  // Valider at pattern er trygt (forhindrer injection i SCAN)
  if (!VALID_CACHE_PATTERN_WITH_WILDCARD.test(pattern) || pattern.includes("..")) {
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
    const validKeys = keysToDelete.filter((key) => {
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
