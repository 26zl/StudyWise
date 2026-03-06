/**
 * Canvas Sync Service
 *
 * Synkroniserer Canvas-data (emner, moduler, oppgaver, kunngjøringer) til Redis
 * for rask oppslag under KI-chat. Hver bruker kan trigge synkronisering via
 * sin Canvas API-token.
 *
 * Redis-nøkkelstruktur:
 *   canvas:user:{userId}:emner                    — liste over aktive emner (JSON)
 *   canvas:user:{userId}:emne:{courseId}:meta      — emne-metadata (JSON)
 *   canvas:user:{userId}:emne:{courseId}:moduler    — moduler med items (JSON)
 *   canvas:user:{userId}:emne:{courseId}:oppgaver   — oppgaver (JSON)
 *   canvas:user:{userId}:emne:{courseId}:kunngjøringer — kunngjøringer (JSON)
 *   canvas:user:{userId}:file:{fileId}:content        — PDF-innhold (JSON)
 *   canvas:user:{userId}:syncMeta                   — siste sync tidspunkt + hash
 *
 * Invalideringslogikk:
 *   - SHA-256 hash av innhold — kun oppdater Redis hvis data faktisk endret seg
 *   - TTL 3600s (1 time) på alle nøkler
 *   - Manuell invalidering via invalidateUserCanvasCache()
 */

import crypto from "crypto";
import pLimit from "p-limit";
import { logger } from "../utils/logger.js";
import { getCache, setCache, isRedisReady, invalidateCacheByPattern } from "../cache/redis.js";
import {
  fetchCoursesForKI,
  fetchModules,
  fetchAssignments,
  fetchCourseAnnouncements,
  fetchPdfContent,
  fetchFileMetadata,
} from "../rutere/canvas/canvasService.js";

// ─── Konstanter ────────────────────────────────────────────

/** TTL for synkroniserte Canvas-data i Redis (1 time) */
const SYNC_CACHE_TTL = 3600;

/** Maks samtidige Canvas API-kall under synkronisering */
const SYNC_CONCURRENCY = 3;

/** Minimum intervall mellom synkroniseringer per bruker (sekunder) */
const MIN_SYNC_INTERVAL_S = 300; // 5 minutter

/** Maks antall PDF-filer å ekstrahere per synkronisering */
const MAX_PDFS_PER_SYNC = 20;

// ─── Typer ─────────────────────────────────────────────────

interface SyncMeta {
  lastSyncAt: string; // ISO timestamp
  courseHashes: Record<string, string>; // courseId → SHA-256 hash
}

export interface SyncResult {
  synced: boolean;
  courses: {
    total: number;
    updated: number;
    unchanged: number;
    failed: number;
  };
  durationMs: number;
}

// ─── Hjelpefunksjoner ──────────────────────────────────────

/** Genererer SHA-256 hash av en streng */
function sha256(data: string): string {
  return crypto.createHash("sha256").update(data, "utf8").digest("hex");
}

/** Bygger Redis-nøkkel med bruker-prefiks */
function userKey(userId: string, ...parts: string[]): string {
  return `canvas:user:${userId}:${parts.join(":")}`;
}

// ─── Hovedfunksjon ─────────────────────────────────────────

/**
 * Synkroniserer Canvas-data for en bruker til Redis.
 *
 * Flyt:
 * 1. Sjekk om Redis er tilgjengelig
 * 2. Sjekk om det er for tidlig å synkronisere igjen (rate limiting)
 * 3. Hent aktive emner fra Canvas API
 * 4. For hvert emne: hent moduler, oppgaver, kunngjøringer
 * 5. Sammenlign SHA-256 hash — kun oppdater hvis data endret
 * 6. Lagre sync-metadata med tidspunkt
 *
 * @param userId - Brukerens lokale ID (MongoDB _id)
 * @param canvasToken - Dekryptert Canvas API-token
 * @returns SyncResult med statistikk
 */
