/**
 * Admin Redis-verktøy.
 * Monteres under /api/admin (allerede beskyttet med requireAuth + requireRole("admin")).
 *
 * Endepunkter:
 *   GET    /redis/info                    – Redis server-info, minne, eviction-policy, db-størrelser
 *   GET    /redis/prefixes                – Tellinger per kjent key-prefix
 *   POST   /redis/flush                   – Tøm alle keys som matcher et whitelisted prefix
 *   GET    /redis/relink-states           – Liste alle stuck brukere (auth:relink-state:*)
 *
 * Relink-state tømmes via DELETE /brukere/:id/relink-guard (adminBrukere.ts).
 *
 * Sikkerhet:
 *   - Kun WHITELIST-ede prefiks kan tømmes (FLUSH-vern: BullMQ, deleted-clerk, deleted-session ekskludert)
 *   - Bruker SCAN, ikke KEYS (ikke-blokkerende)
 *   - Alle DELETE/FLUSH er audit-loggført
 */
import { Router } from "express";
import {
  AdminRedisFlushPrefixSchema,
  AdminRedisFlushResponseSchema,
  AdminRedisInfoResponseSchema,
  AdminRedisPrefixesResponseSchema,
  AdminRedisRelinkStatesResponseSchema,
  type AdminRedisRelinkStateItem,
} from "common/admin";
import redisClient, {
  invalidateCacheByPattern,
  isRedisReady,
} from "../../cache/redis.js";
import { requireRecentAuth } from "../../middleware/auth.js";
import { apiError, requireUserId, sendUnknownError, sendZodError } from "../../utils/apiError.js";
import { audit, AUDIT_ACTIONS } from "../../utils/auditLog.js";
import { logger } from "../../utils/logger.js";
import { RELINK_STATE_KEY_PREFIX } from "../auth/relinkGuard.js";

const router = Router();

/**
 * Whitelist av prefiks som kan listes og tømmes via admin-UI.
 * `canFlush: false` betyr "vis kun, ikke gi flush-knapp".
 *
 * EKSKLUDERT (sikkerhetskritiske, ingen flush mulig):
 *   - auth:deleted-clerk:*    — replay-vern for slettede Clerk-brukere
 *   - auth:deleted-session:*  — replay-vern for slettede sesjoner
 *   - bull:*                  — BullMQ-jobs (ligger på en annen DB uansett)
 */
const PREFIX_REGISTRY: Array<{
  prefix: string;
  label: string;
  canFlush: boolean;
}> = [
  { prefix: "canvas:", label: "Canvas API-cache", canFlush: true },
  { prefix: "ki:", label: "KI-sesjonskontekst", canFlush: true },
  { prefix: "kb:", label: "Kunnskapsbase-cache", canFlush: true },
  { prefix: "admin:", label: "Admin-stats-cache", canFlush: true },
  { prefix: "auth:turnstile-session:", label: "Turnstile-sesjoner", canFlush: true },
  { prefix: "auth:turnstile-nonce:", label: "Turnstile-nonces", canFlush: true },
  { prefix: "auth:relink-state:", label: "Relink-guard state", canFlush: true },
  { prefix: "webhook:svix:", label: "Svix webhook-dedup", canFlush: true },
  { prefix: "auth:deleted-clerk:", label: "Slettede Clerk-IDer (replay-vern)", canFlush: false },
  { prefix: "auth:deleted-session:", label: "Slettede sesjoner (replay-vern)", canFlush: false },
  // Protected: BullMQ-jobs har ingen TTL og må ikke flushes (ville mistet
  // pågående retries og dead-letter-jobs)
  { prefix: "bull:clerk-deletion:", label: "BullMQ: Clerk-sletting (jobs)", canFlush: false },
  { prefix: "bull:pinecone-cleanup:", label: "BullMQ: Pinecone-cleanup (jobs)", canFlush: false },
  { prefix: "bull:web-push:", label: "BullMQ: Web-push (jobs)", canFlush: false },
  // Protected: live-logger via Redis Stream — flush ville tømt admin live-loggen
  // for alle dynos midt i feilsøking
  { prefix: "logs:buffer", label: "Live logger (Redis Stream)", canFlush: false },
  // Protected: rate-limiter-flexible nøkler — flush ville nullstilt limits midt
  // i en pågående angreps-/spam-runde
  { prefix: "rl:", label: "Rate limit-tellere", canFlush: false },
];

