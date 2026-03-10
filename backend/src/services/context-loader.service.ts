/**
 * Context Loader Service
 *
 * Laster Canvas-kontekst for KI-chatten. Bruker Redis-synkronisert data
 * (fra canvas-sync.service) som primærkilde, med fallback til direkteoppslag
 * via kiCanvas-builderne.
 *
 * Flyt:
 *   1. Sjekk om brukeren har synkronisert data i Redis
 *   2. Hvis ja → bygg kontekst fra Redis-data (raskt, ingen Canvas API-kall)
 *   3. Hvis nei → trigger bakgrunns-sync og bruk kiCanvas-fallback
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
  getChunksForCourse,
  searchChunks,
  buildChunkContext,
  type ContentChunk,
} from "./chunk.service.js";

// ─── Typer ─────────────────────────────────────────────────

export type IntentType = "general_chat" | "canvas_light" | "canvas_full";

export interface ContextResult {
  kontekst: string;
  hasCanvasData: boolean;
  source: "redis" | "api" | "none";
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
    const emnerRaw = await getCache(userKey(userId, "emner"));
    if (!emnerRaw) {
      logger.info({ userId }, "byggMålrettet: Ingen emner i Redis — returnerer null");
      return null;
    }

    const emner = JSON.parse(emnerRaw) as Array<{
      id: number;
      name: string;
      course_code?: string;
    }>;

    // Finn matchende emne basert på courseHint
    let matchedCourse:
      | { id: number; name: string; course_code?: string }
      | undefined;

    if (target.courseHint) {
      const hint = target.courseHint.toLowerCase();
      matchedCourse = emner.find(
        (e) =>
          e.name.toLowerCase().includes(hint) ||
          (e.course_code ?? "").toLowerCase().includes(hint),
      );
      logger.info(
        { userId, courseHint: target.courseHint, matched: !!matchedCourse, matchedName: matchedCourse?.name },
        "byggMålrettet: courseHint-søk",
      );
    }

    // Hvis ingen match, prøv med moduleHint som fallback
    if (!matchedCourse && target.moduleHint) {
      // Søk i alle emners moduler etter modulnavnet
      for (const emne of emner) {
        const modulerRaw = await getCache(userKey(userId, "emne", String(emne.id), "moduler"));
        if (!modulerRaw) continue;
        try {
          const moduler = JSON.parse(modulerRaw) as Array<{ name: string }>;
          if (moduler.some((m) => m.name.toLowerCase().includes(target.moduleHint!.toLowerCase()))) {
            matchedCourse = emne;
            logger.info(
              { userId, moduleHint: target.moduleHint, matchedName: emne.name, moduleCount: moduler.length },
              "byggMålrettet: moduleHint-match funnet",
            );
            break;
          }
        } catch {
          continue;
        }
      }
      if (!matchedCourse) {
        logger.info(
          { userId, moduleHint: target.moduleHint, emnerCount: emner.length },
          "byggMålrettet: moduleHint fant ingen match i noen emner",
        );
      }
    }

    // Hvis ingen match, prøv med fileHint som fallback (søk i moduler for fil-tittel)
    if (!matchedCourse && target.fileHint) {
      for (const emne of emner) {
        const modulerRaw = await getCache(userKey(userId, "emne", String(emne.id), "moduler"));
        if (!modulerRaw) continue;
        try {
          const moduler = JSON.parse(modulerRaw) as Array<{
            name: string;
            items?: Array<{ title: string; type: string; content_id?: number }>;
          }>;
          const normHintSearch = target.fileHint!.toLowerCase().replace(/\.pdf$/i, "").replace(/[_-]/g, " ").trim();
          const found = moduler.some(
            (m) =>
              m.items?.some(
                (item) => {
                  if (item.type !== "File") return false;
                  const normT = item.title.toLowerCase().replace(/\.pdf$/i, "").replace(/[_-]/g, " ").trim();
                  return normT.includes(normHintSearch) || normHintSearch.includes(normT);
                },
              ),
          );
          if (found) {
            matchedCourse = emne;
            logger.info(
              { userId, fileHint: target.fileHint, matchedName: emne.name },
              "byggMålrettet: fileHint-match funnet",
            );
            break;
          }
        } catch {
          continue;
        }
      }
    }

    if (!matchedCourse) {
      logger.info(
        { userId, target },
        "byggMålrettet: Ingen match via courseHint/moduleHint/fileHint — returnerer null",
      );
      return null;
    }

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
            for (const item of modul.items) {
              kontekst += `- [${item.type}] ${item.title}\n`;

              // Inkluder PDF-innhold hvis fileHint matcher
              if (
                target.fileHint &&
                item.type === "File" &&
                item.content_id
              ) {
                // Normaliser: fjern extension, erstatt separatorer med mellomrom
                const normHint = target.fileHint.toLowerCase().replace(/\.pdf$/i, "").replace(/[_-]/g, " ").trim();
                const normTitle = item.title.toLowerCase().replace(/\.pdf$/i, "").replace(/[_-]/g, " ").trim();
                const titleMatchesHint = normTitle.includes(normHint) || normHint.includes(normTitle);

                if (titleMatchesHint) {
                  try {
                    const pdfRaw = await getCache(
                      userKey(userId, "file", String(item.content_id), "content"),
                    );
                    if (pdfRaw) {
                      const pdfData = JSON.parse(pdfRaw) as {
                        content?: string;
                        truncated?: boolean;
                      };
                      if (pdfData.content) {
                        kontekst += `\n--- PDF-INNHOLD: ${item.title} ---\n`;
                        kontekst += pdfData.content;
                        if (pdfData.truncated) {
                          kontekst += "\n(Innholdet er forkortet)\n";
                        }
                        kontekst += `\n--- SLUTT PDF-INNHOLD ---\n\n`;
                      }
                    }
                  } catch {
                    // Ugyldig JSON i PDF-cache — ignorer
                  }
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
    const emnerRaw = await getCache(userKey(userId, "emner"));
    if (!emnerRaw) return null;

    const emner = JSON.parse(emnerRaw) as Array<{
      id: number;
      name: string;
      course_code?: string;
    }>;

    // Bestem hvilke kurs vi skal laste chunks fra
    let coursesToSearch = emner;
    if (target?.courseHint) {
      const hint = target.courseHint.toLowerCase();
      const matched = emner.filter(
        (e) =>
          e.name.toLowerCase().includes(hint) ||
          (e.course_code ?? "").toLowerCase().includes(hint),
      );
      if (matched.length > 0) {
        coursesToSearch = matched;
        logger.info(
          { userId, courseHint: hint, matchedCourses: matched.map((c) => c.name) },
          "Chunk-søk begrenset til matchende kurs",
        );
      }
    }

    // Last chunks fra utvalgte kurs
    const allChunks: ContentChunk[] = [];
    for (const emne of coursesToSearch) {
      const courseChunks = await getChunksForCourse(userId, String(emne.id));
      if (courseChunks.length > 0) {
        logger.info(
          { userId, courseId: emne.id, courseName: emne.name, chunkCount: courseChunks.length },
          "Chunks lastet fra kurs",
        );
      }
      allChunks.push(...courseChunks);
    }

    if (allChunks.length === 0) {
      // Hvis en sync pågår, vent på den og prøv igjen én gang
      if (isSyncing(userId)) {
        logger.info(
          { userId, coursesChecked: coursesToSearch.length },
          "Ingen chunks funnet — venter på pågående sync",
        );
        await waitForSync(userId, 15_000);

        // Prøv å laste chunks på nytt etter sync
        for (const emne of coursesToSearch) {
          const courseChunks = await getChunksForCourse(userId, String(emne.id));
          allChunks.push(...courseChunks);
        }
      }

      if (allChunks.length === 0) {
        logger.info(
          { userId, coursesChecked: coursesToSearch.length, courseHint: target?.courseHint },
          "Ingen chunks funnet i Redis for noen kurs",
        );
        return null;
      }
    }

    // Søk i chunk-tekst med brukerens melding (keyword-basert TF-scoring)
    const scored = searchChunks(allChunks, message, {
      moduleHint: target?.moduleHint,
      fileHint: target?.fileHint,
    });

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

// ─── Hovedfunksjoner ───────────────────────────────────────

/**
 * Laster Canvas-kontekst for KI-chatten basert på intent.
 *
 * Strategi:
 * 1. Prøv Redis først (rask, ingen API-kall)
 * 2. Hvis Redis mangler data → trigger bakgrunns-sync + bruk API-fallback
 *
 * For canvas_full med melding brukes en 4-trinns strategi:
 *   1. Chunk-søk (keyword-basert, returnerer relevant innhold)
 *   2. Målrettet Redis (tittel-matching, inkluderer PDF-innhold)
 *   3. API-fallback
 *
 * @param userId - Brukerens lokale ID
 * @param canvasToken - Dekryptert Canvas API-token
 * @param intent - Detektert intent-nivå
 * @param target - Eventuelt spesifikt mål (emne/modul) for canvas_full
 * @param message - Siste brukermelding (for chunk-søk)
 */
