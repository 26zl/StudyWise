/**
 * Public status-endepunkt for /status-siden.
 *
 * Offentlig tilgjengelig (ingen auth) slik at brukere kan sjekke driftstatus
 * FØR de logger inn — f.eks. hvis de lurer på om innlogging er nede.
 *
 * Returnerer brukerfokuserte komponenter (Innlogging, KI-chat, Kunnskapsbase,
 * Varsler) i stedet for bakenforliggende teknologi. Det skjuler infrastruktur-
 * detaljer fra offentligheten — admin-panelet har fortsatt tilgang til full
 * tjeneste-status via `/health/dependencies`.
 *
 * Cachet i Redis i 30 sekunder — absorberer monitorerings-polling og beskytter
 * mot DB-belastning. Fallback til direkte lesing hvis Redis er nede.
 *
 * Sikkerhet:
 *   - Ingen tech-navn i public respons (f.eks. ikke "Pinecone", "Anthropic")
 *   - Kun komponent-buckets med operational/degraded/down
 *   - Rate-limited per IP (60/min) for å begrense misbruk
 */

import { Router } from "express";
import {
  PublicStatusResponseSchema,
  type PublicStatusResponse,
  type OverallStatus,
  type DependencyStatus,
} from "common/system";
import { getDependenciesHealth } from "../utils/health.js";
import { SystemAnnouncement } from "../database/models/SystemAnnouncement.js";
import { getCache, setCache, deleteCacheKeys } from "../cache/redis.js";
import { rateLimitStatus } from "../middleware/rate-limit.js";
import { sendUnknownError } from "../utils/apiError.js";
import { logger } from "../utils/logger.js";

export const publicStatusRouter = Router();

const CACHE_KEY = "status:public";
const CACHE_TTL_SECONDS = 30;

/**
 * Invalideres når admin publiserer/deaktiverer en melding som treffer status-siden.
 * Returnerer true hvis invalideringen lyktes, false hvis Redis var nede —
 * admin-ruten inkluderer resultatet i responsen.
 */
export async function invalidatePublicStatusCache(): Promise<boolean> {
  try {
    await deleteCacheKeys([CACHE_KEY]);
    return true;
  } catch (err) {
    logger.warn({ err }, "Kunne ikke invalidere public status-cache");
    return false;
  }
}

type ServiceHealth = { status: DependencyStatus; critical: boolean };

/**
 * Beregn status for en komponent basert på underliggende tjenester:
 *   - Kritisk tjeneste `down`   → "down"
 *   - Ikke-kritisk tjeneste `down` → "degraded"
 *   - Kritisk tjeneste `unknown`  → "degraded" (ikke "operational" — vi vet
 *     ikke om den faktisk er oppe enda, typisk rett etter oppstart før
 *     første refreshExternalDependencyHealth har kjørt)
 *   - Ikke-kritisk tjeneste `unknown` → behandles som up (degraderer ikke
 *     bucket, siden mangel på sjekk ikke i seg selv indikerer feil)
 *   - Alle `up` → "operational"
 */
function componentStatus(services: ServiceHealth[]): OverallStatus {
  const criticalDown = services.some((s) => s.critical && s.status === "down");
  if (criticalDown) return "down";
  const anyDown = services.some((s) => s.status === "down");
  if (anyDown) return "degraded";
  const criticalUnknown = services.some(
    (s) => s.critical && s.status === "unknown",
  );
  if (criticalUnknown) return "degraded";
  return "operational";
}

function computeOverall(components: PublicStatusResponse["components"]): OverallStatus {
  // Canvas er en EKSTERN integrasjon vi ikke eier. Den skal ikke kunne dra
  // hele plattformen til "down" — vi degraderer maks "overall" til "degraded"
  // når Canvas er borte, slik at brukerne ser at appen ellers fungerer.
  const { canvas, ...platform } = components;
  const platformValues = Object.values(platform);
  if (platformValues.some((c) => c.status === "down")) return "down";
  if (platformValues.some((c) => c.status === "degraded")) return "degraded";
  if (canvas.status === "down" || canvas.status === "degraded") return "degraded";
  return "operational";
}