/** Parser INFO-respons til en flat key/value-map. */
function parseInfo(raw: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const line of raw.split(/\r?\n/)) {
    if (!line || line.startsWith("#")) continue;
    const idx = line.indexOf(":");
    if (idx < 0) continue;
    result[line.slice(0, idx).trim()] = line.slice(idx + 1).trim();
  }
  return result;
}

/** Teller keys som matcher et prefix via SCAN. */
async function countByPrefix(prefix: string): Promise<number> {
  if (!redisClient.isOpen) return 0;
  let count = 0;
  for await (const keys of redisClient.scanIterator({
    MATCH: `${prefix}*`,
    COUNT: 500,
  })) {
    count += keys.length;
  }
  return count;
}

// ── GET /redis/info ─────────────────────────────────────────────────────────
router.get("/redis/info", async (req, res) => {
  if (!isRedisReady()) {
    return res.json(
      AdminRedisInfoResponseSchema.parse({
        connected: false,
        dbSizes: {},
        usedMemoryBytes: 0,
        usedMemoryHuman: "0B",
        usedMemoryPeakBytes: 0,
        usedMemoryPeakHuman: "0B",
        maxMemoryBytes: 0,
        maxMemoryHuman: "0B",
        evictionPolicy: "unknown",
        keyspaceHits: 0,
        keyspaceMisses: 0,
        hitRate: null,
        connectedClients: 0,
        redisVersion: "unknown",
        uptimeSeconds: 0,
      }),
    );
  }

  try {
    const [memoryRaw, statsRaw, clientsRaw, serverRaw, keyspaceRaw] = await Promise.all([
      redisClient.info("memory"),
      redisClient.info("stats"),
      redisClient.info("clients"),
      redisClient.info("server"),
      redisClient.info("keyspace"),
    ]);

    const memory = parseInfo(memoryRaw);
    const stats = parseInfo(statsRaw);
    const clients = parseInfo(clientsRaw);
    const server = parseInfo(serverRaw);
    const keyspace = parseInfo(keyspaceRaw);

    // CONFIG GET kan være deaktivert på managed Redis — fall tilbake gracefully
    let evictionPolicy = "unknown";
    try {
      const cfg = await redisClient.configGet("maxmemory-policy");
      const v = cfg["maxmemory-policy"];
      if (typeof v === "string" && v.length > 0) evictionPolicy = v;
    } catch {
      // Behold "unknown"
    }

    const hits = Number(stats.keyspace_hits ?? 0);
    const misses = Number(stats.keyspace_misses ?? 0);
    const total = hits + misses;
    const hitRate = total > 0 ? hits / total : null;

    // Parse db0:keys=N,expires=M til { db0: N }
    const dbSizes: Record<string, number> = {};
    for (const [k, v] of Object.entries(keyspace)) {
      const m = v.match(/keys=(\d+)/);
      if (m) dbSizes[k] = Number(m[1]);
    }

    const actorUserId = requireUserId(req, res);
    if (!actorUserId) return;

    void audit({
      actorUserId,
      action: AUDIT_ACTIONS.ADMIN_ACTION,
      category: "admin",
      outcome: "success",
      role: req.actorRole,
      metadata: { subAction: "redis.info" },
      req,
    });

    const payload = AdminRedisInfoResponseSchema.parse({
      connected: true,
      dbSizes,
      usedMemoryBytes: Number(memory.used_memory ?? 0),
      usedMemoryHuman: memory.used_memory_human ?? "0B",
      usedMemoryPeakBytes: Number(memory.used_memory_peak ?? 0),
      usedMemoryPeakHuman: memory.used_memory_peak_human ?? "0B",
      maxMemoryBytes: Number(memory.maxmemory ?? 0),
      maxMemoryHuman: memory.maxmemory_human ?? "0B",
      evictionPolicy,
      keyspaceHits: hits,
      keyspaceMisses: misses,
      hitRate,
      connectedClients: Number(clients.connected_clients ?? 0),
      redisVersion: server.redis_version ?? "unknown",
      uptimeSeconds: Number(server.uptime_in_seconds ?? 0),
    });
    return res.json(payload);
  } catch (err) {
    return sendUnknownError(res, err, { kontekst: "admin.redis.info" });
  }
});