export async function loadCanvasContext(
  userId: string,
  canvasToken: string,
  intent: IntentType,
  target?: TargetedQuery,
  message?: string,
  baseUrl?: string,
): Promise<ContextResult> {

  // general_chat trenger ingen kontekst
  if (intent === "general_chat") {
    return { kontekst: "", hasCanvasData: false, source: "none" };
  }

  const redisAvailable = isRedisReady();
  const hasSyncData = redisAvailable && (await hasCanvasSyncData(userId));

  // ── canvas_light ──
  if (intent === "canvas_light") {
    // Prøv Redis først
    if (hasSyncData) {
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
      syncCanvasDataForUser(userId, canvasToken, baseUrl).catch((err) => {
        logger.warn({ err, userId }, "Bakgrunns-sync feilet etter API-fallback");
      });
    }

    return { kontekst: apiKontekst, hasCanvasData: hasData, source: "api" };
  }

  // ── canvas_full ──
  const hasSpecificTarget = !!(target?.courseHint || target?.moduleHint || target?.fileHint);

  // Trinn 1: Chunk-basert søk (hvis vi har brukermelding)
  if (hasSyncData && message) {
    const chunkKontekst = await byggKontekstFraChunks(userId, message, target);
    if (chunkKontekst) {
      logger.info(
        { userId, intent, source: "redis", contextLength: chunkKontekst.length },
        "Canvas-kontekst lastet fra chunk-søk",
      );
      return { kontekst: chunkKontekst, hasCanvasData: true, source: "redis" };
    }
  }

  // Trinn 2: Målrettet Redis (tittel-matching)
  if (hasSpecificTarget && target) {
    // Prøv Redis først for målrettet kontekst
    if (hasSyncData) {
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
      syncCanvasDataForUser(userId, canvasToken, baseUrl).catch((err) => {
        logger.warn({ err, userId }, "Bakgrunns-sync feilet etter API-fallback");
      });
    }

    return { kontekst: apiKontekst, hasCanvasData: hasData, source: "api" };
  }

  // canvas_full uten spesifikt mål → bruk lett kontekst (som eksisterende logikk)
  if (hasSyncData) {
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
    syncCanvasDataForUser(userId, canvasToken, baseUrl).catch((err) => {
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

  // Fallback til CANVAS_BASE_URL for brukere uten canvasBaseUrl i DB
  baseUrl = baseUrl ?? process.env.CANVAS_BASE_URL;
  if (!baseUrl) {
    logger.warn({ userId }, "ensureCanvasSync: canvasBaseUrl mangler — hopper over sync");
    return;
  }

  syncCanvasDataForUser(userId, canvasToken, baseUrl).catch((err) => {
    logger.warn({ err, userId }, "Canvas sync feilet");
  });
}
