/**
 * Context Loader Service
 *
 * Laster Canvas-kontekst for KI-chatten. Bruker en hybridmodell:
 * - MongoDB ContentEmbedding for lagret KI-innhold (chunks/embeddings) — PDF-innhold lagres KUN her
 * - Redis for lett Canvas-struktur og sync-status (metadata: emnelister, modulnavn, oppgaver; ingen fil-body)
 * - MongoDB CanvasStructure som permanent fallback når Redis TTL utløper
 * - direkte Canvas API som siste fallback (kun ved aller første innlogging)
 *
 * Flyt:
 *   1. Prøv lagret KI-innhold i MongoDB for semantisk/keyword-basert søk
 *   2. Bruk Redis for lett strukturkontekst og metadata når det finnes
 *   3. Hvis Redis mangler → bruk MongoDB CanvasStructure (permanent, ~10-30ms)
 *   4. Hvis lokal lagring mangler → trigger bakgrunns-sync og bruk kiCanvas-fallback
 *
 * Opprettholder kompatibilitet med eksisterende intent-nivåer:
 *   - general_chat:   ingen kontekst
 *   - canvas_light:   emneliste + kommende frister
 *   - canvas_full:    fullt emneinnhold (moduler, oppgaver, kunngjøringer)
 */

import { logger } from "../utils/logger.js";
import { getCache, isRedisReady } from "../cache/redis.js";
import { syncCanvasDataForUser, hasCanvasSyncData, userKey, isSyncing, waitForSync } from "./canvas-sync.service.js";
import type { TargetedQuery } from "../rutere/ki/ki.js";
import { TWO_WEEKS_MS } from "common/dateUtils";
import { isCanvasAssignmentSubmitted } from "common/canvas";
import { stripHtml } from "../utils/htmlUtils.js";
import { normaliserFilnavnHint } from "../utils/dateFormatter.js";
import { formatCourseLabel } from "./semantic-search.service.js";
import {
  searchChunks,
  buildChunkContext,
  buildChunkContextFromEntries,
  checkChunkSparsity,
  selectChunksForExpansion,
} from "./chunk.service.js";
import {
  getStoredCourseCatalog,
  getStoredChunksForCourses,
  getStoredChunksForFile,
  getStoredFullDocumentForFile,
  hasStoredContentForUser,
} from "./embedding.service.js";
import { hybridSearch, type HybridSearchResult } from "./hybrid-retrieval.service.js";
import { CanvasStructureModel, type ICanvasStructure } from "../database/models/CanvasStructure.js";
import {
  isCourseOverviewQuery,
  isStructuredCanvasQuery,
  normaliserCanvasSporsmal,
} from "./canvasStructuredQueries.js";

import { z } from "zod";

// ─── Typer ─────────────────────────────────────────────────

export type IntentType = "general_chat" | "canvas_light" | "canvas_full";

export const ContextResultSchema = z.object({
  kontekst: z.string(),
  hasCanvasData: z.boolean(),
  source: z.enum(["redis", "mongodb", "api", "vector", "chunks", "none"]),
  /** true hvis minst én chunk inneholder sparse kulepunkt-innhold (PowerPoint etc.) */
  hasSparseChunks: z.boolean().optional(),
  /** true når konteksten er hentet som full dokumenttekst (ikke chunk-sammensetning) */
  fullDocumentMode: z.boolean().optional(),
});

export type ContextResult = z.infer<typeof ContextResultSchema>;

interface SyncedCourse {
  id: string;
  name: string;
  course_code?: string;
  moduleTitles: string[];
  fileNames: string[];
}

const COURSE_MATCH_STOPWORDS = new Set([
  "og", "i", "på", "for", "til", "av", "med", "om",
  "emne", "emner", "kurs", "kursene", "fag", "faget", "fagene",
  "høst", "host", "vår", "var", "semester", "kull", "bø", "bo",
  "campus", "gruppe", "klasse", "studie", "studiet", "innføring",
]);

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const FULL_DOCUMENT_TRIGGER_WORDS = [
  "oppsummere",
  "oppsummer",
  "forklar hele",
  "gi meg oversikt",
  "hva dekker",
  "hele kapittel",
  "alle temaene",
  "hva handler om",
  "sammendrag",
  "gå gjennom",
];

function shouldUseFullDocumentMode(
  message: string,
  target: TargetedQuery | undefined,
  filteredResults: HybridSearchResult[],
): { enabled: boolean; reason: string; triggerWord?: string } {
  const rawLower = message.toLowerCase();
  const normalized = normaliserCanvasSporsmal(message);
  const wordCount = normalized.split(/\s+/).filter(Boolean).length;
  const triggerWord = FULL_DOCUMENT_TRIGGER_WORDS.find((word) => rawLower.includes(word));
  const explicitBroadQuery = !!triggerWord;
  const explicitFileOrChapter = Boolean(target?.fileHint || target?.moduleHint);
  const uniqueFileIds = new Set(filteredResults.map((r) => `${r.source.courseId}:${r.source.fileId}`));
  const singleFileBroadMatch = uniqueFileIds.size === 1 && wordCount < 6;

  if (explicitBroadQuery) return { enabled: true, reason: "explicit_broad_query", triggerWord };
  if (explicitFileOrChapter) return { enabled: true, reason: "explicit_file_or_chapter" };
  if (singleFileBroadMatch) return { enabled: true, reason: "single_file_broad_query" };
  return { enabled: false, reason: "chunk_mode_no_trigger_word" };
}
function tokenizeCourseMatchText(value: string): string[] {
  return normaliserCanvasSporsmal(value)
    .split(" ")
    .map((token) => token.trim())
    .filter((token) => token.length >= 3)
    .filter((token) => !/^\d+$/.test(token))
    .filter((token) => !COURSE_MATCH_STOPWORDS.has(token));
}

