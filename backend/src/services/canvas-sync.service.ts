/**
 * Canvas Sync Service
 *
 * Synkroniserer Canvas-data til en hybridmodell:
 * - Redis: lett strukturdata, sync-status (TTL 2 timer — rask cache)
 * - MongoDB CanvasStructure: permanent kursstruktur (fallback når Redis TTL utløper)
 * - MongoDB ContentEmbedding: tungt filinnhold som chunks + embeddings for KI-søk
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
 *   - SHA-256 hash av kursdata — oppdater Redis/MongoDB kun ved faktiske endringer
 *   - SHA-256 hash av filer — unngå unødvendig re-ekstraksjon/embedding
 *   - TTL 7200s (2 timer) på Redis-data; MongoDB har ingen TTL (permanent)
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
  fetchPage,
} from "../rutere/canvas/canvasService.js";
import { isSupportedFileType, extractTextFromFile } from "./fileExtractor.js";
import { stripHtml } from "../utils/htmlUtils.js";
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
import { CanvasStructureModel, type ICanvasModuleItem } from "../database/models/CanvasStructure.js";
import { crawlCourseExternalUrls } from "./crawler.js";

// ─── Konstanter ────────────────────────────────────────────

/** TTL for synkroniserte Canvas-data i Redis (2 timer) — MongoDB er nå permanent fallback */
const SYNC_CACHE_TTL = 7200;

/** Maks samtidige Canvas API-kall under synkronisering */
const SYNC_CONCURRENCY = 3;

/** Minimum intervall mellom synkroniseringer per bruker (sekunder) */
const MIN_SYNC_INTERVAL_S = 300; // 5 minutter

/** TTL for sync-status flagg i Redis */
const SYNC_STATUS_TTL = 300;

/** Maks antall filer/sider å ekstrahere per synkronisering */
const MAX_FILES_PER_SYNC = 200;

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

/** Ekstra valg for _doSync */
interface SyncOptions {
  bypassRateLimit?: boolean;
  maxFiles?: number;
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

