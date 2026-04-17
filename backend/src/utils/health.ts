/*
 * Samler liveness-, readiness- og avhengighetssjekker for backend.
 * /health = liveness
 * /ready = readiness
 * /health/dependencies = status for eksterne og ikke-kritiske avhengigheter
 */

import mongoose from "mongoose";
import { isRedisReady } from "../cache/redis.js";
import { isClientAvailable } from "../rutere/ki/aiClient.js";
import { isClerkHealthy } from "../rutere/auth/clerkAuth.js";
import { isCohereConfigured } from "../services/cohere-rerank.service.js";
import { ensurePineconeIndex } from "../services/pinecone.service.js";
import { isWorkerRunning } from "../queues/index.js";
import { logger } from "./logger.js";

/** Intervall i ms for periodisk oppdatering av Clerk/Pinecone-helse (5 min). */
const DEPENDENCY_HEALTH_REFRESH_MS = 5 * 60 * 1000;

/** Enkelt avhengighetsstatus: sann, usann eller ennå ikke sjekket. */
type CachedDependencyState = boolean | null;

/** Cachet helsestatus for eksterne tjenester som sjekkes asynkront (Clerk, Pinecone). */
interface CachedExternalDependencyHealth {
  clerk: CachedDependencyState;
  pinecone: CachedDependencyState;
  checkedAt: string | null;
}

/** Modul-global cache for Clerk/Pinecone-helse; oppdateres av refreshExternalDependencyHealth. */
let cachedExternalDependencyHealth: CachedExternalDependencyHealth = {
  clerk: null,
  pinecone: null,
  checkedAt: null,
};

/**
 * Mapper boolean/null til lesbar statusstreng for API-respons.
 */
function statusFromBoolean(value: CachedDependencyState): "up" | "down" | "unknown" {
  if (value === true) return "up";
  if (value === false) return "down";
  return "unknown";
}

/**
 * Liveness-sjekk: svarer alltid ok.
 * Brukes av Kubernetes/orchestrator for å vite at prosessen lever; ingen avhengighetssjekk.
 */
export function getLivenessHealth() {
  return {
    ok: true,
    type: "liveness" as const,
    timestamp: new Date().toISOString(),
  };
}

/**
 * Readiness-sjekk: appen er klar til å ta trafikk hvis MongoDB er tilkoblet.
 * Brukes av load balancer/orchestrator for å styre trafikk.
 *
 * Mongo er eneste kritiske avhengighet (uten den fungerer ingenting). Redis
 * inkluderes som informasjon og trigger `degraded: true` når den er nede, men
 * avviser ikke trafikk — rate limiting har in-memory fallback, og cache-miss
 * treffer bare Mongo direkte. Operatører kan overvåke `degraded` for å se at
 * appen kjører i redusert modus (ingen BullMQ-workers, ingen distribuert rate
 * limiting, ingen cache).
 */
export function getReadinessHealth() {
  const mongoOk = mongoose.connection.readyState === 1;
  const redisOk = isRedisReady();

  return {
    ok: mongoOk,
    degraded: mongoOk && !redisOk,
    type: "readiness" as const,
    timestamp: new Date().toISOString(),
    checks: {
      mongo: {
        ok: mongoOk,
        state: mongoose.connection.readyState,
      },
      redis: {
        ok: redisOk,
        // Ikke-kritisk: hvis nede, faller rate limiting tilbake til per-instans
        // og BullMQ-køer er utilgjengelige. Appen aksepterer fortsatt trafikk.
        critical: false,
      },
    },
  };
}

/**
 * Avhengighetshelse: Mongo, Redis, BullMQ, Anthropic, Cohere + cachet Clerk/Pinecone.
 * Ok kun når alle kritiske er tilgjengelige; brukes for overvåking, feilsøking
 * og admin-panelets status-visning.
 */
export function getDependenciesHealth() {
  const mongoOk = mongoose.connection.readyState === 1;
  const redisOk = isRedisReady();
  const bullmqOk = isWorkerRunning();
  const anthropicOk = isClientAvailable("");
  const cohereOk = isCohereConfigured();

  return {
    ok:
      mongoOk &&
      redisOk &&
      bullmqOk &&
      anthropicOk &&
      cohereOk &&
      cachedExternalDependencyHealth.clerk === true &&
      cachedExternalDependencyHealth.pinecone === true,
    type: "dependencies" as const,
    timestamp: new Date().toISOString(),
    checkedAt: cachedExternalDependencyHealth.checkedAt,
    dependencies: {
      mongo: {
        ok: mongoOk,
        status: statusFromBoolean(mongoOk),
        critical: true,
      },
      redis: {
        ok: redisOk,
        status: statusFromBoolean(redisOk),
        critical: false,
      },
      bullmq: {
        ok: bullmqOk,
        status: statusFromBoolean(bullmqOk),
        critical: false,
      },
      anthropic: {
        ok: anthropicOk,
        status: statusFromBoolean(anthropicOk),
        critical: true,
      },
      cohere: {
        ok: cohereOk,
        status: statusFromBoolean(cohereOk),
        critical: false,
      },
      clerk: {
        ok: cachedExternalDependencyHealth.clerk,
        status: statusFromBoolean(cachedExternalDependencyHealth.clerk),
        critical: true,
      },
      pinecone: {
        ok: cachedExternalDependencyHealth.pinecone,
        status: statusFromBoolean(cachedExternalDependencyHealth.pinecone),
        critical: false,
      },
    },
  };
}

/**
 * Oppdaterer cachet Clerk- og Pinecone-helse asynkront.
 * Kalles periodisk av startExternalDependencyHealthPolling og ved behov.
 */
export async function refreshExternalDependencyHealth(): Promise<CachedExternalDependencyHealth> {
  const [clerkOk, pineconeOk] = await Promise.all([
    isClerkHealthy(),
    ensurePineconeIndex(),
  ]);

  cachedExternalDependencyHealth = {
    clerk: clerkOk,
    pinecone: pineconeOk,
    checkedAt: new Date().toISOString(),
  };

  return cachedExternalDependencyHealth;
}

/**
 * Starter periodisk oppdatering av Clerk/Pinecone-helse (intervallet fra DEPENDENCY_HEALTH_REFRESH_MS).
 * Intervallet er unref'et slik at prosessen kan avslutte uten å vente på det.
 */
export function startExternalDependencyHealthPolling(): NodeJS.Timeout {
  const interval = setInterval(() => {
    void refreshExternalDependencyHealth().catch((error) => {
      logger.warn({ err: error }, "Periodisk helsesjekk av avhengigheter feilet");
    });
  }, DEPENDENCY_HEALTH_REFRESH_MS);

  interval.unref?.();
  return interval;
}