export async function syncCanvasDataForUser(
  userId: string,
  canvasToken: string,
): Promise<SyncResult> {
  const startTime = Date.now();

  if (!isRedisReady()) {
    logger.warn({ userId }, "Canvas sync avbrutt — Redis ikke tilgjengelig");
    return { synced: false, courses: { total: 0, updated: 0, unchanged: 0, failed: 0 }, durationMs: 0 };
  }

  // Rate limiting: Sjekk om brukeren nylig har synkronisert
  const syncMetaKey = userKey(userId, "syncMeta");
  const existingMeta = await getCache(syncMetaKey);
  if (existingMeta) {
    try {
      const meta: SyncMeta = JSON.parse(existingMeta);
      const secondsSinceLast = (Date.now() - new Date(meta.lastSyncAt).getTime()) / 1000;
      if (secondsSinceLast < MIN_SYNC_INTERVAL_S) {
        logger.info(
          { userId, secondsSinceLast: Math.round(secondsSinceLast), minInterval: MIN_SYNC_INTERVAL_S },
          "Canvas sync hoppet over — for kort tid siden forrige sync",
        );
        return { synced: false, courses: { total: 0, updated: 0, unchanged: 0, failed: 0 }, durationMs: 0 };
      }
    } catch {
      // Ugyldig meta — fortsett med sync
    }
  }

  // Hent aktive emner
  let courses;
  try {
    const result = await fetchCoursesForKI(canvasToken);
    courses = result.data;
  } catch (error) {
    logger.error({ err: error, userId }, "Kunne ikke hente emner for Canvas sync");
    return { synced: false, courses: { total: 0, updated: 0, unchanged: 0, failed: 0 }, durationMs: Date.now() - startTime };
  }

  if (courses.length === 0) {
    logger.info({ userId }, "Ingen aktive emner funnet for Canvas sync");
    return { synced: true, courses: { total: 0, updated: 0, unchanged: 0, failed: 0 }, durationMs: Date.now() - startTime };
  }

  // Lagre emneliste
  const emneListe = courses.map((c) => ({
    id: c.id,
    name: c.name,
    course_code: c.course_code,
  }));
  await setCache(userKey(userId, "emner"), JSON.stringify(emneListe), SYNC_CACHE_TTL);

  // Hent eksisterende hashes for diff-sjekk
  const previousMeta: SyncMeta = existingMeta
    ? (() => { try { return JSON.parse(existingMeta); } catch { return { lastSyncAt: "", courseHashes: {} }; } })()
    : { lastSyncAt: "", courseHashes: {} };

  const newHashes: Record<string, string> = {};
  let updated = 0;
  let unchanged = 0;
  let failed = 0;

  // Synkroniser hvert emne med begrenset concurrency
  const limit = pLimit(SYNC_CONCURRENCY);

  await Promise.allSettled(
    courses.map((course) =>
      limit(async () => {
        const courseId = String(course.id);
        try {
          // Hent data parallelt for dette emnet
          const [modulesResult, assignmentsResult, announcementsResult] = await Promise.allSettled([
            fetchModules(canvasToken, course.id),
            fetchAssignments(canvasToken, course.id),
            fetchCourseAnnouncements(canvasToken, course.id),
          ]);

          const moduler = modulesResult.status === "fulfilled" ? modulesResult.value.data : [];
          const oppgaver = assignmentsResult.status === "fulfilled" ? assignmentsResult.value.data : [];
          const kunngjøringer = announcementsResult.status === "fulfilled" ? announcementsResult.value.data : [];

          // Bygg data-objekt for hashing
          const courseData = {
            meta: {
              id: course.id,
              name: course.name,
              course_code: course.course_code,
            },
            moduler,
            oppgaver,
            kunngjøringer,
          };

          // Hash for å sjekke om data har endret seg (ikke sikkerhetskritisk — cache invalidering)
          const dataStr = JSON.stringify(courseData);
          const hash = sha256(dataStr);
          newHashes[courseId] = hash;

          const previousHash = previousMeta.courseHashes[courseId];
          // eslint-disable-next-line security/detect-possible-timing-attacks
          if (previousHash === hash) {
            // Data uendret — hopp over skriving, bare oppdater TTL
            unchanged++;
            // Forny TTL på eksisterende nøkler
            const keys = ["meta", "moduler", "oppgaver", "kunngjøringer"];
            await Promise.allSettled(
              keys.map(async (k) => {
                const existing = await getCache(userKey(userId, "emne", courseId, k));
                if (existing) {
                  await setCache(userKey(userId, "emne", courseId, k), existing, SYNC_CACHE_TTL);
                }
              }),
            );
          } else {
            // Data endret — skriv til Redis
            await Promise.all([
              setCache(
                userKey(userId, "emne", courseId, "meta"),
                JSON.stringify(courseData.meta),
                SYNC_CACHE_TTL,
              ),
              setCache(
                userKey(userId, "emne", courseId, "moduler"),
                JSON.stringify(courseData.moduler),
                SYNC_CACHE_TTL,
              ),
              setCache(
                userKey(userId, "emne", courseId, "oppgaver"),
                JSON.stringify(courseData.oppgaver),
                SYNC_CACHE_TTL,
              ),
              setCache(
                userKey(userId, "emne", courseId, "kunngjøringer"),
                JSON.stringify(courseData.kunngjøringer),
                SYNC_CACHE_TTL,
              ),
            ]);

            updated++;
            logger.info(
              { userId, courseId, courseName: course.name },
              "Canvas emne-data oppdatert i Redis",
            );
          }

          // ── PDF-ekstraksjon for File-type module items ──
          // Kjører uavhengig av om kursdata endret seg — PDF har egen hash-sjekk
          let pdfCount = 0;
          for (const mod of moduler) {
            if (pdfCount >= MAX_PDFS_PER_SYNC) break;
            if (!mod.items || mod.items.length === 0) continue;

            for (const item of mod.items) {
              if (pdfCount >= MAX_PDFS_PER_SYNC) break;
              if (item.type !== "File") continue;
              if (!item.title.toLowerCase().endsWith(".pdf")) continue;
              const contentId = item.content_id;
              if (!contentId) continue;

              try {
                const fileKey = userKey(userId, "file", String(contentId), "content");

                // Hent filmetadata for endringsindikatoren (updated_at)
                const { data: fileData } = await fetchFileMetadata(canvasToken, contentId);
                const metaHash = sha256(`${fileData.id}:${fileData.updated_at}:${fileData.size}`);

                // Sjekk om vi allerede har innhold med samme hash
                const existingRaw = await getCache(fileKey);
                if (existingRaw) {
                  try {
                    const existing = JSON.parse(existingRaw);
                    if (existing.hash === metaHash) {
                      // Fil uendret — forny TTL
                      await setCache(fileKey, existingRaw, SYNC_CACHE_TTL);
                      continue;
                    }
                  } catch {
                    // Ugyldig JSON — hent på nytt
                  }
                }

                // Last ned og pars PDF
                const pdfResult = await fetchPdfContent(canvasToken, {
                  id: fileData.id,
                  filename: fileData.filename,
                  url: fileData.url,
                  size: fileData.size,
                  mime_type: fileData.mime_type,
                });

                if (pdfResult) {
                  await setCache(
                    fileKey,
                    JSON.stringify({
                      content: pdfResult.content,
                      hash: metaHash,
                      filename: fileData.filename,
                      displayName: fileData.display_name,
                      truncated: pdfResult.truncated,
                    }),
                    SYNC_CACHE_TTL,
                  );
                  pdfCount++;
                  logger.info(
                    { userId, fileId: contentId, filename: fileData.filename },
                    "PDF-innhold lagret i Redis under sync",
                  );
                }
              } catch (error) {
                logger.warn(
                  { err: error, userId, contentId, title: item.title },
                  "Feil ved PDF-ekstraksjon under sync",
                );
              }
            }
          }
        } catch (error) {
          failed++;
          logger.warn(
            { err: error, userId, courseId, courseName: course.name },
            "Feil ved synkronisering av emne",
          );
        }
      }),
    ),
  );

  // Lagre sync-metadata
  const syncMeta: SyncMeta = {
    lastSyncAt: new Date().toISOString(),
    courseHashes: newHashes,
  };
  await setCache(syncMetaKey, JSON.stringify(syncMeta), SYNC_CACHE_TTL);

  const durationMs = Date.now() - startTime;
  logger.info(
    { userId, total: courses.length, updated, unchanged, failed, durationMs },
    "Canvas sync fullført",
  );

  return {
    synced: true,
    courses: { total: courses.length, updated, unchanged, failed },
    durationMs,
  };
}