function scoreKnownCourseMatch(
  course: SyncedCourse,
  normalizedMessage: string,
  normalizedHint: string | null,
): number {
  const compactMessage = normalizedMessage.replace(/\s+/g, "");
  const normalizedName = normaliserCanvasSporsmal(course.name);
  const normalizedCode = normaliserCanvasSporsmal(course.course_code ?? "");
  const compactCode = (course.course_code ?? "").toLowerCase().replace(/[^a-z0-9æøå]/g, "");

  let score = 0;

  if (compactCode && compactMessage.includes(compactCode)) {
    score += 140;
  } else if (normalizedCode && normalizedMessage.includes(normalizedCode)) {
    score += 120;
  }

  if (normalizedHint) {
    if (normalizedCode && (normalizedCode.includes(normalizedHint) || normalizedHint.includes(normalizedCode))) {
      score += 90;
    }
    if (normalizedName.includes(normalizedHint) || normalizedHint.includes(normalizedName)) {
      score += 80;
    }
  }

  if (normalizedName.length >= 6 && normalizedMessage.includes(normalizedName)) {
    score += 100;
  }

  const tokens = tokenizeCourseMatchText(`${course.name} ${course.course_code ?? ""}`);
  if (tokens.length > 0) {
    const matchedTokens = tokens.filter((token) =>
      // eslint-disable-next-line security/detect-non-literal-regexp -- token er avledet fra intern kurskatalog og escapeRegex() brukes
      new RegExp(`(^|\\s)${escapeRegex(token)}(\\s|$)`, "i").test(normalizedMessage),
    );

    if (matchedTokens.length >= 2) {
      score += matchedTokens.length * 22;
    } else if (matchedTokens.length === 1 && tokens.length === 1) {
      score += 35;
    }
  }

  return score;
}

/**
 * Matcher brukerens melding mot faktiske emner i Canvas-katalogen.
 * Dette gjør courseHint robust for alle studier, ikke bare hardkodede fagord.
 */
