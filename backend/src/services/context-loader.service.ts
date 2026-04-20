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
 *   4. Hvis lokal lagring mangler → trigger bakgrunns-sync
 *
 * Opprettholder kompatibilitet med eksisterende intent-nivåer:
 *   - general_chat:   ingen kontekst
 *   - canvas_light:   emneliste + kommende frister
 *   - canvas_full:    fullt emneinnhold (moduler, oppgaver, kunngjøringer)
 */

import { logger } from "../utils/logger.js";
import { escapeRegex } from "../utils/regexUtils.js";
import { getCache, isRedisReady } from "../cache/redis.js";
import { syncCanvasDataForUser, hasCanvasSyncData, userKey, isSyncing, waitForSync, hasIndexedCourseData } from "./canvas-sync.service.js";
import type { TargetedQuery } from "../rutere/ki/ki.js";
import { TWO_WEEKS_MS } from "common/dateUtils";
import type { CanvasContextPreferences } from "common/auth";
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
  getAllFullDocumentsForCourse,
  hasStoredContentForUser,
} from "./embedding.service.js";
import { hybridSearch, type HybridSearchResult } from "./hybrid-retrieval.service.js";
import { CanvasStructureModel, type ICanvasStructure } from "../database/models/CanvasStructure.js";
import {
  isCourseOverviewQuery,
  isStructuredCanvasQuery,
  normaliserCanvasSporsmal,
} from "./canvasStructuredQueries.js";
import { fetchPdfContent, fetchFileContent, fetchFileMetadata } from "../rutere/canvas/canvasService.js";
import { isSupportedFileType, extractTextFromFile } from "./fileExtractor.js";
import { createChunksFromContent } from "./chunk.service.js";
import { upsertStoredFileContent } from "./embedding.service.js";

import { z } from "zod";

// ─── Typer ─────────────────────────────────────────────────

export type IntentType = "general_chat" | "canvas_light" | "canvas_full";

/** Kildereferanse — duplisert lokalt for å unngå sirkulær avhengighet med common/ki. */
const ContextSourceSchema = z.object({
  courseId: z.string(),
  courseName: z.string(),
  fileId: z.number().int(),
  fileName: z.string(),
  score: z.number().optional(),
  chunkCount: z.number().int().nonnegative().optional(),
});
export type ContextSource = z.infer<typeof ContextSourceSchema>;

export const ContextResultSchema = z.object({
  kontekst: z.string(),
  hasCanvasData: z.boolean(),
  source: z.enum(["redis", "mongodb", "api", "vector", "chunks", "none"]),
  /** true hvis minst én chunk inneholder sparse kulepunkt-innhold (PowerPoint etc.) */
  hasSparseChunks: z.boolean().optional(),
  /** true når konteksten er hentet som full dokumenttekst (ikke chunk-sammensetning) */
  fullDocumentMode: z.boolean().optional(),
  /** true når konteksten kun er metadata (modulstruktur/oppgaveliste) uten faktisk faginnhold */
  metadataOnly: z.boolean().optional(),
  /** true når kurset ikke var indeksert og vi måtte trigge prioritert sync før kontekstlasting.
   *  Signaliserer at filinnhold kan være ufullstendig — brukes av chat-handler til å velge
   *  raskere modell og til å generere tydeligere svar når filer mangler. */
  syncWaited: z.boolean().optional(),
  /** Kilder som ble brukt i konteksten — propageres til chat-svar som klikkbar liste. */
  kilder: z.array(ContextSourceSchema).optional(),
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
  // Norsk
  "og", "i", "på", "for", "til", "av", "med", "om",
  "emne", "emner", "kurs", "kursene", "fag", "faget", "fagene",
  "høst", "host", "vår", "var", "semester", "kull", "bø", "bo",
  "campus", "gruppe", "klasse", "studie", "studiet", "innføring",
  // Engelsk
  "and", "in", "on", "the", "of", "with", "about", "a", "an",
  "course", "courses", "subject", "subjects", "class", "classes",
  "fall", "spring", "semester", "group", "study", "introduction",
]);

const FULL_DOCUMENT_TRIGGER_WORDS = [
  // Norsk
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
  "utdype",
  "utdyp",
  "forklar forelesning",
  "forklar mer om",
  "fortell mer om",
  "mer om forelesning",
  // Engelsk
  "summarize",
  "summarise",
  "explain the entire",
  "explain the whole",
  "give me an overview",
  "what does it cover",
  "entire chapter",
  "whole chapter",
  "all the topics",
  "what is it about",
  "summary",
  "go through",
  "elaborate",
  "expand on",
  "tell me more about",
  "explain lecture",
  "more about lecture",
];

/** Prefiksord som indikerer at et påfølgende tall refererer til en kapittel/modul/seksjon. */
const NUMERIC_REFERENCE_PREFIXES =
  "kap|kapittel|kapitlet|chapter|chapters|ch|modul|modulen|module|leksjon|lesson|forelesning|forelesningen|forelesninga|lecture|uke|uka|week|seksjon|section|del|delen|part|side|page|oppgave|oppgaven|exercise|task|tema|temaet|enhet|sesjon|session|time|timen|økt|økta|pensum|foredrag|note|notat|slide|lysark";

/**
 * Ekstraherer numeriske referanser fra brukerens melding som kan matche
 * filnavn eller moduler (kapittelnummer, range, seksjonsnummer).
 *
 * Regler:
 *   - Seksjon (dot-notation, "5.2") → KUN compound, ingen utspredning til enkelttall
 *     (hindrer at "5.2" matcher filer med "5" eller "2" isolert som false positive).
 *   - Range (dash-notation, "16-18") → compound + alle tall i rangen (16, 17, 18)
 *     (bruker som spør om et intervall vil ha treff på alle filer i intervallet).
 *   - Oppramsing ("1 og 2", "3, 4 og 5") → enkelttall per element.
 *   - Enkelttall → bare det ene tallet.
 *
 * Eksempler:
 *   "oppsummere kap 1 fra metode"        → ["1"]
 *   "oppsummere kap 16.18"               → ["16.18"]                 (seksjon, ingen 16/18)
 *   "kapittel 16-18"                     → ["16-18", "16", "17", "18"] (range → fanout)
 *   "forelesning 3 og 4"                 → ["3", "4"]
 *   "hva står i seksjon 5.2"             → ["5.2"]
 *   "kapittel 2024"                      → ["2024"]                  (4-sifrede årstall/ref)
 *   "Forelesning 01"                     → ["01", "1"]               (zero-stripped variant)
 *   "100 liter vann"                     → []                        (ingen ref-kontekst)
 */