// ── GET /redis/prefixes ─────────────────────────────────────────────────────
router.get("/redis/prefixes", async (req, res) => {
  if (!isRedisReady()) {
    return res.json(AdminRedisPrefixesResponseSchema.parse({ prefixes: [] }));
  }

  try {
    const prefixes = await Promise.all(
      PREFIX_REGISTRY.map(async (entry) => ({
        prefix: entry.prefix,
        label: entry.label,
        canFlush: entry.canFlush,
        count: await countByPrefix(entry.prefix),
      })),
    );

    const actorUserId = requireUserId(req, res);
    if (!actorUserId) return;

    void audit({
      actorUserId,
      action: AUDIT_ACTIONS.ADMIN_ACTION,
      category: "admin",
      outcome: "success",
      role: req.actorRole,
      metadata: { subAction: "redis.prefixes" },
      req,
    });

    return res.json(AdminRedisPrefixesResponseSchema.parse({ prefixes }));
  } catch (err) {
    return sendUnknownError(res, err, { kontekst: "admin.redis.prefixes" });
  }
});

// ── POST /redis/flush ───────────────────────────────────────────────────────
router.post("/redis/flush", requireRecentAuth, async (req, res) => {
  const actorUserId = requireUserId(req, res);
  if (!actorUserId) return;

  const parsed = AdminRedisFlushPrefixSchema.safeParse(req.body);
  if (!parsed.success) return sendZodError(res, parsed.error, "redis flush body");

  const { prefix } = parsed.data;
  const entry = PREFIX_REGISTRY.find((p) => p.prefix === prefix);

  if (!entry) {
    return apiError.badRequest(res, "Ukjent prefix — kun whitelistede prefiks kan tømmes");
  }
  if (!entry.canFlush) {
    return apiError.badRequest(res, "Dette prefikset er beskyttet og kan ikke tømmes");
  }

  try {
    const deletedCount = await invalidateCacheByPattern(`${prefix}*`);

    void audit({
      actorUserId,
      action: AUDIT_ACTIONS.ADMIN_ACTION,
      category: "admin",
      outcome: "success",
      role: req.actorRole,
      metadata: { subAction: "redis.flush", prefix, deletedCount },
      req,
    });

    logger.info(
      { adminUserId: actorUserId, prefix, deletedCount },
      "Admin tømte Redis-prefix",
    );

    return res.json(AdminRedisFlushResponseSchema.parse({ prefix, deletedCount }));
  } catch (err) {
    return sendUnknownError(res, err, { kontekst: "admin.redis.flush" });
  }
});

// ── GET /redis/relink-states ────────────────────────────────────────────────
router.get("/redis/relink-states", async (req, res) => {
  if (!isRedisReady()) {
    return res.json(AdminRedisRelinkStatesResponseSchema.parse({ states: [] }));
  }

  try {
    const now = Date.now();
    const states: AdminRedisRelinkStateItem[] = [];

    for await (const keys of redisClient.scanIterator({
      MATCH: `${RELINK_STATE_KEY_PREFIX}*`,
      COUNT: 200,
    })) {
      for (const key of keys) {
        const userId = key.slice(RELINK_STATE_KEY_PREFIX.length);
        const [ttl, value] = await Promise.all([
          redisClient.ttl(key),
          redisClient.get(key),
        ]);

        let count: number | undefined;
        let env: string | undefined;
        let ageSeconds: number | undefined;
        if (value) {
          try {
            const parsed = JSON.parse(value) as { at?: number; count?: number; env?: string };
            count = parsed.count;
            env = parsed.env;
            if (typeof parsed.at === "number") {
              ageSeconds = Math.max(0, Math.floor((now - parsed.at) / 1000));
            }
          } catch {
            // Ignorer corrupt JSON
          }
        }

        states.push({ userId, ttlSeconds: ttl, count, env, ageSeconds });
      }
    }

    // Sorter etter alder, eldste først
    states.sort((a, b) => (b.ageSeconds ?? 0) - (a.ageSeconds ?? 0));

    // Relink-states inneholder bruker-IDer — audit-logg tilgangen
    const actorUserId = requireUserId(req, res);
    if (actorUserId) {
      void audit({
        actorUserId,
        action: AUDIT_ACTIONS.ADMIN_ACTION,
        category: "admin",
        outcome: "success",
        role: req.actorRole,
        metadata: { subAction: "redis.relinkStates", stateCount: states.length },
        req,
      });
    }

    return res.json(AdminRedisRelinkStatesResponseSchema.parse({ states }));
  } catch (err) {
    return sendUnknownError(res, err, { kontekst: "admin.redis.relink-states" });
  }
});

// Relink-state tømmes via DELETE /brukere/:id/relink-guard (adminBrukere.ts)
// som verifiserer at brukeren finnes og har konsistent audit-logging.

export default router;