export async function resolveTargetAgainstKnownCourses(
  userId: string,
  target: TargetedQuery,
  message: string,
): Promise<TargetedQuery> {
  if (target.courseIdHint != null) {
    return target;
  }

  const emner = await hentKjentEmnekatalog(userId);
  if (emner.length === 0) {
    return target;
  }

  const normalizedMessage = normaliserCanvasSporsmal(message);
  if (!normalizedMessage) {
    return target;
  }

  const normalizedHint = target.courseHint ? normaliserCanvasSporsmal(target.courseHint) : null;
  const scored = emner
    .map((course) => ({
      course,
      score: scoreKnownCourseMatch(course, normalizedMessage, normalizedHint),
    }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score);

  if (scored.length === 0) {
    return target;
  }

  const [best, secondBest] = scored;
  const hasStrongMatch = best.score >= 70 || (best.score >= 45 && (!secondBest || best.score - secondBest.score >= 20));
  if (!hasStrongMatch) {
    return target;
  }

  const numericCourseId = /^\d+$/.test(best.course.id) ? Number(best.course.id) : null;
  const resolvedHint = best.course.course_code
    ? best.course.course_code.replace(/-/g, "").toLowerCase()
    : normaliserCanvasSporsmal(best.course.name);

  logger.info(
    {
      userId,
      originalCourseHint: target.courseHint,
      resolvedCourseHint: resolvedHint,
      resolvedCourseId: numericCourseId,
      matchedCourseName: best.course.name,
      matchedCourseCode: best.course.course_code,
      score: best.score,
    },
    "Matchet kurshint mot brukerens faktiske emnekatalog",
  );

  return {
    ...target,
    courseIdHint: numericCourseId,
    courseHint: resolvedHint,
  };
}

function hasCourseTarget(target?: TargetedQuery): boolean {
  return target?.courseIdHint !== null && target?.courseIdHint !== undefined
    ? true
    : !!target?.courseHint;
}

function matchesCourseId(
  candidateCourseId: string | number | null | undefined,
  courseIdHint: number | null | undefined,
): boolean {
  if (candidateCourseId == null || courseIdHint == null) {
    return false;
  }

  return String(candidateCourseId) === String(courseIdHint);
}

/** Felles datastruktur for lett kontekst-bygging (brukes av både Redis- og MongoDB-kilde) */
interface LettKontekstEmne {
  name: string;
  course_code?: string;
  oppgaver: Array<{
    name: string;
    due_at?: string | null;
    submission?: { workflow_state?: string | null; submitted_at?: string | null } | null;
  }>;
}

/**
 * Felles formatter for lett kontekst — brukes av både Redis og MongoDB-fallback.
 * Eliminerer duplikat kontekst-byggingslogikk.
 */
function formaterLettKontekst(emner: LettKontekstEmne[]): string {
  const now = new Date();
  const twoWeeksFromNow = new Date(now.getTime() + TWO_WEEKS_MS);

  let kontekst = "[CANVAS-DATA START]\n";
  kontekst += `EMNER (${emner.length} aktive):\n`;
  for (const emne of emner) {
    kontekst += `- ${formatCourseLabel(emne.name, emne.course_code)}\n`;
  }

  const fristLinjer: Array<{ dueAt: number; line: string }> = [];
  for (const emne of emner) {
    for (const oppg of emne.oppgaver) {
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
}

function titleMatchesFileHint(title: string, fileHint: string): boolean {
  const normHint = normaliserFilnavnHint(fileHint);
  const normTitle = normaliserFilnavnHint(title);
  return normTitle.includes(normHint) || normHint.includes(normTitle);
}

/**
 * Formaterer kursoversikt fra lagret MongoDB/Redis-data.
 * Brukes når brukeren spør om "hvilke fag har jeg" o.l.
 */
function formaterKursoversiktFraLagring(
  courses: Array<{ courseName: string; course_code?: string; moduler?: Array<{ name: string }> }>,
): string {
  let kontekst = "[CANVAS-DATA START]\n";
  kontekst += `EMNER (${courses.length} aktive):\n`;
  for (const course of courses) {
    const label = formatCourseLabel(course.courseName, course.course_code);
    kontekst += `- ${label}\n`;
    if (course.moduler && course.moduler.length > 0) {
      kontekst += `  Moduler: ${course.moduler.map((m) => m.name).slice(0, 5).join(", ")}`;
      if (course.moduler.length > 5) {
        kontekst += ` (+${course.moduler.length - 5} til)`;
      }
      kontekst += "\n";
    }
  }
  kontekst += "[CANVAS-DATA SLUTT]";
  return kontekst;
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

  if (!hasCourseTarget(target) && !target?.moduleHint && !target?.fileHint) {
    return emner;
  }

  if (!target) {
    return emner;
  }

  if (target?.courseIdHint != null) {
    const matched = emner.filter((emne) =>
      matchesCourseId(emne.id, target.courseIdHint),
    );
    if (matched.length > 0) {
      return matched;
    }
  }

  if (target.courseHint) {
    const hint = target.courseHint.toLowerCase();
    
    // Eksakt eller substring-match i navn eller emnekode
    const matched = emner.filter(
      (emne) =>
        emne.name.toLowerCase().includes(hint) ||
        (emne.course_code ?? "").toLowerCase().includes(hint),
    );
    if (matched.length > 0) {
      return matched;
    }

    // Fuzzy matching: sjekk om hint er et prefiks av emnekoden
    // Eksempel: hint="dat" skal matche course_code="DAT102"
    const fuzzyMatched = emner.filter((emne) => {
      const code = (emne.course_code ?? "").toLowerCase();
      // Sjekk om emnekoden starter med hint (f.eks. "dat" matcher "dat102")
      if (code.startsWith(hint)) {
        return true;
      }
      // Sjekk om hint er en del av emnekoden uten bindestrek (f.eks. "is304" matcher "IS-304")
      const codeWithoutDash = code.replace(/-/g, "");
      if (codeWithoutDash.startsWith(hint) || codeWithoutDash.includes(hint)) {
        return true;
      }
      return false;
    });
    if (fuzzyMatched.length > 0) {
      logger.info(
        { hint, matchedCourses: fuzzyMatched.map((e) => e.course_code) },
        "Fuzzy-match på emnekode-prefiks",
      );
      return fuzzyMatched;
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

// ─── MongoDB fallback-hjelpere ───────────────────────────────

/** Nøkkelord som indikerer at brukeren spør om kunngjøringer.
 * Bruker regex for å fange vanlige skrivefeil (f.eks. "kungjøring" uten 'n'). */
const ANNOUNCEMENT_PATTERN = /ku+n{1,2}gj[øo]ring|beskjed|announcement|nyhet|varsel|endring/i;

function isAnnouncementQuery(message: string): boolean {
  return ANNOUNCEMENT_PATTERN.test(message);
}

interface AnnouncementEntry {
  title: string;
  message?: string | null;
  posted_at?: string | null;
  courseName: string;
}

/**
 * Henter kunngjøringer for en bruker fra Redis og/eller MongoDB.
 * Returnerer sortert liste (nyeste først) med kursnavn inkludert.
 */
async function hentKunngjøringerForBruker(userId: string): Promise<AnnouncementEntry[]> {
  const announcements: AnnouncementEntry[] = [];

  // Prøv Redis først
  const redisAvailable = isRedisReady();
  if (redisAvailable) {
    const emnerRaw = await getCache(userKey(userId, "emner"));
    if (emnerRaw) {
      try {
        const emner = JSON.parse(emnerRaw) as Array<{ id: number; name: string }>;
        const results = await Promise.all(
          emner.map(async (emne) => ({
            courseName: emne.name,
            raw: await getCache(userKey(userId, "emne", String(emne.id), "kunngjøringer")),
          })),
        );
        for (const { courseName, raw } of results) {
          if (!raw) continue;
          try {
            const parsed = JSON.parse(raw) as Array<{
              title: string;
              message?: string | null;
              posted_at?: string | null;
            }>;
            for (const k of parsed) {
              announcements.push({ ...k, courseName });
            }
          } catch { /* ugyldig JSON — hopp over */ }
        }
      } catch { /* ugyldig emner-JSON */ }
    }
  }

  // MongoDB fallback hvis Redis ga ingenting
  if (announcements.length === 0) {
    try {
      const structures = await CanvasStructureModel.find({ userId }).lean<ICanvasStructure[]>();
      for (const s of structures) {
        for (const k of s.kunngjøringer ?? []) {
          announcements.push({
            title: k.title,
            message: k.message,
            posted_at: k.posted_at,
            courseName: s.courseName,
          });
        }
      }
    } catch (error) {
      logger.warn({ err: error, userId }, "Feil ved henting av kunngjøringer fra MongoDB");
    }
  }

  // Sorter nyeste først
  return announcements.sort((a, b) => {
    const dateA = a.posted_at ? new Date(a.posted_at).getTime() : 0;
    const dateB = b.posted_at ? new Date(b.posted_at).getTime() : 0;
    return dateB - dateA;
  });
}

/**
 * Formaterer kunngjøringer til en kontekstblokk for Claude.
 * Maks 20 kunngjøringer, med tittel, dato, kurs og meldingsinnhold.
 */
function formaterKunngjøringerKontekst(announcements: AnnouncementEntry[]): string {
  const maxAnnouncements = 20;
  const recent = announcements.slice(0, maxAnnouncements);

  let blokk = `\n\nKUNNGJØRINGER (${recent.length} av ${announcements.length} totalt, nyeste først):\n`;
  for (const k of recent) {
    const dato = k.posted_at ? new Date(k.posted_at).toLocaleDateString("nb-NO") : "ukjent dato";
    blokk += `\n[Kunngjøring – ${k.courseName}]\n`;
    blokk += `Tittel: ${k.title}\n`;
    blokk += `Dato: ${dato}\n`;
    if (k.message) {
      const melding = stripHtml(k.message).trim();
      if (melding.length > 0) {
        blokk += `${melding.substring(0, 500)}${melding.length > 500 ? "..." : ""}\n`;
      }
    }
  }
  return blokk;
}

/**
 * Bygger lett kontekst fra MongoDB CanvasStructure (permanent fallback når Redis TTL utløper).
 */
async function byggLettKontekstFraMongo(userId: string): Promise<string | null> {
  try {
    const structures = await CanvasStructureModel.find({ userId }).lean<ICanvasStructure[]>();
    if (!structures || structures.length === 0) return null;

    const emner: LettKontekstEmne[] = structures.map((s) => ({
      name: s.courseName,
      course_code: s.course_code,
      oppgaver: s.oppgaver,
    }));

    return formaterLettKontekst(emner);
  } catch (error) {
    logger.warn({ err: error, userId }, "Feil ved bygging av lett kontekst fra MongoDB");
    return null;
  }
}

/**
 * Bygger målrettet kontekst fra MongoDB CanvasStructure for et spesifikt emne/modul.
 * Matcher på courseHint, moduleHint og fileHint — speiler logikken i Redis-versjonen.
 */
async function byggMålrettetKontekstFraMongo(
  userId: string,
  target: TargetedQuery,
): Promise<string | null> {
  try {
    const structures = await CanvasStructureModel.find({ userId }).lean<ICanvasStructure[]>();
    if (!structures || structures.length === 0) return null;

    // Finn matchende kurs — søk i courseHint, moduleHint, fileHint (samme rekkefølge som finnRelevanteEmner)
    let matchedStructure: (typeof structures)[number] | undefined;

    if (target.courseIdHint != null) {
      matchedStructure = structures.find((s) =>
        matchesCourseId(s.courseId, target.courseIdHint),
      );
    }

    if (!matchedStructure && target.courseHint) {
      const hint = target.courseHint.toLowerCase();
      matchedStructure = structures.find(
        (s) =>
          s.courseName.toLowerCase().includes(hint) ||
          s.course_code.toLowerCase().includes(hint),
      );
    }

    if (!matchedStructure && target.moduleHint) {
      const hint = target.moduleHint.toLowerCase();
      matchedStructure = structures.find((s) =>
        s.moduler.some((mod) => mod.name.toLowerCase().includes(hint)),
      );
    }

    if (!matchedStructure && target.fileHint) {
      matchedStructure = structures.find((s) =>
        s.moduler.some((mod) =>
          mod.items?.some((item) =>
            item.type === "File" && titleMatchesFileHint(item.title, target.fileHint!),
          ),
        ),
      );
    }

    if (!matchedStructure && structures.length === 1) {
      matchedStructure = structures[0];
    }

    if (!matchedStructure) return null;

    let kontekst = "[CANVAS-DATA START]\n";
    kontekst += `EMNE: ${formatCourseLabel(matchedStructure.courseName, matchedStructure.course_code)}\n\n`;

    let hadModuleFileContent = false;

    // Moduler
    if (matchedStructure.moduler.length > 0) {
      kontekst += `MODULER (${matchedStructure.moduler.length}):\n`;
      for (const mod of matchedStructure.moduler) {
        kontekst += `\n### ${mod.name}\n`;

        // Filtrer til spesifikk modul hvis moduleHint finnes
        if (target.moduleHint) {
          const hint = target.moduleHint.toLowerCase();
          if (!mod.name.toLowerCase().includes(hint)) {
            kontekst += "(Ikke relevant for søket)\n";
            continue;
          }
        }

        if (mod.items && mod.items.length > 0) {
          const maxFilerMedInnhold = target.moduleHint ? 5 : 1;
          let filerMedInnhold = 0;
          for (const item of mod.items) {
            kontekst += `- [${item.type}] ${item.title}\n`;

            // Inkluder filinnhold fra chunks (MongoDB ContentEmbedding) for matchende filer
            const skalInkludereFil =
              item.type === "File" &&
              item.content_id != null &&
              (target.fileHint
                ? titleMatchesFileHint(item.title, target.fileHint)
                : target.moduleHint && filerMedInnhold < maxFilerMedInnhold);

            if (skalInkludereFil && item.content_id != null) {
              try {
                const fileChunks = await getStoredChunksForFile(
                  userId,
                  matchedStructure.courseId,
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
    }

    // Oppgaver
    if (matchedStructure.oppgaver.length > 0) {
      kontekst += `OPPGAVER (${matchedStructure.oppgaver.length}):\n`;
      for (const oppg of matchedStructure.oppgaver) {
        const frist = oppg.due_at ? new Date(oppg.due_at).toLocaleDateString("nb-NO") : "ingen frist";
        const poeng = oppg.points_possible != null ? `${oppg.points_possible}p` : "";
        const status = isCanvasAssignmentSubmitted(oppg) ? "✓" : "⏳";
        kontekst += `- ${status} ${oppg.name} — frist: ${frist} ${poeng}\n`;

        if (oppg.description) {
          const desc = stripHtml(oppg.description).trim();
          if (desc.length > 0) {
            kontekst += `  Beskrivelse: ${desc.substring(0, 300)}${desc.length > 300 ? "..." : ""}\n`;
          }
        }
      }
      kontekst += "\n";
    }

    // Kunngjøringer
    if (matchedStructure.kunngjøringer.length > 0) {
      kontekst += `KUNNGJØRINGER (${Math.min(matchedStructure.kunngjøringer.length, 5)} nyeste):\n`;
      for (const k of matchedStructure.kunngjøringer.slice(0, 5)) {
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

    kontekst += "[CANVAS-DATA SLUTT]";

    // Ved modulspørsmål uten filinnhold: fall tilbake til API som henter PDF live
    if (target.moduleHint && !hadModuleFileContent) {
      logger.info(
        { userId, target },
        "Målrettet MongoDB: ingen filinnhold for modul — fallback til API",
      );
      return null;
    }

    return kontekst;
  } catch (error) {
    logger.warn({ err: error, userId }, "Feil ved bygging av målrettet kontekst fra MongoDB");
    return null;
  }
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

    // Hent oppgaver for alle emner parallelt
    const oppgaverResults = await Promise.all(
      emner.map(async (emne) => ({
        emne,
        raw: await getCache(userKey(userId, "emne", String(emne.id), "oppgaver")),
      })),
    );

    const lettEmner: LettKontekstEmne[] = oppgaverResults.map(({ emne, raw }) => {
      let oppgaver: LettKontekstEmne["oppgaver"] = [];
      if (raw) {
        try {
          oppgaver = JSON.parse(raw);
        } catch {
          // Ugyldig JSON — hopp over
        }
      }
      return { name: emne.name, course_code: emne.course_code, oppgaver };
    });

    return formaterLettKontekst(lettEmner);
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
          const poeng = oppg.points_possible != null ? `${oppg.points_possible}p` : "";
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
    // Blokkér kun når courseHint er eksplisitt satt men ingen kurs matchet
    if (hasCourseTarget(target) && courseIds.length === 0) {
      logger.info({ userId, target }, "Chunk-søk: courseHint satt men ingen kurs matchet");
      return null;
    }
    const coursesPinned = courseIds.length > 0;

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
          {
            userId,
            courseCount: courseIds.length,
            courseHint: target?.courseHint,
            courseIdHint: target?.courseIdHint,
          },
          "Ingen lagrede chunks funnet i MongoDB",
        );
        return null;
      }
    }

    let scored = searchChunks(allChunks, message, {
      moduleHint: target?.moduleHint,
      fileHint: target?.fileHint,
    });

    // Modul-filter kun når vi er avgrenset til spesifikke kurs
    if (coursesPinned && target?.moduleHint) {
      const moduleMatches = scored.filter((chunk) =>
        chunk.source.moduleTitle.toLowerCase().includes(target.moduleHint!.toLowerCase()),
      );
      if (moduleMatches.length === 0) {
        // Fallback: moduleHint matchet ingenting i chunk-metadata — bruk alle resultater
        logger.warn(
          { userId, moduleHint: target.moduleHint, chunksBeforeFilter: scored.length, action: "fallback til ufiltrerte chunks" },
          "Chunk-søk: moduleHint matchet ingen chunks — bruker alle som fallback",
        );
        // scored beholdes uendret
      } else {
        scored = moduleMatches;
      }
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

function filtrerHybridResultater(
  results: HybridSearchResult[],
  target?: TargetedQuery,
  coursesPinned?: boolean,
): HybridSearchResult[] {
  let filtered = results;

  // Modul-filter kun når vi allerede er avgrenset til spesifikke kurs —
  // ellers lar vi retrieval-scoren bestemme relevans
  if (coursesPinned && target?.moduleHint) {
    const moduleMatches = filtered.filter((result) =>
      result.source.moduleTitle.toLowerCase().includes(target.moduleHint!.toLowerCase()),
    );
    if (moduleMatches.length === 0) {
      // Fallback: moduleHint matchet ingenting — bruk alle reranked resultater
      // slik at Claude ikke mottar tom kontekst pga. et for strengt modul-filter.
      logger.warn(
        {
          moduleHint: target.moduleHint,
          courseHint: target.courseHint,
          chunksBeforeFilter: results.length,
          action: "fallback til ufiltrerte chunks",
        },
        "Hybrid søk: alle resultater filtrert bort av moduleHint — bruker ufiltrerte chunks som fallback",
      );
      return filtered; // returner alle i stedet for []
    }
    filtered = moduleMatches;
  }

  if (target?.fileHint) {
    const fileMatches = filtered.filter((result) =>
      titleMatchesFileHint(result.source.fileName, target.fileHint!),
    );
    if (fileMatches.length === 0) return [];
    filtered = fileMatches;
  }

  return filtered;
}

/**
 * Bygger kontekst via hybrid søk: Pinecone + BM25 → RRF → Cohere Rerank.
 * Erstatter separat vector- og keyword-søk med én samlet pipeline.
 *
 * Bruker chunkHint som søkequery når den finnes — dette gir bedre BM25-matching
 * på fagbegreper som brukeren eksplisitt nevner (f.eks. "recursion", "kvantitativ metode").
 *
 * Returnerer også hasSparseChunks for å signalisere om konteksten inneholder
 * PowerPoint-kulepunkter eller lignende sparse innhold.
 */
async function byggKontekstFraHybridSearch(
  userId: string,
  message: string,
  target?: TargetedQuery,
): Promise<{ kontekst: string; hasSparseChunks: boolean; fullDocumentMode: boolean } | null> {
  try {
    const relevantCourses = await finnRelevanteEmner(userId, target);
    const courseIds = relevantCourses.map((course) => String(course.id));
    // Blokkér kun når courseHint er eksplisitt satt men ingen kurs matchet.
    // Når courseHint er null, søker vi på tvers av alle kurs —
    // retrieval-scoren bestemmer relevans.
    if (hasCourseTarget(target) && courseIds.length === 0) {
      logger.info({ userId, target }, "Hybrid søk: courseHint satt men ingen kurs matchet");
      return null;
    }

    const coursesPinned = courseIds.length > 0;

    // Bruk chunkHint som søkequery når den finnes — gir bedre nøkkelord-matching
    // Fallback til full melding for semantisk søk
    const searchQuery = target?.chunkHint || message;
    if (target?.chunkHint) {
      logger.info(
        { userId, chunkHint: target.chunkHint, intent: "canvas_full" },
        "Hybrid søk trigget av chunkHint",
      );
    }

    const { results, degraded, sources } = await hybridSearch(userId, searchQuery, {
      courseIds: coursesPinned ? courseIds : undefined,
    });

    if (results.length === 0) {
      logger.info(
        { userId, degraded, messagePreview: message.substring(0, 80) },
        "Hybrid søk ga ingen resultater",
      );
      return null;
    }

    if (degraded) {
      logger.warn(
        { userId, sources, messagePreview: message.substring(0, 80) },
        "Hybrid søk: delvis degradert — bruker tilgjengelige resultater",
      );
    }

    const filteredResults = filtrerHybridResultater(results, target, coursesPinned);
    if (filteredResults.length === 0) {
      logger.info(
        { userId, messagePreview: message.substring(0, 80) },
        "Hybrid søk: alle resultater filtrert bort av target-hints",
      );
      return null;
    }

    // ── Full dokument-mode ──
    const fullDocumentDecision = shouldUseFullDocumentMode(message, target, filteredResults);
    if (fullDocumentDecision.enabled) {
      const primary = filteredResults[0];
      const fullDocument = await getStoredFullDocumentForFile(
        userId,
        primary.source.courseId,
        primary.source.fileId,
      );

      if (fullDocument) {
        const maxTokens = 20000;
        const estimatedChars = maxTokens * 4;
        const truncatedFullText = fullDocument.fullText.slice(0, estimatedChars);
        const truncated = truncatedFullText.length < fullDocument.fullText.length;
        const kontekst =
          "[CANVAS-DATA START]\n" +
          `--- FIL-INNHOLD (FULLT DOKUMENT): ${fullDocument.fileName} ---\n` +
          truncatedFullText +
          "\n[CANVAS-DATA SLUTT]";

        logger.info(
          {
            mode: "full_document",
            triggerWord: fullDocumentDecision.triggerWord ?? null,
            fileId: primary.source.fileId,
            fileName: fullDocument.fileName,
            fullTextChars: fullDocument.charCount,
            injectedChars: truncatedFullText.length,
            truncated,
            reason: fullDocumentDecision.reason,
          },
          "Full dokument-mode aktivert",
        );

        return { kontekst, hasSparseChunks: false, fullDocumentMode: true };
      }
    }
    if (!fullDocumentDecision.enabled) {
      logger.info(
        {
          mode: "chunk",
          reason: "no trigger word matched",
          queryPreview: message.substring(0, 120),
        },
        "Full dokument-mode ikke trigget",
      );
    }

    // ── Sparsity-sjekk på chunks ──
    // Oppdager PowerPoint-kulepunkter og lignende sparse innhold
    let hasSparseChunks = false;
    for (const result of filteredResults) {
      const { sparse, avgWordsPerLine } = checkChunkSparsity(result.text);
      if (sparse) {
        hasSparseChunks = true;
        logger.debug(
          {
            chunkId: `${result.source.courseId}:${result.source.fileId}:${result.chunkIndex}`,
            avgWordsPerLine: avgWordsPerLine.toFixed(1),
            sparse: true,
          },
          "Sparse chunk detektert",
        );
      }
    }

    // ── File-aware context expansion ──
    // Hent full innhold fra matchede filer (ikke bare oppsummering)
    const MAX_EXPANDED_CHARS = 23000; // topFile opptil 20k + sekundære opptil 3k
    const MAX_TOPFILE_EXPANDED_CHARS = 20000;
    const MAX_SECONDARY_EXPANDED_CHARS = 3000;
    const expandedChunks: Array<{ text: string; source: typeof filteredResults[0]["source"]; index: number }> = [];
    let totalExpandedChars = 0;
    let filesExpanded = 0;

    // Grupper etter fileId og samle matchede indekser
    const fileMatchCounts = new Map<string, { count: number; source: typeof filteredResults[0]["source"]; indexes: Set<number> }>();
    for (const result of filteredResults) {
      const fileKey = `${result.source.courseId}:${result.source.fileId}`;
      const existing = fileMatchCounts.get(fileKey);
      if (existing) {
        existing.count++;
        existing.indexes.add(result.chunkIndex);
      } else {
        fileMatchCounts.set(fileKey, {
          count: 1,
          source: result.source,
          indexes: new Set([result.chunkIndex]),
        });
      }
    }

    // Identifiser topFile: høyeste score først, deretter flest matcher.
    const topResult = [...filteredResults]
      .sort((a, b) => {
        if (Math.abs(b.score - a.score) > 0.0001) return b.score - a.score;
        const aCount = fileMatchCounts.get(`${a.source.courseId}:${a.source.fileId}`)?.count ?? 0;
        const bCount = fileMatchCounts.get(`${b.source.courseId}:${b.source.fileId}`)?.count ?? 0;
        return bCount - aCount;
      })[0];
    const topFileKey = `${topResult.source.courseId}:${topResult.source.fileId}`;
    const topFileInfo = fileMatchCounts.get(topFileKey);

    // Sorter sekundære filer etter flest matcher
    const secondaryFiles = Array.from(fileMatchCounts.entries())
      .filter(([key]) => key !== topFileKey)
      .sort((a, b) => b[1].count - a[1].count);

    const expansionOrder: Array<{ fileInfo: { count: number; source: typeof filteredResults[0]["source"]; indexes: Set<number> }; reason: "topFile" | "secondary"; budgetCap: number }> = [];
    if (topFileInfo) {
      expansionOrder.push({ fileInfo: topFileInfo, reason: "topFile", budgetCap: MAX_TOPFILE_EXPANDED_CHARS });
    }
    for (const [, fileInfo] of secondaryFiles) {
      expansionOrder.push({ fileInfo, reason: "secondary", budgetCap: MAX_SECONDARY_EXPANDED_CHARS });
    }

    for (const { fileInfo, reason, budgetCap } of expansionOrder) {
      if (totalExpandedChars >= MAX_EXPANDED_CHARS) break;

      try {
        // Hent alle chunks fra filen
        const allFileChunks = await getStoredChunksForFile(
          userId,
          fileInfo.source.courseId,
          fileInfo.source.fileId,
        );

        // Hopp over hvis filen har få chunks (lite å ekspandere)
        if (allFileChunks.length <= fileInfo.indexes.size + 2) continue;

        const remainingBudget = Math.min(
          budgetCap,
          MAX_EXPANDED_CHARS - totalExpandedChars,
        );
        if (remainingBudget <= 0) continue;
        const additionalChunks = selectChunksForExpansion(
          allFileChunks,
          fileInfo.indexes,
          remainingBudget,
        );

        if (additionalChunks.length > 0) {
          for (const chunk of additionalChunks) {
            expandedChunks.push({
              text: chunk.text,
              source: fileInfo.source,
              index: chunk.index,
            });
            totalExpandedChars += chunk.text.length;
          }
          filesExpanded++;

          logger.info(
            {
              fileId: fileInfo.source.fileId,
              fileName: fileInfo.source.fileName,
              reason,
              charsAdded: additionalChunks.reduce((sum, c) => sum + c.text.length, 0),
            },
            "Fil-ekspansjon lagt til kontekst",
          );
        }
      } catch (err) {
        logger.warn(
          { err, userId, fileId: fileInfo.source.fileId },
          "Feil ved henting av fil-chunks for ekspansjon",
        );
      }
    }

    // Kombiner matchede chunks med ekspanderte chunks og sorter etter filnavn + indeks
    const allChunksForContext = [
      ...filteredResults.map((r) => ({ text: r.text, source: r.source, index: r.chunkIndex })),
      ...expandedChunks,
    ];

    // Sorter etter fil og deretter indeks for logisk dokumentrekkefølge
    allChunksForContext.sort((a, b) => {
      const fileCompare = `${a.source.courseId}:${a.source.fileId}`.localeCompare(
        `${b.source.courseId}:${b.source.fileId}`,
      );
      if (fileCompare !== 0) return fileCompare;
      return a.index - b.index;
    });

    const kontekst = buildChunkContextFromEntries(allChunksForContext, 13000);
    if (kontekst.length === 0) return null;

    logger.info(
      {
        userId,
        chunkHint: target?.chunkHint ?? null,
        intent: "canvas_full",
        matchedChunks: filteredResults.length,
        filesExpanded,
        totalExpandedChars,
        topScore: filteredResults[0].score.toFixed(3),
        topFile: filteredResults[0].source.fileName,
        contextLength: kontekst.length,
        hasSparseChunks,
        sources,
      },
      "Hybrid søk kontekst bygget med full fil-ekspansjon",
    );

    return {
      kontekst: "[CANVAS-DATA START]\n" + kontekst + "\n[CANVAS-DATA SLUTT]",
      hasSparseChunks,
      fullDocumentMode: false,
    };
  } catch (error) {
    logger.warn({ err: error }, "Feil ved hybrid søk — faller tilbake til keyword-søk");
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

  // Sett generiske moduleHints til null tidlig i pipelinen slik at alle nedstrøms filtre
  // ikke blokkerer resultater pga. ord som "leksjonene", "forelesningene" osv.
  // courseHint beholdes alltid — det er alltid spesifikt nok til å identifisere et kurs.
  const GENERIC_MODULE_HINTS = new Set([
    "leksjonene", "leksjon", "leksjonen",
    "forelesningene", "forelesning", "forelesningen", "forelesningane",
    "modulene", "modul", "modulen",
    "innhold", "pensum", "faget", "kurset", "emnet", "emner", "fagene",
    "alt", "alle", "materialet", "stoffet", "leksjonane",
  ]);

  const sanitizedTarget: TargetedQuery | undefined = target
    ? {
        ...target,
        moduleHint:
          target.moduleHint && GENERIC_MODULE_HINTS.has(target.moduleHint.toLowerCase())
            ? null
            : target.moduleHint,
      }
    : undefined;

  if (target?.moduleHint && sanitizedTarget?.moduleHint === null) {
    logger.info(
      { userId, originalModuleHint: target.moduleHint },
      "loadCanvasContext: generisk moduleHint ignorert — bruker bredere søk",
    );
  }

  // Bruk sanitert target for alle videre oppslag
  target = sanitizedTarget;

  const redisAvailable = isRedisReady();
  const hasRedisSyncData = redisAvailable && (await hasCanvasSyncData(userId));
  const hasStoredAIContent = await hasStoredContentForUser(userId);
  const wantsCourseOverview = Boolean(message && isCourseOverviewQuery(message));
  const shouldPreferStructuredContext = Boolean(message && isStructuredCanvasQuery(message));
  const wantsAnnouncements = Boolean(message && isAnnouncementQuery(message));
  const hasSpecificTarget = !!(
    hasCourseTarget(target) ||
    target?.moduleHint ||
    target?.fileHint
  );

  if (wantsCourseOverview) {
    // Prøv Redis først (prosessert kursdata fra sync)
    const dbCoursesKey = `db:user:${userId}:courses`;
    const cachedCourses = await getCache(dbCoursesKey);
    if (cachedCourses) {
      try {
        const courses = JSON.parse(cachedCourses);
        const kontekst = formaterKursoversiktFraLagring(courses);
        logger.info(
          { userId, intent, source: "redis", courseCount: courses.length },
          "Canvas-kontekst: kursoversikt lastet fra Redis",
        );
        return { kontekst, hasCanvasData: true, source: "redis" };
      } catch {
        // Ugyldig JSON — fortsett til MongoDB
      }
    }

    // MongoDB fallback
    const mongoKontekst = await byggLettKontekstFraMongo(userId);
    if (mongoKontekst) {
      logger.info(
        { userId, intent, source: "mongodb" },
        "Canvas-kontekst: kursoversikt lastet fra MongoDB",
      );
      // Trigger bakgrunns-sync for å oppdatere Redis
      if (redisAvailable) {
        syncCanvasDataForUser(userId, canvasToken, baseUrl, signal).catch((err) => {
          logger.warn({ err, userId }, "Bakgrunns-sync feilet etter MongoDB-fallback");
        });
      }
      return { kontekst: mongoKontekst, hasCanvasData: true, source: "mongodb" };
    }

    // Ingen lagret data — trigger sync og returner tom kontekst
    logger.info(
      { userId, intent, source: "none" },
      "Canvas-kontekst: ingen lagret kursoversikt — trigger sync",
    );
    if (redisAvailable) {
      syncCanvasDataForUser(userId, canvasToken, baseUrl, signal).catch((err) => {
        logger.warn({ err, userId }, "Bakgrunns-sync feilet");
      });
    }
    return { kontekst: "", hasCanvasData: false, source: "none" };
  }

  // ── Hybrid søk når chunkHint finnes (uavhengig av intent) ──
  // chunkHint indikerer at brukeren spør om spesifikt faginnhold, selv om
  // intent er canvas_light (f.eks. "forklar kvantitativ metode").
  if (!shouldPreferStructuredContext && hasStoredAIContent && message && target?.chunkHint) {
    const hybridResult = await byggKontekstFraHybridSearch(userId, message, target);
    if (hybridResult) {
      logger.info(
        { userId, intent, chunkHint: target.chunkHint, source: "vector", contextLength: hybridResult.kontekst.length },
        "Canvas-kontekst lastet fra hybrid søk (chunkHint-trigget)",
      );
      return {
        kontekst: hybridResult.kontekst,
        hasCanvasData: true,
        source: "vector",
        hasSparseChunks: hybridResult.hasSparseChunks,
        fullDocumentMode: hybridResult.fullDocumentMode,
      };
    }
    // Hvis hybrid søk ikke ga resultater, fortsett med vanlig intent-basert flyt
    logger.info(
      { userId, intent, chunkHint: target.chunkHint },
      "Hybrid søk (chunkHint) ga ingen resultater — fortsetter med intent-basert flyt",
    );
  }

  // ── canvas_light ──
  if (intent === "canvas_light") {
    if (wantsAnnouncements && !hasSpecificTarget) {
      const announcements = await hentKunngjøringerForBruker(userId);
      if (announcements.length > 0) {
        const kontekst = "[CANVAS-DATA START]\n" + formaterKunngjøringerKontekst(announcements) + "\n[CANVAS-DATA SLUTT]";
        logger.info(
          { userId, intent, source: "redis", count: announcements.length, contextLength: kontekst.length },
          "Canvas-kontekst lastet som kunngjøringsoversikt",
        );
        return { kontekst, hasCanvasData: true, source: "redis" };
      }
    }

    if (hasSpecificTarget && target) {
      if (hasRedisSyncData) {
        const redisKontekst = await byggMålrettetKontekstFraRedis(userId, target);
        if (redisKontekst) {
          logger.info(
            { userId, intent, target, source: "redis", contextLength: redisKontekst.length },
            "Canvas-kontekst lastet fra Redis (målrettet metadata)",
          );
          return { kontekst: redisKontekst, hasCanvasData: true, source: "redis" };
        }
      }

      const mongoKontekst = await byggMålrettetKontekstFraMongo(userId, target);
      if (mongoKontekst) {
        logger.info(
          { userId, intent, target, source: "mongodb", contextLength: mongoKontekst.length },
          "Canvas-kontekst lastet fra MongoDB (målrettet metadata fallback)",
        );
        if (redisAvailable) {
          syncCanvasDataForUser(userId, canvasToken, baseUrl, signal).catch((err) => {
            logger.warn({ err, userId }, "Bakgrunns-sync feilet etter målrettet metadata-fallback");
          });
        }
        return { kontekst: mongoKontekst, hasCanvasData: true, source: "mongodb" };
      }

      // Ingen lokal data — trigger sync og returner tom kontekst (ingen Canvas API-kall)
      logger.info(
        { userId, intent, target, source: "none" },
        "Redis+MongoDB mangler data — trigger sync (målrettet metadata)",
      );
      if (redisAvailable) {
        syncCanvasDataForUser(userId, canvasToken, baseUrl, signal).catch((err) => {
          logger.warn({ err, userId }, "Bakgrunns-sync feilet");
        });
      }
      return { kontekst: "", hasCanvasData: false, source: "none" };
    }

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

    // MongoDB fallback (permanent lagring, ~10-30ms)
    const mongoKontekst = await byggLettKontekstFraMongo(userId);
    if (mongoKontekst) {
      logger.info(
        { userId, intent, source: "mongodb", contextLength: mongoKontekst.length },
        "Canvas-kontekst lastet fra MongoDB (lett fallback)",
      );
      // Trigger bakgrunns-sync for å oppdatere Redis
      if (redisAvailable) {
        syncCanvasDataForUser(userId, canvasToken, baseUrl, signal).catch((err) => {
          logger.warn({ err, userId }, "Bakgrunns-sync feilet etter MongoDB-fallback");
        });
      }
      return { kontekst: mongoKontekst, hasCanvasData: true, source: "mongodb" };
    }

    // Ingen lokal data — trigger sync og returner tom kontekst (ingen Canvas API-kall)
    logger.info(
      { userId, intent, source: "none" },
      "Redis+MongoDB mangler data — trigger sync (lett)",
    );
    if (redisAvailable) {
      syncCanvasDataForUser(userId, canvasToken, baseUrl, signal).catch((err) => {
        logger.warn({ err, userId }, "Bakgrunns-sync feilet");
      });
    }
    return { kontekst: "", hasCanvasData: false, source: "none" };
  }

  // ── canvas_full ──
  // Kunngjøring-deteksjon: Kunngjøringer er strukturert data som ikke er indeksert i
  // Pinecone/BM25, så hybrid-søk finner dem aldri. Når brukeren spør om kunngjøringer,
  // hent dem direkte fra Redis/MongoDB og injiser i konteksten.
  let announcementBlock = "";

  if (wantsAnnouncements) {
    const announcements = await hentKunngjøringerForBruker(userId);
    if (announcements.length > 0) {
      announcementBlock = formaterKunngjøringerKontekst(announcements);
      const courseNames = [...new Set(announcements.map((a) => a.courseName))];
      logger.info(
        { userId, count: announcements.length, courses: courseNames, contextAddedLength: announcementBlock.length },
        "Kunngjøringer injisert i Canvas-kontekst",
      );
    } else {
      logger.info({ userId }, "Bruker spurte om kunngjøringer, men ingen ble funnet");
    }
  }

  // Trinn 0: Hybrid søk (Pinecone + BM25 → RRF → Cohere Rerank)
  if (!shouldPreferStructuredContext && hasStoredAIContent && message) {
    const hybridResult = await byggKontekstFraHybridSearch(userId, message, target);
    if (hybridResult) {
      const kontekstMedKunngjøringer = announcementBlock
        ? hybridResult.kontekst.replace("[CANVAS-DATA SLUTT]", announcementBlock + "\n[CANVAS-DATA SLUTT]")
        : hybridResult.kontekst;
      logger.info(
        { userId, intent, source: "vector", contextLength: kontekstMedKunngjøringer.length },
        "Canvas-kontekst lastet fra hybrid søk",
      );
      return {
        kontekst: kontekstMedKunngjøringer,
        hasCanvasData: true,
        source: "vector",
        hasSparseChunks: hybridResult.hasSparseChunks,
        fullDocumentMode: hybridResult.fullDocumentMode,
      };
    }
  }

  // Hvis brukeren spør om kunngjøringer og vi har data, returner det direkte —
  // hybrid-søk finner aldri kunngjøringer (ikke indeksert), så vi trenger ikke vente på chunk-søk.
  if (wantsAnnouncements && announcementBlock) {
    const kontekst = "[CANVAS-DATA START]\n" + announcementBlock + "\n[CANVAS-DATA SLUTT]";
    return { kontekst, hasCanvasData: true, source: "redis" };
  }

  // Trinn 1: Chunk-basert søk (keyword fallback når hybrid søk ikke ga treff)
  if (!shouldPreferStructuredContext && hasStoredAIContent && message) {
    const chunkKontekst = await byggKontekstFraChunks(userId, message, target);
    if (chunkKontekst) {
      logger.info(
        { userId, intent, source: "chunks", contextLength: chunkKontekst.length },
        "Canvas-kontekst lastet fra chunk-søk (keyword)",
      );
      return { kontekst: chunkKontekst, hasCanvasData: true, source: "chunks" };
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

    // MongoDB fallback for målrettet kontekst
    const mongoKontekst = await byggMålrettetKontekstFraMongo(userId, target);
    if (mongoKontekst) {
      logger.info(
        { userId, intent, target, source: "mongodb", contextLength: mongoKontekst.length },
        "Målrettet Canvas-kontekst lastet fra MongoDB (fallback)",
      );
      if (redisAvailable) {
        syncCanvasDataForUser(userId, canvasToken, baseUrl, signal).catch((err) => {
          logger.warn({ err, userId }, "Bakgrunns-sync feilet etter MongoDB-fallback");
        });
      }
      return { kontekst: mongoKontekst, hasCanvasData: true, source: "mongodb" };
    }

    // Ingen lokal data — trigger sync og returner tom kontekst (ingen Canvas API-kall)
    logger.info(
      { userId, intent, target, source: "none" },
      "Redis+MongoDB mangler data — trigger sync (målrettet)",
    );
    if (redisAvailable) {
      syncCanvasDataForUser(userId, canvasToken, baseUrl, signal).catch((err) => {
        logger.warn({ err, userId }, "Bakgrunns-sync feilet");
      });
    }
    return { kontekst: "", hasCanvasData: false, source: "none" };
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

  // MongoDB fallback
  const mongoFallback = await byggLettKontekstFraMongo(userId);
  if (mongoFallback) {
    logger.info(
      { userId, intent, source: "mongodb", contextLength: mongoFallback.length },
      "canvas_full uten mål — lett kontekst fra MongoDB (fallback)",
    );
    if (redisAvailable) {
      syncCanvasDataForUser(userId, canvasToken, baseUrl, signal).catch((err) => {
        logger.warn({ err, userId }, "Bakgrunns-sync feilet etter MongoDB-fallback");
      });
    }
    return { kontekst: mongoFallback, hasCanvasData: true, source: "mongodb" };
  }

  // Ingen lokal data — trigger sync og returner tom kontekst (ingen Canvas API-kall)
  logger.info(
    { userId, intent, source: "none" },
    "Redis+MongoDB mangler data — trigger sync (canvas_full uten mål)",
  );
  if (redisAvailable) {
    syncCanvasDataForUser(userId, canvasToken, baseUrl, signal).catch((err) => {
      logger.warn({ err, userId }, "Bakgrunns-sync feilet");
    });
  }
  return { kontekst: "", hasCanvasData: false, source: "none" };
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