publicStatusRouter.get("/status", rateLimitStatus, async (_req, res) => {
  try {
    // 1. Prøv cache
    const cached = await getCache(CACHE_KEY);
    if (cached) {
      try {
        return res.json(JSON.parse(cached) as PublicStatusResponse);
      } catch {
        // Korrupt cache-verdi — fall gjennom til fersk oppbygging
      }
    }

    // 2. Bygg fra kilder. `getDependenciesHealth()` er ren synkron data.
    const health = getDependenciesHealth();
    const deps = health.dependencies;

    // Map tech → brukerfokuserte komponenter. Én komponent er "down" hvis
    // en kritisk underliggende tjeneste er nede, "degraded" ved ikke-kritisk
    // utage, ellers "operational". Mongo er implisitt kritisk for alt siden
    // all persistent data ligger der.
    const components: PublicStatusResponse["components"] = {
      // Innlogging: Clerk + Mongo (begge kritiske)
      authentication: {
        status: componentStatus([deps.clerk, deps.mongo]),
      },
      // KI-chat: Anthropic + Mongo (begge kritiske)
      aiChat: {
        status: componentStatus([deps.anthropic, deps.mongo]),
      },
      // Kunnskapsbase: Mongo (kritisk), Pinecone + Cohere (ikke-kritisk —
      // chat fungerer uten RAG-kontekst og reranking)
      knowledgeBase: {
        status: componentStatus([deps.mongo, deps.pinecone, deps.cohere]),
      },
      // Varsler: BullMQ + Redis (ikke-kritisk, men degradert)
      notifications: {
        status: componentStatus([deps.bullmq, deps.redis]),
      },
      // Canvas: speiler circuit breaker-staten i `canvasCircuit`. Vi mapper
      // direkte i stedet for å bruke `componentStatus`, fordi den fellesfunksjonen
      // behandler `unknown` på ikke-kritiske tjenester som "operational" — for
      // Canvas vil vi tvert imot at HALF_OPEN (status="unknown") skal vises som
      // "degraded", siden det signaliserer aktiv recovery etter trippet breaker.
      canvas: {
        status:
          deps.canvas.status === "down"
            ? "down"
            : deps.canvas.status === "unknown"
              ? "degraded"
              : "operational",
      },
    };

    // Announcement-lesing KAN feile hvis Mongo er nede. Isoler i try-catch så
    // status-siden fortsatt fungerer (og korrekt rapporterer bucket-status).
    let activeAnnouncement: {
      severity: "info" | "warning" | "critical";
      melding: string;
      updatedAt: Date;
    } | null = null;
    try {
      // `showOnStatusPage: true` filtrerer ut meldinger admin kun ville vist
      // i banneret til innloggede brukere.
      const found = await SystemAnnouncement.findOne({
        singletonKey: "global",
        active: true,
        showOnStatusPage: true,
      })
        .select("severity melding updatedAt")
        .lean();
      if (found) {
        activeAnnouncement = {
          severity: found.severity,
          melding: found.melding,
          updatedAt: found.updatedAt,
        };
      }
    } catch (mongoErr) {
      logger.warn(
        { err: mongoErr },
        "Kunne ikke hente systemmelding for public status — Mongo nede? Rapporterer status uten melding.",
      );
    }

    const response: PublicStatusResponse = {
      overall: computeOverall(components),
      timestamp: new Date().toISOString(),
      components,
      announcement: activeAnnouncement
        ? {
            severity: activeAnnouncement.severity,
            melding: activeAnnouncement.melding,
            oppdatertAt: activeAnnouncement.updatedAt.toISOString(),
          }
        : null,
    };

    // Valider mot schema før vi cacher og sender (garanti for public kontrakt)
    const validated = PublicStatusResponseSchema.parse(response);

    // 3. Fyll cache (best-effort — fallback fungerer uansett hvis Redis nede)
    try {
      await setCache(CACHE_KEY, JSON.stringify(validated), CACHE_TTL_SECONDS);
    } catch (err) {
      logger.warn({ err }, "Kunne ikke cache public status");
    }

    return res.json(validated);
  } catch (err) {
    return sendUnknownError(res, err, { kontekst: "hent public status" });
  }
});
