/**
 * Global systemmelding — public endpoint (krever innlogging).
 *
 * Leses av alle innloggede brukere på frontend for å rendre banner hvis admin
 * har publisert en melding. Adminpanelet bruker `/api/admin/announcement`
 * for å sette/oppdatere/slette meldingen.
 *
 * Redis-cache med 30s TTL: banneret polles hvert 2. minutt per bruker, så for
 * N aktive brukere ville DB fått N/120 kall/sekund uten cache. Caching reduserer
 * det til maks 1 DB-lookup per 30s på tvers av ALLE dyner. Cache invalideres
 * av admin-ruten ved publisering/deaktivering via `invalidateAnnouncementCache()`
 * — siden Redis deles mellom dyner, ser alle brukere nye meldinger umiddelbart.
 * Fallback til Mongo hvis Redis er nede.
 */

import { Router } from "express";
import { SystemAnnouncement } from "../database/models/SystemAnnouncement.js";
import { sendUnknownError } from "../utils/apiError.js";
import { rateLimitMe } from "../middleware/rate-limit.js";
import { getCache, setCache, deleteCacheKeys } from "../cache/redis.js";
import { logger } from "../utils/logger.js";

export const announcementRouter = Router();

const CACHE_KEY = "announcement:global";
const CACHE_TTL_SECONDS = 30;

type CachedResponse =
  | { active: false }
  | {
      active: true;
      severity: "info" | "warning" | "critical";
      melding: string;
      oppdatertAt: string;
      dismissible: boolean;
    };

/**
 * Invaliderer Redis-cache. Kalles av admin-ruten etter publish/delete slik at
 * alle dyner (og alle brukere) ser ny tilstand umiddelbart. Best-effort:
 * feiler stille hvis Redis er nede — cache utløper uansett etter TTL.
 *
 * Returnerer true hvis invalideringen lyktes, false hvis Redis var nede.
 * Admin-ruten inkluderer dette i responsen så driftsvakt ser at andre dyner
 * kan vise foreldet melding i opptil 30s til neste cache-miss.
 */
export async function invalidateAnnouncementCache(): Promise<boolean> {
  try {
    await deleteCacheKeys([CACHE_KEY]);
    return true;
  } catch (err) {
    logger.warn({ err }, "Kunne ikke invalidere announcement-cache");
    return false;
  }
}

announcementRouter.get("/announcement", rateLimitMe, async (_req, res) => {
  try {
    // 1. Prøv cache (returnerer null hvis Redis nede eller cache miss)
    const cached = await getCache(CACHE_KEY);
    if (cached) {
      try {
        return res.json(JSON.parse(cached) as CachedResponse);
      } catch {
        // Korrupt cache-verdi — fall gjennom til DB-lookup
      }
    }

    // 2. Cache miss eller Redis nede — les fra Mongo
    // `showInBanner: true` filtrerer ut meldinger admin har valgt å KUN vise på
    // /status-siden (ikke som banner). Slik kan admin f.eks. varsle om kjent
    // utage offentlig uten å forstyrre innloggede brukere med banner.
    const existing = await SystemAnnouncement.findOne({
      singletonKey: "global",
      active: true,
      showInBanner: true,
    })
      .select("severity melding dismissible updatedAt")
      .lean();

    const value: CachedResponse = existing
      ? {
          active: true,
          severity: existing.severity,
          melding: existing.melding,
          oppdatertAt: existing.updatedAt.toISOString(),
          dismissible: existing.dismissible,
        }
      : { active: false };

    // 3. Fyll cache (best-effort — fallback fungerer uansett)
    try {
      await setCache(CACHE_KEY, JSON.stringify(value), CACHE_TTL_SECONDS);
    } catch {
      /* Redis nede — ikke kritisk, direkte lesing fungerer */
    }

    return res.json(value);
  } catch (err) {
    return sendUnknownError(res, err, { kontekst: "hent systemmelding" });
  }
});