// ─── Cache-invalidering ────────────────────────────────────

/**
 * Invaliderer all cachet Canvas-data for en bruker.
 * Brukes når brukeren oppdaterer sitt Canvas-token eller logger ut.
 */
export async function invalidateUserCanvasCache(userId: string): Promise<void> {
  if (!isRedisReady()) return;

  try {
    await invalidateCacheByPattern(`canvas:user:${userId}:*`);
    logger.info({ userId }, "Canvas cache invalidert for bruker");
  } catch (error) {
    logger.warn({ err: error, userId }, "Feil ved invalidering av Canvas cache");
  }
}

/**
 * Sjekker om en bruker har synkronisert Canvas-data i Redis.
 */
export async function hasCanvasSyncData(userId: string): Promise<boolean> {
  if (!isRedisReady()) return false;
  const meta = await getCache(userKey(userId, "syncMeta"));
  return meta !== null;
}

/**
 * Henter synkroniserings-metadata for en bruker.
 */
export async function getSyncMeta(userId: string): Promise<SyncMeta | null> {
  if (!isRedisReady()) return null;
  const raw = await getCache(userKey(userId, "syncMeta"));
  if (!raw) return null;
  try {
    return JSON.parse(raw) as SyncMeta;
  } catch {
    return null;
  }
}
