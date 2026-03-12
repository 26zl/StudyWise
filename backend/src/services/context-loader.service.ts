/**
 * Context Loader Service
 *
 * Laster Canvas-kontekst for KI-chatten. Bruker en hybridmodell:
 * - MongoDB for lagret KI-innhold (chunks/embeddings) — PDF-innhold lagres KUN her, aldri i Redis
 * - Redis for lett Canvas-struktur og sync-status (metadata: emnelister, modulnavn, oppgaver; ingen fil-body)
 * - direkte Canvas API som siste fallback
 *
 * Flyt:
 *   1. Prøv lagret KI-innhold i MongoDB for semantisk/keyword-basert søk
 *   2. Bruk Redis for lett strukturkontekst og metadata når det finnes
 *   3. Hvis lokal lagring mangler → trigger bakgrunns-sync og bruk kiCanvas-fallback
 *
 * Opprettholder kompatibilitet med eksisterende intent-nivåer:
 *   - general_chat:   ingen kontekst
 *   - canvas_light:   emneliste + kommende frister
 *   - canvas_full:    fullt emneinnhold (moduler, oppgaver, kunngjøringer)
 */

import { logger } from "../utils/logger.js";
import { getCache, isRedisReady } from "../cache/redis.js";
import { syncCanvasDataForUser, hasCanvasSyncData, userKey, isSyncing, waitForSync } from "./canvas-sync.service.js";
import { byggLettCanvasKontekst, byggMålrettetCanvasKontekst } from "../rutere/ki/kiCanvas.js";
import type { TargetedQuery } from "../rutere/ki/ki.js";
import { TWO_WEEKS_MS } from "common/dateUtils";
import { isCanvasAssignmentSubmitted } from "common/canvas";
import { stripHtml } from "../utils/htmlUtils.js";
import { formatCourseLabel } from "./semantic-search.service.js";
import {
  searchChunks,
  buildChunkContext,
  buildChunkContextFromEntries,
} from "./chunk.service.js";
import {
  getStoredCourseCatalog,
  getStoredChunksForCourses,
  getStoredChunksForFile,
  hasStoredContentForUser,
  isEmbeddingAvailable,
  vectorSearch,
  type VectorSearchResult,
} from "./embedding.service.js";

// ─── Typer ─────────────────────────────────────────────────

export type IntentType = "general_chat" | "canvas_light" | "canvas_full";

export interface ContextResult {
  kontekst: string;
  hasCanvasData: boolean;
  source: "redis" | "api" | "vector" | "none";
}

interface SyncedCourse {
  id: string;
  name: string;
  course_code?: string;
  moduleTitles: string[];
  fileNames: string[];
}

function normaliserFilnavnHint(value: string): string {
  return value.toLowerCase().replace(/\.pdf$/i, "").replace(/[_-]/g, " ").trim();
}

function titleMatchesFileHint(title: string, fileHint: string): boolean {
  const normHint = normaliserFilnavnHint(fileHint);
  const normTitle = normaliserFilnavnHint(title);
  return normTitle.includes(normHint) || normHint.includes(normTitle);
}

async function hentSynkroniserteEmnerFraRedis(userId: string): Promise<SyncedCourse[]> {
  const emnerRaw = await getCache(userKey(userId, "emner"));
  if (!emnerRaw) return [];

  try {
    const parsed = JSON.parse(emnerRaw) as Array<{
      id: number | string;
      name: string;
      course_code?: string;
    }>;
    return parsed.map((emne) => ({
      id: String(emne.id),
      name: emne.name,
      course_code: emne.course_code,
      moduleTitles: [],
      fileNames: [],
    }));
  } catch {
    return [];
  }
}

