/**
 * Distribuert logg-buffer for admin "Logger"-fanen.
 *
 * Bakgrunn: tidligere var dette en in-memory ring buffer per Node-prosess. I prod
 * kjører vi 2× Heroku-dynos, så halvparten av loggene var alltid usynlige fordi
 * Herokus router rutet hver poll til tilfeldig dyno. Nå publiseres alle rader til
 * en delt Redis Stream (`logs:buffer`), så enhver dyno ser det samme.
 *
 * Kapasitet: ~500 oppføringer (MAXLEN ~ 500). Stream-nøkkelen har ingen TTL, så
 * `volatile-lru`-eviction-policy lar den være i fred. MAXLEN holder den bounded.
 * Total minnebruk: ~250 KB.
 *
 * Fallback: hvis Redis ikke er klar (cold start, lokal dev uten Redis) bruker vi
 * en in-memory ringbuffer slik at admin-fanen fortsatt fungerer single-process.
 *
 * IDer er Redis Stream-IDer på formatet `<ms>-<seq>`. Disse er strengt
 * monotont stigende per stream og lex-sorterbare, så frontend kan bruke siste
 * sett ID som cursor uten ekstra logikk.
 */
import client, { isRedisReady } from "../cache/redis.js";

export type LogSource = "backend" | "frontend";
export type LogLevel = "fatal" | "error" | "warn" | "info" | "debug" | "trace";

export interface BufferedLogEntry {
  /** Redis Stream-ID (`<ms>-<seq>`) — sortérbar og brukes som cursor */
  id: string;
  /** Når raden ble lagt inn (ms epoch) */
  timestamp: number;
  source: LogSource;
  level: LogLevel;
  msg: string;
  context?: Record<string, unknown>;
}

const STREAM_KEY = "logs:buffer";
const STREAM_MAXLEN = 500;
const FALLBACK_CAPACITY = 500;

const LEVEL_RANK: Record<LogLevel, number> = {
  trace: 10,
  debug: 20,
  info: 30,
  warn: 40,
  error: 50,
  fatal: 60,
};

// In-memory fallback når Redis er nede. Synteten genererer pseudo-stream-IDer
// (`<ms>-<seq>`) slik at kontrakten mot frontend er identisk.
const fallbackEntries: BufferedLogEntry[] = [];
let fallbackSeq = 0;

function makeFallbackId(): string {
  return `${Date.now()}-${fallbackSeq++}`;
}

function pushFallback(entry: Omit<BufferedLogEntry, "id">): BufferedLogEntry {
  const full: BufferedLogEntry = { id: makeFallbackId(), ...entry };
  fallbackEntries.push(full);
  if (fallbackEntries.length > FALLBACK_CAPACITY) fallbackEntries.shift();
  return full;
}

class DistributedLogBuffer {
  /**
   * Legg til en logg-rad. Fire-and-forget mot Redis — feil i Redis må aldri
   * blokkere logging eller kaste videre til Pino.
   */
  push(partial: Omit<BufferedLogEntry, "id" | "timestamp"> & { timestamp?: number }): void {
    const timestamp = partial.timestamp ?? Date.now();
    const entry = {
      timestamp,
      source: partial.source,
      level: partial.level,
      msg: partial.msg,
      context: partial.context,
    };

    if (!isRedisReady()) {
      pushFallback(entry);
      return;
    }

    // Fire-and-forget XADD med MAXLEN-trimming. `~` lar Redis trimme litt
    // upresist for ytelse — fortsatt bounded rundt 500.
    void client
      .xAdd(
        STREAM_KEY,
        "*",
        {
          ts: String(timestamp),
          source: partial.source,
          level: partial.level,
          msg: partial.msg,
          context: partial.context ? JSON.stringify(partial.context) : "",
        },
        {
          TRIM: {
            strategy: "MAXLEN",
            strategyModifier: "~",
            threshold: STREAM_MAXLEN,
          },
        },
      )
      .catch(() => {
        // Hvis Redis falt ut mellom isRedisReady-sjekken og XADD: legg i fallback
        pushFallback(entry);
      });
  }

