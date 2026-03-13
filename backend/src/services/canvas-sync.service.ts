/**
 * Canvas Sync Service
 *
 * Synkroniserer Canvas-data til en hybridmodell:
 * - Redis: lett strukturdata, sync-status og kortlivede nøkler
 * - MongoDB: tungt filinnhold som chunks + embeddings for KI-søk
 *
 * Redis-nøkkelstruktur:
 *   canvas:user:{userId}:emner                    — liste over aktive emner (JSON)
 *   canvas:user:{userId}:emne:{courseId}:meta      — emne-metadata (JSON)
 *   canvas:user:{userId}:emne:{courseId}:moduler    — moduler med items (JSON)
 *   canvas:user:{userId}:emne:{courseId}:oppgaver   — oppgaver (JSON)
 *   canvas:user:{userId}:emne:{courseId}:kunngjøringer — kunngjøringer (JSON)
 *   canvas:user:{userId}:syncMeta                   — siste sync tidspunkt + hash
 *
 * Invalideringslogikk:
 *   - SHA-256 hash av kursdata — oppdater Redis kun ved faktiske endringer
 *   - SHA-256 hash av filer — unngå unødvendig re-ekstraksjon/embedding
 *   - TTL 3600s (1 time) kun på Redis-data
 *   - Manuell invalidering via invalidateUserCanvasCache()
 */

import crypto from "crypto";
import pLimit from "p-limit";
import { logger } from "../utils/logger.js";
import {
  deleteCacheKeys,
  getCache,
  setCache,
  isRedisReady,
  invalidateCacheByPattern,
} from "../cache/redis.js";
import {
  fetchCoursesForKI,
  fetchModules,
  fetchAssignments,
  fetchCourseAnnouncements,
  fetchPdfContent,
  fetchFileContent,
  fetchFileMetadata,
} from "../rutere/canvas/canvasService.js";
import { isSupportedFileType, extractTextFromFile } from "./fileExtractor.js";
import {
  createChunksFromContent,
  type ContentChunk,
} from "./chunk.service.js";
import {
  deleteMissingFilesForCourse,
  deleteStoredCourseContent,
  deleteStoredUserContent,
  getStoredChunksForFile,
  getStoredFileStatusForCourse,
  isEmbeddingAvailable,
  updateStoredFileMetadata,
  upsertStoredFileContent,
} from "./embedding.service.js";

// ─── Konstanter ────────────────────────────────────────────

/** TTL for synkroniserte Canvas-data i Redis (30 min) — reduserer Redis-bruk ved mange brukere/emner */
const SYNC_CACHE_TTL = 1800;

/** Maks samtidige Canvas API-kall under synkronisering */
const SYNC_CONCURRENCY = 3;

/** Minimum intervall mellom synkroniseringer per bruker (sekunder) */
const MIN_SYNC_INTERVAL_S = 300; // 5 minutter

/** TTL for sync-status flagg i Redis */
const SYNC_STATUS_TTL = 300;

/** Maks antall filer å ekstrahere per synkronisering */
const MAX_FILES_PER_SYNC = 20;

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

// ─── Sync-tracking ─────────────────────────────────────────

/** Holder styr på pågående synkroniseringer per bruker */
const activeSyncs = new Map<string, Promise<SyncResult>>();

/** Sjekker om en bruker har en pågående synkronisering */
export function isSyncing(userId: string): boolean {
  return activeSyncs.has(userId);
}

/** Venter på at en pågående sync fullføres (med timeout). Returnerer null hvis ingen sync pågår. */
export async function waitForSync(userId: string, timeoutMs: number): Promise<SyncResult | null> {
  const pending = activeSyncs.get(userId);
  if (!pending) return null;

  const timeout = new Promise<null>((resolve) => setTimeout(() => resolve(null), timeoutMs));
  return Promise.race([
    pending.catch((err) => {
      logger.warn({ err, userId }, "Canvas sync feilet mens en forespørsel ventet - fortsetter uten sync-resultat");
      return null;
    }),
    timeout,
  ]);
}

// ─── Hjelpefunksjoner ──────────────────────────────────────

/** Genererer SHA-256 hash av en streng */
function sha256(data: string): string {
  return crypto.createHash("sha256").update(data, "utf8").digest("hex");
}

/** Bygger Redis-nøkkel med bruker-prefiks */
export function userKey(userId: string, ...parts: string[]): string {
  return `canvas:user:${userId}:${parts.join(":")}`;
}