async function hentKjentEmnekatalog(userId: string): Promise<SyncedCourse[]> {
  const [redisEmner, lagredeEmner] = await Promise.all([
    hentSynkroniserteEmnerFraRedis(userId),
    getStoredCourseCatalog(userId),
  ]);

  if (redisEmner.length === 0) {
    return lagredeEmner.map((emne) => ({
      id: emne.courseId,
      name: emne.courseName,
      moduleTitles: emne.moduleTitles,
      fileNames: emne.fileNames,
    }));
  }

  const redisMetadata = new Map<
    string,
    { moduleTitles: string[]; fileNames: string[] }
  >(
    await Promise.all(
      redisEmner.map(async (emne) => {
        const modulerRaw = await getCache(userKey(userId, "emne", emne.id, "moduler"));
        if (!modulerRaw) {
          return [emne.id, { moduleTitles: [] as string[], fileNames: [] as string[] }] as const;
        }

        try {
          const moduler = JSON.parse(modulerRaw) as Array<{
            name: string;
            items?: Array<{ title: string; type: string }>;
          }>;

          const moduleTitles = moduler
            .map((modul) => modul.name)
            .filter((navn): navn is string => typeof navn === "string" && navn.trim().length > 0);
          const fileNames = moduler.flatMap((modul) =>
            (modul.items ?? [])
              .filter((item) => item.type === "File")
              .map((item) => item.title),
          );

          return [emne.id, { moduleTitles, fileNames }] as const;
        } catch {
          return [emne.id, { moduleTitles: [] as string[], fileNames: [] as string[] }] as const;
        }
      }),
    ),
  );

  const lagredeEmnerMap = new Map(
    lagredeEmner.map((emne) => [emne.courseId, emne]),
  );

  const merged = redisEmner.map((emne) => {
    const lagret = lagredeEmnerMap.get(emne.id);
    const redisMeta = redisMetadata.get(emne.id);
    return {
      ...emne,
      moduleTitles: [
        ...new Set([
          ...(redisMeta?.moduleTitles ?? []),
          ...(lagret?.moduleTitles ?? []),
        ]),
      ],
      fileNames: [
        ...new Set([
          ...(redisMeta?.fileNames ?? []),
          ...(lagret?.fileNames ?? []),
        ]),
      ],
    };
  });

  for (const lagret of lagredeEmner) {
    if (merged.some((emne) => emne.id === lagret.courseId)) {
      continue;
    }
    merged.push({
      id: lagret.courseId,
      name: lagret.courseName,
      moduleTitles: lagret.moduleTitles,
      fileNames: lagret.fileNames,
    });
  }

  return merged;
}

async function finnRelevanteEmner(
  userId: string,
  target?: TargetedQuery,
): Promise<SyncedCourse[]> {
  const emner = await hentKjentEmnekatalog(userId);
  if (emner.length === 0) return [];

  if (!target?.courseHint && !target?.moduleHint && !target?.fileHint) {
    return emner;
  }

  if (target.courseHint) {
    const hint = target.courseHint.toLowerCase();
    const matched = emner.filter(
      (emne) =>
        emne.name.toLowerCase().includes(hint) ||
        (emne.course_code ?? "").toLowerCase().includes(hint),
    );
    if (matched.length > 0) {
      return matched;
    }
  }

  if (target.moduleHint) {
    const hint = target.moduleHint.toLowerCase();
    const matched = emner.filter((emne) =>
      emne.moduleTitles.some((modulnavn) => modulnavn.toLowerCase().includes(hint)),
    );
    if (matched.length > 0) {
      return matched;
    }
  }

  if (target.fileHint) {
    const matched = emner.filter((emne) =>
      emne.fileNames.some((filnavn) => titleMatchesFileHint(filnavn, target.fileHint!)),
    );
    if (matched.length > 0) {
      return matched;
    }
  }

  return [];
}

/**
 * Bygger lett kontekst fra Redis-data.
 * Inkluderer: emneliste + oppgaver med frister (neste 14 dager).
 */
