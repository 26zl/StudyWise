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
import { logger } from "./logger.js";

/** Intervall i ms for periodisk oppdatering av Clerk/Pinecone-helse (5 min). */
export const DEPENDENCY_HEALTH_REFRESH_MS = 5 * 60 * 1000;

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
 */
export function getReadinessHealth() {
  const mongoOk = mongoose.connection.readyState === 1;

  return {
    ok: mongoOk,
    type: "readiness" as const,
    timestamp: new Date().toISOString(),
    checks: {
      mongo: {
        ok: mongoOk,
        state: mongoose.connection.readyState,
      },
    },
  };
}

/**
 * Avhengighetshelse: Redis, Anthropic, Cohere + cachet Clerk/Pinecone.
 * Ok kun når alle er tilgjengelige/konfigurert; brukes for overvåking og feilsøking.
 */
export function getDependenciesHealth() {
  const redisOk = isRedisReady();
  const anthropicOk = isClientAvailable("");
  const cohereOk = isCohereConfigured();

  return {
    ok:
      redisOk &&
      anthropicOk &&
      cohereOk &&
      cachedExternalDependencyHealth.clerk === true &&
      cachedExternalDependencyHealth.pinecone === true,
    type: "dependencies" as const,
    timestamp: new Date().toISOString(),
    checkedAt: cachedExternalDependencyHealth.checkedAt,
    dependencies: {
      redis: {
        ok: redisOk,
        status: statusFromBoolean(redisOk),
      },
      anthropic: {
        ok: anthropicOk,
        status: statusFromBoolean(anthropicOk),
      },
      cohere: {
        ok: cohereOk,
        status: statusFromBoolean(cohereOk),
      },
      clerk: {
        ok: cachedExternalDependencyHealth.clerk,
        status: statusFromBoolean(cachedExternalDependencyHealth.clerk),
      },
      pinecone: {
        ok: cachedExternalDependencyHealth.pinecone,
        status: statusFromBoolean(cachedExternalDependencyHealth.pinecone),
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
