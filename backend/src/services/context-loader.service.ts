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
import { syncCanvasDataForUser, hasCanvasSyncData } from "./canvas-sync.service.js";
import { byggLettCanvasKontekst, byggMålrettetCanvasKontekst } from "../rutere/ki/kiCanvas.js";
import type { TargetedQuery } from "../rutere/ki/ki.js";

// ─── Typer ─────────────────────────────────────────────────

export type IntentType = "general_chat" | "canvas_light" | "canvas_full";

export interface ContextResult {
  kontekst: string;
  hasCanvasData: boolean;
  source: "redis" | "api" | "none";
}

// ─── Hjelpefunksjoner ──────────────────────────────────────

/** Bygger Redis-nøkkel med bruker-prefiks */
function userKey(userId: string, ...parts: string[]): string {
  return `canvas:user:${userId}:${parts.join(":")}`;
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
      course_code: string;
    }>;

    if (emner.length === 0) return null;

    const now = new Date();
    const twoWeeksFromNow = new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000);

    let kontekst = "[CANVAS-DATA START]\n";
    kontekst += `EMNER (${emner.length} aktive):\n`;
    for (const emne of emner) {
      kontekst += `- ${emne.name} (${emne.course_code})\n`;
    }

    // Hent oppgaver for alle emner og filtrer til kommende frister
    const fristLinjer: string[] = [];
    for (const emne of emner) {
      const oppgaverRaw = await getCache(userKey(userId, "emne", String(emne.id), "oppgaver"));
      if (!oppgaverRaw) continue;

      try {
        const oppgaver = JSON.parse(oppgaverRaw) as Array<{
          name: string;
          due_at?: string | null;
          has_submitted_submissions?: boolean;
        }>;

        for (const oppg of oppgaver) {
          if (!oppg.due_at) continue;
          const frist = new Date(oppg.due_at);
          if (frist >= now && frist <= twoWeeksFromNow) {
            const dagerIgjen = Math.ceil((frist.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
            const status = oppg.has_submitted_submissions ? "✓ levert" : "⏳ ikke levert";
            fristLinjer.push(
              `- ${oppg.name} (${emne.course_code}) — frist: ${frist.toLocaleDateString("nb-NO")} (${dagerIgjen}d) [${status}]`,
            );
          }
        }
      } catch {
        // Ugyldig JSON — hopp over
      }
    }

    if (fristLinjer.length > 0) {
      fristLinjer.sort(); // Sorter kronologisk (dato-prefiks)
      kontekst += `\nKOMMANDE FRISTER (neste 14 dager):\n`;
      kontekst += fristLinjer.join("\n") + "\n";
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
      course_code: string;
    }>;

    // Finn matchende emne basert på courseHint
    let matchedCourse: { id: number; name: string; course_code: string } | undefined;

    if (target.courseHint) {
      const hint = target.courseHint.toLowerCase();
      matchedCourse = emner.find(
        (e) =>
          e.name.toLowerCase().includes(hint) ||
          e.course_code.toLowerCase().includes(hint),
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
    kontekst += `EMNE: ${matchedCourse.name} (${matchedCourse.course_code})\n\n`;

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
          has_submitted_submissions?: boolean;
        }>;

        kontekst += `OPPGAVER (${oppgaver.length}):\n`;
        for (const oppg of oppgaver) {
          const frist = oppg.due_at ? new Date(oppg.due_at).toLocaleDateString("nb-NO") : "ingen frist";
          const poeng = oppg.points_possible ? `${oppg.points_possible}p` : "";
          const status = oppg.has_submitted_submissions ? "✓" : "⏳";
          kontekst += `- ${status} ${oppg.name} — frist: ${frist} ${poeng}\n`;

          // Inkluder kort beskrivelse (uten HTML)
          if (oppg.description) {
            const desc = oppg.description.replace(/<[^>]*>/g, "").trim();
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
              const melding = k.message.replace(/<[^>]*>/g, "").trim();
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

// ─── Hovedfunksjoner ───────────────────────────────────────

/**
 * Laster Canvas-kontekst for KI-chatten basert på intent.
 *
 * Strategi:
 * 1. Prøv Redis først (rask, ingen API-kall)
 * 2. Hvis Redis mangler data → trigger bakgrunns-sync + bruk API-fallback
 *
 * @param userId - Brukerens lokale ID
 * @param canvasToken - Dekryptert Canvas API-token
 * @param intent - Detektert intent-nivå
 * @param target - Eventuelt spesifikt mål (emne/modul) for canvas_full
 */
export async function loadCanvasContext(
  userId: string,
  canvasToken: string,
  intent: IntentType,
  target?: TargetedQuery,
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
    const apiKontekst = await byggLettCanvasKontekst(canvasToken);
    const hasData = apiKontekst.includes("CANVAS-DATA");

    // Trigger bakgrunns-sync for neste gang
    if (redisAvailable) {
      syncCanvasDataForUser(userId, canvasToken).catch((err) => {
        logger.warn({ err, userId }, "Bakgrunns-sync feilet etter API-fallback");
      });
    }

    return { kontekst: apiKontekst, hasCanvasData: hasData, source: "api" };
  }

  // ── canvas_full ──
  const hasSpecificTarget = !!(target?.courseHint || target?.moduleHint || target?.fileHint);

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
    const apiKontekst = await byggMålrettetCanvasKontekst(canvasToken, target);
    const hasData =
      apiKontekst.includes("CANVAS-DATA") ||
      apiKontekst.includes("MODULER") ||
      apiKontekst.includes("OPPGAVER");

    // Trigger bakgrunns-sync
    if (redisAvailable) {
      syncCanvasDataForUser(userId, canvasToken).catch((err) => {
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
  const apiKontekst = await byggLettCanvasKontekst(canvasToken);
  const hasData = apiKontekst.includes("CANVAS-DATA");

  if (redisAvailable) {
    syncCanvasDataForUser(userId, canvasToken).catch((err) => {
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
): Promise<void> {
  if (!isRedisReady()) return;

  // Trigger sync i bakgrunnen — syncCanvasDataForUser har egen rate limiting
  // (MIN_SYNC_INTERVAL_S = 300s) som forhindrer for hyppige kall
  syncCanvasDataForUser(userId, canvasToken).catch((err) => {
    logger.warn({ err, userId }, "Canvas sync feilet");
  });
}