/** Redis-nøkkel for sync-status ("running" | "done") */
function syncStatusKey(userId: string): string {
  return userKey(userId, "sync", "status");
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
/**
 * Avbrytbar sync: når signal aborteres (f.eks. når chat-respons er ferdig),
 * stopper sync raskt i stedet for å fortsette i bakgrunnen.
 */
export async function syncCanvasDataForUser(
  userId: string,
  canvasToken: string,
  baseUrl?: string,
  signal?: AbortSignal,
): Promise<SyncResult> {
  // Hvis det allerede pågår en sync for denne brukeren, vent på den
  const existing = activeSyncs.get(userId);
  if (existing) return existing;

  const promise = _doSync(userId, canvasToken, baseUrl, signal);
  activeSyncs.set(userId, promise);

  // Sett Redis sync-status til "running" med timestamp slik at andre prosesser kan polle
  // og oppdage stale status (eldre enn SYNC_STATUS_TTL sekunder)
  if (isRedisReady()) {
    await setCache(
      syncStatusKey(userId),
      JSON.stringify({ status: "running", startedAt: Date.now() }),
      SYNC_STATUS_TTL,
    ).catch((err) => logger.warn({ err, userId }, "Kunne ikke sette sync-status til 'running' i Redis"));
  }

  try {
    return await promise;
  } finally {
    activeSyncs.delete(userId);
    if (isRedisReady()) {
      await setCache(
        syncStatusKey(userId),
        JSON.stringify({ status: "done", completedAt: Date.now() }),
        SYNC_STATUS_TTL,
      ).catch((err) => logger.warn({ err, userId }, "Kunne ikke sette sync-status til 'done' i Redis"));
    }
  }
}

async function _doSync(
  userId: string,
  canvasToken: string,
  baseUrl?: string,
  signal?: AbortSignal,
): Promise<SyncResult> {
  const startTime = Date.now();

  if (signal?.aborted) {
    return { synced: false, courses: { total: 0, updated: 0, unchanged: 0, failed: 0 }, durationMs: Date.now() - startTime };
  }

  if (!baseUrl) {
    logger.warn({ userId }, "canvas-sync: baseUrl mangler — avbryter sync");
    return { synced: false, courses: { total: 0, updated: 0, unchanged: 0, failed: 0 }, durationMs: 0 };
  }

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
    const result = await fetchCoursesForKI(canvasToken, baseUrl);
    courses = result.data;
  } catch (error) {
    logger.error({ err: error, userId }, "Kunne ikke hente emner for Canvas sync");
    return { synced: false, courses: { total: 0, updated: 0, unchanged: 0, failed: 0 }, durationMs: Date.now() - startTime };
  }

  if (courses.length === 0) {
    logger.info({ userId }, "Ingen aktive emner funnet for Canvas sync");
    await Promise.allSettled([
      invalidateCacheByPattern(`canvas:user:${userId}:emne:*`),
      deleteStoredUserContent(userId),
      invalidateUserKISessionCache(userId),
    ]);
    // Overskriv Redis med tom liste og oppdater syncMeta slik at loadCanvasContext ikke serverer stale data
    await setCache(userKey(userId, "emner"), "[]", SYNC_CACHE_TTL);
    const emptyMeta: SyncMeta = { lastSyncAt: new Date().toISOString(), courseHashes: {} };
    await setCache(syncMetaKey, JSON.stringify(emptyMeta), SYNC_CACHE_TTL);
    return { synced: true, courses: { total: 0, updated: 0, unchanged: 0, failed: 0 }, durationMs: Date.now() - startTime };
  }

  // Lagre emneliste
  const emneListe = courses.map((c) => ({
    id: c.id,
    name: c.name,
    course_code: c.course_code ?? "",
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

  // Forny sync-status TTL periodisk under lang-kjørende syncs
  // slik at andre prosesser ikke antar at sync er stale
  const syncStatusRefreshInterval = setInterval(() => {
    if (signal?.aborted) {
      clearInterval(syncStatusRefreshInterval);
      return;
    }
    if (isRedisReady()) {
      setCache(
        syncStatusKey(userId),
        JSON.stringify({ status: "running", startedAt: Date.now() }),
        SYNC_STATUS_TTL,
      ).catch((err) => logger.warn({ err, userId }, "Kunne ikke fornye sync-status TTL"));
    }
  }, Math.floor(SYNC_STATUS_TTL * 1000 * 0.5)); // Forny ved halveis TTL

  // Synkroniser hvert emne med begrenset concurrency
  const limit = pLimit(SYNC_CONCURRENCY);

  await Promise.allSettled(
    courses.map((course) =>
      limit(async () => {
        if (signal?.aborted) return;
        const courseId = String(course.id);
        try {
          // Hent data parallelt for dette emnet
          const [modulesResult, assignmentsResult, announcementsResult] = await Promise.allSettled([
            fetchModules(canvasToken, course.id, baseUrl),
            fetchAssignments(canvasToken, course.id, { baseUrl }),
            fetchCourseAnnouncements(canvasToken, course.id, baseUrl),
          ]);

          const moduler = modulesResult.status === "fulfilled" ? modulesResult.value.data : [];
          const oppgaver = assignmentsResult.status === "fulfilled" ? assignmentsResult.value.data : [];
          const kunngjøringer = announcementsResult.status === "fulfilled" ? announcementsResult.value.data : [];

          // Bygg data-objekt for hashing
          const courseData = {
            meta: {
              id: course.id,
              name: course.name,
              course_code: course.course_code ?? "",
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

          // ── Filekstraksjon for File-type module items ──
          // Tungt filinnhold lagres i MongoDB, ikke Redis.
          let fileCount = 0;
          let reachedFileLimit = false;
          const keepFileIds = new Set<number>();
          const storedFileStatus = await getStoredFileStatusForCourse(userId, courseId);

          for (const mod of moduler) {
            if (signal?.aborted) break;
            if (fileCount >= MAX_FILES_PER_SYNC) {
              reachedFileLimit = true;
              break;
            }
            if (!mod.items || mod.items.length === 0) continue;

            for (const item of mod.items) {
              if (signal?.aborted) break;
              if (fileCount >= MAX_FILES_PER_SYNC) {
                reachedFileLimit = true;
                break;
              }
              if (item.type !== "File") continue;

              const contentId = item.content_id;
              if (!contentId) continue;

              try {
                const legacyFileKey = userKey(userId, "file", String(contentId), "content");
                const { data: fileData } = await fetchFileMetadata(canvasToken, contentId, baseUrl);

                if (!isSupportedFileType(fileData.filename)) {
                  continue;
                }

                keepFileIds.add(contentId);
                const metaHash = sha256(`${fileData.id}:${fileData.updated_at}:${fileData.size}`);
                const existingStatus = storedFileStatus.get(contentId);

                if (existingStatus?.fileHash === metaHash) {
                  if (!existingStatus.hasEmbedding && isEmbeddingAvailable()) {
                    const storedChunks = await getStoredChunksForFile(userId, courseId, contentId);
                    if (storedChunks.length > 0) {
                      await upsertStoredFileContent({
                        userId,
                        courseId,
                        courseName: course.name,
                        moduleId: mod.id,
                        moduleTitle: mod.name,
                        fileName: fileData.filename,
                        fileId: contentId,
                        fileHash: metaHash,
                        chunks: storedChunks,
                      });
                      await deleteCacheKeys([legacyFileKey]);
                      continue;
                    }
                  }

                  await updateStoredFileMetadata(userId, courseId, contentId, {
                    courseName: course.name,
                    moduleTitle: mod.name,
                    fileName: fileData.filename,
                    fileHash: metaHash,
                  });
                  await deleteCacheKeys([legacyFileKey]);
                  continue;
                }

                const isPdf =
                  fileData.mime_type === "application/pdf" ||
                  fileData.filename.toLowerCase().endsWith(".pdf");

                let content: string | null = null;

                if (isPdf) {
                  const pdfResult = await fetchPdfContent(canvasToken, {
                    id: fileData.id,
                    filename: fileData.filename,
                    url: fileData.url,
                    size: fileData.size,
                    mime_type: fileData.mime_type,
                  }, baseUrl);
                  if (pdfResult) {
                    content = pdfResult.content;
                  }
                } else {
                  const buf = await fetchFileContent(canvasToken, {
                    id: fileData.id,
                    filename: fileData.filename,
                    url: fileData.url,
                    size: fileData.size,
                  }, baseUrl);
                  if (buf) {
                    const result = await extractTextFromFile(buf, fileData.filename);
                    if (result && result.content.trim().length > 0) {
                      content = result.content;
                    }
                  }
                }

                if (!content || content.trim().length === 0) {
                  logger.info(
                    { userId, courseId, fileId: contentId, filename: fileData.filename },
                    "Fil ga ikke ekstraherbart innhold — beholder eventuell tidligere lagring",
                  );
                  continue;
                }

                const chunks: ContentChunk[] = createChunksFromContent(content, {
                  courseId,
                  courseName: course.name,
                  moduleTitle: mod.name,
                  fileName: fileData.filename,
                  fileId: contentId,
                });

                if (chunks.length === 0) {
                  continue;
                }

                await upsertStoredFileContent({
                  userId,
                  courseId,
                  courseName: course.name,
                  moduleId: mod.id,
                  moduleTitle: mod.name,
                  fileName: fileData.filename,
                  fileId: contentId,
                  fileHash: metaHash,
                  chunks,
                });
                await deleteCacheKeys([legacyFileKey]);
                fileCount++;
              } catch (error) {
                logger.warn(
                  { err: error, userId, contentId, title: item.title },
                  "Feil ved filekstraksjon under sync",
                );
              }
            }
          }

          if (!reachedFileLimit) {
            const removedCount = await deleteMissingFilesForCourse(
              userId,
              courseId,
              [...keepFileIds],
            );
            if (removedCount > 0) {
              logger.info(
                { userId, courseId, removedCount },
                "Slettet lagrede filer som ikke lenger finnes i kurset",
              );
            }
          } else {
            logger.info(
              { userId, courseId, maxFilesPerSync: MAX_FILES_PER_SYNC },
              "Hopper over sletting av manglende filer fordi filgrensen ble nådd",
            );
          }

          await deleteCacheKeys([userKey(userId, "emne", courseId, "chunks")]);
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

  clearInterval(syncStatusRefreshInterval);

  if (signal?.aborted) {
    logger.info({ userId }, "Canvas sync avbrutt (forespørsel ferdig)");
    return {
      synced: false,
      courses: { total: courses.length, updated, unchanged, failed },
      durationMs: Date.now() - startTime,
    };
  }

  const removedCourseIds = Object.keys(previousMeta.courseHashes).filter(
    (courseId) => !(courseId in newHashes),
  );
  if (removedCourseIds.length > 0) {
    await Promise.allSettled(
      removedCourseIds.map(async (removedCourseId) => {
        await Promise.allSettled([
          invalidateCacheByPattern(userKey(userId, "emne", removedCourseId, "*")),
          deleteStoredCourseContent(userId, removedCourseId),
        ]);
      }),
    );
    logger.info(
      { userId, removedCourseIds },
      "Fjernet lagret data for kurs som ikke lenger er aktive",
    );
  }

  // Lagre sync-metadata
  const syncMeta: SyncMeta = {
    lastSyncAt: new Date().toISOString(),
    courseHashes: newHashes,
  };
  await setCache(syncMetaKey, JSON.stringify(syncMeta), SYNC_CACHE_TTL);
  await invalidateUserKISessionCache(userId);

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

export async function invalidateUserKISessionCache(userId: string): Promise<void> {
  try {
    await invalidateCacheByPattern(`ki:session:${userId}:*`);
  } catch (error) {
    logger.warn({ err: error, userId }, "Feil ved invalidering av KI session-cache");
  }
}

export async function clearUserCanvasRuntimeState(userId: string): Promise<void> {
  try {
    const tasks: Array<Promise<unknown>> = [invalidateUserKISessionCache(userId)];

    if (isRedisReady()) {
      tasks.push(invalidateCacheByPattern(userKey(userId, "sync", "status")));
    }

    await Promise.allSettled(tasks);
    logger.info({ userId }, "Canvas-runtime state ryddet for bruker");
  } catch (error) {
    logger.warn({ err: error, userId }, "Feil ved rydding av Canvas-runtime state");
  }
}

/**
 * Invaliderer all cachet Canvas-data og lagret KI-innhold for en bruker.
 * Brukes når brukeren oppdaterer eller sletter sitt Canvas-token.
 */
export async function invalidateUserCanvasCache(
  userId: string,
  options: { strictContentDeletion?: boolean } = {},
): Promise<{ contentEmbeddingDeleted: number }> {
  const { strictContentDeletion = false } = options;
  const tasks = {
    contentDeletion: deleteStoredUserContent(userId),
    sessionInvalidation: invalidateUserKISessionCache(userId),
    redisInvalidation: isRedisReady()
      ? invalidateCacheByPattern(`canvas:user:${userId}:*`)
      : Promise.resolve(),
  };

  const [contentResult, sessionResult, redisResult] = await Promise.allSettled([
    tasks.contentDeletion,
    tasks.sessionInvalidation,
    tasks.redisInvalidation,
  ]);

  if (contentResult.status === "rejected") {
    logger.warn({ err: contentResult.reason, userId }, "Feil ved sletting av lagret Canvas-/KI-innhold");
    if (strictContentDeletion) {
      throw contentResult.reason;
    }
  }

  if (sessionResult.status === "rejected") {
    logger.warn({ err: sessionResult.reason, userId }, "Feil ved invalidering av KI-sesjonscache");
  }

  if (redisResult.status === "rejected") {
    logger.warn({ err: redisResult.reason, userId }, "Feil ved invalidering av Canvas-cache i Redis");
  }

  const contentEmbeddingDeleted = contentResult.status === "fulfilled" ? contentResult.value : 0;
  logger.info({ userId, contentEmbeddingDeleted }, "Canvas- og KI-data invalidert for bruker");
  return { contentEmbeddingDeleted };
}

/**
 * Sjekker om en bruker har synkronisert Canvas-data i Redis.
 */
export async function hasCanvasSyncData(userId: string): Promise<boolean> {
  if (!isRedisReady()) return false;
  const meta = await getCache(userKey(userId, "syncMeta"));
  return meta !== null;
}