function extractNumericHintsFromMessage(message: string): string[] {
  const lower = message.toLowerCase();
  const hints = new Set<string>();

  // Merk: bruker negativ lookbehind istedenfor \b fordi JS's \b er ASCII-basert
  // og ikke fungerer for æøå — "økt 4" ville aldri matche med \b.
  const referencePatterns = [
    // Prefiks + enkelt tall eller compound "16-18" / "5.2" / "2024"
    new RegExp(
      `(?<![a-zæøå0-9])(?:${NUMERIC_REFERENCE_PREFIXES})\\.?\\s+(\\d{1,4}(?:\\s*[.-]\\s*\\d{1,4})*)`,
      "gi",
    ),
    // Prefiks + oppramsing "kap 1 og 2", "uke 3, 4 og 5"
    new RegExp(
      `(?<![a-zæøå0-9])(?:${NUMERIC_REFERENCE_PREFIXES})\\.?\\s+(\\d{1,4}(?:\\s*(?:og|and|,)\\s*\\d{1,4})+)`,
      "gi",
    ),
    // Sammensatte bare tall: "16.18", "5.1-5.3" (uten prefiks — typisk seksjon/kapittelref)
    // Krever minst ett skilletegn (dot/dash) så vi ikke trigger på enkeltstående tall som "100 liter"
    // eslint-disable-next-line security/detect-unsafe-regex -- bounded: \d{1,4}-kvantifikatorer, input er brukermelding <2000 tegn
    /(?:^|[\s(])(\d{1,4}(?:[.-]\d{1,4})+)\b/g,
  ];

  for (const pattern of referencePatterns) {
    for (const match of lower.matchAll(pattern)) {
      const raw = match[1]?.replace(/\s+/g, "") ?? "";
      if (!raw) continue;

      const compound = raw.replace(/,/g, "-");
      // eslint-disable-next-line security/detect-unsafe-regex -- bounded: ankret regex (^...$), input er compound <20 tegn
      const isDotSection = /^\d+(?:\.\d+)+$/.test(compound); // "5.2", "5.2.3"
      const rangeMatch = compound.match(/^(\d{1,4})-(\d{1,4})$/); // "16-18"

      if (isDotSection) {
        // Seksjon/subseksjon: kun compound — ingen utspredning (unngå false positives)
        hints.add(compound);
      } else if (rangeMatch) {
        // Range: compound + alle tall i rangen
        hints.add(compound);
        const start = parseInt(rangeMatch[1], 10);
        const end = parseInt(rangeMatch[2], 10);
        if (end > start && end - start <= 30) {
          for (let n = start; n <= end; n++) hints.add(String(n));
        }
      } else {
        // Enkelttall eller oppramsing: legg til alle enkelttall fra referansen
        for (const digit of raw.matchAll(/\d+/g)) {
          hints.add(digit[0]);
        }
      }
    }
  }

  // Post-prosessering: utvid hints med ekvivalente varianter
  for (const h of [...hints]) {
    // Zero-stripped variant for enkelttall: "01" → også "1" (bruker kan skrive enten form)
    if (/^0\d+$/.test(h)) {
      const stripped = h.replace(/^0+/, "");
      if (stripped.length > 0) hints.add(stripped);
    }
    // Dot/dash-notasjonsekvivalens for compound: bruker skriver ofte "16.18" mens filen
    // heter "16-18" og omvendt. Legg til begge notasjoner for filnavn-match.
    if (h.includes(".")) {
      hints.add(h.replace(/\./g, "-"));
    }
    if (h.includes("-")) {
      hints.add(h.replace(/-/g, "."));
    }
  }

  return [...hints];
}

/**
 * Normaliserer numeriske sekvenser i et filnavn ved å fjerne ledende nuller
 * KUN på isolerte tall-sekvenser (start-of-string eller forutgående ikke-siffer).
 * Dette hindrer at indre nuller i tall som "2024" eller "102" blir feilaktig fjernet.
 *
 * "Lecture 03 - Intro.pdf"  → "lecture 3 - intro.pdf"
 * "Kapittel 001 og 002.pptx" → "kapittel 1 og 2.pptx"
 * "ISO-8601-2024.pdf"        → "iso-8601-2024.pdf" (indre nuller beholdt)
 * "Kapittel 102.pdf"         → "kapittel 102.pdf" (ingen ledende nuller å fjerne)
 * "003_Lecture.pdf"          → "3_lecture.pdf" (ledende null på starten)
 */
function normaliserNumeriskFilnavn(fileName: string): string {
  return fileName.toLowerCase().replace(/(^|[^\d])0+(\d+)/g, "$1$2");
}

/**
 * Sjekker om filnavnet inneholder ett av de numeriske hintene som en
 * selvstendig numerisk "bit" (ikke som en del av et lengre tall).
 *
 * "Kapittel 1 og 2.pptx" + hint "1" → true
 * "Kapittel 16-18.pptx" + hint "16-18" → true
 * "Kapittel 16-18.pptx" + hint "1" → false (matcher IKKE inne i "16")
 * "Lecture 03 - Intro.pdf" + hint "3" → true (ledende null fjernet ved normalisering)
 */
function fileNameMatchesNumericHints(fileName: string, hints: string[]): boolean {
  if (hints.length === 0) return false;
  const lower = fileName.toLowerCase();
  const normalisert = normaliserNumeriskFilnavn(fileName);
  return hints.some((hint) => {
    // Bygg regex og test mot både originalt filnavn og zero-padding-normalisert variant
    if (/[.-]/.test(hint)) {
      const escaped = hint.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      // eslint-disable-next-line security/detect-non-literal-regexp -- hint er fra egen ekstraksjon, escaped
      const regex = new RegExp(`(?:^|[^\\d])${escaped}(?![\\d])`);
      return regex.test(lower) || regex.test(normalisert);
    }
    // eslint-disable-next-line security/detect-non-literal-regexp -- hint er rent numerisk fra egen ekstraksjon
    const regex = new RegExp(`(?:^|[^\\d])${hint}(?![\\d])`);
    return regex.test(lower) || regex.test(normalisert);
  });
}

/**
 * Velger primærfil for full_document-mode. Hvis brukeren eksplisitt refererte
 * til et kapittel/seksjon/modul-nummer, foretrekk fil hvis navn inneholder
 * det nummeret — selv om Cohere rangerte en annen fil høyest. Dette redder
 * tilfeller der rerank-scoren er lav (<0.4) og tilfeldig velger feil fil.
 */
function velgPrimaerFilForFullDocument(
  message: string,
  filteredResults: HybridSearchResult[],
): {
  primary: HybridSearchResult;
  overridden: boolean;
  numericHints: string[];
  originalPrimaryFile?: string;
} {
  const rerankedTop = filteredResults[0];
  const numericHints = extractNumericHintsFromMessage(message);
  if (numericHints.length === 0) {
    return { primary: rerankedTop, overridden: false, numericHints };
  }

  // Hvis top-resultatet allerede matcher filnavnet → ingen override
  if (fileNameMatchesNumericHints(rerankedTop.source.fileName, numericHints)) {
    return { primary: rerankedTop, overridden: false, numericHints };
  }

  // Finn første reranked resultat (bevarer Cohere-rekkefølgen) som matcher filnavnet
  const filenameMatch = filteredResults.find((r) =>
    fileNameMatchesNumericHints(r.source.fileName, numericHints),
  );
  if (filenameMatch) {
    return {
      primary: filenameMatch,
      overridden: true,
      numericHints,
      originalPrimaryFile: rerankedTop.source.fileName,
    };
  }

  return { primary: rerankedTop, overridden: false, numericHints };
}

function shouldUseFullDocumentMode(
  message: string,
  target: TargetedQuery | undefined,
  filteredResults: HybridSearchResult[],
  moduleHintMissed = false,
): { enabled: boolean; reason: string; triggerWord?: string } {
  const rawLower = message.toLowerCase();
  const normalized = normaliserCanvasSporsmal(message);
  const wordCount = normalized.split(/\s+/).filter(Boolean).length;
  const triggerWord = FULL_DOCUMENT_TRIGGER_WORDS.find((word) => rawLower.includes(word));
  const explicitBroadQuery = !!triggerWord;
  // Når moduleHint ikke traff noen resultater, er chunks fra en annen modul enn forespurt.
  // Da skal vi IKKE trigge full_document basert på moduleHint — filene er irrelevante.
  const explicitFileOrChapter = Boolean(target?.fileHint || (!moduleHintMissed && target?.moduleHint));
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
    // Stem-matching: tillat trailing bokstaver slik at "organisering" treffer
    // "organiserings", "metode" treffer "metoden", "database" treffer "databaser", osv.
    const matchedTokens = tokens.filter((token) =>
      // eslint-disable-next-line security/detect-non-literal-regexp -- token er avledet fra intern kurskatalog og escapeRegex() brukes
      new RegExp(`\\b${escapeRegex(token)}[a-zæøå]*\\b`, "i").test(normalizedMessage),
    );

    if (matchedTokens.length >= 2) {
      score += matchedTokens.length * 22;
    } else if (matchedTokens.length === 1 && tokens.length === 1) {
      score += 35;
    } else if (matchedTokens.length === 1) {
      // Selv ett token-treff bør gi en del poeng — ellers blir terskelen (45/70)
      // umulig å nå for meldinger som "Organiserings emnet" der bare ett ord matcher.
      score += 50;
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

/**
 * Når det finnes moduleHint (f.eks. "uke 7") men ingen courseHint, sjekk
 * CanvasStructure for å finne hvilket kurs som har en modul med matchende navn.
 * Meldingsteksten brukes for å skille mellom kurser som har lignende modulnavn.
 */
export async function resolveModuleHintToCourse(
  userId: string,
  target: TargetedQuery,
  message: string,
): Promise<TargetedQuery> {
  if (target.courseIdHint != null || !target.moduleHint) {
    return target;
  }

  const structures = await CanvasStructureModel.find(
    { userId },
    { courseId: 1, courseName: 1, course_code: 1, "moduler.name": 1, "moduler.items.title": 1 },
  ).lean();

  if (structures.length === 0) return target;

  const normalizedHint = normaliserCanvasSporsmal(target.moduleHint);
  const normalizedMsg = normaliserCanvasSporsmal(message);

  interface ModuleMatch {
    courseId: string;
    courseName: string;
    courseCode: string;
    moduleName: string;
    score: number;
  }

  const matches: ModuleMatch[] = [];

  for (const structure of structures) {
    for (const mod of structure.moduler ?? []) {
      const normalizedModName = normaliserCanvasSporsmal(mod.name);
      if (!normalizedModName.includes(normalizedHint)) continue;

      // Modulnavn matcher — beregn score basert på item-titler mot meldingen
      let score = 10; // Grunnpoeng for modulnavn-match
      const items = (mod as { items?: Array<{ title?: string }> }).items ?? [];
      for (const item of items) {
        if (!item.title) continue;
        const normalizedTitle = normaliserCanvasSporsmal(item.title);
        // Sjekk om item-tittel har felles ord med meldingen (minst 4 tegn for å unngå støy)
        const titleWords = normalizedTitle.split(/\s+/).filter((w) => w.length >= 4);
        for (const word of titleWords) {
          if (normalizedMsg.includes(word)) {
            score += 15;
          }
        }
      }

      matches.push({
        courseId: structure.courseId,
        courseName: structure.courseName,
        courseCode: structure.course_code ?? "",
        moduleName: mod.name,
        score,
      });
    }
  }

  if (matches.length === 0) return target;

  matches.sort((a, b) => b.score - a.score);
  const best = matches[0];
  const secondBest = matches[1];

  // Krev tydelig vinner (score >= 25 betyr minst 1 item-tittel match + modul-match)
  if (best.score < 25) return target;
  if (secondBest && best.score - secondBest.score < 10) return target;

  const numericCourseId = /^\d+$/.test(best.courseId) ? Number(best.courseId) : null;
  const resolvedHint = best.courseCode
    ? best.courseCode.replace(/-/g, "").toLowerCase()
    : normaliserCanvasSporsmal(best.courseName);

  logger.info(
    {
      userId,
      moduleHint: target.moduleHint,
      resolvedCourse: best.courseName,
      resolvedCourseId: numericCourseId,
      moduleName: best.moduleName,
      score: best.score,
      runnerUpScore: secondBest?.score ?? 0,
    },
    "Løste moduleHint til kurs via CanvasStructure",
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
function formaterLettKontekst(emner: LettKontekstEmne[], prefs?: CanvasContextPreferences): string {
  const now = new Date();
  const twoWeeksFromNow = new Date(now.getTime() + TWO_WEEKS_MS);

  let kontekst = "<canvas-kursdata>\n";

  if (!prefs || prefs.courses) {
    kontekst += `EMNER (${emner.length} aktive):\n`;
    for (const emne of emner) {
      kontekst += `- ${formatCourseLabel(emne.name, emne.course_code)}\n`;
    }
  }

  if (!prefs || prefs.assignments) {
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
  }

  kontekst += "</canvas-kursdata>";
  return kontekst;
}

function titleMatchesFileHint(title: string, fileHint: string): boolean {
  const normHint = normaliserFilnavnHint(fileHint);
  const normTitle = normaliserFilnavnHint(title);
  return normTitle.includes(normHint) || normHint.includes(normTitle);
}

function isContentBearingModuleItemType(itemType: string): boolean {
  return itemType === "File" || itemType === "Page" || itemType === "ExternalUrl";
}

function resolveModuleItemFileId(item: {
  type: string;
  id?: number;
  content_id?: number;
}): number | null {
  if (item.type === "File") return item.content_id ?? null;
  if (item.type === "Page" || item.type === "ExternalUrl") return item.id ?? null;
  return null;
}

/**
 * Formaterer kursoversikt fra lagret MongoDB/Redis-data.
 * Brukes når brukeren spør om "hvilke fag har jeg" o.l.
 */
function formaterKursoversiktFraLagring(
  courses: Array<{ courseName: string; course_code?: string; moduler?: Array<{ name: string }> }>,
): string {
  let kontekst = "<canvas-kursdata>\n";
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
  kontekst += "</canvas-kursdata>";
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

async function hentKjentEmnekatalog(userId: string, hiddenCourseIds?: Set<number>): Promise<SyncedCourse[]> {
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
              .filter((item) => isContentBearingModuleItemType(item.type))
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

  if (hiddenCourseIds && hiddenCourseIds.size > 0) {
    return merged.filter((emne) => !hiddenCourseIds.has(Number(emne.id)));
  }

  return merged;
}

async function finnRelevanteEmner(
  userId: string,
  target?: TargetedQuery,
  hiddenCourseIds?: Set<number>,
): Promise<SyncedCourse[]> {
  const emner = await hentKjentEmnekatalog(userId, hiddenCourseIds);
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
const ANNOUNCEMENT_PATTERN = /ku+n{1,2}gj[øo]ring|beskjed|announcements?|nyhet|varsel|endring|notifications?|news|updates?|notice/i;

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
        blokk += `${melding.substring(0, 1000)}${melding.length > 1000 ? "..." : ""}\n`;
      }
    }
  }
  return blokk;
}

/**
 * Bygger lett kontekst fra MongoDB CanvasStructure (permanent fallback når Redis TTL utløper).
 */
async function byggLettKontekstFraMongo(userId: string, prefs?: CanvasContextPreferences): Promise<string | null> {
  try {
    const structures = await CanvasStructureModel.find({ userId }).lean<ICanvasStructure[]>();
    if (!structures || structures.length === 0) return null;

    const emner: LettKontekstEmne[] = structures.map((s) => ({
      name: s.courseName,
      course_code: s.course_code,
      oppgaver: s.oppgaver,
    }));

    return formaterLettKontekst(emner, prefs);
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
  prefs?: CanvasContextPreferences,
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
        s.moduler.some((mod) => modulTitleMatcherHint(mod.name, hint)),
      );
    }

    if (!matchedStructure && target.fileHint) {
      matchedStructure = structures.find((s) =>
        s.moduler.some((mod) =>
          mod.items?.some((item) =>
            isContentBearingModuleItemType(item.type) && titleMatchesFileHint(item.title, target.fileHint!),
          ),
        ),
      );
    }

    if (!matchedStructure && structures.length === 1) {
      matchedStructure = structures[0];
    }

    if (!matchedStructure) return null;

    let kontekst = "<canvas-kursdata>\n";
    kontekst += `EMNE: ${formatCourseLabel(matchedStructure.courseName, matchedStructure.course_code)}\n\n`;

    let hadModuleFileContent = false;

    // Moduler
    if (matchedStructure.moduler.length > 0) {
      kontekst += `MODULER (${matchedStructure.moduler.length}):\n`;
      for (const mod of matchedStructure.moduler) {
        kontekst += `\n### ${mod.name}\n`;

        // Filtrer til spesifikk modul hvis moduleHint finnes
        if (target.moduleHint) {
          if (!modulTitleMatcherHint(mod.name, target.moduleHint)) {
            kontekst += "(Ikke relevant for søket)\n";
            continue;
          }
        }

        if (mod.items && mod.items.length > 0) {
          const maxFilerMedInnhold = target.moduleHint ? 5 : 1;
          let filerMedInnhold = 0;
          for (const item of mod.items) {
            kontekst += `- [${item.type}] ${item.title}\n`;

            // Inkluder filinnhold fra chunks (MongoDB ContentEmbedding) for matchende filer og Pages
            const itemFileId = resolveModuleItemFileId(item);
            const skalInkludereFil =
              isContentBearingModuleItemType(item.type) &&
              itemFileId != null &&
              (target.fileHint
                ? titleMatchesFileHint(item.title, target.fileHint)
                : target.moduleHint && filerMedInnhold < maxFilerMedInnhold);

            if (skalInkludereFil && itemFileId != null) {
              try {
                const fileChunks = await getStoredChunksForFile(
                  userId,
                  matchedStructure.courseId,
                  itemFileId,
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
    if (matchedStructure.oppgaver.length > 0 && (!prefs || prefs.assignments)) {
      kontekst += `OPPGAVER (${matchedStructure.oppgaver.length}):\n`;
      for (const oppg of matchedStructure.oppgaver) {
        const frist = oppg.due_at ? new Date(oppg.due_at).toLocaleDateString("nb-NO") : "ingen frist";
        const poeng = oppg.points_possible != null ? `${oppg.points_possible}p` : "";
        const status = isCanvasAssignmentSubmitted(oppg) ? "✓" : "⏳";
        kontekst += `- ${status} ${oppg.name} — frist: ${frist} ${poeng}\n`;

        if (oppg.description) {
          const desc = stripHtml(oppg.description).trim();
          if (desc.length > 0) {
            kontekst += `  Beskrivelse: ${desc.substring(0, 1000)}${desc.length > 1000 ? "..." : ""}\n`;
          }
        }
      }
      kontekst += "\n";
    }

    // Kunngjøringer
    if (matchedStructure.kunngjøringer.length > 0 && (!prefs || prefs.announcements)) {
      kontekst += `KUNNGJØRINGER (${Math.min(matchedStructure.kunngjøringer.length, 5)} nyeste):\n`;
      for (const k of matchedStructure.kunngjøringer.slice(0, 5)) {
        const dato = k.posted_at ? new Date(k.posted_at).toLocaleDateString("nb-NO") : "";
        kontekst += `- ${k.title} (${dato})\n`;
        if (k.message) {
          const melding = stripHtml(k.message).trim();
          if (melding.length > 0) {
            kontekst += `  ${melding.substring(0, 500)}${melding.length > 500 ? "..." : ""}\n`;
          }
        }
      }
    }

    kontekst += "</canvas-kursdata>";

    if (target.moduleHint && !hadModuleFileContent) {
      logger.info(
        { userId, target, contextLength: kontekst.length },
        "Målrettet MongoDB: ingen filinnhold for modul — metadata-kontekst klar, on-demand kan berike",
      );
      return `${kontekst}\n<!-- MODULE_NEEDS_FILE_CONTENT -->`;
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
async function byggLettKontekstFraRedis(userId: string, prefs?: CanvasContextPreferences): Promise<string | null> {
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

    return formaterLettKontekst(lettEmner, prefs);
  } catch (error) {
    logger.warn({ err: error }, "Feil ved bygging av lett kontekst fra Redis");
    return null;
  }
}

/**
 * Bygger modulstruktur-oversikt med filnavn og tilgjengelig innhold for et spesifikt emne.
 * Brukes for å berike hybrid-søk med kontekst om hva som finnes i emnet,
 * slik at KI-assistenten vet om alle moduler og filer — ikke bare det den fant via søk.
 *
 * For målrettet modul (moduleHint) inkluderes også lagret filinnhold fra MongoDB,
 * slik at KI har tilgang til faktisk kursinnhold selv om hybrid-søket bare fant 1 dokument.
 */
async function byggModulStrukturOversikt(
  userId: string,
  target: TargetedQuery,
  hiddenCourseIds?: Set<number>,
): Promise<string | null> {
  try {
    const matchedCourses = await finnRelevanteEmner(userId, target, hiddenCourseIds);
    if (matchedCourses.length === 0) return null;

    const matchedCourse = matchedCourses[0];
    const courseId = String(matchedCourse.id);

    // Hent moduler fra Redis eller MongoDB
    type ModulItem = { id?: number; title: string; type: string; content_id?: number; page_url?: string };
    type Modul = { name: string; items?: ModulItem[] };
    let moduler: Modul[] = [];

    const modulerRaw = await getCache(userKey(userId, "emne", courseId, "moduler"));
    if (modulerRaw) {
      try { moduler = JSON.parse(modulerRaw); } catch { /* ugyldig JSON */ }
    }
    if (moduler.length === 0) {
      const structure = await CanvasStructureModel.findOne(
        { userId, courseId },
        { moduler: 1 },
      ).lean();
      if (structure?.moduler?.length) {
        moduler = structure.moduler.map((m) => ({
          name: m.name,
          items: m.items?.map((i) => ({
            id: i.id,
            title: i.title,
            type: i.type,
            content_id: i.content_id ?? undefined,
            page_url: i.page_url ?? undefined,
          })),
        }));
      }
    }
    if (moduler.length === 0) return null;

    let oversikt = `\n--- EMNESTRUKTUR: ${formatCourseLabel(matchedCourse.name, undefined)} ---\n`;
    oversikt += `Moduler (${moduler.length}):\n`;

    // For målrettet modul: inkluder lagret filinnhold
    const isModuleTargeted = !!target.moduleHint;
    const MAX_FILE_CONTENT_CHARS = 3500;
    const MAX_FILES_WITH_CONTENT = 8;
    let filesWithContentIncluded = 0;

    for (const modul of moduler) {
      const items = modul.items ?? [];
      const isTargetModule = isModuleTargeted && modulTitleMatcherHint(modul.name, target.moduleHint!);

      if (isTargetModule) {
        // Målrettet modul: vis filer med innhold
        oversikt += `\n### ${modul.name}\n`;
        for (const item of items) {
          oversikt += `- [${item.type}] ${item.title}\n`;

          // Prøv å inkludere lagret filinnhold for File/Page-items
          if (filesWithContentIncluded < MAX_FILES_WITH_CONTENT) {
            const fileId = resolveModuleItemFileId(item);
            if (isContentBearingModuleItemType(item.type) && fileId != null) {
              try {
                const chunks = await getStoredChunksForFile(userId, courseId, fileId);
                if (chunks.length > 0) {
                  const fullText = chunks
                    .sort((a, b) => a.index - b.index)
                    .map((c) => c.text)
                    .join("\n\n");
                  const truncated = fullText.length > MAX_FILE_CONTENT_CHARS
                    ? fullText.substring(0, MAX_FILE_CONTENT_CHARS) + "\n[...forkortet...]"
                    : fullText;
                  oversikt += `\nINNHOLD FRA ${item.title}:\n${truncated}\n`;
                  filesWithContentIncluded++;
                }
              } catch {
                // Lagret filinnhold mangler — ignorer
              }
            }
          }
        }
      } else {
        // Andre moduler: vis filnavn kompakt
        const fileNames = items
          .filter((i) => isContentBearingModuleItemType(i.type))
          .map((i) => i.title);
        oversikt += `- ${modul.name} (${items.length} elementer)`;
        if (fileNames.length > 0) {
          oversikt += `\n  Filer: ${fileNames.join(", ")}`;
        }
        oversikt += "\n";
      }
    }

    return oversikt;
  } catch (err) {
    logger.warn({ err, userId }, "Kunne ikke bygge modulstruktur-oversikt");
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
  prefs?: CanvasContextPreferences,
  hiddenCourseIds?: Set<number>,
): Promise<string | null> {
  try {
    const matchedCourses = await finnRelevanteEmner(userId, target, hiddenCourseIds);
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

    let kontekst = "<canvas-kursdata>\n";
    kontekst += `EMNE: ${formatCourseLabel(matchedCourse.name, matchedCourse.course_code)}\n\n`;

    let hadModuleFileContent = false;

    // Moduler
    if (modulerRaw) {
      try {
        const moduler = JSON.parse(modulerRaw) as Array<{
          name: string;
          items?: Array<{ id?: number; title: string; type: string; content_id?: number; page_url?: string }>;
        }>;

        kontekst += `MODULER (${moduler.length}):\n`;
        for (const modul of moduler) {
          kontekst += `\n### ${modul.name}\n`;

          // Filtrer til spesifikk modul hvis moduleHint finnes
          if (target.moduleHint) {
            if (!modulTitleMatcherHint(modul.name, target.moduleHint)) {
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

              const redisItemFileId = resolveModuleItemFileId(item);
              const skalInkludereFil =
                isContentBearingModuleItemType(item.type) &&
                redisItemFileId != null &&
                (target.fileHint
                  ? titleMatchesFileHint(itemTitle, target.fileHint)
                  : target.moduleHint && filerMedInnhold < maxFilerMedInnhold);

              if (skalInkludereFil && redisItemFileId != null) {
                try {
                  const fileChunks = await getStoredChunksForFile(
                    userId,
                    courseId,
                    redisItemFileId,
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
    if (oppgaverRaw && (!prefs || prefs.assignments)) {
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
              kontekst += `  Beskrivelse: ${desc.substring(0, 1000)}${desc.length > 1000 ? "..." : ""}\n`;
            }
          }
        }
        kontekst += "\n";
      } catch {
        // Ugyldig JSON
      }
    }

    // Kunngjøringer
    if (kunngjøringerRaw && (!prefs || prefs.announcements)) {
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
                kontekst += `  ${melding.substring(0, 500)}${melding.length > 500 ? "..." : ""}\n`;
              }
            }
          }
        }
      } catch {
        // Ugyldig JSON
      }
    }

    kontekst += "</canvas-kursdata>";

    // Modulspørsmål uten filinnhold: marker at on-demand bør prøves for å berike konteksten
    if (target.moduleHint && !hadModuleFileContent) {
      logger.info(
        { userId, target, contextLength: kontekst.length },
        "Målrettet Redis: ingen filinnhold for modul — metadata-kontekst klar, on-demand kan berike",
      );
      // Returner konteksten med en markør slik at caller kan prøve on-demand berikelse
      return `${kontekst}\n<!-- MODULE_NEEDS_FILE_CONTENT -->`;
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
  hiddenCourseIds?: Set<number>,
): Promise<{ kontekst: string; kilder: ContextSource[] } | null> {
  try {
    const relevantCourses = await finnRelevanteEmner(userId, target, hiddenCourseIds);
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
        modulTitleMatcherHint(chunk.source.moduleTitle, target.moduleHint!),
      );
      if (moduleMatches.length === 0) {
        // moduleHint matchet ingenting — bruk kursresultatene i stedet
        logger.info(
          { userId, moduleHint: target.moduleHint, chunksBeforeFilter: scored.length },
          "Chunk-søk: moduleHint matchet ingen chunks — bruker kursresultater",
        );
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

    const fileMap = new Map<string, ContextSource>();
    for (const chunk of scored) {
      const key = `${chunk.source.courseId}:${chunk.source.fileId}`;
      const existing = fileMap.get(key);
      if (!existing) {
        fileMap.set(key, {
          courseId: String(chunk.source.courseId),
          courseName: chunk.source.courseName ?? "",
          fileId: chunk.source.fileId,
          fileName: chunk.source.fileName ?? "",
          score: chunk.score,
          chunkCount: 1,
        });
      } else {
        existing.chunkCount = (existing.chunkCount ?? 0) + 1;
        if ((chunk.score ?? 0) > (existing.score ?? 0)) {
          existing.score = chunk.score;
        }
      }
    }
    const kilder = Array.from(fileMap.values())
      .filter((k) => k.fileName.length > 0)
      .sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
      .slice(0, 8);

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

    return {
      kontekst: "<canvas-kursdata>\n" + chunkKontekst + "\n</canvas-kursdata>",
      kilder,
    };
  } catch (error) {
    logger.warn({ err: error }, "Feil ved bygging av chunk-kontekst");
    return null;
  }
}

interface FilterResult {
  results: HybridSearchResult[];
  /** true hvis moduleHint-filter filtrerte bort alle resultater */
  moduleHintMissed: boolean;
}

/** Normaliserer streng for modul-matching: lowercase, fjern ekstra mellomrom/bindestreker */
function normaliserModulNavn(text: string): string {
  return text.toLowerCase().replace(/[-_]/g, " ").replace(/\s+/g, " ").trim();
}

/** Sjekker om moduleTitle matcher moduleHint med fleksibel substring-matching */
function modulTitleMatcherHint(moduleTitle: string, hint: string): boolean {
  const normTitle = normaliserModulNavn(moduleTitle);
  const normHint = normaliserModulNavn(hint);

  // Når hint inneholder tall (f.eks. "kapittel 16-18"), krev talloverlapp.
  // Dette hindrer at et generelt ord som "kapittel" matcher feil modul.
  const hintNumbers = normHint.match(/\b\d{1,3}\b/g) ?? [];
  if (hintNumbers.length > 0) {
    const titleNumbers = new Set(normTitle.match(/\b\d{1,3}\b/g) ?? []);
    const hasNumberOverlap = hintNumbers.some((num) => titleNumbers.has(num));
    if (!hasNumberOverlap) return false;
  }

  // Direkte substring-match
  if (normTitle.includes(normHint) || normHint.includes(normTitle)) return true;
  // Ordbasert overlapp: minst halvparten av hint-ordene finnes i tittelen
  const hintWords = normHint.split(" ").filter((w) => w.length > 2);
  if (hintWords.length === 0) return false;
  const matchCount = hintWords.filter((w) => normTitle.includes(w)).length;
  return matchCount >= Math.ceil(hintWords.length / 2);
}

function filtrerHybridResultater(
  results: HybridSearchResult[],
  target?: TargetedQuery,
  coursesPinned?: boolean,
): FilterResult {
  let filtered = results;
  let moduleHintMissed = false;

  // Modul-filter kun når vi allerede er avgrenset til spesifikke kurs —
  // ellers lar vi retrieval-scoren bestemme relevans
  if (coursesPinned && target?.moduleHint) {
    const moduleMatches = filtered.filter((result) =>
      modulTitleMatcherHint(result.source.moduleTitle, target.moduleHint!),
    );
    if (moduleMatches.length === 0) {
      // moduleHint matchet ingenting — merk som "missed" slik at caller
      // kan falle gjennom til on-demand henting i stedet for å bruke irrelevante chunks.
      logger.warn(
        {
          moduleHint: target.moduleHint,
          courseHint: target.courseHint,
          chunksBeforeFilter: results.length,
          moduleTitles: results.map((r) => r.source.moduleTitle),
          action: "moduleHintMissed",
        },
        "Hybrid søk: alle resultater filtrert bort av moduleHint — signaliserer miss til caller",
      );
      moduleHintMissed = true;
    } else {
      filtered = moduleMatches;
    }
  }

  if (target?.fileHint) {
    const fileMatches = filtered.filter((result) =>
      titleMatchesFileHint(result.source.fileName, target.fileHint!),
    );
    if (fileMatches.length === 0) return { results: [], moduleHintMissed };
    filtered = fileMatches;
  }

  return { results: filtered, moduleHintMissed };
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
  hiddenCourseIds?: Set<number>,
): Promise<{ kontekst: string; hasSparseChunks: boolean; fullDocumentMode: boolean; kilder: ContextSource[] } | null> {
  try {
    const relevantCourses = await finnRelevanteEmner(userId, target, hiddenCourseIds);
    const courseIds = relevantCourses.map((course) => String(course.id));
    // Blokkér kun når courseHint er eksplisitt satt men ingen kurs matchet.
    // Når courseHint er null, søker vi på tvers av alle kurs —
    // retrieval-scoren bestemmer relevans.
    if (hasCourseTarget(target) && courseIds.length === 0) {
      logger.info({ userId, target }, "Hybrid søk: courseHint satt men ingen kurs matchet");
      return null;
    }

    const coursesPinned = courseIds.length > 0;

    // ── Kursomfattende oversikt: "forklar forelesningene"/"hva har lectures dekket" ──
    // Når brukeren spør bredt om alle forelesninger/leksjoner i ett spesifikt kurs,
    // last alle fulle dokumenter for kurset i stedet for kun top-K hybrid-chunks.
    // Dette løser at KI ellers hopper over forelesninger som ikke traff retrieval.
    if (target?.courseIdHint != null && !target?.fileHint && !target?.moduleHint) {
      const lowerMsg = message.toLowerCase();
      const COURSE_WIDE_TRIGGERS = [
        "forelesningene", "forelesninger", "alle forelesninger",
        "leksjonene", "leksjoner", "alle leksjoner",
        "modulene", "alle moduler",
        "the lectures", "all lectures", "all the lectures",
        "all modules", "all the topics covered",
      ];
      const matchesCourseWide = COURSE_WIDE_TRIGGERS.some((t) => lowerMsg.includes(t));
      if (matchesCourseWide) {
        const courseIdStr = String(target.courseIdHint);
        const allDocs = await getAllFullDocumentsForCourse(userId, courseIdStr);
        if (allDocs.length > 0) {
          // Char-budsjett ~50k tegn (≈12.5k tokens) — redusert for bedre LLM-latens
          const TOTAL_BUDGET = 50_000;
          const perFileBudget = Math.max(1500, Math.floor(TOTAL_BUDGET / allDocs.length));
          let totalChars = 0;
          const blocks: string[] = [];
          const kilder: ContextSource[] = [];
          for (const doc of allDocs) {
            if (totalChars >= TOTAL_BUDGET) break;
            const remaining = TOTAL_BUDGET - totalChars;
            const slice = doc.fullText.slice(0, Math.min(perFileBudget, remaining));
            blocks.push(
              `--- FIL-INNHOLD: ${doc.fileName}${doc.moduleTitle ? ` (${doc.moduleTitle})` : ""} ---\n${slice}\n--- SLUTT ---`,
            );
            totalChars += slice.length;
            kilder.push({
              courseId: courseIdStr,
              courseName: relevantCourses.find((c) => String(c.id) === courseIdStr)?.name ?? "",
              fileId: doc.fileId,
              fileName: doc.fileName,
              score: 1,
              chunkCount: 1,
            });
          }
          const kontekst = "<canvas-kursdata>\n" + blocks.join("\n\n") + "\n</canvas-kursdata>";
          logger.info(
            {
              userId,
              courseId: courseIdStr,
              fileCount: allDocs.length,
              filesIncluded: kilder.length,
              totalChars,
              contextLength: kontekst.length,
            },
            "Kursomfattende oversikt-mode aktivert (alle forelesninger lastet)",
          );
          return {
            kontekst,
            hasSparseChunks: false,
            fullDocumentMode: true,
            kilder,
          };
        }
      }
    }

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

    let filterResult = filtrerHybridResultater(results, target, coursesPinned);
    const moduleHintMissedOriginal = filterResult.moduleHintMissed;

    // Når moduleHint filtrerte bort alle resultater: prøv igjen uten moduleHint-filter.
    // Innhold fra samme kurs (andre moduler) er bedre enn ingen kontekst, men dette er
    // en "soft miss" som må bevares for senere beslutninger (full_document og on-demand).
    if (filterResult.moduleHintMissed && results.length > 0) {
      logger.info(
        { userId, moduleHint: target?.moduleHint, unfilteredCount: results.length, messagePreview: message.substring(0, 80) },
        "Hybrid søk: moduleHint ga ingen treff — bruker kursresultater uten moduleHint-filter",
      );
      const courseOnlyTarget = target ? { ...target, moduleHint: null } : target;
      filterResult = filtrerHybridResultater(results, courseOnlyTarget, coursesPinned);
      // Bevar originalt signal om moduleHint-miss, selv om fallback ga treff.
      filterResult = { ...filterResult, moduleHintMissed: true };
    }

    const filteredResults = filterResult.results;
    if (filteredResults.length === 0) {
      logger.info(
        { userId, messagePreview: message.substring(0, 80) },
        "Hybrid søk: alle resultater filtrert bort av target-hints",
      );
      return null;
    }

    // ── Full dokument-mode ──
    const fullDocumentDecision = shouldUseFullDocumentMode(
      message,
      target,
      filteredResults,
      moduleHintMissedOriginal,
    );
    if (fullDocumentDecision.enabled) {
      const primarySelection = velgPrimaerFilForFullDocument(message, filteredResults);
      const primary = primarySelection.primary;
      if (primarySelection.overridden) {
        logger.info(
          {
            numericHints: primarySelection.numericHints,
            originalPrimaryFile: primarySelection.originalPrimaryFile,
            selectedPrimaryFile: primary.source.fileName,
            selectedFileId: primary.source.fileId,
            reason: "filename_matches_numeric_hint",
          },
          "Full dokument-mode: primærfil overstyrt basert på filnavn-match",
        );
      }
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

        // Når hoveddokumentet er lite (typisk PowerPoint med kulepunkter),
        // berik konteksten med andre filer fra samme modul
        const MIN_FULL_DOC_CHARS = 6000;
        let supplementBlock = "";
        if (truncatedFullText.length < MIN_FULL_DOC_CHARS && target?.moduleHint) {
          const supplementBudget = estimatedChars - truncatedFullText.length;
          const otherFilesInModule = filteredResults.filter(
            (r) => r.source.fileId !== primary.source.fileId,
          );
          const seenFileIds = new Set<number>([primary.source.fileId]);
          for (const other of otherFilesInModule) {
            if (seenFileIds.has(other.source.fileId)) continue;
            if (supplementBlock.length >= supplementBudget) break;
            seenFileIds.add(other.source.fileId);
            const otherFullDoc = await getStoredFullDocumentForFile(
              userId,
              other.source.courseId,
              other.source.fileId,
            );
            if (otherFullDoc) {
              const remaining = supplementBudget - supplementBlock.length;
              const otherText = otherFullDoc.fullText.slice(0, remaining);
              supplementBlock += `\n--- FIL-INNHOLD (SUPPLERENDE): ${otherFullDoc.fileName} ---\n${otherText}\n--- SLUTT SUPPLERENDE ---\n`;
            }
          }
          if (supplementBlock) {
            logger.info(
              {
                mode: "full_document_supplemented",
                primaryChars: truncatedFullText.length,
                supplementChars: supplementBlock.length,
                supplementFiles: seenFileIds.size - 1,
              },
              "Full dokument-mode beriket med andre filer fra samme modul",
            );
          }
        }

        const kontekst =
          "<canvas-kursdata>\n" +
          `--- FIL-INNHOLD (FULLT DOKUMENT): ${fullDocument.fileName} ---\n` +
          truncatedFullText +
          supplementBlock +
          "\n</canvas-kursdata>";

        logger.info(
          {
            mode: "full_document",
            triggerWord: fullDocumentDecision.triggerWord ?? null,
            fileId: primary.source.fileId,
            fileName: fullDocument.fileName,
            fullTextChars: fullDocument.charCount,
            injectedChars: truncatedFullText.length,
            totalContextChars: kontekst.length,
            truncated,
            reason: fullDocumentDecision.reason,
          },
          "Full dokument-mode aktivert",
        );

        return {
          kontekst,
          hasSparseChunks: false,
          fullDocumentMode: true,
          kilder: [
            {
              courseId: String(primary.source.courseId),
              courseName: primary.source.courseName ?? "",
              fileId: primary.source.fileId,
              fileName: fullDocument.fileName,
              score: primary.score,
              chunkCount: 1,
            },
          ],
        };
      }
    }
    if (!fullDocumentDecision.enabled) {
      logger.info(
        {
          mode: "chunk",
          reason: "no trigger word matched",
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
    const MAX_EXPANDED_CHARS = 14000; // topFile opptil 11k + sekundære opptil 1.5k
    const MAX_TOPFILE_EXPANDED_CHARS = 11000;
    const MAX_SECONDARY_EXPANDED_CHARS = 1500;
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

    // Bygg kildeliste fra fileMatchCounts — én oppføring per fil, sortert etter
    // matchcount/score. Brukes som klikkbar liste under chat-svaret.
    const topScoreByFile = new Map<string, number>();
    for (const r of filteredResults) {
      const key = `${r.source.courseId}:${r.source.fileId}`;
      const prev = topScoreByFile.get(key) ?? -Infinity;
      if (r.score > prev) topScoreByFile.set(key, r.score);
    }
    const kilder: ContextSource[] = Array.from(fileMatchCounts.entries())
      .map(([key, info]) => ({
        courseId: String(info.source.courseId),
        courseName: info.source.courseName ?? "",
        fileId: info.source.fileId,
        fileName: info.source.fileName ?? "",
        score: topScoreByFile.get(key),
        chunkCount: info.indexes.size,
      }))
      .filter((k) => k.fileName.length > 0)
      .sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
      .slice(0, 8);

    return {
      kontekst: "<canvas-kursdata>\n" + kontekst + "\n</canvas-kursdata>",
      hasSparseChunks,
      fullDocumentMode: false,
      kilder,
    };
  } catch (error) {
    logger.warn({ err: error }, "Feil ved hybrid søk — faller tilbake til keyword-søk");
    return null;
  }
}

// ─── On-demand filhenting ────────────────────────────────────

/** Maks filer å hente on-demand per forespørsel */
const ON_DEMAND_MAX_FILES = 5;
/** Maks filstørrelse for on-demand henting (10 MB) */
const ON_DEMAND_MAX_FILE_SIZE = 10 * 1024 * 1024;
/** Timeout per fil-henting (ms) — forhindrer at én treg fil blokkerer alle */
const ON_DEMAND_PER_FILE_TIMEOUT_MS = 8_000;

/**
 * Henter filinnhold on-demand fra Canvas API for en spesifikk modul.
 * Brukes som siste fallback når verken Redis eller MongoDB har data.
 * Lagrer innholdet i MongoDB/Pinecone for fremtidige forespørsler (fire-and-forget).
 */
async function hentModulFilerOnDemand(
  userId: string,
  canvasToken: string,
  moduleHint: string,
  baseUrl?: string,
  courseIdHint?: number,
): Promise<string | null> {
  try {
    // Finn modulen fra CanvasStructure — prioriter korrekt kurs
    const query: Record<string, unknown> = { userId };
    if (courseIdHint) query.courseId = courseIdHint;
    const structures = await CanvasStructureModel.find(query).lean<ICanvasStructure[]>();
    if (!structures || structures.length === 0) return null;

    let matchedStructure: ICanvasStructure | undefined;
    let matchedModule: ICanvasStructure["moduler"][0] | undefined;

    for (const s of structures) {
      const mod = s.moduler.find((m) => modulTitleMatcherHint(m.name, moduleHint));
      if (mod) {
        matchedStructure = s;
        matchedModule = mod;
        break;
      }
    }

    if (!matchedStructure || !matchedModule || !matchedModule.items) return null;

    // Filtrer til filer som kan prosesseres
    const filItems = matchedModule.items.filter(
      (item) => item.type === "File" ? item.content_id != null : item.type === "Page" || item.type === "ExternalUrl",
    );

    if (filItems.length === 0) return null;

    const courseId = String(matchedStructure.courseId);
    let kontekst = `<canvas-kursdata>\n`;
    kontekst += `EMNE: ${formatCourseLabel(matchedStructure.courseName, matchedStructure.course_code)}\n\n`;
    kontekst += `### ${matchedModule.name}\n`;

    // Parallell filhenting med per-fil timeout
    interface FileResult {
      title: string;
      type: string;
      content: string | null;
      fileData: { filename: string; id: number } | null;
    }

    const filesToFetch = filItems.slice(0, ON_DEMAND_MAX_FILES);
    
    const fetchFileWithTimeout = async (item: typeof filItems[0]): Promise<FileResult> => {
      const contentId = item.content_id!;
      
      // Wrapper med timeout
      const timeoutPromise = new Promise<null>((resolve) =>
        setTimeout(() => resolve(null), ON_DEMAND_PER_FILE_TIMEOUT_MS),
      );

      const fetchPromise = (async (): Promise<string | null> => {
        try {
          const { data: fileData } = await fetchFileMetadata(canvasToken, contentId, baseUrl);
          if (!fileData || fileData.size > ON_DEMAND_MAX_FILE_SIZE) return null;
          if (!isSupportedFileType(fileData.filename)) return null;

          const isPdf =
            fileData.mime_type === "application/pdf" ||
            fileData.filename.toLowerCase().endsWith(".pdf");

          if (isPdf) {
            const pdfResult = await fetchPdfContent(canvasToken, {
              id: fileData.id,
              filename: fileData.filename,
              url: fileData.url,
              size: fileData.size,
              mime_type: fileData.mime_type,
            }, baseUrl);
            return pdfResult?.content ?? null;
          } else {
            const buf = await fetchFileContent(canvasToken, {
              id: fileData.id,
              filename: fileData.filename,
              url: fileData.url,
              size: fileData.size,
            }, baseUrl);
            if (buf) {
              const result = await extractTextFromFile(buf, fileData.filename);
              if (result && result.content.trim().length > 0) return result.content;
            }
          }
          return null;
        } catch (err) {
          logger.warn({ err, userId, fileId: contentId }, "On-demand fil-fetch feilet");
          return null;
        }
      })();

      const content = await Promise.race([fetchPromise, timeoutPromise]);
      
      // Hent fileData for lagring (gjøres separat for å ikke blokkere)
      let fileData: { filename: string; id: number } | null = null;
      try {
        const { data } = await fetchFileMetadata(canvasToken, contentId, baseUrl);
        if (data) fileData = { filename: data.filename, id: data.id };
      } catch {
        // Ignorer — ikke kritisk for kontekst
      }

      return { title: item.title, type: item.type ?? "File", content, fileData };
    };

    // Hent alle filer parallelt
    const results = await Promise.allSettled(filesToFetch.map(fetchFileWithTimeout));
    
    let hentetFiler = 0;
    for (const result of results) {
      if (result.status !== "fulfilled") continue;
      const { title, type, content, fileData } = result.value;
      
      kontekst += `- [${type}] ${title}\n`;
      
      if (!content || content.trim().length === 0) continue;

      // Inkluder i kontekst (maks 4000 tegn per fil)
      const truncated = content.length > 4000 ? content.substring(0, 4000) + "\n[...forkortet...]" : content;
      kontekst += `\nINNHOLD FRA ${title}:\n${truncated}\n`;
      hentetFiler++;

      // Lagre i MongoDB for fremtidige forespørsler (fire-and-forget)
      if (fileData) {
        const chunks = createChunksFromContent(content, {
          courseId,
          courseName: matchedStructure.courseName,
          moduleTitle: matchedModule.name,
          fileName: fileData.filename,
          fileId: fileData.id,
        });
        if (chunks.length > 0) {
          void upsertStoredFileContent({
            userId,
            courseId,
            courseName: matchedStructure.courseName,
            moduleId: matchedModule.id,
            moduleTitle: matchedModule.name,
            fileName: fileData.filename,
            fileId: fileData.id,
            fileHash: `ondemand-${Date.now()}`,
            chunks,
            fullText: content,
          }).catch((err) => {
            logger.warn({ err, userId, fileId: fileData.id }, "On-demand lagring feilet (ikke-kritisk)");
          });
        }
      }
    }

    if (hentetFiler === 0) return null;

    kontekst += "\n</canvas-kursdata>";

    logger.info(
      { userId, moduleHint, hentetFiler, courseId },
      "On-demand filhenting fullført for modul",
    );

    return kontekst;
  } catch (error) {
    logger.warn({ err: error, userId, moduleHint }, "On-demand filhenting feilet");
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
 * For canvas_full med melding brukes en 5-trinns strategi:
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
  contextPrefs?: CanvasContextPreferences,
  hiddenCourseIds?: Set<number>,
): Promise<ContextResult> {
  // Mutable state som settes inne i indre IIFE og leses av wrapperen under.
  // IIFE-wrappen lar oss annotere alle eksisterende return-punkter uten å
  // måtte røre hver enkelt av dem.
  const state = { syncWaited: false };
  const result = await loadCanvasContextCore(
    state,
    userId,
    canvasToken,
    intent,
    target,
    message,
    baseUrl,
    signal,
    contextPrefs,
    hiddenCourseIds,
  );
  return state.syncWaited ? { ...result, syncWaited: true } : result;
}

async function loadCanvasContextCore(
  state: { syncWaited: boolean },
  userId: string,
  canvasToken: string,
  intent: IntentType,
  target?: TargetedQuery,
  message?: string,
  baseUrl?: string,
  signal?: AbortSignal,
  contextPrefs?: CanvasContextPreferences,
  hiddenCourseIds?: Set<number>,
): Promise<ContextResult> {

  // general_chat trenger ingen kontekst
  if (intent === "general_chat") {
    return { kontekst: "", hasCanvasData: false, source: "none" };
  }

  // Alle Canvas-datatyper deaktivert av bruker — hopp over kontekstlasting
  if (contextPrefs && !contextPrefs.courses && !contextPrefs.assignments && !contextPrefs.announcements && !contextPrefs.events) {
    return { kontekst: "", hasCanvasData: false, source: "none" };
  }

  // Avbryt tidlig dersom forespørselen allerede er avsluttet
  const ABORTED_RESULT: ContextResult = { kontekst: "", hasCanvasData: false, source: "none" };
  if (signal?.aborted) return ABORTED_RESULT;

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

  // ── Vent på sync hvis brukeren peker på et spesifikt kurs som ikke er indeksert ──
  // Dette løser racet der chat svarer "ingen tilgang til lærestoff" fordi sync av det
  // aktuelle kurset enda ikke er ferdig. Vi triggrer sync med priority og venter
  // inntil kurset har minst én chunk i MongoDB, eller timeout.
  // state.syncWaited propageres til chat-handler så den kan velge raskere modell
  // og generere bedre feilmeldinger når filer fortsatt mangler.
  if (target?.courseIdHint != null && !signal?.aborted) {
    const courseIdStr = String(target.courseIdHint);
    const alreadyIndexed = await hasIndexedCourseData(userId, courseIdStr);
    if (!alreadyIndexed) {
      state.syncWaited = true;
      logger.info(
        { userId, courseId: courseIdStr },
        "loadCanvasContext: kurs ikke indeksert — trigger prioritert sync og venter",
      );
      // Trigger sync med priority (no-op hvis allerede pågår)
      void syncCanvasDataForUser(userId, canvasToken, baseUrl, signal, {
        priorityCourseId: courseIdStr,
      }).catch((err) => {
        logger.warn({ err, userId, courseId: courseIdStr }, "Prioritert sync feilet");
      });
      // Vent inntil 10s på at det prioriterte kurset får minst én indeksert chunk
      // Redusert fra 25s for å forbedre responsivitet — de fleste syncer fullføres på <5s
      const WAIT_DEADLINE_MS = 10_000;
      const POLL_INTERVAL_MS = 400;
      const startedAt = Date.now();
      while (Date.now() - startedAt < WAIT_DEADLINE_MS) {
        if (signal?.aborted) break;
        await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
        if (await hasIndexedCourseData(userId, courseIdStr)) {
          logger.info(
            { userId, courseId: courseIdStr, waitedMs: Date.now() - startedAt },
            "loadCanvasContext: prioritert kurs ble indeksert under venting",
          );
          break;
        }
      }
    }
  }

  const redisAvailable = isRedisReady();
  const hasRedisSyncData = redisAvailable && (await hasCanvasSyncData(userId));
  const hasStoredAIContent = await hasStoredContentForUser(userId);
  const wantsCourseOverview = Boolean(message && isCourseOverviewQuery(message));
  const shouldPreferStructuredContext = Boolean(message && isStructuredCanvasQuery(message));
  const wantsAnnouncements = Boolean(message && isAnnouncementQuery(message)) && (!contextPrefs || contextPrefs.announcements);
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
        syncCanvasDataForUser(userId, canvasToken, baseUrl, signal, { priorityCourseId: target?.courseIdHint ?? undefined }).catch((err) => {
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
      syncCanvasDataForUser(userId, canvasToken, baseUrl, signal, { priorityCourseId: target?.courseIdHint ?? undefined }).catch((err) => {
        logger.warn({ err, userId }, "Bakgrunns-sync feilet");
      });
    }
    return { kontekst: "", hasCanvasData: false, source: "none" };
  }

  // Sjekk abort-signal før tyngre søkeoperasjoner
  if (signal?.aborted) return ABORTED_RESULT;

  // ── Hybrid søk når chunkHint finnes (uavhengig av intent) ──
  // chunkHint indikerer at brukeren spør om spesifikt faginnhold, selv om
  // intent er canvas_light (f.eks. "forklar kvantitativ metode").
  // Resultatet huskes i hybridAlreadyAttempted slik at Trinn 0 ikke gjentar identisk søk.
  let hybridAlreadyAttempted = false;
  if (!shouldPreferStructuredContext && hasStoredAIContent && message && target?.chunkHint) {
    hybridAlreadyAttempted = true;
    const hybridResult = await byggKontekstFraHybridSearch(userId, message, target, hiddenCourseIds);
    if (hybridResult) {
      // Berik med modulstruktur-oversikt slik at KI vet hva som finnes i emnet
      let kontekst = hybridResult.kontekst;
      if (hasCourseTarget(target)) {
        const strukturOversikt = await byggModulStrukturOversikt(userId, target, hiddenCourseIds);
        if (strukturOversikt) {
          kontekst = kontekst.replace("</canvas-kursdata>", strukturOversikt + "\n</canvas-kursdata>");
        }
      }
      logger.info(
        { userId, intent, chunkHint: target.chunkHint, source: "vector", contextLength: kontekst.length },
        "Canvas-kontekst lastet fra hybrid søk (chunkHint-trigget)",
      );
      return {
        kontekst,
        hasCanvasData: true,
        source: "vector",
        hasSparseChunks: hybridResult.hasSparseChunks,
        fullDocumentMode: hybridResult.fullDocumentMode,
        kilder: hybridResult.kilder,
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
    // Faglige spørsmål havner av og til feilaktig i canvas_light uten chunkHint.
    // Prøv hybrid-søk også her når vi har lagret AI-innhold.
    if (!hybridAlreadyAttempted && !shouldPreferStructuredContext && hasStoredAIContent && message && !wantsAnnouncements) {
      const hybridResult = await byggKontekstFraHybridSearch(userId, message, target, hiddenCourseIds);
      if (hybridResult) {
        let kontekst = hybridResult.kontekst;
        if (hasCourseTarget(target)) {
          const strukturOversikt = await byggModulStrukturOversikt(userId, target!, hiddenCourseIds);
          if (strukturOversikt) {
            kontekst = kontekst.replace("</canvas-kursdata>", strukturOversikt + "\n</canvas-kursdata>");
          }
        }
        logger.info(
          { userId, intent, source: "vector", contextLength: kontekst.length },
          "Canvas-light oppgradert til hybrid søk",
        );
        return {
          kontekst,
          hasCanvasData: true,
          source: "vector",
          hasSparseChunks: hybridResult.hasSparseChunks,
          fullDocumentMode: hybridResult.fullDocumentMode,
          kilder: hybridResult.kilder,
        };
      }
    }

    if (wantsAnnouncements && !hasSpecificTarget) {
      const announcements = await hentKunngjøringerForBruker(userId);
      if (announcements.length > 0) {
        const kontekst = "<canvas-kursdata>\n" + formaterKunngjøringerKontekst(announcements) + "\n</canvas-kursdata>";
        logger.info(
          { userId, intent, source: "redis", count: announcements.length, contextLength: kontekst.length },
          "Canvas-kontekst lastet som kunngjøringsoversikt",
        );
        return { kontekst, hasCanvasData: true, source: "redis" };
      }
    }

    if (hasSpecificTarget && target) {
      if (hasRedisSyncData) {
        const redisKontekst = await byggMålrettetKontekstFraRedis(userId, target, contextPrefs, hiddenCourseIds);
        if (redisKontekst) {
          logger.info(
            { userId, intent, target, source: "redis", contextLength: redisKontekst.length },
            "Canvas-kontekst lastet fra Redis (målrettet metadata)",
          );
          return { kontekst: redisKontekst, hasCanvasData: true, source: "redis" };
        }
      }

      const mongoKontekst = await byggMålrettetKontekstFraMongo(userId, target, contextPrefs);
      if (mongoKontekst) {
        logger.info(
          { userId, intent, target, source: "mongodb", contextLength: mongoKontekst.length },
          "Canvas-kontekst lastet fra MongoDB (målrettet metadata fallback)",
        );
        if (redisAvailable) {
          syncCanvasDataForUser(userId, canvasToken, baseUrl, signal, { priorityCourseId: target?.courseIdHint ?? undefined }).catch((err) => {
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
        syncCanvasDataForUser(userId, canvasToken, baseUrl, signal, { priorityCourseId: target?.courseIdHint ?? undefined }).catch((err) => {
          logger.warn({ err, userId }, "Bakgrunns-sync feilet");
        });
      }
      return { kontekst: "", hasCanvasData: false, source: "none" };
    }

    // Prøv Redis først
    if (hasRedisSyncData) {
      const redisKontekst = await byggLettKontekstFraRedis(userId, contextPrefs);
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
    const mongoKontekst = await byggLettKontekstFraMongo(userId, contextPrefs);
    if (mongoKontekst) {
      logger.info(
        { userId, intent, source: "mongodb", contextLength: mongoKontekst.length },
        "Canvas-kontekst lastet fra MongoDB (lett fallback)",
      );
      // Trigger bakgrunns-sync for å oppdatere Redis
      if (redisAvailable) {
        syncCanvasDataForUser(userId, canvasToken, baseUrl, signal, { priorityCourseId: target?.courseIdHint ?? undefined }).catch((err) => {
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
      syncCanvasDataForUser(userId, canvasToken, baseUrl, signal, { priorityCourseId: target?.courseIdHint ?? undefined }).catch((err) => {
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

  // Sjekk abort-signal før canvas_full søketrinn
  if (signal?.aborted) return ABORTED_RESULT;

  // Trinn 0: Hybrid søk (Pinecone + BM25 → RRF → Cohere Rerank)
  // Hopp over om chunkHint-stien allerede kjørte identisk søk.
  if (!hybridAlreadyAttempted && !shouldPreferStructuredContext && hasStoredAIContent && message) {
    const hybridResult = await byggKontekstFraHybridSearch(userId, message, target, hiddenCourseIds);
    if (hybridResult) {
      let kontekst = hybridResult.kontekst;
      // Injiser kunngjøringer
      if (announcementBlock) {
        kontekst = kontekst.replace("</canvas-kursdata>", announcementBlock + "\n</canvas-kursdata>");
      }
      // Berik med modulstruktur slik at KI kjenner til hele emneinnholdet
      if (hasCourseTarget(target)) {
        const strukturOversikt = await byggModulStrukturOversikt(userId, target!, hiddenCourseIds);
        if (strukturOversikt) {
          kontekst = kontekst.replace("</canvas-kursdata>", strukturOversikt + "\n</canvas-kursdata>");
        }
      }
      logger.info(
        { userId, intent, source: "vector", contextLength: kontekst.length },
        "Canvas-kontekst lastet fra hybrid søk",
      );
      return {
        kontekst,
        hasCanvasData: true,
        source: "vector",
        hasSparseChunks: hybridResult.hasSparseChunks,
        fullDocumentMode: hybridResult.fullDocumentMode,
        kilder: hybridResult.kilder,
      };
    }
  }

  // Hvis brukeren spør om kunngjøringer og vi har data, returner det direkte —
  // hybrid-søk finner aldri kunngjøringer (ikke indeksert), så vi trenger ikke vente på chunk-søk.
  if (wantsAnnouncements && announcementBlock) {
    const kontekst = "<canvas-kursdata>\n" + announcementBlock + "\n</canvas-kursdata>";
    return { kontekst, hasCanvasData: true, source: "redis" };
  }

  // Sjekk abort-signal før chunk-søk og metadata-oppslag
  if (signal?.aborted) return ABORTED_RESULT;

  // Trinn 1: Chunk-basert søk (keyword fallback når hybrid søk ikke ga treff)
  if (!shouldPreferStructuredContext && hasStoredAIContent && message) {
    const chunkKontekst = await byggKontekstFraChunks(userId, message, target, hiddenCourseIds);
    if (chunkKontekst) {
      logger.info(
        { userId, intent, source: "chunks", contextLength: chunkKontekst.kontekst.length, sources: chunkKontekst.kilder.length },
        "Canvas-kontekst lastet fra chunk-søk (keyword)",
      );
      return { kontekst: chunkKontekst.kontekst, hasCanvasData: true, source: "chunks", kilder: chunkKontekst.kilder };
    }
  }

  // Trinn 2: Målrettet Redis/MongoDB (tittel-matching)
  if (hasSpecificTarget && target) {
    let metadataKontekst: string | null = null;
    let metadataSource: "redis" | "mongodb" | null = null;

    // Prøv Redis først
    if (hasRedisSyncData) {
      metadataKontekst = await byggMålrettetKontekstFraRedis(userId, target, contextPrefs, hiddenCourseIds);
      if (metadataKontekst) metadataSource = "redis";
    }

    // MongoDB fallback
    if (!metadataKontekst) {
      metadataKontekst = await byggMålrettetKontekstFraMongo(userId, target, contextPrefs);
      if (metadataKontekst) metadataSource = "mongodb";
    }

    if (metadataKontekst) {
      const needsFileContent = metadataKontekst.includes("<!-- MODULE_NEEDS_FILE_CONTENT -->");
      const cleanKontekst = metadataKontekst.replace("\n<!-- MODULE_NEEDS_FILE_CONTENT -->", "");

      // Modulen har allerede filinnhold — returner direkte
      if (!needsFileContent) {
        logger.info(
          { userId, intent, target, source: metadataSource, contextLength: cleanKontekst.length },
          "Målrettet Canvas-kontekst lastet (med filinnhold)",
        );
        return { kontekst: cleanKontekst, hasCanvasData: true, source: metadataSource! };
      }

      // Modulen mangler filinnhold — prøv on-demand med 5s timeout for å berike
      if (target.moduleHint) {
        logger.info(
          { userId, intent, target, source: "on-demand-enrichment" },
          "Metadata-kontekst klar — prøver on-demand berikelse med timeout",
        );
        try {
          const ON_DEMAND_TIMEOUT_MS = 5000;
          const onDemandPromise = hentModulFilerOnDemand(
            userId, canvasToken, target.moduleHint, baseUrl, target.courseIdHint ?? undefined,
          );
          const timeoutPromise = new Promise<null>((resolve) => setTimeout(() => resolve(null), ON_DEMAND_TIMEOUT_MS));
          const onDemandKontekst = await Promise.race([onDemandPromise, timeoutPromise]);

          if (onDemandKontekst) {
            logger.info(
              { userId, intent, target, source: "on-demand-enriched", contextLength: onDemandKontekst.length },
              "On-demand berikelse fullført — bruker modulfilinnhold",
            );
            return { kontekst: onDemandKontekst, hasCanvasData: true, source: "api" };
          }

          logger.info(
            { userId, intent, target },
            "On-demand berikelse ga ingen resultater eller timet ut — bruker metadata-kontekst",
          );
        } catch (err) {
          logger.warn({ err, userId }, "On-demand berikelse feilet — bruker metadata-kontekst");
        }
      }

      // Returner metadata-konteksten (uten filinnhold, men med modulstruktur)
      logger.info(
        { userId, intent, target, source: metadataSource, contextLength: cleanKontekst.length },
        "Målrettet Canvas-kontekst lastet (kun metadata)",
      );
      return { kontekst: cleanKontekst, hasCanvasData: true, source: metadataSource!, metadataOnly: true };
    }

    // Ingen metadata i det hele tatt — prøv full on-demand som siste utvei
    if (target.moduleHint) {
      logger.info(
        { userId, intent, target, source: "on-demand" },
        "Redis+MongoDB mangler all data — prøver on-demand henting fra Canvas API",
      );
      const onDemandKontekst = await hentModulFilerOnDemand(userId, canvasToken, target.moduleHint, baseUrl, target.courseIdHint ?? undefined);
      if (onDemandKontekst) {
        return { kontekst: onDemandKontekst, hasCanvasData: true, source: "api" };
      }
    }

    // Ingen data — trigger sync
    logger.info(
      { userId, intent, target, source: "none" },
      "Redis+MongoDB+on-demand mangler data — trigger sync (målrettet)",
    );
    if (redisAvailable) {
      syncCanvasDataForUser(userId, canvasToken, baseUrl, signal, { priorityCourseId: target?.courseIdHint ?? undefined }).catch((err) => {
        logger.warn({ err, userId }, "Bakgrunns-sync feilet");
      });
    }
    return { kontekst: "", hasCanvasData: false, source: "none" };
  }

  // Sjekk abort-signal før siste fallback-runde
  if (signal?.aborted) return ABORTED_RESULT;

  // canvas_full uten spesifikt mål → bruk lett kontekst (som eksisterende logikk)
  if (hasRedisSyncData) {
    const redisKontekst = await byggLettKontekstFraRedis(userId, contextPrefs);
    if (redisKontekst) {
      logger.info(
        { userId, intent, source: "redis", contextLength: redisKontekst.length },
        "canvas_full uten mål — lett kontekst fra Redis",
      );
      return { kontekst: redisKontekst, hasCanvasData: true, source: "redis" };
    }
  }

  // MongoDB fallback
  const mongoFallback = await byggLettKontekstFraMongo(userId, contextPrefs);
  if (mongoFallback) {
    logger.info(
      { userId, intent, source: "mongodb", contextLength: mongoFallback.length },
      "canvas_full uten mål — lett kontekst fra MongoDB (fallback)",
    );
    if (redisAvailable) {
      syncCanvasDataForUser(userId, canvasToken, baseUrl, signal, { priorityCourseId: target?.courseIdHint ?? undefined }).catch((err) => {
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
    syncCanvasDataForUser(userId, canvasToken, baseUrl, signal, { priorityCourseId: target?.courseIdHint ?? undefined }).catch((err) => {
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
  priorityCourseId?: string | number,
  signal?: AbortSignal,
): Promise<void> {
  if (!isRedisReady()) return;

  if (!baseUrl) {
    logger.warn({ userId }, "ensureCanvasSync: canvasBaseUrl mangler — hopper over sync");
    return;
  }

  syncCanvasDataForUser(userId, canvasToken, baseUrl, signal, {
    priorityCourseId,
  }).catch((err) => {
    if ((err as { name?: string } | null)?.name === "AbortError") {
      logger.debug({ userId }, "Canvas sync avbrutt (signal)");
      return;
    }
    logger.warn({ err, userId }, "Canvas sync feilet");
  });
}
