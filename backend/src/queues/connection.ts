/*
 * BullMQ Redis-tilkoblinger.
 *
 * BullMQ krever `ioredis` med `maxRetriesPerRequest: null`. Vi bruker en egen
 * connection — ikke samme klient som `cache/redis.ts` — fordi BullMQ workers
 * holder blocking-kommandoer (BRPOPLPUSH) som ville blokkert cache-bruk.
 *
 * VIKTIG om DB-indeks:
 *   `REDIS_BULLMQ_DB` (default `0`) styrer hvilken Redis-database BullMQ bruker.
 *   Default er 0 fordi mange Redis-instanser (inkludert lokal `redis-server` uten
 *   custom config) kun har én database. BullMQ namespacer keys med `bull:<kø>:`
 *   som ikke kolliderer med vår cache (canvas:/ki:/auth:/etc), så samlokalisering
 *   på db 0 er trygt. I prod kan du sette `REDIS_BULLMQ_DB=1` (eller høyere) for
 *   ekstra isolasjon hvis Redis Cloud-instansen din har flere databaser konfigurert
 *   og policy er forskjellig per DB.
 *
 * VIKTIG om eviction-policy:
 *   `volatile-lru` er trygt for BullMQ siden den kun evicter keys med TTL,
 *   og BullMQ setter ingen TTL på job-keys. `allkeys-lru` derimot kan slette
 *   jobs og må unngås på BullMQ-databasen.
 *
 * VIKTIG om delte tilkoblinger (per BullMQ-dokumentasjon):
 *   - Alle Queue-instanser KAN dele én tilkobling.
 *   - Hver Worker MÅ ha sin egen tilkobling fordi den holder en blocking
 *     command som ville blokkert andre klienter på samme tilkobling.
 *   Vi bruker derfor én unified kø + én worker (i stedet for tre separate)
 *   for å minimere antall Redis-tilkoblinger:
 *     getSharedQueueConnection() — singleton for Queue-instansen
 *     getWorkerConnection()      — singleton for den ene Worker-instansen
 *     getUnifiedQueue()          — singleton for den unified køen
 */

import { Queue } from "bullmq";
import { Redis } from "ioredis";
import { logger } from "../utils/logger.js";

const REDIS_URL = process.env.REDIS_URL;
const BULLMQ_DB = Number(process.env.REDIS_BULLMQ_DB ?? 0);

export const UNIFIED_QUEUE_NAME = "studywise-jobs";

let sharedQueueConnection: Redis | null = null;
let workerConnection: Redis | null = null;
let unifiedQueue: Queue | null = null;

function buildConnection(label: string): Redis {
  if (!REDIS_URL) {
    throw new Error("REDIS_URL er ikke satt — BullMQ kan ikke starte");
  }
  const conn = new Redis(REDIS_URL, {
    maxRetriesPerRequest: null,
    db: BULLMQ_DB,
    enableReadyCheck: true,
    lazyConnect: false,
    retryStrategy: (times) => Math.min(times * 200, 5000),
    // Lukk inaktive connections etter 5 min for å frigjøre plass mot connection-grensen.
    disconnectTimeout: 300_000,
  });
  conn.on("error", (err) => {
    logger.error({ err, label }, "BullMQ Redis-tilkobling feilet");
  });
  conn.on("ready", () => {
    logger.info({ db: BULLMQ_DB, label }, "BullMQ Redis-tilkobling klar");
  });
  return conn;
}

/** Delt tilkobling for Queue-instanser (trygt å dele). */
export function getSharedQueueConnection(): Redis {
  if (sharedQueueConnection) return sharedQueueConnection;
  sharedQueueConnection = buildConnection("queue-shared");
  return sharedQueueConnection;
}

/**
 * Singleton for den ene Worker-tilkoblingen. BullMQ dupliserer denne
 * internt for blocking commands, så totalt 2 TCP-connections for workeren.
 */
export function getWorkerConnection(): Redis {
  if (workerConnection) return workerConnection;
  workerConnection = buildConnection("worker-unified");
  return workerConnection;
}

/**
 * Unified kø — alle job-typer (clerk-deletion, pinecone-cleanup, web-push)
 * går gjennom én kø og én worker i stedet for tre separate. Reduserer
 * Redis-tilkoblinger fra 8 til 4 per instans.
 */
export function getUnifiedQueue(): Queue {
  if (unifiedQueue) return unifiedQueue;
  unifiedQueue = new Queue(UNIFIED_QUEUE_NAME, {
    connection: getSharedQueueConnection(),
  });
  return unifiedQueue;
}

export async function closeAllBullMqConnections(): Promise<void> {
  if (unifiedQueue) {
    try {
      await unifiedQueue.close();
    } catch (err) {
      logger.warn({ err }, "Feil under lukking av unified kø");
    }
    unifiedQueue = null;
  }
  if (sharedQueueConnection) {
    try {
      await sharedQueueConnection.quit();
    } catch (err) {
      logger.warn({ err }, "Feil under lukking av delt BullMQ-tilkobling");
    }
    sharedQueueConnection = null;
  }
  if (workerConnection) {
    try {
      await workerConnection.quit();
    } catch (err) {
      logger.warn({ err }, "Feil under lukking av worker-tilkobling");
    }
    workerConnection = null;
  }
}