async function byggLettKontekstFraRedis(userId: string): Promise<string | null> {
  try {
    const emnerRaw = await getCache(userKey(userId, "emner"));
    if (!emnerRaw) return null;

    const emner = JSON.parse(emnerRaw) as Array<{
      id: number;
      name: string;
      course_code?: string;
    }>;

    if (emner.length === 0) return null;

    const now = new Date();
    const twoWeeksFromNow = new Date(now.getTime() + TWO_WEEKS_MS);

    let kontekst = "[CANVAS-DATA START]\n";
    kontekst += `EMNER (${emner.length} aktive):\n`;
    for (const emne of emner) {
      kontekst += `- ${formatCourseLabel(emne.name, emne.course_code)}\n`;
    }

    // Hent oppgaver for alle emner parallelt og filtrer til kommende frister
    const fristLinjer: Array<{ dueAt: number; line: string }> = [];
    const oppgaverResults = await Promise.all(
      emner.map(async (emne) => ({
        emne,
        raw: await getCache(userKey(userId, "emne", String(emne.id), "oppgaver")),
      })),
    );

    for (const { emne, raw: oppgaverRaw } of oppgaverResults) {
      if (!oppgaverRaw) continue;

      try {
        const oppgaver = JSON.parse(oppgaverRaw) as Array<{
          name: string;
          due_at?: string | null;
          submission?: { workflow_state?: string | null; submitted_at?: string | null } | null;
        }>;

        for (const oppg of oppgaver) {
          if (!oppg.due_at) continue;
          const frist = new Date(oppg.due_at);
          if (frist >= now && frist <= twoWeeksFromNow) {
            const dagerIgjen = Math.ceil((frist.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
            const status = isCanvasAssignmentSubmitted(oppg) ? "✓ levert" : "⏳ ikke levert";
            fristLinjer.push({
              dueAt: frist.getTime(),
              line: `- ${oppg.name}${emne.course_code ? ` (${emne.course_code})` : ""} — frist: ${frist.toLocaleDateString("nb-NO")} (${dagerIgjen}d) [${status}]`,
            });
          }
        }
      } catch {
        // Ugyldig JSON — hopp over
      }
    }

    if (fristLinjer.length > 0) {
      fristLinjer.sort((a, b) => a.dueAt - b.dueAt);
      kontekst += `\nKOMMANDE FRISTER (neste 14 dager):\n`;
      kontekst += fristLinjer.map((item) => item.line).join("\n") + "\n";
    } else {
      kontekst += "\nINGEN FRISTER de neste 14 dagene.\n";
    }

    kontekst += "[CANVAS-DATA SLUTT]";
    return kontekst;
  } catch (error) {
    logger.warn({ err: error }, "Feil ved bygging av lett kontekst fra Redis");
    return null;
  }
}

/**
 * Bygger målrettet kontekst fra Redis-data for et spesifikt emne/modul.
 * Inkluderer: emne-metadata, moduler, oppgaver og kunngjøringer for det aktuelle emnet.
 */
async function byggMålrettetKontekstFraRedis(
  userId: string,
  target: TargetedQuery,
): Promise<string | null> {
  try {
    const matchedCourses = await finnRelevanteEmner(userId, target);
    if (matchedCourses.length === 0) {
      logger.info({ userId, target }, "byggMålrettet: Fant ingen relevante emner i Redis");
      return null;
    }

    const matchedCourse = matchedCourses[0];

    const courseId = String(matchedCourse.id);

    // Hent all data for dette emnet
    const [modulerRaw, oppgaverRaw, kunngjøringerRaw] = await Promise.all([
      getCache(userKey(userId, "emne", courseId, "moduler")),
      getCache(userKey(userId, "emne", courseId, "oppgaver")),
      getCache(userKey(userId, "emne", courseId, "kunngjøringer")),
    ]);

    logger.info(
      {
        userId,
        courseId,
        matchedName: matchedCourse.name,
        hasModuler: !!modulerRaw,
        hasOppgaver: !!oppgaverRaw,
        hasKunngjøringer: !!kunngjøringerRaw,
      },
      "byggMålrettet: Data hentet for matchet emne",
    );

    let kontekst = "[CANVAS-DATA START]\n";
    kontekst += `EMNE: ${formatCourseLabel(matchedCourse.name, matchedCourse.course_code)}\n\n`;

    let hadModuleFileContent = false;

    // Moduler
    if (modulerRaw) {
      try {
        const moduler = JSON.parse(modulerRaw) as Array<{
          name: string;
          items?: Array<{ title: string; type: string; content_id?: number }>;
        }>;

        kontekst += `MODULER (${moduler.length}):\n`;
        for (const modul of moduler) {
          kontekst += `\n### ${modul.name}\n`;

          // Filtrer til spesifikk modul hvis moduleHint finnes
          if (target.moduleHint) {
            const hint = target.moduleHint.toLowerCase();
            if (!modul.name.toLowerCase().includes(hint)) {
              kontekst += "(Ikke relevant for søket)\n";
              continue;
            }
          }

          if (modul.items && modul.items.length > 0) {
            const maxFilerMedInnhold = target.moduleHint ? 5 : 1;
            let filerMedInnhold = 0;
            for (const item of modul.items) {
              const itemTitle = item.title ?? "";
              kontekst += `- [${item.type}] ${itemTitle}\n`;

              const skalInkludereFil =
                item.type === "File" &&
                item.content_id != null &&
                (target.fileHint
                  ? titleMatchesFileHint(itemTitle, target.fileHint)
                  : target.moduleHint && filerMedInnhold < maxFilerMedInnhold);

              if (skalInkludereFil && item.content_id != null) {
                try {
                  const fileChunks = await getStoredChunksForFile(
                    userId,
                    courseId,
                    item.content_id,
                  );
                  if (fileChunks.length > 0) {
                    const fileKontekst = buildChunkContextFromEntries(fileChunks);
                    if (fileKontekst) {
                      filerMedInnhold++;
                      if (target.moduleHint) hadModuleFileContent = true;
                      kontekst += "\n" + fileKontekst + "\n";
                    }
                  }
                } catch {
                  // Lagret filinnhold mangler eller er ugyldig — ignorer
                }
              }
            }
          }
        }
        kontekst += "\n";
      } catch {
        // Ugyldig JSON
      }
    }

    // Oppgaver
    if (oppgaverRaw) {
      try {
        const oppgaver = JSON.parse(oppgaverRaw) as Array<{
          name: string;
          due_at?: string | null;
          description?: string | null;
          points_possible?: number | null;
          submission?: { workflow_state?: string | null; submitted_at?: string | null } | null;
        }>;

        kontekst += `OPPGAVER (${oppgaver.length}):\n`;
        for (const oppg of oppgaver) {
          const frist = oppg.due_at ? new Date(oppg.due_at).toLocaleDateString("nb-NO") : "ingen frist";
          const poeng = oppg.points_possible ? `${oppg.points_possible}p` : "";
          const status = isCanvasAssignmentSubmitted(oppg) ? "✓" : "⏳";
          kontekst += `- ${status} ${oppg.name} — frist: ${frist} ${poeng}\n`;

          // Inkluder kort beskrivelse (uten HTML)
          if (oppg.description) {
            const desc = stripHtml(oppg.description).trim();
            if (desc.length > 0) {
              kontekst += `  Beskrivelse: ${desc.substring(0, 300)}${desc.length > 300 ? "..." : ""}\n`;
            }
          }
        }
        kontekst += "\n";
      } catch {
        // Ugyldig JSON
      }
    }

    // Kunngjøringer
    if (kunngjøringerRaw) {
      try {
        const kunngjøringer = JSON.parse(kunngjøringerRaw) as Array<{
          title: string;
          message?: string | null;
          posted_at?: string | null;
        }>;

        if (kunngjøringer.length > 0) {
          kontekst += `KUNNGJØRINGER (${Math.min(kunngjøringer.length, 5)} nyeste):\n`;
          for (const k of kunngjøringer.slice(0, 5)) {
            const dato = k.posted_at ? new Date(k.posted_at).toLocaleDateString("nb-NO") : "";
            kontekst += `- ${k.title} (${dato})\n`;
            if (k.message) {
              const melding = stripHtml(k.message).trim();
              if (melding.length > 0) {
                kontekst += `  ${melding.substring(0, 200)}${melding.length > 200 ? "..." : ""}\n`;
              }
            }
          }
        }
      } catch {
        // Ugyldig JSON
      }
    }

    kontekst += "[CANVAS-DATA SLUTT]";

    // Ved modulspørsmål uten filinnhold i Redis: fall tilbake til API som henter PDF live
    if (target.moduleHint && !hadModuleFileContent) {
      logger.info(
        { userId, target },
        "Målrettet Redis: ingen filinnhold for modul — fallback til API",
      );
      return null;
    }

    return kontekst;
  } catch (error) {
    logger.warn({ err: error }, "Feil ved bygging av målrettet kontekst fra Redis");
    return null;
  }
}

/**
 * Bygger kontekst fra chunks via keyword-søk i chunk-tekst.
 * Når courseHint er satt, søkes kun i matchende kurs (raskere og mer presist).
 * Ellers søkes i alle kurs.
 */
async function byggKontekstFraChunks(
  userId: string,
  message: string,
  target?: TargetedQuery,
): Promise<string | null> {
  try {
    const relevantCourses = await finnRelevanteEmner(userId, target);
    const courseIds = relevantCourses.map((course) => String(course.id));
    if (target && (target.courseHint || target.moduleHint || target.fileHint) && courseIds.length === 0) {
      logger.info({ userId, target }, "Chunk-søk fant ingen relevante kurs");
      return null;
    }

    const CHUNK_QUERY_LIMIT = 1000;
    let allChunks = await getStoredChunksForCourses(userId, {
      courseIds: courseIds.length > 0 ? courseIds : undefined,
      moduleHint: target?.moduleHint,
      fileHint: target?.fileHint,
      limit: CHUNK_QUERY_LIMIT,
    });

    if (allChunks.length === 0 && (target?.moduleHint || target?.fileHint)) {
      allChunks = await getStoredChunksForCourses(userId, {
        courseIds: courseIds.length > 0 ? courseIds : undefined,
        limit: CHUNK_QUERY_LIMIT,
      });
    }

    if (allChunks.length === 0) {
      if (isSyncing(userId)) {
        logger.info(
          { userId, courseCount: courseIds.length },
          "Ingen lagrede chunks funnet — venter på pågående sync",
        );
        await waitForSync(userId, 6_000);
        allChunks = await getStoredChunksForCourses(userId, {
          courseIds: courseIds.length > 0 ? courseIds : undefined,
          limit: CHUNK_QUERY_LIMIT,
        });
      }

      if (allChunks.length === 0) {
        logger.info(
          { userId, courseCount: courseIds.length, courseHint: target?.courseHint },
          "Ingen lagrede chunks funnet i MongoDB",
        );
        return null;
      }
    }

    let scored = searchChunks(allChunks, message, {
      moduleHint: target?.moduleHint,
      fileHint: target?.fileHint,
    });

    if (target?.moduleHint) {
      const moduleMatches = scored.filter((chunk) =>
        chunk.source.moduleTitle.toLowerCase().includes(target.moduleHint!.toLowerCase()),
      );
      if (moduleMatches.length === 0) {
        return null;
      }
      scored = moduleMatches;
    }

    if (target?.fileHint) {
      const fileMatches = scored.filter((chunk) =>
        titleMatchesFileHint(chunk.source.fileName, target.fileHint!),
      );
      if (fileMatches.length === 0) {
        return null;
      }
      scored = fileMatches;
    }

    if (scored.length === 0) {
      logger.info(
        { userId, chunksSearched: allChunks.length, message: message.substring(0, 80) },
        "Chunk-søk ga 0 treff på tekstinnhold",
      );
      return null;
    }

    const chunkKontekst = buildChunkContext(scored);
    if (chunkKontekst.length === 0) return null;

    logger.info(
      {
        userId,
        chunksSearched: allChunks.length,
        chunksMatched: scored.length,
        topScore: scored[0].score.toFixed(2),
        topFile: scored[0].source.fileName,
        contextLength: chunkKontekst.length,
      },
      "Chunk-basert kontekst bygget fra tekstinnhold",
    );

    return "[CANVAS-DATA START]\n" + chunkKontekst + "\n[CANVAS-DATA SLUTT]";
  } catch (error) {
    logger.warn({ err: error }, "Feil ved bygging av chunk-kontekst");
    return null;
  }
}

function filtrerVectorResultater(
  results: VectorSearchResult[],
  target?: TargetedQuery,
) {
  let filtered = results;

  if (target?.moduleHint) {
    const moduleMatches = filtered.filter((result) =>
      result.source.moduleTitle.toLowerCase().includes(target.moduleHint!.toLowerCase()),
    );
    if (moduleMatches.length === 0) {
      return [];
    }
    filtered = moduleMatches;
  }

  if (target?.fileHint) {
    const fileMatches = filtered.filter((result) =>
      titleMatchesFileHint(result.source.fileName, target.fileHint!),
    );
    if (fileMatches.length === 0) {
      return [];
    }
    filtered = fileMatches;
  }

  return filtered;
}

/**
 * Bygger kontekst via Pinecone vector search (semantisk embedding-søk).
 * Bruker Pinecone Inference-embeddings for å finne de mest relevante chunks.
 * Fallback: returnerer null hvis Pinecone ikke er tilgjengelig.
 */
async function byggKontekstFraVectorSearch(
  userId: string,
  message: string,
  target?: TargetedQuery,
): Promise<string | null> {
  if (!isEmbeddingAvailable()) return null;

  try {
    const relevantCourses = await finnRelevanteEmner(userId, target);
    const courseIds = relevantCourses.map((course) => String(course.id));
    if (target && (target.courseHint || target.moduleHint || target.fileHint) && courseIds.length === 0) {
      logger.info({ userId, target }, "Vector-søk fant ingen relevante kurs");
      return null;
    }

    const { results, degraded } = await vectorSearch(userId, message, {
      limit: 8,
      courseIds: courseIds.length > 0 ? courseIds : undefined,
    });

    // Degradert modus: Pinecone feilet — returner null slik at kalleren faller tilbake til keyword-søk
    if (degraded) {
      logger.info({ userId }, "Vector search degradert — faller tilbake til keyword-søk");
      return null;
    }

    const filteredResults = filtrerVectorResultater(results, target);

    if (filteredResults.length === 0) {
      logger.info(
        { userId, messagePreview: message.substring(0, 80) },
        "Vector search ga 0 treff",
      );
      return null;
    }

    const kontekst = buildChunkContextFromEntries(
      filteredResults.map((result) => ({
        text: result.text,
        source: result.source,
        index: result.chunkIndex,
      })),
    );
    if (kontekst.length === 0) return null;

    logger.info(
      {
        userId,
        resultsCount: filteredResults.length,
        topScore: filteredResults[0].score.toFixed(3),
        topFile: filteredResults[0].source.fileName,
        contextLength: kontekst.length,
      },
      "Vector search kontekst bygget",
    );

    return "[CANVAS-DATA START]\n" + kontekst + "\n[CANVAS-DATA SLUTT]";
  } catch (error) {
    logger.warn({ err: error }, "Feil ved vector search — faller tilbake til keyword-søk");
    return null;
  }
}

// ─── Hovedfunksjoner ───────────────────────────────────────

/**
 * Laster Canvas-kontekst for KI-chatten basert på intent.
 *
 * Strategi:
 * 1. Prøv Redis først (rask, ingen API-kall)
 * 2. Hvis Redis mangler data → trigger bakgrunns-sync + bruk API-fallback
 *
 * For canvas_full med melding brukes en 4-trinns strategi:
 *   1. Vector-søk i MongoDB (semantisk søk)
 *   2. Chunk-søk i MongoDB (keyword fallback)
 *   3. Målrettet Redis (kursstruktur + metadata)
 *   4. API-fallback
 *
 * @param userId - Brukerens lokale ID
 * @param canvasToken - Dekryptert Canvas API-token
 * @param intent - Detektert intent-nivå
 * @param target - Eventuelt spesifikt mål (emne/modul) for canvas_full
 * @param message - Siste brukermelding (for chunk-søk)
 * @param signal - Valgfritt AbortSignal; når avbrutt (f.eks. når chat-respons er ferdig) stopper bakgrunns-sync
 */
export async function loadCanvasContext(
  userId: string,
  canvasToken: string,
  intent: IntentType,
  target?: TargetedQuery,
  message?: string,
  baseUrl?: string,
  signal?: AbortSignal,
): Promise<ContextResult> {

  // general_chat trenger ingen kontekst
  if (intent === "general_chat") {
    return { kontekst: "", hasCanvasData: false, source: "none" };
  }

  const redisAvailable = isRedisReady();
  const hasRedisSyncData = redisAvailable && (await hasCanvasSyncData(userId));
  const hasStoredAIContent = await hasStoredContentForUser(userId);

  // ── canvas_light ──
  if (intent === "canvas_light") {
    // Prøv Redis først
    if (hasRedisSyncData) {
      const redisKontekst = await byggLettKontekstFraRedis(userId);
      if (redisKontekst) {
        logger.info(
          { userId, intent, source: "redis", contextLength: redisKontekst.length },
          "Canvas-kontekst lastet fra Redis (lett)",
        );
        return {
          kontekst: redisKontekst,
          hasCanvasData: true,
          source: "redis",
        };
      }
    }

    // Fallback: direkte Canvas API via kiCanvas
    logger.info({ userId, intent, source: "api" }, "Redis mangler data — bruker API-fallback (lett)");
    const apiKontekst = await byggLettCanvasKontekst(canvasToken, baseUrl);
    const hasData = apiKontekst.includes("CANVAS-DATA");

    if (redisAvailable) {
      syncCanvasDataForUser(userId, canvasToken, baseUrl, signal).catch((err) => {
        logger.warn({ err, userId }, "Bakgrunns-sync feilet etter API-fallback");
      });
    }

    return { kontekst: apiKontekst, hasCanvasData: hasData, source: "api" };
  }

  // ── canvas_full ──
  const hasSpecificTarget = !!(target?.courseHint || target?.moduleHint || target?.fileHint);

  // Trinn 0: Vector search (semantisk embedding-søk, best kvalitet)
  if (hasStoredAIContent && message) {
    const vectorKontekst = await byggKontekstFraVectorSearch(userId, message, target);
    if (vectorKontekst) {
      logger.info(
        { userId, intent, source: "vector", contextLength: vectorKontekst.length },
        "Canvas-kontekst lastet fra vector search",
      );
      return { kontekst: vectorKontekst, hasCanvasData: true, source: "vector" };
    }
  }

  // Trinn 1: Chunk-basert søk (keyword fallback når vector search ikke ga treff)
  if (hasStoredAIContent && message) {
    const chunkKontekst = await byggKontekstFraChunks(userId, message, target);
    if (chunkKontekst) {
      logger.info(
        { userId, intent, source: "vector", contextLength: chunkKontekst.length },
        "Canvas-kontekst lastet fra chunk-søk (keyword)",
      );
      return { kontekst: chunkKontekst, hasCanvasData: true, source: "vector" };
    }
  }

  // Trinn 2: Målrettet Redis (tittel-matching)
  if (hasSpecificTarget && target) {
    // Prøv Redis først for målrettet kontekst
    if (hasRedisSyncData) {
      const redisKontekst = await byggMålrettetKontekstFraRedis(userId, target);
      if (redisKontekst) {
        logger.info(
          { userId, intent, target, source: "redis", contextLength: redisKontekst.length },
          "Målrettet Canvas-kontekst lastet fra Redis",
        );
        return { kontekst: redisKontekst, hasCanvasData: true, source: "redis" };
      }
    }

    // Fallback: direkte Canvas API via kiCanvas
    logger.info(
      { userId, intent, target, source: "api" },
      "Redis mangler data — bruker API-fallback (målrettet)",
    );
    const apiKontekst = await byggMålrettetCanvasKontekst(canvasToken, target, baseUrl);
    const hasData =
      apiKontekst.includes("CANVAS-DATA") ||
      apiKontekst.includes("MODULER") ||
      apiKontekst.includes("OPPGAVER");

    if (redisAvailable) {
      syncCanvasDataForUser(userId, canvasToken, baseUrl, signal).catch((err) => {
        logger.warn({ err, userId }, "Bakgrunns-sync feilet etter API-fallback");
      });
    }

    return { kontekst: apiKontekst, hasCanvasData: hasData, source: "api" };
  }

  // canvas_full uten spesifikt mål → bruk lett kontekst (som eksisterende logikk)
  if (hasRedisSyncData) {
    const redisKontekst = await byggLettKontekstFraRedis(userId);
    if (redisKontekst) {
      logger.info(
        { userId, intent, source: "redis", contextLength: redisKontekst.length },
        "canvas_full uten mål — lett kontekst fra Redis",
      );
      return { kontekst: redisKontekst, hasCanvasData: true, source: "redis" };
    }
  }

  // Fallback
  const apiKontekst = await byggLettCanvasKontekst(canvasToken, baseUrl);
  const hasData = apiKontekst.includes("CANVAS-DATA");

  if (redisAvailable) {
    syncCanvasDataForUser(userId, canvasToken, baseUrl, signal).catch((err) => {
      logger.warn({ err, userId }, "Bakgrunns-sync feilet etter API-fallback");
    });
  }

  return { kontekst: apiKontekst, hasCanvasData: hasData, source: "api" };
}

/**
 * Sikrer at brukerens Canvas-data er synkronisert.
 * Kalles ved chat-start eller login. Delegerer rate-limiting til
 * syncCanvasDataForUser (5 min intervall) i stedet for å blokkere
 * helt basert på om syncMeta eksisterer.
 */
export async function ensureCanvasSync(
  userId: string,
  canvasToken: string,
  baseUrl?: string,
): Promise<void> {
  if (!isRedisReady()) return;

  if (!baseUrl) {
    logger.warn({ userId }, "ensureCanvasSync: canvasBaseUrl mangler — hopper over sync");
    return;
  }

  syncCanvasDataForUser(userId, canvasToken, baseUrl).catch((err) => {
    logger.warn({ err, userId }, "Canvas sync feilet");
  });
}