  let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<null>((resolve) => {
    timeoutHandle = setTimeout(() => resolve(null), timeoutMs);
  });
  try {
    return await Promise.race([
      pending.catch((err) => {
        logger.warn({ err, userId }, "Canvas sync feilet mens en forespørsel ventet - fortsetter uten sync-resultat");
        return null;
      }),
      timeout,
    ]);
  } finally {
    if (timeoutHandle) {
      clearTimeout(timeoutHandle);
    }
  }
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

/**
 * Beregner contentHash for et modul-item basert på tilgjengelige felter.
 * Brukes for å detektere endringer uten å måtte re-prosessere alt.
 */
function computeModuleItemHash(item: {
  id?: number;
  title?: string;
  updated_at?: string | null;
  external_url?: string;
  page_url?: string;
}): string {
  const parts = [
    String(item.id ?? ""),
    item.title ?? "",
    item.updated_at ?? "",
    item.external_url ?? "",
    item.page_url ?? "",
  ];
  return sha256(parts.join("|"));
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
  options?: SyncOptions,
): Promise<SyncResult> {
  // Hvis det allerede pågår en sync for denne brukeren, vent på den
  const existing = activeSyncs.get(userId);
  if (existing) return existing;

  const promise = _doSync(userId, canvasToken, baseUrl, signal, options);
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
  options?: SyncOptions,
): Promise<SyncResult> {
  const startTime = Date.now();
  const maxFilesPerSync = options?.maxFiles ?? MAX_FILES_PER_SYNC;

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

  // Rate limiting: Sjekk om brukeren nylig har synkronisert (kan bypasses for initial sync)
  const syncMetaKey = userKey(userId, "syncMeta");
  const existingMeta = await getCache(syncMetaKey);
  if (!options?.bypassRateLimit && existingMeta) {
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
    } catch (err) {
      logger.warn({ err, userId }, "Ugyldig sync-meta i cache — fortsetter med full sync");
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
    // Vent på invalidering og sletting FØR vi skriver ny cache-state,
    // slik at en sen invalidering ikke overskriver de nye verdiene.
    const cleanupResults = await Promise.allSettled([
      invalidateCacheByPattern(`canvas:user:${userId}:emne:*`),
      deleteStoredUserContent(userId),
      invalidateUserKISessionCache(userId),
      CanvasStructureModel.deleteMany({ userId }),
    ]);
    for (const r of cleanupResults) {
      if (r.status === "rejected") {
        logger.warn({ err: r.reason, userId }, "Feil under cleanup av tom emneliste");
      }
    }
    // Nå er det trygt å skrive tom liste og syncMeta
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

  try {
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

          // Sjekk hvilke hentinger som feilet — unngå å overskrive gyldig data med tomme lister
          const modulesFailed = modulesResult.status === "rejected";
          const assignmentsFailed = assignmentsResult.status === "rejected";
          const announcementsFailed = announcementsResult.status === "rejected";
          const anyFetchFailed = modulesFailed || assignmentsFailed || announcementsFailed;

          if (anyFetchFailed) {
            logger.warn(
              {
                userId, courseId, courseName: course.name,
                modulesFailed, assignmentsFailed, announcementsFailed,
              },
              "Delvis Canvas-henting feilet — beholder eksisterende data for dette kurset",
            );
            // Behold forrige hash slik at kurset ikke behandles som "fjernet"
            const prevHash = previousMeta.courseHashes[courseId];
            if (prevHash) newHashes[courseId] = prevHash;
            failed++;
            return;
          }

          const moduler = modulesResult.value.data;
          const oppgaver = assignmentsResult.value.data;
          const kunngjøringer = announcementsResult.value.data;

          // ── Per-item change detection ──
          // Hent lagrede item-hashes fra MongoDB for å sammenligne med innkommende data
          const previousStructure = await CanvasStructureModel.findOne(
            { userId, courseId },
            { moduler: 1 },
          ).lean();
          const previousItemHashes = new Map<
            string,
            {
              contentHash?: string;
              crawledHash?: string;
              crawledAt?: Date;
              crawledPdfs?: string[];
            }
          >();
          if (previousStructure?.moduler) {
            for (const mod of previousStructure.moduler) {
              if (!mod.items) continue;
              for (const item of mod.items) {
                if (item.id != null) {
                    previousItemHashes.set(
                      `${mod.id}:${item.id}`,
                      {
                        contentHash: item.contentHash,
                        crawledHash: item.crawledHash,
                        crawledAt: item.crawledAt,
                        crawledPdfs: item.crawledPdfs,
                      },
                    );
                  }
                }
            }
          }

          // Berik hver modul-item med contentHash og logg endringer
          const enrichedModuler = moduler.map((mod) => {
            if (!mod.items) return mod;
            const enrichedItems: ICanvasModuleItem[] = mod.items.map((item) => {
              const newContentHash = computeModuleItemHash(item);
              const itemKey = `${mod.id}:${item.id}`;
              const prev = previousItemHashes.get(itemKey);
              const enrichedItem: ICanvasModuleItem = {
                id: item.id,
                title: item.title,
                type: item.type,
                content_id: item.content_id,
                external_url: item.external_url,
                page_url: item.page_url,
                contentHash: newContentHash,
                // Behold crawledHash fra forrige sync (oppdateres kun ved ExternalUrl-crawling)
                crawledHash: prev?.crawledHash,
                // Behold crawl-metadata fra forrige sync
                crawledAt: prev?.crawledAt,
                crawledPdfs: prev?.crawledPdfs,
              };
              if (prev?.contentHash && prev.contentHash === newContentHash) {
                logger.debug(
                  { courseId, itemId: item.id, type: item.type },
                  "Canvas item uendret, hopper over",
                );
              } else {
                logger.debug(
                  { courseId, itemId: item.id, type: item.type },
                  "Canvas item endret, oppdaterer",
                );
              }
              return enrichedItem;
            });
            return { ...mod, items: enrichedItems };
          });

          // Bygg data-objekt for hashing (bruker original moduler for hash-kontinuitet)
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

          // Data som lagres i MongoDB inkluderer berikede moduler med contentHash
          const storageData = {
            ...courseData,
            moduler: enrichedModuler,
          };

          // Hash for å sjekke om data har endret seg (ikke sikkerhetskritisk — cache invalidering)
          const dataStr = JSON.stringify(courseData);
          const hash = sha256(dataStr);
          newHashes[courseId] = hash;

          const previousHash = previousMeta.courseHashes[courseId];
          // eslint-disable-next-line security/detect-possible-timing-attacks
          if (previousHash === hash) {
            // Data uendret — hopp over Redis-skriving, bare oppdater TTL
            unchanged++;
            const keyDataMap: Record<string, unknown> = {
              meta: courseData.meta,
              moduler: storageData.moduler,
              oppgaver: courseData.oppgaver,
              kunngjøringer: courseData.kunngjøringer,
            };
            const keys = Object.keys(keyDataMap);
            const ttlResults = await Promise.allSettled(
              keys.map(async (k) => {
                const existing = await getCache(userKey(userId, "emne", courseId, k));
                if (existing) {
                  await setCache(userKey(userId, "emne", courseId, k), existing, SYNC_CACHE_TTL);
                } else {
                  // Nøkkelen utløp mellom sjekk og skriving — re-populer fra ferske data
                  await setCache(userKey(userId, "emne", courseId, k), JSON.stringify(keyDataMap[k]), SYNC_CACHE_TTL);
                }
              }),
            );
            for (const r of ttlResults) {
              if (r.status === "rejected") {
                logger.warn({ err: r.reason, userId, courseId }, "Feil ved TTL-refresh for uendret kurs");
              }
            }

            // Backfill til MongoDB hvis dokumentet ikke finnes ennå
            // (eksisterende brukere som aldri fikk initial upsert)
            await CanvasStructureModel.findOneAndUpdate(
              { userId, courseId },
              {
                $setOnInsert: {
                  userId,
                  courseId,
                  courseName: course.name,
                  course_code: course.course_code ?? "",
                  moduler: storageData.moduler,
                  oppgaver: courseData.oppgaver,
                  kunngjøringer: courseData.kunngjøringer,
                  syncedAt: new Date(),
                  dataHash: hash,
                },
              },
              { upsert: true },
            ).catch((err) => {
              logger.warn({ err, userId, courseId }, "Kunne ikke backfille Canvas-struktur til MongoDB");
            });

            // Backfill contentHash/crawl-metadata på eksisterende dokumenter som mangler per-item hashes
            const missingItemHashes = enrichedModuler.some((mod) =>
              (mod.items ?? []).some((item) => !previousItemHashes.get(`${mod.id}:${item.id}`)?.contentHash),
            );
            if (missingItemHashes) {
              await CanvasStructureModel.updateOne(
                { userId, courseId },
                { $set: { moduler: storageData.moduler } },
              ).catch((err) => {
                logger.warn(
                  { err, userId, courseId },
                  "Kunne ikke backfille item-hasher på eksisterende Canvas-struktur",
                );
              });
            }
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
                JSON.stringify(storageData.moduler),
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

            // Permanent lagring i MongoDB (fallback når Redis TTL utløper)
            await CanvasStructureModel.findOneAndUpdate(
              { userId, courseId },
              {
                userId,
                courseId,
                courseName: course.name,
                course_code: course.course_code ?? "",
                moduler: storageData.moduler,
                oppgaver: courseData.oppgaver,
                kunngjøringer: courseData.kunngjøringer,
                syncedAt: new Date(),
                dataHash: hash,
              },
              { upsert: true },
            ).catch((err) => {
              logger.warn({ err, userId, courseId }, "Kunne ikke lagre Canvas-struktur til MongoDB");
            });
          }

          // ── Filekstraksjon for File-type module items ──
          // Tungt filinnhold lagres i MongoDB, ikke Redis.
          let fileCount = 0;
          let reachedFileLimit = false;
          const keepFileIds = new Set<number>();
          const storedFileStatus = await getStoredFileStatusForCourse(userId, courseId);

          // Samle alle File-items på tvers av moduler for å batch-hente metadata parallelt.
          // Sekvensielle metadata-kall per fil var den primære årsaken til mange /api/v1/files/:id-kall.
          type FileItem = {
            mod: (typeof moduler)[number];
            item: NonNullable<(typeof moduler)[number]["items"]>[number];
            contentId: number;
          };
          const allFileItems: FileItem[] = [];
          for (const mod of moduler) {
            if (!mod.items) continue;
            for (const item of mod.items) {
              if (item.type !== "File" || !item.content_id) continue;
              allFileItems.push({ mod, item, contentId: item.content_id });
            }
          }

          // Pre-hent all filmetadata parallelt (maks 5 samtidige kall) — én runde i stedet for N sekvensielle
          const FILE_META_CONCURRENCY = 5;
          const fileMetaLimit = pLimit(FILE_META_CONCURRENCY);
          type CanvasFileData = Awaited<ReturnType<typeof fetchFileMetadata>>["data"];
          const fileMetadataMap = new Map<number, CanvasFileData>();

          await Promise.allSettled(
            allFileItems.map(({ contentId }) =>
              fileMetaLimit(async () => {
                try {
                  const { data } = await fetchFileMetadata(canvasToken, contentId, baseUrl);
                  fileMetadataMap.set(contentId, data);
                } catch (err) {
                  logger.warn({ err, userId, contentId }, "Kunne ikke pre-hente filmetadata");
                }
              }),
            ),
          );

          for (const mod of moduler) {
            if (signal?.aborted) break;
            if (fileCount >= maxFilesPerSync) {
              reachedFileLimit = true;
              break;
            }
            if (!mod.items || mod.items.length === 0) continue;

            for (const item of mod.items) {
              if (signal?.aborted) break;
              if (fileCount >= maxFilesPerSync) {
                reachedFileLimit = true;
                break;
              }
              if (item.type !== "File") continue;

              const contentId = item.content_id;
              if (!contentId) continue;

              const fileData = fileMetadataMap.get(contentId);
              if (!fileData) continue; // metadata-henting feilet — skip denne filen

              try {
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
                        fullText: storedChunks
                          .sort((a, b) => a.index - b.index)
                          .map((chunk) => chunk.text)
                          .join("\n\n"),
                      });

                      continue;
                    }
                  }

                  await updateStoredFileMetadata(userId, courseId, contentId, {
                    courseName: course.name,
                    moduleTitle: mod.name,
                    fileName: fileData.filename,
                    fileHash: metaHash,
                  });
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
                  fullText: content,
                });
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
              { userId, courseId, maxFilesPerSync },
              "Hopper over sletting av manglende filer fordi filgrensen ble nådd",
            );
          }

          await deleteCacheKeys([userKey(userId, "emne", courseId, "chunks")]);

          // ── Page-ekstraksjon for Page-type module items ──
          // Canvas Pages (wiki-sider) inneholder ofte pensum som HTML.
          // Henter page body, stripper HTML og lagrer som chunks.
          if (isEmbeddingAvailable()) {
            const PAGE_CONCURRENCY = 3;
            const pageLimit = pLimit(PAGE_CONCURRENCY);
            const pageItems: Array<{
              mod: (typeof moduler)[number];
              item: NonNullable<(typeof moduler)[number]["items"]>[number];
            }> = [];

            for (const mod of moduler) {
              if (!mod.items) continue;
              for (const item of mod.items) {
                if (item.type === "Page" && item.page_url) {
                  pageItems.push({ mod, item });
                }
              }
            }

            if (pageItems.length > 0) {
              await Promise.allSettled(
                pageItems.map(({ mod, item }) =>
                  pageLimit(async () => {
                    if (signal?.aborted) return;
                    if (fileCount >= maxFilesPerSync) return;

                    // Bruk item.id som fileId for Pages (unik innenfor kurset)
                    const pageItemId = item.id;
                    if (!pageItemId) return;

                    // Sjekk om siden allerede er lagret og uendret
                    const itemKey = `${mod.id}:${pageItemId}`;
                    const prev = previousItemHashes.get(itemKey);
                    const currentHash = computeModuleItemHash(item);
                    if (prev?.contentHash && prev.contentHash === currentHash) {
                      keepFileIds.add(pageItemId);
                      return;
                    }

                    try {
                      const { data: page } = await fetchPage(
                        canvasToken,
                        course.id,
                        item.page_url!,
                        baseUrl,
                      );

                      if (!page.body) return;

                      const textContent = stripHtml(page.body, { removeStyles: true }).trim();
                      if (textContent.length < 50) return; // For kort innhold — ignorer

                      const chunks: ContentChunk[] = createChunksFromContent(textContent, {
                        courseId,
                        courseName: course.name,
                        moduleTitle: mod.name,
                        fileName: `${page.title}.page`,
                        fileId: pageItemId,
                      });

                      if (chunks.length === 0) return;

                      keepFileIds.add(pageItemId);
                      await upsertStoredFileContent({
                        userId,
                        courseId,
                        courseName: course.name,
                        moduleId: mod.id,
                        moduleTitle: mod.name,
                        fileName: `${page.title}.page`,
                        fileId: pageItemId,
                        fileHash: currentHash,
                        chunks,
                        fullText: textContent,
                      });
                      fileCount++;

                      logger.info(
                        { userId, courseId, pageTitle: page.title, chunks: chunks.length },
                        "Canvas Page ekstrahert og indeksert",
                      );
                    } catch (error) {
                      logger.warn(
                        { err: error, userId, courseId, pageUrl: item.page_url, title: item.title },
                        "Feil ved ekstraksjon av Canvas Page",
                      );
                    }
                  }),
                ),
              );
            }
          }

          // ── ExternalUrl crawling og indeksering ──
          // Kaller den avanserte crawleren som parser HTML med cheerio og oppdager PDF-er
          if (isEmbeddingAvailable()) {
            // Finn hvilke ExternalUrl-items som har endret contentHash
            const changedExternalUrlIds = new Set<number>();
            for (const mod of enrichedModuler) {
              for (const item of mod.items ?? []) {
                if (item.type === "ExternalUrl" && item.id != null) {
                  const itemKey = `${mod.id}:${item.id}`;
                  const prev = previousItemHashes.get(itemKey);
                  const enrichedItem = item as ICanvasModuleItem;
                  if (!prev?.contentHash || prev.contentHash !== enrichedItem.contentHash) {
                    changedExternalUrlIds.add(item.id);
                  }
                }
              }
            }

            // Kun crawl hvis det er endrede ExternalUrl-items
            if (changedExternalUrlIds.size > 0) {
              crawlCourseExternalUrls({
                userId,
                courseId,
                courseName: course.name,
                moduler: enrichedModuler,
              }, { changedItemIds: changedExternalUrlIds }).catch((err) => {
                logger.warn(
                  { err, userId, courseId },
                  "ExternalUrl-crawling feilet",
                );
              });
            }
          }

          // ── Oppgavebeskrivelse-indeksering ──
          // Indekserer fulle oppgavebeskrivelser som chunks slik at vektorsøk kan finne dem.
          // Bruker negative fileId-er (-(oppgave-index+1)) for å unngå kollisjon med ekte filer.
          if (isEmbeddingAvailable() && oppgaver.length > 0) {
            let assignmentCount = 0;
            for (const [index, oppg] of oppgaver.entries()) {
              if (signal?.aborted) break;
              if (!oppg.description) continue;

              const desc = stripHtml(oppg.description).trim();
              if (desc.length < 100) continue; // For kort — ikke verdt å indeksere

              // Stabil fileId basert på oppgave-index (negativ for å skille fra filer)
              const assignmentFileId = -(index + 1);
              const assignmentHash = sha256(`assignment:${oppg.name}:${desc.length}:${oppg.due_at ?? ""}`);

              // Sjekk om oppgaven allerede er lagret uendret
              const existingStatus = storedFileStatus.get(assignmentFileId);
              if (existingStatus?.fileHash === assignmentHash) {
                keepFileIds.add(assignmentFileId);
                continue;
              }

              const chunks: ContentChunk[] = createChunksFromContent(
                `Oppgave: ${oppg.name}\n${oppg.due_at ? `Frist: ${new Date(oppg.due_at).toLocaleDateString("nb-NO")}\n` : ""}${oppg.points_possible != null ? `Poeng: ${oppg.points_possible}\n` : ""}\n${desc}`,
                {
                  courseId,
                  courseName: course.name,
                  moduleTitle: "Oppgaver",
                  fileName: `${oppg.name}.assignment`,
                  fileId: assignmentFileId,
                },
              );

              if (chunks.length === 0) continue;

              keepFileIds.add(assignmentFileId);
              await upsertStoredFileContent({
                userId,
                courseId,
                courseName: course.name,
                moduleId: 0,
                moduleTitle: "Oppgaver",
                fileName: `${oppg.name}.assignment`,
                fileId: assignmentFileId,
                fileHash: assignmentHash,
                chunks,
                fullText: desc,
              });
              assignmentCount++;
            }

            if (assignmentCount > 0) {
              logger.info(
                { userId, courseId, assignmentCount },
                "Oppgavebeskrivelser indeksert",
              );
            }
          }
        } catch (error) {
          // Behold forrige hash slik at kurset ikke behandles som "fjernet"
          const prevHash = previousMeta.courseHashes[courseId];
          if (prevHash) newHashes[courseId] = prevHash;
          failed++;
          logger.warn(
            { err: error, userId, courseId, courseName: course.name },
            "Feil ved synkronisering av emne",
          );
        }
      }),
    ),
  );

  } finally {
    clearInterval(syncStatusRefreshInterval);
  }

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
    const removeResults = await Promise.allSettled(
      removedCourseIds.map(async (removedCourseId) => {
        const innerResults = await Promise.allSettled([
          invalidateCacheByPattern(userKey(userId, "emne", removedCourseId, "*")),
          deleteStoredCourseContent(userId, removedCourseId),
          CanvasStructureModel.deleteOne({ userId, courseId: removedCourseId }),
        ]);
        for (const r of innerResults) {
          if (r.status === "rejected") {
            logger.warn({ err: r.reason, userId, courseId: removedCourseId }, "Feil ved opprydding av fjernet kurs");
          }
        }
      }),
    );
    for (const r of removeResults) {
      if (r.status === "rejected") {
        logger.warn({ err: r.reason, userId }, "Feil ved fjerning av inaktivt kurs");
      }
    }
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

  // ── Lagre prosessert kursdata til Redis for chat-kontekst ──
  // Chat-forespørsler leser kun fra denne nøkkelen (ingen Canvas API-kall)
  // TTL 1 time — chat bruker MongoDB som fallback hvis nøkkelen utløper
  const DB_COURSES_TTL = 3600;
  const processedCourses = await CanvasStructureModel.find(
    { userId },
    { courseId: 1, courseName: 1, course_code: 1, moduler: 1, oppgaver: 1, kunngjøringer: 1 },
  ).lean();
  if (processedCourses.length > 0) {
    await setCache(
      `db:user:${userId}:courses`,
      JSON.stringify(processedCourses),
      DB_COURSES_TTL,
    );
    logger.info(
      { userId, courseCount: processedCourses.length },
      "Prosessert kursdata lagret til Redis for chat-kontekst",
    );
  }

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
    structureDeletion: CanvasStructureModel.deleteMany({ userId }).catch((err) => {
      logger.warn({ err, userId }, "Feil ved sletting av CanvasStructure for bruker");
      return { deletedCount: 0 };
    }),
    sessionInvalidation: invalidateUserKISessionCache(userId),
    redisInvalidation: isRedisReady()
      ? invalidateCacheByPattern(`canvas:user:${userId}:*`)
      : Promise.resolve(),
  };

  const [contentResult, structureResult, sessionResult, redisResult] = await Promise.allSettled([
    tasks.contentDeletion,
    tasks.structureDeletion,
    tasks.sessionInvalidation,
    tasks.redisInvalidation,
  ]);

  if (contentResult.status === "rejected") {
    logger.warn({ err: contentResult.reason, userId }, "Feil ved sletting av lagret Canvas-/KI-innhold");
    if (strictContentDeletion) {
      throw contentResult.reason;
    }
  }

  if (structureResult.status === "rejected") {
    logger.warn({ err: structureResult.reason, userId }, "Feil ved sletting av Canvas-struktur");
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

/** Maks filer per sync under initial sync (konfigurerbar via env) */
const INITIAL_SYNC_MAX_FILES = parseInt(process.env.INITIAL_SYNC_MAX_FILES ?? "50", 10);

/**
 * Kjører en full Canvas-sync i bakgrunnen uten rate-limit.
 * Brukes ved første token-lagring for å fylle MongoDB permanent.
 * Fire-and-forget — kaller skal IKKE awaite.
 */
export function triggerInitialSync(
  userId: string,
  canvasToken: string,
  baseUrl: string,
): void {
  syncCanvasDataForUser(userId, canvasToken, baseUrl, undefined, {
    bypassRateLimit: true,
    maxFiles: INITIAL_SYNC_MAX_FILES,
  }).catch((err) => {
    logger.error({ err, userId }, "Initial Canvas sync feilet");
  });
}