  /**
   * Hent nylige rader. Hvis `sinceId` er gitt returneres alle nye rader etter
   * den ID-en (eksklusivt). Filtrer på source/minLevel valgfritt.
   */
  async recent(options?: {
    limit?: number;
    source?: LogSource;
    minLevel?: LogLevel;
    sinceId?: string;
  }): Promise<BufferedLogEntry[]> {
    const limit = Math.min(Math.max(1, options?.limit ?? 200), STREAM_MAXLEN);
    const minRank = options?.minLevel ? LEVEL_RANK[options.minLevel] : 0;

    if (!isRedisReady()) {
      let filtered = fallbackEntries;
      if (options?.source) filtered = filtered.filter((e) => e.source === options.source);
      if (minRank) filtered = filtered.filter((e) => LEVEL_RANK[e.level] >= minRank);
      if (options?.sinceId) {
        const since = options.sinceId;
        filtered = filtered.filter((e) => compareStreamIds(e.id, since) > 0);
      }
      return filtered.slice(-limit);
    }

    try {
      // Med sinceId: hent alle rader etter den, eksklusivt (`(id`).
      // Uten: hent siste N med xRevRange.
      let raw: Array<{ id: string; message: Record<string, string> }>;
      if (options?.sinceId) {
        raw = await client.xRange(STREAM_KEY, `(${options.sinceId}`, "+", { COUNT: limit });
      } else {
        const rev = await client.xRevRange(STREAM_KEY, "+", "-", { COUNT: limit });
        raw = rev.reverse();
      }

      const entries: BufferedLogEntry[] = [];
      for (const item of raw) {
        const m = item.message;
        const level = (m.level as LogLevel) || "info";
        if (minRank && LEVEL_RANK[level] < minRank) continue;
        const source = (m.source as LogSource) || "backend";
        if (options?.source && source !== options.source) continue;

        let context: Record<string, unknown> | undefined;
        if (m.context && m.context.length > 0) {
          try {
            context = JSON.parse(m.context) as Record<string, unknown>;
          } catch {
            context = undefined;
          }
        }

        entries.push({
          id: item.id,
          timestamp: Number(m.ts) || Date.now(),
          source,
          level,
          msg: m.msg ?? "",
          context,
        });
      }
      return entries;
    } catch {
      // Redis-feil: degrader til fallback-bufferet
      return fallbackEntries.slice(-limit);
    }
  }

  async size(): Promise<number> {
    if (!isRedisReady()) return fallbackEntries.length;
    try {
      return await client.xLen(STREAM_KEY);
    } catch {
      return fallbackEntries.length;
    }
  }
}

/**
 * Sammenligner to Redis Stream-IDer (`<ms>-<seq>`). Returnerer >0 hvis a > b,
 * <0 hvis a < b, 0 ved likhet.
 */
function compareStreamIds(a: string, b: string): number {
  const [aMs, aSeq] = a.split("-").map((n) => Number.parseInt(n, 10));
  const [bMs, bSeq] = b.split("-").map((n) => Number.parseInt(n, 10));
  if (aMs !== bMs) return aMs - bMs;
  return (aSeq ?? 0) - (bSeq ?? 0);
}

export function pinoLevelToString(level: number | string): LogLevel {
  if (typeof level === "string") {
    if (level in LEVEL_RANK) return level as LogLevel;
  }
  const num = typeof level === "number" ? level : Number.parseInt(String(level), 10);
  if (num >= 60) return "fatal";
  if (num >= 50) return "error";
  if (num >= 40) return "warn";
  if (num >= 30) return "info";
  if (num >= 20) return "debug";
  return "trace";
}

export const logBuffer = new DistributedLogBuffer();
