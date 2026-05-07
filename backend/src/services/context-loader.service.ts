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
import { getCache, setCache, isRedisReady } from "../cache/redis.js";
import { syncCanvasDataForUser, hasCanvasSyncData, userKey, isSyncing, waitForSync, hasIndexedCourseData } from "./canvas-sync.service.js";
import { fetchCanvasLectures, fetchPlannerItems } from "../rutere/canvas/canvasService.js";
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
import { createStableFileId } from "./crawler.js";
import { ContentEmbedding } from "../database/models/ContentEmbedding.js";
import {
  isCourseOverviewQuery,
  isStructuredCanvasQuery,
  normaliserCanvasSporsmal,
} from "./canvasStructuredQueries.js";
import { fetchPdfContent, fetchFileContent, fetchFileMetadata } from "../rutere/canvas/canvasService.js";
import { isSupportedFileType, extractTextFromFile } from "./fileExtractor.js";
import { createChunksFromContent } from "./chunk.service.js";
import { upsertStoredFileContent } from "./embedding.service.js";
import { getExtractionFailuresForCourses } from "./file-extraction-status.service.js";
import type { IFileExtractionStatus } from "../database/models/FileExtractionStatus.js";

import { z } from "zod";

// Typer
export type IntentType = "general_chat" | "canvas_light" | "canvas_full";

/** Kildereferanse — duplisert lokalt for å unngå sirkulær avhengighet med common/ki. */
const ContextSourceSchema = z.object({
  courseId: z.string(),
  courseName: z.string(),
  fileId: z.number().int(),
  fileName: z.string(),
  score: z.number().optional(),
  chunkCount: z.number().int().nonnegative().optional(),
  /** Ekstern URL når kilden er crawlet fra ExternalUrl/PDF — gir kilde-panelet
   *  noe å åpne i ny fane, siden Canvas-nedlasting ikke funker for slike. */
  sourceUrl: z.url().optional(),
});
export type ContextSource = z.infer<typeof ContextSourceSchema>;

/**
 * Bygger et oppslag fra fileId → sourceUrl for ett kurs.
 *
 * Dekker to kategorier:
 * 1. **Crawlede eksterne ressurser** (ExternalUrl + PDF-lenker + undersider) —
 *    bruker createStableFileId for å matche den syntetiske IDen som crawleren
 *    genererer når innholdet indekseres.
 * 2. **Canvas Pages** — indekseres med `item.id` som fileId av canvas-sync.
 *    Disse har ikke `/api/v1/files/:id`-endepunkt i Canvas, så download-klikk
 *    ville gitt 404. Vi bygger derfor `{baseUrl}/courses/{id}/pages/{slug}`
 *    som sourceUrl, slik at klikk åpner Canvas-siden i ny fane istedenfor.
 *
 * `baseUrl` er Canvas-hostens URL (f.eks. `https://usn.instructure.com`).
 * Uten den kan ikke Page-URL-er bygges, men crawlede URL-er fungerer
 * uansett siden de allerede er fullstendige.
 */
async function buildCrawledFileIdUrlMap(
  userId: string,
  courseId: string,
  baseUrl?: string,
): Promise<Map<number, string>> {
  const idToUrl = new Map<number, string>();
  try {
    const numericCourseId = Number(courseId);
    // CanvasStructure-schema-et har courseId som string, men noen gamle rader
    // kan være lagret som number. Prøv begge — Mongoose caster normalt, men
    // vi er eksplisitte for å være robust.
    const filter: Record<string, unknown> = Number.isFinite(numericCourseId)
      ? { userId, courseId: String(numericCourseId) }
      : { userId, courseId };
    const structure = await CanvasStructureModel.findOne(filter)
      .select("moduler")
      .lean<ICanvasStructure | null>();
    if (!structure) return idToUrl;

    const addUrl = (url: string | undefined | null) => {
      if (!url || typeof url !== "string") return;
      try {
        const parsed = new URL(url);
        if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return;
      } catch {
        return;
      }
      const id = createStableFileId(url);
      if (!idToUrl.has(id)) idToUrl.set(id, url);
    };

    // Normaliser baseUrl: strip trailing slash for å unngå `//courses`.
    const normalizedBaseUrl = baseUrl?.replace(/\/+$/, "");

    for (const modul of structure.moduler ?? []) {
      for (const item of modul.items ?? []) {
        addUrl(item.external_url);
        for (const pdfUrl of item.crawledPdfs ?? []) addUrl(pdfUrl);
        for (const subUrl of item.crawledSubpages ?? []) addUrl(subUrl);

        if (!normalizedBaseUrl) continue;

        // Canvas-ressurser som ikke kan lastes ned via /api/v1/files/:id
        // (Pages) eller som kan feile med 403 (Files brukeren ikke har
        // tilgang til). Alle får en Canvas UI-URL så klikk navigerer til
        // ressursen i Canvas selv istedenfor å 404/403-e mot file-API-et.
        if (
          item.type === "Page"
          && item.page_url
          && typeof item.id === "number"
          && !idToUrl.has(item.id)
        ) {
          idToUrl.set(
            item.id,
            `${normalizedBaseUrl}/courses/${courseId}/pages/${encodeURIComponent(item.page_url)}`,
          );
        } else if (
          item.type === "File"
          && typeof item.content_id === "number"
          && !idToUrl.has(item.content_id)
        ) {
          // Canvas file-download-URL med download_frd=1 som trigger direkte
          // nedlasting istedenfor forhåndsvisning. Hvis brukeren ikke har
          // tilgang viser Canvas en feilmelding — men i praksis pleier
          // studenten som spør om filen å ha tilgang (filen er i Canvas-
          // modulen de er påmeldt). Dette sparer dem ett klikk vs. å lande
          // på forhåndsvisnings-siden og klikke "Download" der.
          idToUrl.set(
            item.content_id,
            `${normalizedBaseUrl}/courses/${courseId}/files/${item.content_id}/download?download_frd=1`,
          );
        } else if (
          item.type === "Assignment"
          && typeof item.content_id === "number"
          && !idToUrl.has(item.content_id)
        ) {
          idToUrl.set(
            item.content_id,
            `${normalizedBaseUrl}/courses/${courseId}/assignments/${item.content_id}`,
          );
        }
      }
    }
  } catch (err) {
    logger.warn({ err, userId, courseId }, "buildCrawledFileIdUrlMap feilet");
  }
  return idToUrl;
}

/**
 * Fyller inn `sourceUrl` på kilder som mangler det ved å matche syntetisk
 * fileId mot CanvasStructure sine eksterne URL-er. Fire-and-forget-backfill
 * til ContentEmbedding slik at neste kall er instant.
 *
 * Mutér input-arrayet direkte for enkelhet — kilder er small-sized.
 */
async function backfillMissingSourceUrls(
  userId: string,
  kilder: ContextSource[],
  baseUrl?: string,
): Promise<void> {
  const missingByCourse = new Map<string, ContextSource[]>();
  for (const k of kilder) {
    if (k.sourceUrl) continue;
    if (!Number.isFinite(k.fileId)) continue;
    const bucket = missingByCourse.get(k.courseId) ?? [];
    bucket.push(k);
    missingByCourse.set(k.courseId, bucket);
  }
  if (missingByCourse.size === 0) return;

  for (const [courseId, bucket] of missingByCourse) {
    const idToUrl = await buildCrawledFileIdUrlMap(userId, courseId, baseUrl);
    if (idToUrl.size === 0) continue;

    const backfillOps: Array<{ fileId: number; externalUrl: string }> = [];
    for (const k of bucket) {
      const url = idToUrl.get(k.fileId);
      if (!url) continue;
      k.sourceUrl = url;
      backfillOps.push({ fileId: k.fileId, externalUrl: url });
    }

    if (backfillOps.length > 0) {
      // Fire-and-forget: oppdater ContentEmbedding så neste treff er instant.
      void Promise.all(
        backfillOps.map((op) =>
          ContentEmbedding.updateMany(
            { userId, courseId, fileId: op.fileId, externalUrl: { $exists: false } },
            { $set: { externalUrl: op.externalUrl } },
          ).catch((err) => {
            logger.warn({ err, userId, courseId, fileId: op.fileId }, "Backfill av externalUrl feilet");
          }),
        ),
      ).then(() => {
        logger.info(
          { userId, courseId, count: backfillOps.length },
          "Backfilled externalUrl på crawlede ContentEmbedding-rader",
        );
      });
    }
  }
}

export const ContextResultSchema = z.object({
  kontekst: z.string(),
  hasCanvasData: z.boolean(),
  /** true når `kontekst` inneholder faktisk fil-innhold (ikke bare
   *  extraction-failure-notat). Styrer om anti-hallusinasjons-guarden i
   *  system-prompten skal aktiveres: guarden påstår "du har innhold fra
   *  Canvas-filer" og gir mening kun når faktisk fil-innhold er lastet. */
  hasRealCanvasContent: z.boolean().optional(),
  source: z.enum(["redis", "mongodb", "api", "vector", "chunks", "none"]),
  /** true hvis minst én chunk inneholder sparse kulepunkt-innhold (PowerPoint etc.) */
  hasSparseChunks: z.boolean().optional(),
  /** true når konteksten er hentet som full dokumenttekst (ikke chunk-sammensetning) */
  fullDocumentMode: z.boolean().optional(),
  /** Matchet trigger-ord fra meldingen (oppsummer, utdyp, …) — brukes av chat-handler
   *  til å kalibrere max_tokens (fordypning trenger mer budsjett enn kort oppsummering). */
  fullDocumentTriggerWord: z.string().optional(),
  /** Primær-fil som ble valgt i full-document-mode — eksponeres for response-cache-nøkkel. */
  primaryFileId: z.number().optional(),
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

export const FULL_DOCUMENT_TRIGGER_WORDS = [
  // Norsk — oppsummering/gjennomgang
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
  "gå igjennom",
  "gjennomgå",
  "gi gjennomgang",
  "ta denne",
  // Norsk — fordypning
  "utdype",
  "utdyp",
  "forklar forelesning",
  "forklare forelesning",
  "forklar mer om",
  "fortell mer om",
  "mer om forelesning",
  // "Forklar/fortell + [leksjon|kapittel|modul]" — dekker "kan du forklare
  // leksjon 1", "forklar kapittel 3", "fortell om modul 2". Krever eksplisitt
  // innhold-type (leksjon/kapittel/modul) for å unngå at bredt "forklar X"
  // drar inn full-dokument-mode på generelle begreps-forespørsler.
  "forklar leksjon",
  "forklare leksjon",
  "forklar kapittel",
  "forklare kapittel",
  "forklar modul",
  "forklare modul",
  "fortell om leksjon",
  "fortell om kapittel",
  "fortell om modul",
  "fortell om forelesning",
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
  "explain lesson",
  "explain chapter",
  "explain module",
  "tell me about lesson",
  "tell me about chapter",
  "tell me about module",
];

/**
 * Sjekker om en brukermelding inneholder et full-dokument-trigger-ord
 * (oppsummering/fordypning/gjennomgang). Brukes også av kunnskapsbase for å
 * aktivere full-dokument-modus på KB-innhold.
 */
export function isFullDocumentTrigger(message: string): string | null {
  const rawLower = message.toLowerCase();
  return FULL_DOCUMENT_TRIGGER_WORDS.find((word) => rawLower.includes(word)) ?? null;
}

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
// Norske ordinaler → sifferform. Brukes i extractNumericHintsFromMessage slik at
// "første forelesning" gir numerisk hint "1" — uten dette ville primærfil-valget
// ikke kunne overstyre basert på filnavn for ordinal-formulerte spørsmål.
const NORSKE_ORDINALER_TIL_SIFFER: Record<string, string> = {
  "første": "1", "forste": "1",
  "andre": "2", "annen": "2",
  "tredje": "3",
  "fjerde": "4",
  "femte": "5",
  "sjette": "6",
  "sjuende": "7", "syvende": "7",
  "åttende": "8", "attende": "8",
  "niende": "9",
  "tiende": "10",
  "ellevte": "11",
  "tolvte": "12",
};

// Inkluderer typo-varianter ("forlesning" mangler e) og nynorsk-former ("førelesing")
// direkte her siden denne funksjonen kjører på rå brukermelding uten å gå via
// normaliserSkrivefeil (som bor i ki.ts). Gir robust match også ved skrivefeil.
const ORDINAL_MODUL_REGEX = /(?<![a-zæøå])(første|forste|andre|annen|tredje|fjerde|femte|sjette|sjuende|syvende|åttende|attende|niende|tiende|ellevte|tolvte)\s+(?:forelesning|forelesningen|forelesninga|forlesning|forlesninger|forelsning|forelesing|forelesinga|forelesingar|førelesning|førelesing|førelesinga|førelesingar|forlesing|lecture|modul|modulen|leksjon|lesson|kapittel|kapitlet|kapitel|kapitell|kap|chapter|uke|uka|week|tema|sesjon|session)/gi;

function extractNumericHintsFromMessage(message: string): string[] {
  const lower = message.toLowerCase();
  const hints = new Set<string>();

  // Ordinal + modul-nøkkelord: "første forelesning" → hint "1", "andre kapittel" → hint "2".
  // Dette gjør at filnavn-basert primærfil-valg virker for ordinal-formulerte spørsmål.
  for (const match of lower.matchAll(ORDINAL_MODUL_REGEX)) {
    const digit = NORSKE_ORDINALER_TIL_SIFFER[match[1]];
    if (digit) hints.add(digit);
  }

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
 * Ekstraherer dato fra filnavn som følger vanlige mønstre:
 *  - DDMMYYYY (kompakt, ingen skilletegn) — "Forelesning13012026.pdf" → 13. jan 2026
 *  - YYYYMMDD (ISO kompakt) — "Forelesning20260113.pdf" → 13. jan 2026
 *  - YYYY-MM-DD / YYYY.MM.DD / YYYY_MM_DD — "2026-01-13"
 *  - DD.MM.YYYY / DD-MM-YYYY — "13.01.2026"
 *
 * Returnerer null hvis ingen gyldig dato kan ekstraheres.
 * Prøver DDMMYYYY før YYYYMMDD siden norsk kontekst oftest bruker dag-først.
 */
function extractLectureDateFromFileName(fileName: string): Date | null {
  const isValidDate = (yyyy: number, mm: number, dd: number): boolean =>
    yyyy >= 2000 && yyyy <= 2099 && mm >= 1 && mm <= 12 && dd >= 1 && dd <= 31;
  // UTC-konstruksjon for å unngå tidssone-skift som kan gi feil dato
  // ved sammenligning eller logging (f.eks. Jan 13 local → Jan 12 UTC).
  const makeUtcDate = (yyyy: number, mm: number, dd: number): Date =>
    new Date(Date.UTC(yyyy, mm - 1, dd));

  // 8-sifret kompakt: prøv både DDMMYYYY og YYYYMMDD
  for (const match of fileName.matchAll(/(\d{8})/g)) {
    const digits = match[1];
    // DDMMYYYY først (norsk standard)
    const dd1 = parseInt(digits.slice(0, 2), 10);
    const mm1 = parseInt(digits.slice(2, 4), 10);
    const yyyy1 = parseInt(digits.slice(4, 8), 10);
    if (isValidDate(yyyy1, mm1, dd1)) return makeUtcDate(yyyy1, mm1, dd1);
    // YYYYMMDD fallback
    const yyyy2 = parseInt(digits.slice(0, 4), 10);
    const mm2 = parseInt(digits.slice(4, 6), 10);
    const dd2 = parseInt(digits.slice(6, 8), 10);
    if (isValidDate(yyyy2, mm2, dd2)) return makeUtcDate(yyyy2, mm2, dd2);
  }

  // YYYY-MM-DD / YYYY.MM.DD / YYYY_MM_DD
  const iso = fileName.match(/(\d{4})[-._](\d{1,2})[-._](\d{1,2})/);
  if (iso) {
    const yyyy = parseInt(iso[1], 10);
    const mm = parseInt(iso[2], 10);
    const dd = parseInt(iso[3], 10);
    if (isValidDate(yyyy, mm, dd)) return makeUtcDate(yyyy, mm, dd);
  }

  // DD.MM.YYYY / DD-MM-YYYY / DD_MM_YYYY
  const euro = fileName.match(/(\d{1,2})[-._](\d{1,2})[-._](\d{4})/);
  if (euro) {
    const dd = parseInt(euro[1], 10);
    const mm = parseInt(euro[2], 10);
    const yyyy = parseInt(euro[3], 10);
    if (isValidDate(yyyy, mm, dd)) return makeUtcDate(yyyy, mm, dd);
  }

  return null;
}

/**
 * Finner den N-te forelesningen fra en fil-liste ved å sortere kronologisk
 * på ekstraherte datoer fra filnavn.
 *
 * Brukes som siste-fallback når kurset navngir forelesninger etter dato
 * (f.eks. "Forelesning13012026.pdf") i stedet for nummer — og brukerens
 * numeriske hint ikke treffer noen fil ved direkte filnavn-match.
 *
 * Filtrerer bort plan/oversikt-filer som ikke representerer en faktisk
 * forelesning (f.eks. "Førelesingsplan" eller "Forelesningsoversikt").
 */
function finnNteForelesningFraKatalog<T extends { fileName: string }>(
  files: T[],
  n: number,
): T | null {
  if (n < 1) return null;
  const lectureLike = files.filter((f) => {
    const lower = f.fileName.toLowerCase().normalize("NFKC");
    // Normaliser ø→o for matching av "Førelesing..." varianter
    const nfc = lower.replace(/ø/g, "o");
    if (!/forelesn|foreles|lecture/.test(nfc)) return false;
    // Ekskluder planer/oversikter — disse er ikke selve forelesningen
    if (/plan|agenda|schedule|oversikt|pensum|syllabus/.test(nfc)) return false;
    return true;
  });
  const withDates = lectureLike
    .map((f) => ({ file: f, date: extractLectureDateFromFileName(f.fileName) }))
    .filter((x): x is { file: T; date: Date } => x.date !== null);
  if (withDates.length < n) return null;
  withDates.sort((a, b) => a.date.getTime() - b.date.getTime());
  return withDates[n - 1].file;
}

/**
 * Renser URL-escape-sekvenser (%XX) og "+" (URL-space) fra filnavn før
 * numerisk matching. Uten dette lekker tall i escape-sekvenser ("%2C" → "2")
 * inn og gir falske positiver på hint som "2".
 */
function cleanUrlEncodedFileName(fileName: string): string {
  return fileName
    .replace(/%[0-9a-f]{2}/gi, " ")
    .replace(/\+/g, " ");
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
  return cleanUrlEncodedFileName(fileName.toLowerCase()).replace(/(^|[^\d])0+(\d+)/g, "$1$2");
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
  const lower = cleanUrlEncodedFileName(fileName.toLowerCase());
  const normalisert = normaliserNumeriskFilnavn(fileName);
  // Ekstraher alle sammenhengende sifferrekker i filnavnet. Brukes til å matche
  // "prefix + 2-sifret år"-mønsteret (f.eks. "Forelesning226.pdf" = forelesning 2,
  // år 26) som ellers ville blitt rangert vekk av strict standalone-digit-regex.
  const digitRuns = [...lower.matchAll(/(?<!\d)(\d+)(?!\d)/g)].map((m) => m[1]);
  // Year-suffix-heuristikken er bare trygg å bruke når filnavnet faktisk
  // signaliserer forelesning/kapittel/leksjon-kontekst. Uten denne guarden
  // matcher "met1020" (kurs-kode) på hint "10" via run "1020" = "10" + "20"
  // — observert på MET1020 "kapittel 10" → valgte sensorveiledning.docx.
  const harForelesningsKontekst = /\b(forele|forelesing|forelesning|lecture|leksjon|lesson|kapit|kap\b|modul|uke|week|tema|del|part)/i
    .test(lower);

  return hints.some((hint) => {
    if (/[.-]/.test(hint)) {
      const escaped = hint.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      // eslint-disable-next-line security/detect-non-literal-regexp -- hint er fra egen ekstraksjon, escaped
      const regex = new RegExp(`(?:^|[^\\d])${escaped}(?![\\d])`);
      if (regex.test(lower) || regex.test(normalisert)) return true;
    } else {
      // eslint-disable-next-line security/detect-non-literal-regexp -- hint er rent numerisk fra egen ekstraksjon
      const regex = new RegExp(`(?:^|[^\\d])${hint}(?![\\d])`);
      if (regex.test(lower) || regex.test(normalisert)) return true;
    }
    // Year-suffix match: hint er prefikset av en sifferrekke der siste 2 sifre
    // er et 2-sifret år (2X). Fanger "Forelesning<N>26.pdf" → hint "<N>".
    // Kun aktiv når filnavnet har forelesning-/kapittel-kontekst (se over) —
    // ellers gir kurs-koder som "MET1020" falske treff på hint "10".
    if (harForelesningsKontekst && /^\d+$/.test(hint)) {
      return digitRuns.some((run) => {
        if (run.length !== hint.length + 2) return false;
        if (!run.startsWith(hint)) return false;
        const suffix = run.slice(hint.length);
        return /^2\d$/.test(suffix);
      });
    }
    return false;
  });
}

/**
 * Minste antall tegn før en primærfil regnes som "rik nok" (ikke bare wrapper).
 *
 * Canvas-wrappere (kurs-overview, leksjon-beskrivelser) har typisk 1500-4500
 * tegn (læringsmål + intro + lenker). Ekte pensum-PDF-er er 10-50k. Terskelen
 * må være høy nok til å catche wrappere i det øvre sjiktet, men numeric-hint-
 * filteret beskytter mot over-promotion til ubeslektede filer.
 */
export const MIN_RICH_PRIMARY_CHARS = 5000;
/** Hvor mye større må en alternativ fil være for å overta som primær. */
export const RICHER_ALTERNATIVE_MULTIPLIER = 3;
/** Maks antall kandidater vi sjekker charCount på — hver sjekk er én DB-hit. */
export const MAX_RICHNESS_PROBES = 4;

/**
 * Finner den rikeste kandidaten blant alternativer i samme kurs når primærfilen
 * er en tynn "wrapper" (Canvas-side med bare læringsmål/intro). Dette er pure
 * logikk — DB-hentingen skjer i kalleren, som oversender charCount-verdier.
 *
 * Returnerer null når primæren er rik nok, eller ingen kandidat er signifikant
 * større enn primæren.
 */
export function pickRicherPrimaryCandidate<Candidate extends { charCount: number }>(input: {
  primaryCharCount: number;
  candidates: readonly Candidate[];
  minRichChars?: number;
  richnessMultiplier?: number;
}): Candidate | null {
  const { primaryCharCount, candidates } = input;
  const minRich = input.minRichChars ?? MIN_RICH_PRIMARY_CHARS;
  const multiplier = input.richnessMultiplier ?? RICHER_ALTERNATIVE_MULTIPLIER;

  if (primaryCharCount >= minRich) return null;

  let richest: Candidate | null = null;
  for (const candidate of candidates) {
    if (candidate.charCount <= primaryCharCount * multiplier) continue;
    if (candidate.charCount < minRich) continue;
    if (!richest || candidate.charCount > richest.charCount) {
      richest = candidate;
    }
  }
  return richest;
}

/**
 * Velger primærfil for full_document-mode. Hvis brukeren eksplisitt refererte
 * til et kapittel/seksjon/modul-nummer, foretrekk fil hvis navn inneholder
 * det nummeret — selv om Cohere rangerte en annen fil høyest. Dette redder
 * tilfeller der rerank-scoren er lav (<0.4) og tilfeldig velger feil fil.
 *
 * Hvis ingen fil i `filteredResults` matcher, utvider vi søket til
 * `broaderPool` (typisk pre-rerank hybrid-resultater). Kap 1-filen kan
 * ligge der selv om den falt ut av top-6 etter Cohere-rerank.
 */
/**
 * Sjekker om filnavnet starter med et tall som matcher ett av hints.
 * Eksempel: "2. Lage databasetabeller.html" + hint "2" → true.
 *           "3. Likekoblinger ... leksjon 2" + hint "2" → false (starter med 3).
 *           "Forelesning226.pdf" + hint "2" → false (starter med "Forelesning").
 *           "F2 - Internett.pptx" + hint "2" → false (starter med bokstav).
 *
 * Brukes til å foretrekke filer som har tall-prefiks-konvensjon (f.eks.
 * `"N. Tittel"`) over filer som tilfeldigvis nevner samme tall et annet sted
 * i filnavnet, når flere kandidater matcher det samme numeriske hint.
 */
function fileNameStartsWithAnyNumericHint(fileName: string, hints: string[]): boolean {
  if (hints.length === 0) return false;
  const cleaned = cleanUrlEncodedFileName(fileName).trim();
  const match = cleaned.match(/^0*(\d+)\b/);
  if (!match) return false;
  const leadingNumber = match[1];
  return hints.includes(leadingNumber);
}

function velgPrimaerFilForFullDocument(
  message: string,
  filteredResults: HybridSearchResult[],
  broaderPool: HybridSearchResult[] = [],
): {
  primary: HybridSearchResult;
  overridden: boolean;
  numericHints: string[];
  originalPrimaryFile?: string;
  broadenedPool?: boolean;
} {
  const rerankedTop = filteredResults[0];
  const numericHints = extractNumericHintsFromMessage(message);
  if (numericHints.length === 0) {
    return { primary: rerankedTop, overridden: false, numericHints };
  }

  // Hvis top-resultatet allerede matcher filnavnet → vurder om en annen
  // kandidat har tallet som filnavn-prefiks (f.eks. "2. Lage databasetabeller").
  // Cohere-rerank kan plukke en fil som tilfeldigvis NEVNER tallet — observert
  // i DAT1000 leksjon 2 hvor "3. Likekoblinger ... leksjon 2" vant over
  // "2. Lage databasetabeller". Begge filnavn matcher hint "2", men kun den
  // siste har "2." som prefiks, og er derfor mest sannsynlig brukerens intensjon.
  if (fileNameMatchesNumericHints(rerankedTop.source.fileName, numericHints)) {
    const topStartsWithHint = fileNameStartsWithAnyNumericHint(
      rerankedTop.source.fileName,
      numericHints,
    );
    if (!topStartsWithHint) {
      const startsWithMatch = filteredResults.find(
        (r) =>
          r.source.fileId !== rerankedTop.source.fileId
          && fileNameStartsWithAnyNumericHint(r.source.fileName, numericHints),
      );
      if (startsWithMatch) {
        return {
          primary: startsWithMatch,
          overridden: true,
          numericHints,
          originalPrimaryFile: rerankedTop.source.fileName,
        };
      }
    }
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

  // Utvidet søk i bredere pool når top-kandidatene ikke matcher kapittelnummer.
  // Samme-kurs-filter: vi plukker bare filer fra samme kurs som top-resultatet
  // slik at vi ikke bytter kurs uten brukerens viten.
  const topCourseId = rerankedTop.source.courseId;
  const seenFileIds = new Set<number>(filteredResults.map((r) => r.source.fileId));
  const broadMatch = broaderPool.find(
    (r) =>
      !seenFileIds.has(r.source.fileId) &&
      r.source.courseId === topCourseId &&
      fileNameMatchesNumericHints(r.source.fileName, numericHints),
  );
  if (broadMatch) {
    return {
      primary: broadMatch,
      overridden: true,
      numericHints,
      originalPrimaryFile: rerankedTop.source.fileName,
      broadenedPool: true,
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
      const items = (mod as { items?: Array<{ title?: string }> }).items ?? [];

      // Sjekk om hint treffer enten modulnavn ELLER en item-tittel.
      // For kurs som 6105N organiserer leksjonene som items innenfor
      // Romertall-modulen ("IV. Nettverksprotokoller...") — da er
      // "leksjon 11" aldri i modulnavnet men alltid i item-titler.
      const hintInModName = normalizedModName.includes(normalizedHint);
      const matchingItem = items.find((item) =>
        item.title &&
        normaliserCanvasSporsmal(item.title).includes(normalizedHint),
      );
      if (!hintInModName && !matchingItem) continue;

      // Beregn score basert på item-titler mot meldingen
      let score = hintInModName ? 10 : 20; // Høyere grunnpoeng når item-tittel matcher (mer spesifikt)
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
        moduleName: matchingItem?.title ?? mod.name,
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
 * Henter de neste forelesningene/timetabell-eventene for chat-konteksten.
 * Leser fra per-bruker-bro-cachen som /api/canvas/kalender skriver — hvis den
 * er tom returneres null. Returnerer formatert seksjonstekst klar til å limes
 * inn i `<canvas-kursdata>`.
 */
async function hentKommendeTimerForChat(userId: string): Promise<string | null> {
  try {
    const raw = await getCache(userKey(userId, "kalender", "kommende"));
    if (!raw) return null;
    const items = JSON.parse(raw) as Array<{
      title: string;
      due_at: string;
      end_at?: string | null;
      course_code?: string | null;
      course_name?: string | null;
      location?: string | null;
      source?: string;
    }>;
    if (!Array.isArray(items) || items.length === 0) return null;

    // Skill ekte forelesninger/timer (calendar_events) fra innleveringsfrister
    // (planner-items uten calendar_event-type). Uten separasjon ville modellen
    // svare på «når er neste time?» med en oppgavefrist hvis Canvas blokkerer
    // calendar_events men planner returnerer assignments.
    const formaterLinje = (item: typeof items[number]): string | null => {
      const start = new Date(item.due_at);
      if (Number.isNaN(start.getTime())) return null;
      const dato = start.toLocaleDateString("nb-NO", {
        weekday: "long",
        day: "numeric",
        month: "short",
      });
      const tid = start.toLocaleTimeString("nb-NO", {
        hour: "2-digit",
        minute: "2-digit",
      });
      const sluttDel = item.end_at
        ? `–${new Date(item.end_at).toLocaleTimeString("nb-NO", { hour: "2-digit", minute: "2-digit" })}`
        : "";
      const emne = item.course_code ?? item.course_name ?? "Ukjent emne";
      const sted = item.location ? ` @ ${item.location}` : "";
      return `- ${dato} ${tid}${sluttDel}: ${item.title} (${emne})${sted}`;
    };

    const timeLinjer: string[] = [];
    const fristLinjer: string[] = [];
    for (const item of items.slice(0, 30)) {
      const linje = formaterLinje(item);
      if (!linje) continue;
      if (item.source === "event") {
        timeLinjer.push(linje);
      } else {
        fristLinjer.push(linje);
      }
    }

    const seksjoner: string[] = [];
    if (timeLinjer.length > 0) {
      seksjoner.push(
        `KOMMANDE TIMER OG FORELESNINGER (autoritativ kalenderdata fra Canvas Calendar Events — bruk denne listen direkte når studenten spør om timer/forelesninger/timeplan):\n${timeLinjer.slice(0, 20).join("\n")}`,
      );
    }
    if (fristLinjer.length > 0) {
      seksjoner.push(
        `KOMMANDE INNLEVERINGSFRISTER OG OPPGAVER (fra Canvas Planner — IKKE timer/forelesninger):\n${fristLinjer.slice(0, 20).join("\n")}`,
      );
    }

    if (seksjoner.length === 0) return null;
    return `\n${seksjoner.join("\n\n")}\n`;
  } catch (err) {
    logger.warn({ err, userId }, "Kunne ikke lese per-bruker kalender-bro");
    return null;
  }
}

/**
 * Felles formatter for lett kontekst — brukes av både Redis og MongoDB-fallback.
 * Eliminerer duplikat kontekst-byggingslogikk.
 *
 * `userId` brukes til å slå opp per-bruker kalender-bro (skrives av
 * /api/canvas/kalender). Hvis userId mangler eller cache er tom hopper vi
 * over hendelsesseksjonen i stedet for å feile.
 */
async function formaterLettKontekst(
  emner: LettKontekstEmne[],
  prefs?: CanvasContextPreferences,
  userId?: string,
): Promise<string> {
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

  if ((!prefs || prefs.events) && userId) {
    const kommendeTimer = await hentKommendeTimerForChat(userId);
    if (kommendeTimer) {
      kontekst += kommendeTimer;
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

// MongoDB fallback-hjelpere
/** Nøkkelord som indikerer at brukeren spør om kunngjøringer.
 * Bruker regex for å fange vanlige skrivefeil (f.eks. "kungjøring" uten 'n'). */
const ANNOUNCEMENT_PATTERN = /ku+n{1,2}gj[øo]ring|beskjed|announcements?|nyhet|varsel|endring|notifications?|news|updates?|notice/i;

function isAnnouncementQuery(message: string): boolean {
  return ANNOUNCEMENT_PATTERN.test(message);
}

/**
 * Detekterer spørsmål om timeplan/forelesninger/neste time. Brukes til å
 * injisere kalender-bro-cachen direkte i konteksten — ellers ville hybrid-
 * søket på et ord som "time" matche tilfeldige Java-filer (Pinecone har
 * ingen semantisk forståelse av at "time" her betyr "forelesning").
 */
const TIMETABLE_PATTERN = /\b(neste\s+time|neste\s+forelesn|forelesn|undervisn|timeplan|timene|timer\s+(jeg|mine|i|denne|neste)|mine\s+timer|alle\s+timer|kalender(en)?|agenda|avtaler|når\s+er\s+(min|neste|jeg)|når\s+har\s+jeg|n[åa]r er klassen|next\s+(class|lecture|lesson)|when\s+is\s+(my|the)\s+next|class\s+schedule|lecture\s+schedule|timetable|my\s+(classes|lectures|schedule))\b/i;
export function isTimetableQuery(message: string): boolean {
  return TIMETABLE_PATTERN.test(message);
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

    return await formaterLettKontekst(emner, prefs, userId);
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

    return await formaterLettKontekst(lettEmner, prefs, userId);
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
        // moduleHint matchet ingenting. Uten eksplisitt filhint er kursresultatene
        // sannsynligvis fra feil modul, så la målrettet metadata/on-demand få prøve.
        logger.info(
          {
            userId,
            moduleHint: target.moduleHint,
            fileHint: target.fileHint,
            chunksBeforeFilter: scored.length,
          },
          "Chunk-søk: moduleHint matchet ingen chunks — faller gjennom til målrettet kontekst",
        );
        if (!target.fileHint) return null;
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
  return text
    .toLowerCase()
    // Fjern URL-escape-sekvenser (%XX) og "+" fra eventuelle URL-encodede filnavn
    // slik at tall inne i escape-sekvenser ikke lekker inn i tall-matching.
    .replace(/%[0-9a-f]{2}/g, " ")
    .replace(/\+/g, " ")
    // Norsk tegn-normalisering for kryss-dialekt matching (bokmål ↔ nynorsk).
    // F.eks. "førelesingsnotat" (nynorsk) ↔ "forelesning" (bokmål) — etter ø→o
    // kan stem-matching nedenfor fange "forele"-prefikset i begge former.
    .replace(/ø/g, "o")
    .replace(/å/g, "a")
    .replace(/æ/g, "ae")
    .replace(/[-_]/g, " ")
    // Splitt bokstav↔siffer slik at "Kapittel1.pdf" blir "kapittel 1.pdf"
    // og tall-matchingen nedenfor finner "1" som eget ord.
    .replace(/([a-z])(\d)/g, "$1 $2")
    .replace(/(\d)([a-z])/g, "$1 $2")
    .replace(/\s+/g, " ")
    .trim();
}

/** Sjekker om moduleTitle matcher moduleHint med fleksibel substring-matching */
function modulTitleMatcherHint(moduleTitle: string, hint: string): boolean {
  const normTitle = normaliserModulNavn(moduleTitle);
  const normHint = normaliserModulNavn(hint);

  // Når hint inneholder tall (f.eks. "kapittel 16-18"), krev talloverlapp.
  // Dette hindrer at et generelt ord som "kapittel" matcher feil modul.
  const hintNumbers = normHint.match(/\b\d{1,3}\b/g) ?? [];
  if (hintNumbers.length > 0) {
    const titleNumberStrings = normTitle.match(/\b\d{1,4}\b/g) ?? [];
    const titleNumbers = new Set(titleNumberStrings);
    const hasExactOverlap = hintNumbers.some((num) => titleNumbers.has(num));
    // Aksepter prefix-match når filnavn har sammensatt tall som starter med
    // hint-tallet og slutter med nøyaktig 2 sifre (typisk årssuffiks, f.eks.
    // "Forelesning126.pdf" = forelesning 1 + semester-suffiks 26).
    const hasYearSuffixMatch = hintNumbers.some((num) =>
      titleNumberStrings.some((tnum) =>
        tnum.length === num.length + 2 && tnum.startsWith(num),
      ),
    );
    if (!hasExactOverlap && !hasYearSuffixMatch) return false;
  }

  // Direkte substring-match
  if (normTitle.includes(normHint) || normHint.includes(normTitle)) return true;
  // Ordbasert overlapp: minst halvparten av hint-ordene finnes i tittelen.
  // Stem-matching via 6-tegn prefiks fanger bøyningsvarianter som
  // "forelesning" ↔ "forelesingsnotat" (etter ø→o-normalisering).
  const hintWords = normHint.split(" ").filter((w) => w.length > 2);
  if (hintWords.length === 0) return false;
  const titleTokens = normTitle.split(/\s+/);
  const matchCount = hintWords.filter((w) => {
    if (normTitle.includes(w)) return true;
    if (w.length >= 6) {
      const stem = w.slice(0, 6);
      return titleTokens.some((t) => t.startsWith(stem));
    }
    return false;
  }).length;
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
    // Matcher hint mot BÅDE moduleTitle OG fileName. Mange Canvas-kurs har
    // generiske modulnavn ("Files") mens kapittel-nummer ligger i filnavnet
    // ("Kapittel1.pdf", "Forelesning 2.pdf"). Uten filnavn-matching treffer
    // hint som "kapittel 1" ingenting.
    const moduleMatches = filtered.filter((result) =>
      modulTitleMatcherHint(result.source.moduleTitle, target.moduleHint!)
      || modulTitleMatcherHint(result.source.fileName, target.moduleHint!),
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
          fileNames: results.map((r) => r.source.fileName),
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
  baseUrl?: string,
): Promise<{
  kontekst: string;
  hasSparseChunks: boolean;
  fullDocumentMode: boolean;
  fullDocumentTriggerWord?: string;
  primaryFileId?: number;
  kilder: ContextSource[];
} | null> {
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

    // Kursomfattende oversikt: "forklar forelesningene"/"hva har lectures dekket"
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
      // Referensielle fraser peker til tidligere samtale og SKAL IKKE trigge
      // kursomfattende oversikt. Uten denne sjekken laster "begge leksjonene"
      // alle 27 kursfiler i stedet for å la modellen bruke samtaletråden til
      // å plukke ut de to nevnte i forrige tur. Lista må holdes i sync med
      // REFERENTIAL_PATTERN i ki.ts (samme semantikk, litt annen form — her
      // brukes includes() i stedet for regex).
      const REFERENTIAL_PHRASES = [
        "begge", "den første", "den andre", "de to", "disse", "dem",
        "den ene", "den over", "over nevnte", "ovennevnte", "nevnte ovenfor",
        "both of them", "both lessons", "the two", "those", "these",
        "svaret ditt", "forrige svar", "det du sa", "det du skrev",
        "utdype svaret", "utdyp svaret", "fortsett", "forklar mer",
        "gi mer detaljer", "mer om dette", "mer om det", "kan du utdype",
      ];
      const isReferential = REFERENTIAL_PHRASES.some((p) => lowerMsg.includes(p));
      const matchesCourseWide =
        !isReferential && COURSE_WIDE_TRIGGERS.some((t) => lowerMsg.includes(t));
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
          const courseNameForBlock =
            relevantCourses.find((c) => String(c.id) === courseIdStr)?.name ?? "";
          for (const doc of allDocs) {
            if (totalChars >= TOTAL_BUDGET) break;
            const remaining = TOTAL_BUDGET - totalChars;
            const slice = doc.fullText.slice(0, Math.min(perFileBudget, remaining));
            blocks.push(
              `--- FIL-INNHOLD: [Kurs: ${courseIdStr} - ${courseNameForBlock}] ${doc.fileName}${doc.moduleTitle ? ` (${doc.moduleTitle})` : ""} ---\n${slice}\n--- SLUTT ---`,
            );
            totalChars += slice.length;
            kilder.push({
              courseId: courseIdStr,
              courseName: relevantCourses.find((c) => String(c.id) === courseIdStr)?.name ?? "",
              fileId: doc.fileId,
              fileName: doc.fileName,
              score: 1,
              chunkCount: 1,
              ...(doc.externalUrl ? { sourceUrl: doc.externalUrl } : {}),
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
          await backfillMissingSourceUrls(userId, kilder, baseUrl);
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

    // Når moduleHint filtrerte bort alle resultater uten at brukeren pekte på
    // en konkret fil, er samme-kurs-treffene sannsynligvis fra feil modul.
    // Returner null slik at caller kan gå videre til metadata/on-demand.
    if (filterResult.moduleHintMissed && !target?.fileHint) {
      logger.info(
        { userId, moduleHint: target?.moduleHint, unfilteredCount: results.length, messagePreview: message.substring(0, 80) },
        "Hybrid søk: moduleHint ga ingen treff — faller gjennom til målrettet kontekst",
      );
      return null;
    }

    const filteredResults = filterResult.results;
    if (filteredResults.length === 0) {
      logger.info(
        { userId, messagePreview: message.substring(0, 80) },
        "Hybrid søk: alle resultater filtrert bort av target-hints",
      );
      return null;
    }

    // Full dokument-mode
    const fullDocumentDecision = shouldUseFullDocumentMode(
      message,
      target,
      filteredResults,
      moduleHintMissedOriginal,
    );
    if (fullDocumentDecision.enabled) {
      const primarySelection = velgPrimaerFilForFullDocument(
        message,
        filteredResults,
        results,
      );
      let primary = primarySelection.primary;
      if (primarySelection.overridden) {
        logger.info(
          {
            numericHints: primarySelection.numericHints,
            originalPrimaryFile: primarySelection.originalPrimaryFile,
            selectedPrimaryFile: primary.source.fileName,
            selectedFileId: primary.source.fileId,
            broadenedPool: primarySelection.broadenedPool ?? false,
            reason: "filename_matches_numeric_hint",
          },
          "Full dokument-mode: primærfil overstyrt basert på filnavn-match",
        );
      }

      // Siste fallback: når retrieval (både filtered og broader pool) ikke fant
      // en fil med filnavn som matcher den numeriske hintet, skan hele
      // kurs-filkatalogen direkte. Fanger tilfeller der Kap 1-filen ikke er i
      // top-N BM25/vektor-resultater fordi innholdet ikke nevner "forelesning"
      // sterkt nok — vi ender med feil fil (assignment/emneplan) som primær.
      // Triggers også når moduleHint er null (f.eks. ved skrivefeil i brukerens
      // melding) så lenge ordinal-ekstraksjon fant et tall, siden intensjonen om
      // N-te forelesning er eksplisitt signalisert.
      //
      // Hopper over hvis primary ALLEREDE matcher numeric hint i filnavnet —
      // uten denne sjekken ville en tilfeldig katalog-fil kunne overstyre en
      // korrekt top-rerank (overridden=false fordi rerank var allerede riktig).
      const primaryAlreadyMatches = fileNameMatchesNumericHints(
        primary.source.fileName,
        primarySelection.numericHints,
      );
      if (
        !primarySelection.overridden
        && !primaryAlreadyMatches
        && primarySelection.numericHints.length > 0
      ) {
        const courseId = primary.source.courseId;
        const allCourseFiles = await getAllFullDocumentsForCourse(userId, courseId);

        // Steg 1: Filnavn-basert numerisk match (f.eks. "Kapittel 1" matcher hint "1").
        // Velger mellom flere treff ved å foretrekke fil hvis navn inneholder samme
        // modul-nøkkelord som brukeren brukte (f.eks. "forelesning").
        const numericMatches = allCourseFiles.filter((f) =>
          fileNameMatchesNumericHints(f.fileName, primarySelection.numericHints),
        );

        // Deprioriter øvelse-/fasit-/oppgave-filer når brukeren ikke eksplisitt
        // ber om det. Uten denne sjekken kan "oppsummere leksjon 3" plukke
        // "Leksjon 3_Øvelse.pdf" i stedet for "3_Generics.pdf" (hovedmaterialet).
        // Canvas-filnavn er ofte URL-encoded (Leksjon+3_%C3%98velse.pdf) — må
        // decodes før tegnsubstitusjon, ellers matcher ikke "ø"→"o".
        const EXERCISE_FILE_PATTERN = /\b(oving|ovelse|ovning|oppgave|oppgaver|fasit|losning|losningsforslag|solution|exercise)\b/i;
        const normalizeForMatch = (s: string) => {
          let decoded = s;
          try {
            decoded = decodeURIComponent(s.replace(/\+/g, " "));
          } catch {
            // Ugyldig URI-sekvens — behold original
          }
          // Underscore er et word-tegn i regex — erstatt med mellomrom så
          // `\bovelse\b` treffer i navn som "Leksjon_3_Øvelse.pdf".
          return decoded.toLowerCase().replace(/ø/g, "o").replace(/_/g, " ");
        };
        const userWantsExerciseFile = target?.moduleHint
          ? EXERCISE_FILE_PATTERN.test(normalizeForMatch(target.moduleHint))
          : false;
        const isExerciseFile = (name: string) =>
          EXERCISE_FILE_PATTERN.test(normalizeForMatch(name));
        const preferredMatches = userWantsExerciseFile
          ? numericMatches
          : numericMatches.filter((f) => !isExerciseFile(f.fileName));
        // Hvis filtreringen fjernet alle treff (kurset har bare øvelse-filer),
        // fall tilbake til originallista for ikke å miste match helt.
        const candidates = preferredMatches.length > 0 ? preferredMatches : numericMatches;

        let catalogMatch = candidates[0];
        let catalogMatchReason: "numeric_filename" | "date_sorted_nth" | null =
          catalogMatch ? "numeric_filename" : null;

        if (candidates.length > 1 && target?.moduleHint) {
          const moduleHintLower = normalizeForMatch(target.moduleHint);
          // Brukerens terminologi (leksjon/kapittel/forelesning/modul) skal
          // behandles som utskiftbar. Når noen spør om "leksjon 2" mener de
          // det primære pensumet for seksjon 2 — uansett om fila heter
          // "Kapittel 2", "Forelesning 2" eller "Notat 2". Uten denne
          // likhetsbehandlingen valgte scanneren feil fil for MET1020
          // "leksjon 2" (se logg fra 2026-04-21): "2. Kunstig intelligens
          // og fusk.page" vant over "Førelesingsnotat Kapittel 1 og 2.pptx"
          // fordi ingen av dem inneholdt "leksjon" — scanneren falt tilbake
          // til lexical first-match.
          const hintIsLectureQuery = /\b(forele|kapit|modul|leksjon|lesson|uke|week|tema|seksj|forelesing)/.test(moduleHintLower);
          const LECTURE_STEMS = ["forele", "kapit", "modul", "leksjon", "lesson", "notat", "pensum", "forelesing"];
          // Velg kandidat som har et lecture-keyword i navnet — uansett om
          // det er samme ord som brukeren brukte.
          if (hintIsLectureQuery) {
            const typed = candidates.find((f) => {
              const name = normalizeForMatch(f.fileName);
              return LECTURE_STEMS.some((stem) => name.includes(stem));
            });
            if (typed) catalogMatch = typed;
          }

          // Tilleggs-prioritering: når brukeren spør om en forelesning,
          // foretrekk faktiske forelesnings-filtyper (.pptx/.pdf) over
          // Canvas-wrappere (.page/.assignment). Wrappers har ofte bare
          // intro/læringsmål — ikke det selve studenten vil ha.
          if (hintIsLectureQuery && catalogMatch) {
            const WRAPPER_EXTENSIONS = /\.(page|assignment|quiz)$/i;
            const RICH_EXTENSIONS = /\.(pptx?|pdf|docx?)$/i;
            const currentIsWrapper = WRAPPER_EXTENSIONS.test(catalogMatch.fileName);
            if (currentIsWrapper) {
              const richAlt = candidates.find(
                (f) => RICH_EXTENSIONS.test(f.fileName)
                  && LECTURE_STEMS.some((stem) => normalizeForMatch(f.fileName).includes(stem)),
              );
              if (richAlt) catalogMatch = richAlt;
            }
          }
        }

        // Steg 2: Dato-basert N-te forelesning for kurs med dato-navngitte filer
        // (f.eks. "Forelesning13012026.pdf"). Aktiveres kun når filnavn-matching
        // feilet OG brukerens moduleHint refererer til en forelesning.
        if (!catalogMatch && target?.moduleHint) {
          const moduleHintLower = normalizeForMatch(target.moduleHint);
          const isLectureQuery = /forele|lecture/.test(moduleHintLower);
          if (isLectureQuery) {
            const ordinalIndex = parseInt(primarySelection.numericHints[0], 10);
            if (!Number.isNaN(ordinalIndex) && ordinalIndex >= 1 && ordinalIndex <= 30) {
              const nth = finnNteForelesningFraKatalog(allCourseFiles, ordinalIndex);
              if (nth) {
                catalogMatch = nth;
                catalogMatchReason = "date_sorted_nth";
              }
            }
          }
        }

        // Richness-guard: ikke overstyr primærfil med en tom wrapper-fil.
        // Canvas lagrer ofte "Pages" som 100-300 tegn metadata (lenker til
        // eksterne PDF-er) mens den faktiske forelesningsteksten ligger i
        // crawlede PDF-er eller pptx-er. Hvis vi blindt bytter til wrappere
        // bare fordi filnavnet matcher tallet, ender vi med å gi AI ~200 tegn
        // og må fallbacke til supplement-filer — som ofte er eksamensfiler
        // eller urelatert innhold fra samme kurs.
        //
        // Observert: "forklar leksjon 1" i WEB1100 overstyrte en 10k+-tegn
        // eksamensfil (feil originalvalg fra hybrid-søk, men minst med reell
        // tekst) med en 217-tegns "PENSUM - Forelesning 1 - Del 1"-wrapper.
        // AI fikk dermed praktisk talt ingen forelesningstekst å jobbe med.
        //
        // Hvis katalogmatchen har lite innhold, behold opprinnelig primær
        // og la supplement-fasen eventuelt berike med katalogtreffet i
        // stedet (der det ikke går på bekostning av primær-rikdom).
        const CATALOG_MATCH_MIN_CHARS = 1500;
        const catalogHasRichContent =
          catalogMatch && catalogMatch.charCount >= CATALOG_MATCH_MIN_CHARS;
        if (catalogMatch && catalogMatch.fileId !== primary.source.fileId && catalogHasRichContent) {
          logger.info(
            {
              numericHints: primarySelection.numericHints,
              originalPrimaryFile: primary.source.fileName,
              catalogMatchFile: catalogMatch.fileName,
              catalogMatchFileId: catalogMatch.fileId,
              catalogMatchChars: catalogMatch.charCount,
              reason: catalogMatchReason,
            },
            "Full dokument-mode: primærfil overstyrt fra kurs-katalog-skanning",
          );
          primary = {
            ...primary,
            source: {
              ...primary.source,
              fileId: catalogMatch.fileId,
              fileName: catalogMatch.fileName,
              moduleTitle: catalogMatch.moduleTitle,
            },
          };
        } else if (catalogMatch && !catalogHasRichContent) {
          // Tom wrapper hoppet over — men la oss IKKE blindt falle tilbake
          // til opprinnelig primary, som ofte er en eksamensfil eller
          // urelatert innhold (rerank velger semantisk likhet, ikke
          // kapittel-match).
          //
          // Steg A: rikere kandidat i samme numeric-match-pool (f.eks. en
          // annen "Kapittel 3"-fil i kurset).
          //
          // Steg B: hvis primary er en eksamensfil og brukeren ikke spurte
          // om eksamen, prøv å finne en pensum-/forelesningsfil i hybrid-
          // søk-resultatene (de er allerede semantisk relevante for
          // spørringen). Eksempel observert (2026-04-25): "WEB1100 leksjon 3"
          // → wrapper "F5 - Kapittel 3.pptx" (331 tegn) hoppet over →
          // primary fra rerank = "Eksamen WEB1100 2024 Høst Kont.docx" →
          // svaret handlet om eksamensoppgaver, ikke leksjonsinnhold.
          // Fix: promoter "Introduksjon til HTML og CSS.pptx" (også fra
          // hybrid-treff, men ikke eksamensmodul).
          const richerCandidate = candidates.find(
            (f) =>
              f.fileId !== catalogMatch!.fileId
              && f.fileId !== primary.source.fileId
              && f.charCount >= CATALOG_MATCH_MIN_CHARS,
          );

          let nonExamHit: HybridSearchResult | null = null;
          if (!richerCandidate) {
            const moduleHintLower = (target?.moduleHint ?? "").toLowerCase();
            const userAskedForExam = /\b(eksamen|exam|kont|prøvee|provee)/.test(moduleHintLower);
            const looksLikeExam = (s: string) =>
              /\b(eksamen|exam|kont|prøvee|provee|tidligere)\b/i.test(s);
            const primaryLooksLikeExam =
              looksLikeExam(primary.source.fileName ?? "")
              || looksLikeExam(primary.source.moduleTitle ?? "");
            if (primaryLooksLikeExam && !userAskedForExam) {
              const charCountByFileId = new Map(
                allCourseFiles.map((f) => [f.fileId, f.charCount] as const),
              );
              nonExamHit = filteredResults.find((r) => {
                if (r.source.fileId === primary.source.fileId) return false;
                if (looksLikeExam(r.source.fileName)) return false;
                if (looksLikeExam(r.source.moduleTitle)) return false;
                const chars = charCountByFileId.get(r.source.fileId) ?? 0;
                return chars >= CATALOG_MATCH_MIN_CHARS;
              }) ?? null;
            }
          }

          if (richerCandidate) {
            logger.info(
              {
                skippedThinFile: catalogMatch.fileName,
                skippedFileChars: catalogMatch.charCount,
                promotedFile: richerCandidate.fileName,
                promotedFileChars: richerCandidate.charCount,
                threshold: CATALOG_MATCH_MIN_CHARS,
                originalPrimary: primary.source.fileName,
              },
              "Katalog-promotering: tom wrapper hoppet over til fordel for rikere kandidat med samme nummer-match",
            );
            primary = {
              ...primary,
              source: {
                ...primary.source,
                fileId: richerCandidate.fileId,
                fileName: richerCandidate.fileName,
                moduleTitle: richerCandidate.moduleTitle,
              },
            };
          } else if (nonExamHit) {
            logger.info(
              {
                skippedThinFile: catalogMatch.fileName,
                skippedFileChars: catalogMatch.charCount,
                originalPrimary: primary.source.fileName,
                originalPrimaryModule: primary.source.moduleTitle,
                promotedFile: nonExamHit.source.fileName,
                promotedFileModule: nonExamHit.source.moduleTitle,
                reason: "primary_was_exam_user_asked_for_lesson",
              },
              "Hybrid-søk-promotering: eksamensfil byttet ut med ikke-eksamen-treff fra rerank",
            );
            primary = {
              ...primary,
              source: {
                ...primary.source,
                fileId: nonExamHit.source.fileId,
                fileName: nonExamHit.source.fileName,
                moduleTitle: nonExamHit.source.moduleTitle,
              },
            };
          } else {
            logger.info(
              {
                catalogMatchFile: catalogMatch.fileName,
                catalogMatchFileId: catalogMatch.fileId,
                catalogMatchChars: catalogMatch.charCount,
                threshold: CATALOG_MATCH_MIN_CHARS,
                keptPrimary: primary.source.fileName,
              },
              "Hopper over katalog-override: match er en tom wrapper/metadata-fil og ingen rikere kandidat funnet",
            );
          }
        }
      }

      let fullDocument = await getStoredFullDocumentForFile(
        userId,
        primary.source.courseId,
        primary.source.fileId,
      );

      // Primærfil-berikning: Canvas-sider fungerer ofte som kun "wrappere"
      // med læringsmål/intro, mens det faktiske innholdet ligger i filer som
      // crawleren har indeksert fra eksterne URL-er (f.eks. PDFer på
      // windowsnett.no for 6105N). Semantisk rerank velger ofte wrapper-siden
      // fordi tittelen matcher perfekt, men resultatet for studenten blir
      // svært magert (<2k tegn). Hvis primæren er liten og retrieval har
      // pekt på en vesentlig rikere fil i samme kurs, promoter vi den.
      //
      // Kritisk: når brukeren har spesifisert et kapittel-/leksjonsnummer
      // ("leksjon 9"), må rikere kandidat matche samme nummer. Uten dette
      // filteret ble "Leksjon 9 Web HTTP IIS" (2239 tegn wrapper) promotert
      // til "Laboving 11b DNS tjener.pdf" (16979 tegn, feil leksjon) — rik
      // og fra samme kurs, men semantisk ubeslektet. Numeric-filter kjører
      // FØR DB-probe så vi ikke sløser DB-hits på filer som uansett ville
      // blitt filtrert bort.
      if (
        fullDocument
        && fullDocument.charCount < MIN_RICH_PRIMARY_CHARS
      ) {
        const candidateFileIds = new Set<number>();
        const allCandidates: HybridSearchResult[] = [];
        for (const pool of [filteredResults, results]) {
          for (const r of pool) {
            if (r.source.fileId === primary.source.fileId) continue;
            if (r.source.courseId !== primary.source.courseId) continue;
            if (candidateFileIds.has(r.source.fileId)) continue;
            candidateFileIds.add(r.source.fileId);
            allCandidates.push(r);
          }
        }

        const intentFilteredCandidates =
          primarySelection.numericHints.length > 0
            ? allCandidates.filter((c) =>
                fileNameMatchesNumericHints(
                  c.source.fileName,
                  primarySelection.numericHints,
                ),
              )
            : allCandidates;

        const candidates = intentFilteredCandidates.slice(
          0,
          MAX_RICHNESS_PROBES,
        );

        const probed: Array<{ candidate: HybridSearchResult; doc: NonNullable<typeof fullDocument>; charCount: number }> = [];
        for (const candidate of candidates) {
          const doc = await getStoredFullDocumentForFile(
            userId,
            candidate.source.courseId,
            candidate.source.fileId,
          );
          if (!doc) continue;
          probed.push({ candidate, doc, charCount: doc.charCount });
        }

        const richest = pickRicherPrimaryCandidate({
          primaryCharCount: fullDocument.charCount,
          candidates: probed,
        });

        if (richest) {
          logger.info(
            {
              originalPrimaryFile: fullDocument.fileName,
              originalPrimaryChars: fullDocument.charCount,
              promotedFile: richest.doc.fileName,
              promotedChars: richest.doc.charCount,
              reason: "primary_too_thin_promoted_richer_same_course_file",
            },
            "Full dokument-mode: primærfil overstyrt fra tynn wrapper til rikere fil i samme kurs",
          );
          primary = {
            ...primary,
            source: {
              ...primary.source,
              fileId: richest.candidate.source.fileId,
              fileName: richest.doc.fileName,
              moduleTitle: richest.candidate.source.moduleTitle ?? primary.source.moduleTitle,
            },
          };
          fullDocument = richest.doc;
        }
      }

      if (fullDocument) {
        // 22 000 tokens = ~88 000 tegn injection-budsjett. Dekker det aller meste
        // av lange forelesningsnotater (~80 000–86 000 tegn) uten å ofre Claude-
        // responstid eller kostnad nevneverdig. Hardt tak holder oss innenfor
        // model-kontekstvinduet selv med full system prompt + chat-historikk.
        const maxTokens = 22000;
        const estimatedChars = maxTokens * 4;
        const truncatedFullText = fullDocument.fullText.slice(0, estimatedChars);
        // Med chunked fullText-lagring kan ikke storage-truncation skje i
        // praksis (`fullText.length` skal alltid være lik `charCount`). Vi
        // beholder sjekken som safeguard mot eldre data eller edge cases.
        // `injectionTruncated` derimot er fortsatt relevant — Claude har
        // begrenset kontekstvindu, så svært store filer må kuttes på vei inn.
        const storageTruncated = fullDocument.fullText.length < fullDocument.charCount;
        const injectionTruncated = truncatedFullText.length < fullDocument.fullText.length;
        const truncated = storageTruncated || injectionTruncated;

        // Når hoveddokumentet er lite (typisk PowerPoint med kulepunkter),
        // berik konteksten med andre filer fra samme modul
        const MIN_FULL_DOC_CHARS = 6000;
        let supplementBlock = "";
        const supplementSources: ContextSource[] = [];
        const seenFileIds = new Set<number>([primary.source.fileId]);
        const supplementBudget = estimatedChars - truncatedFullText.length;

        if (truncatedFullText.length < MIN_FULL_DOC_CHARS && target?.moduleHint) {
          const otherFilesInModule = filteredResults.filter(
            (r) => r.source.fileId !== primary.source.fileId,
          );
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
              // Eksponer supplement-filer som kilder i UI. Uten dette
              // viser "Kilder"-panelet kun primary, selv om svaret bruker
              // innhold fra flere filer (f.eks. Leksjon 1 + Leksjon 2).
              supplementSources.push({
                courseId: String(other.source.courseId),
                courseName: other.source.courseName ?? "",
                fileId: other.source.fileId,
                fileName: otherFullDoc.fileName,
                score: other.score,
                chunkCount: 1,
              });
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

        // Multi-hint katalog-enrichment: når brukeren ber om flere kapitler/leksjoner
        // samtidig (f.eks. "kap 1 og 2"), primary dekker kun ett hint. Skan katalogen
        // direkte for hints som ikke matcher primary OG ikke allerede er lastet via
        // hybrid-søket. Uten dette får AI kun ett av flere etterspurte dokumenter
        // fordi retrieval ikke garantert plukker opp alle relevante filer.
        const numericHints = primarySelection.numericHints;
        if (numericHints.length > 1 && supplementBlock.length < supplementBudget) {
          const primaryMatchesHints = numericHints.filter((h) =>
            fileNameMatchesNumericHints(primary.source.fileName, [h]),
          );
          const unmatchedHints = numericHints.filter(
            (h) => !primaryMatchesHints.includes(h),
          );
          if (unmatchedHints.length > 0) {
            const courseId = String(primary.source.courseId);
            const allCourseFiles = await getAllFullDocumentsForCourse(userId, courseId);
            for (const hint of unmatchedHints) {
              if (supplementBlock.length >= supplementBudget) break;
              const matches = allCourseFiles.filter((f) =>
                fileNameMatchesNumericHints(f.fileName, [hint]),
              );
              // Foretrekk filer som matcher moduleHint-nøkkelordet (forele/kapit/leksjon/…)
              // når flere filer matcher samme numeriske hint.
              let chosen = matches[0];
              if (matches.length > 1 && target?.moduleHint) {
                const moduleHintLower = target.moduleHint.toLowerCase().replace(/ø/g, "o");
                const keywordStem = moduleHintLower.match(/\b(forele|kapit|modul|leksjon|lesson|uke|week|tema|seksj)/)?.[1];
                if (keywordStem) {
                  const typed = matches.find((f) =>
                    f.fileName.toLowerCase().replace(/ø/g, "o").includes(keywordStem),
                  );
                  if (typed) chosen = typed;
                }
              }
              if (!chosen || seenFileIds.has(chosen.fileId)) continue;
              seenFileIds.add(chosen.fileId);
              const remaining = supplementBudget - supplementBlock.length;
              const addedText = chosen.fullText.slice(0, remaining);
              supplementBlock += `\n--- FIL-INNHOLD (SUPPLERENDE): ${chosen.fileName} ---\n${addedText}\n--- SLUTT SUPPLERENDE ---\n`;
              supplementSources.push({
                courseId,
                courseName: primary.source.courseName ?? "",
                fileId: chosen.fileId,
                fileName: chosen.fileName,
                score: primary.score,
                chunkCount: 1,
              });
              logger.info(
                {
                  hint,
                  addedFile: chosen.fileName,
                  addedChars: addedText.length,
                },
                "Full dokument-mode: la til fil fra katalog for uoppnådd numerisk hint",
              );
            }
          }
        }

        // Intent-berikning: når brukeren ber om én leksjon/kapittel, finnes
        // ofte flere filer for samme leksjon (f.eks. "Leksjon 9 beskrivelse"
        // + "Laboving 9a" + "Laboving 9b" for Windows-emnet). Kombiner dem
        // slik at oppsummeringen dekker hele leksjonen, ikke bare én fil.
        // Filteret holder ubeslektede tykke filer ute (f.eks. lærebok-PDF
        // som dekker alle leksjoner — ingen spesifikk "9" i navnet).
        // Scanner både rerank-top (filteredResults) og bredere hybrid-pool
        // (results) slik at intent-matchende filer under rerank-grensen
        // fortsatt fanges opp.
        const MAX_INTENT_SUPPLEMENTS = 3;
        if (
          numericHints.length > 0
          && supplementBlock.length < supplementBudget
        ) {
          const intentMatchingOthers: HybridSearchResult[] = [];
          const addedForSupplement = new Set<number>(seenFileIds);
          for (const pool of [filteredResults, results]) {
            for (const r of pool) {
              if (addedForSupplement.has(r.source.fileId)) continue;
              if (r.source.fileId === primary.source.fileId) continue;
              if (r.source.courseId !== primary.source.courseId) continue;
              if (
                !fileNameMatchesNumericHints(
                  r.source.fileName,
                  numericHints,
                )
              ) {
                continue;
              }
              addedForSupplement.add(r.source.fileId);
              intentMatchingOthers.push(r);
            }
          }
          let addedCount = 0;
          for (const other of intentMatchingOthers) {
            if (addedCount >= MAX_INTENT_SUPPLEMENTS) break;
            if (supplementBlock.length >= supplementBudget) break;
            const otherFullDoc = await getStoredFullDocumentForFile(
              userId,
              other.source.courseId,
              other.source.fileId,
            );
            if (!otherFullDoc) continue;
            seenFileIds.add(other.source.fileId);
            const remaining = supplementBudget - supplementBlock.length;
            const otherText = otherFullDoc.fullText.slice(0, remaining);
            supplementBlock += `\n--- FIL-INNHOLD (SUPPLERENDE): ${otherFullDoc.fileName} ---\n${otherText}\n--- SLUTT SUPPLERENDE ---\n`;
            supplementSources.push({
              courseId: String(other.source.courseId),
              courseName: other.source.courseName ?? "",
              fileId: other.source.fileId,
              fileName: otherFullDoc.fileName,
              score: other.score,
              chunkCount: 1,
              ...(otherFullDoc.externalUrl
                ? { sourceUrl: otherFullDoc.externalUrl }
                : {}),
            });
            addedCount += 1;
            logger.info(
              {
                addedFile: otherFullDoc.fileName,
                addedChars: otherText.length,
                primaryFile: fullDocument.fileName,
                numericHints,
              },
              "Full dokument-mode: la til intent-matchende fil for samme leksjon/kapittel",
            );
          }
        }

        const primaryCourseLabel =
          `[Kurs: ${primary.source.courseId}${primary.source.courseName ? ` - ${primary.source.courseName}` : ""}]`;
        const kontekst =
          "<canvas-kursdata>\n" +
          `--- FIL-INNHOLD (FULLT DOKUMENT): ${primaryCourseLabel} ${fullDocument.fileName} ---\n` +
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
            storedChars: fullDocument.fullText.length,
            injectedChars: truncatedFullText.length,
            totalContextChars: kontekst.length,
            truncated,
            storageTruncated,
            injectionTruncated,
            reason: fullDocumentDecision.reason,
          },
          "Full dokument-mode aktivert",
        );
        // Ekstra synlig varsel når lagringen allerede har kuttet filen —
        // dette betyr at noen deler av filen aldri vil nå fram til KI
        // uansett hvor stort injection-budsjett vi har.
        if (storageTruncated) {
          logger.warn(
            {
              fileId: primary.source.fileId,
              fileName: fullDocument.fileName,
              originalChars: fullDocument.charCount,
              storedChars: fullDocument.fullText.length,
              lostChars: fullDocument.charCount - fullDocument.fullText.length,
            },
            "Full-dokument-mode: lagret tekst er kortere enn original — filen må re-indekseres for å få hele innholdet",
          );
        }
        // Injection-truncation er en separat, stille risiko: filen ble lagret
        // komplett, men overskred injection-budsjettet og ble kuttet på vei inn
        // til modellen. Modellen avslutter naturlig (end_turn), så brukeren
        // merker ingenting — men spørsmål om innhold i de kuttede tegnene får
        // ufullstendig svar. Telemetri brukes til å vurdere om injection-
        // budsjettet er for stramt for enkelte filtyper/kurs.
        // (Logges kun hvis storage-truncation IKKE allerede dekket scenarioet.)
        if (injectionTruncated && !storageTruncated) {
          logger.warn(
            {
              fileId: primary.source.fileId,
              fileName: fullDocument.fileName,
              storedChars: fullDocument.fullText.length,
              injectedChars: truncatedFullText.length,
              lostChars: fullDocument.fullText.length - truncatedFullText.length,
            },
            "Full-dokument-mode: injection-budsjett kuttet filen — innhold på slutten nådde aldri modellen",
          );
        }

        const primaryExternalUrl =
          fullDocument.externalUrl ?? primary.source.externalUrl;
        const fullDocKilder: ContextSource[] = [
          {
            courseId: String(primary.source.courseId),
            courseName: primary.source.courseName ?? "",
            fileId: primary.source.fileId,
            fileName: fullDocument.fileName,
            score: primary.score,
            chunkCount: 1,
            ...(primaryExternalUrl ? { sourceUrl: primaryExternalUrl } : {}),
          },
          ...supplementSources,
        ];
        await backfillMissingSourceUrls(userId, fullDocKilder, baseUrl);
        return {
          kontekst,
          hasSparseChunks: false,
          fullDocumentMode: true,
          ...(fullDocumentDecision.triggerWord
            ? { fullDocumentTriggerWord: fullDocumentDecision.triggerWord }
            : {}),
          primaryFileId: primary.source.fileId,
          kilder: fullDocKilder,
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

    // Sparsity-sjekk på chunks
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

    // File-aware context expansion
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
        ...(info.source.externalUrl ? { sourceUrl: info.source.externalUrl } : {}),
      }))
      .filter((k) => k.fileName.length > 0)
      .sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
      .slice(0, 8);

    await backfillMissingSourceUrls(userId, kilder, baseUrl);

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

// On-demand filhenting
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

// Hovedfunksjoner
/**
 * Finner FileExtractionStatus-rader som matcher target.fileHint/moduleHint
 * innenfor brukerens kurs-scope. Brukes til å injisere et SYSTEM-NOTAT
 * når brukeren spør om en fil vi vet ikke kan indekseres (bilde-basert PPTX
 * o.l.) — slik at KI-en kan gi deterministisk "last opp manuelt"-beskjed
 * istedenfor å prøve å gjette fra supplement-materiell.
 *
 * Design-valg:
 * - Krever target.courseIdHint for å unngå cross-course støy.
 * - Match fileHint mot fileName direkte (titleMatchesFileHint).
 * - Match moduleHint mot moduleTitle (modulTitleMatcherHint) OG mot
 *   fileName via numeric hints ("leksjon 1" → filer med "F1" o.l.).
 */
async function finnMatchendeEkstraksjonsFeil(
  userId: string,
  target: TargetedQuery | undefined,
): Promise<IFileExtractionStatus[]> {
  if (!target) return [];
  if (!target.fileHint && !target.moduleHint) return [];
  if (target.courseIdHint == null) return [];

  const failures = await getExtractionFailuresForCourses(userId, [
    String(target.courseIdHint),
  ]);
  if (failures.length === 0) return [];

  const matched = new Map<number, IFileExtractionStatus>();

  if (target.fileHint) {
    for (const f of failures) {
      if (titleMatchesFileHint(f.fileName, target.fileHint)) {
        matched.set(f.fileId, f);
      }
    }
  }

  if (target.moduleHint) {
    const numHints = extractNumericHintsFromMessage(target.moduleHint);
    for (const f of failures) {
      if (matched.has(f.fileId)) continue;
      const moduleMatches =
        !!f.moduleTitle && modulTitleMatcherHint(f.moduleTitle, target.moduleHint);
      const numMatches =
        numHints.length > 0 && fileNameMatchesNumericHints(f.fileName, numHints);
      if (moduleMatches || numMatches) {
        matched.set(f.fileId, f);
      }
    }
  }

  return [...matched.values()];
}

/**
 * Bygger SYSTEM-NOTAT-blokken som forteller KI-en hvilke filer som enten
 * mangler innhold helt eller kun har partielt innhold. Returnerer tom streng
 * når listen er tom.
 *
 * Skiller mellom:
 *   - "sparse"           → filen er indeksert men har lite tekst (bilde-tung)
 *   - alle andre statuser → filen ble ikke indeksert i det hele tatt
 */
function byggEkstraksjonsFeilNotat(failures: IFileExtractionStatus[]): string {
  if (failures.length === 0) return "";

  const sparse = failures.filter((f) => f.status === "sparse");
  const uleselige = failures.filter((f) => f.status !== "sparse");

  const blokker: string[] = [];

  if (uleselige.length > 0) {
    const linjer = uleselige.map((f) => {
      const modulDel = f.moduleTitle ? `, modul: "${f.moduleTitle}"` : "";
      const grunn = f.reason ?? "ukjent grunn";
      return `- "${f.fileName}" (kurs: "${f.courseName}"${modulDel}) — ${grunn}`;
    });
    blokker.push(
      [
        "",
        "<system-notat-filer-uten-innhold>",
        "Følgende fil(er) finnes i Canvas-kursstrukturen, men innholdet kunne IKKE leses av systemet (typisk bilde-basert PowerPoint, korrupt fil, eller uspøttet format):",
        ...linjer,
        "",
        "Instruksjon til KI:",
        "- Ikke lat som du kjenner innholdet i disse filene.",
        "- Fortell brukeren konkret at filen(e) finnes i Canvas, men at innholdet ikke kunne indekseres automatisk (typisk fordi slidene er bilder istedenfor tekst).",
        "- Anbefal brukeren å laste filen(e) opp manuelt i Kunnskapsbasen (Dashboard → Kunnskapsbase) for å aktivere KI-støtte på innholdet.",
        "- Hvis du har støttemateriell fra samme kurs (andre leksjoner, eksamener, sensorveiledning), kan du fortsatt bruke det — men vær tydelig på at det ikke erstatter selve filen.",
        "- VIKTIG: IKKE lag tabell eller liste over hvilke ANDRE filer/kapitler som er 'tilgjengelige' eller 'ikke tilgjengelige'. Du har kun ekstraksjonsstatus for filen(e) over — alle andre filer i kurset er UKJENT for deg på det punktet. Si heller 'Du kan spørre om andre kapitler/leksjoner i samme emne, så sjekker jeg om jeg har innhold for dem' istedenfor å gjette.",
        "</system-notat-filer-uten-innhold>",
        "",
      ].join("\n"),
    );
  }

  if (sparse.length > 0) {
    const linjer = sparse.map((f) => {
      const modulDel = f.moduleTitle ? `, modul: "${f.moduleTitle}"` : "";
      const grunn = f.reason ?? "partiell ekstraksjon";
      return `- "${f.fileName}" (kurs: "${f.courseName}"${modulDel}) — ${grunn}`;
    });
    blokker.push(
      [
        "",
        "<system-notat-filer-med-partielt-innhold>",
        "Følgende fil(er) er indeksert, men kun en liten del av innholdet er tilgjengelig som tekst (typisk bilde-tung PowerPoint der bare slide-titler og fottekst er lesbart):",
        ...linjer,
        "",
        "Instruksjon til KI:",
        "- Innholdet du har tilgang til fra disse filene er ufullstendig — bruk det, men vær transparent om begrensningen.",
        "- Fortell brukeren at filen er delvis indeksert, men at mye av det faglige innholdet (hoved-poenger på slidene) sannsynligvis bare finnes som bilder og derfor ikke er tilgjengelig som tekst.",
        "- Anbefal brukeren å laste filen opp manuelt i Kunnskapsbasen (Dashboard → Kunnskapsbase) for fullstendig KI-dekning av innholdet.",
        "- Støttemateriell fra samme kurs (andre leksjoner, eksamener, sensorveiledning) kan brukes som supplement.",
        "- VIKTIG: IKKE lag tabell eller liste over hvilke ANDRE filer/kapitler i kurset som er 'tilgjengelige' eller 'ikke tilgjengelige'. Du kjenner kun status for filen(e) over. Si heller 'Spør gjerne om andre kapitler/leksjoner i samme emne, så sjekker jeg' istedenfor å gjette.",
        "</system-notat-filer-med-partielt-innhold>",
        "",
      ].join("\n"),
    );
  }

  return blokker.join("\n");
}

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
  const [result, ekstraksjonsFeil] = await Promise.all([
    loadCanvasContextCore(
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
    ),
    finnMatchendeEkstraksjonsFeil(userId, target),
  ]);

  // Appendér notat om uleselige filer når target treffer minst én kjent-feil.
  // Viktig: vi legger til _etter_ eksisterende kontekst slik at suksessflyten
  // (supplement-materiell, full-dokument-mode, chunks) ikke påvirkes.
  const notat = byggEkstraksjonsFeilNotat(ekstraksjonsFeil);
  // Fanger om det faktisk var fil-innhold før notatet ble appendet — brukes
  // av chat-handleren til å skille "ekte Canvas-kontekst + evt. notat" fra
  // "kun notat om uleselige filer". Anti-hallusinasjons-guarden skal KUN
  // aktiveres i første tilfelle (guarden forbyr å be brukeren om opplasting,
  // mens notatet eksplisitt ber om det for de listede filene).
  const hadRealContent = result.kontekst.trim().length > 0;
  const resultMedNotat =
    notat.length > 0
      ? {
          ...result,
          kontekst: result.kontekst + notat,
          hasCanvasData: true,
          hasRealCanvasContent: hadRealContent,
        }
      : {
          ...result,
          hasRealCanvasContent: hadRealContent,
        };

  if (notat.length > 0) {
    logger.info(
      {
        userId,
        courseIdHint: target?.courseIdHint,
        fileHint: target?.fileHint,
        moduleHint: target?.moduleHint,
        failedFileCount: ekstraksjonsFeil.length,
        failedFiles: ekstraksjonsFeil.map((f) => f.fileName),
      },
      "Extraction-failure-notat injisert i Canvas-kontekst",
    );
  }

  return state.syncWaited
    ? { ...resultMedNotat, syncWaited: true }
    : resultMedNotat;
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

  // Vent på sync hvis brukeren peker på et spesifikt kurs som ikke er indeksert
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
  const wantsTimetable = Boolean(message && isTimetableQuery(message)) && (!contextPrefs || contextPrefs.events);
  const hasSpecificTarget = !!(
    hasCourseTarget(target) ||
    target?.moduleHint ||
    target?.fileHint
  );

  // Bygg strukturert-data-blokker (kunngjøringer, timeplan) tidlig slik at
  // de kan injiseres i ALLE kontekst-pather, ikke bare canvas_full-grenen.
  // Tidligere bug: når chunkHint var satt (f.eks. "10 kunngjøringer"), tok
  // pipelinen snarveien rett til hybrid Pinecone-søk og hoppet over
  // wantsAnnouncements/wantsTimetable-injeksjonen → modellen fikk ingen ekte
  // kunngjøringer/timeplan og svarte ærlig at den ikke har tilgang.
  let announcementBlockEarly = "";
  if (wantsAnnouncements) {
    const announcements = await hentKunngjøringerForBruker(userId);
    if (announcements.length > 0) {
      announcementBlockEarly = formaterKunngjøringerKontekst(announcements);
      const courseNames = [...new Set(announcements.map((a) => a.courseName))];
      logger.info(
        { userId, count: announcements.length, courses: courseNames, contextAddedLength: announcementBlockEarly.length },
        "Kunngjøringer pre-bygget for kontekst-injeksjon",
      );
    } else {
      logger.info({ userId }, "Bruker spurte om kunngjøringer, men ingen ble funnet");
    }
  }
  let timetableBlockEarly = "";
  if (wantsTimetable) {
    let timetableContext = await hentKommendeTimerForChat(userId);
    let calendarBlockedByCanvas = false;

    // On-demand fallback: hvis bro-cachen er tom, hent kalenderdata direkte.
    // Bruker SAMME parallell-strategi som /api/canvas/kalender:
    //   1) fetchCanvasLectures → calendar_events (selve forelesningene/timene)
    //   2) fetchPlannerItems → planner-items, men vi bruker KUN calendar_events
    //      derfra. Oppgavefrister hører hjemme i kalender-/fristkontekst, ikke
    //      i en seksjon som modellen leser som «timer og forelesninger».
    // Hos institusjoner som blokkerer /calendar_events for studenter (USN!),
    // returnerer planner fortsatt nok data til å kunne svare meningsfullt.
    if (!timetableContext && canvasToken && baseUrl) {
      const now = Date.now();
      // 30-dagers vindu — kort nok til å være relevant for «neste time»,
      // langt nok til å fange opp innleveringsfrister og forelesninger som
      // ligger flere uker frem. Tidligere bruk av 7 dager ga ofte 0 items
      // hos brukere som ikke hadde noe akkurat denne uka.
      const lookAheadMs = 30 * 24 * 60 * 60 * 1000;
      const startDate = new Date(now).toISOString().split("T")[0];
      const endDate = new Date(now + lookAheadMs).toISOString().split("T")[0];

      const [lecturesResult, plannerResult] = await Promise.allSettled([
        fetchCanvasLectures(canvasToken, { baseUrl, startDate, endDate }),
        fetchPlannerItems(canvasToken, { start_date: startDate, end_date: endDate, baseUrl, maxPages: 3 }),
      ]);

      const fromLectures =
        lecturesResult.status === "fulfilled"
          ? lecturesResult.value.data
              .filter((e) => e.startAt && Date.parse(e.startAt) >= now && Date.parse(e.startAt) <= now + lookAheadMs)
              .map((event) => ({
                title: event.title,
                due_at: event.startAt!,
                end_at: event.endAt,
                course_code: null,
                course_name: event.courseName,
                location: event.location,
                source: "event" as const,
              }))
          : [];

      const erPlannerKalenderhendelse = (type: string) =>
        type === "calendar_event" || type === "CalendarEvent";

      const fromPlanner =
        plannerResult.status === "fulfilled"
          ? plannerResult.value.data
              .filter((item) => {
                if (!erPlannerKalenderhendelse(item.plannable_type)) return false;
                const dato = item.plannable?.due_at ?? item.plannable_date;
                if (!dato) return false;
                const t = Date.parse(dato);
                if (!Number.isFinite(t)) return false;
                return t >= now && t <= now + lookAheadMs;
              })
              .map((item) => ({
                title: item.plannable?.title ?? "(uten tittel)",
                due_at: (item.plannable?.due_at ?? item.plannable_date)!,
                end_at: item.plannable?.end_at ?? null,
                course_code: null,
                course_name: null,
                location: item.plannable?.location_name ?? null,
                source: "event" as const,
              }))
          : [];

      const seen = new Set<string>();
      const kommendeTimer = [...fromLectures, ...fromPlanner]
        .filter((item) => {
          const key = `${item.title}|${item.due_at}`;
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        })
        .sort((a, b) => Date.parse(a.due_at) - Date.parse(b.due_at))
        .slice(0, 30);

      const lectureFailed = lecturesResult.status === "rejected";
      const plannerFailed = plannerResult.status === "rejected";
      const lecturesErr = lectureFailed ? (lecturesResult.reason as { code?: string; httpStatus?: number }) : null;
      const plannerErr = plannerFailed ? (plannerResult.reason as { code?: string; httpStatus?: number }) : null;
      const lectureBlockedByCanvas =
        lectureFailed && (lecturesErr?.code === "permission_denied" || lecturesErr?.httpStatus === 403);
      const plannerBlockedByCanvas =
        plannerFailed && (plannerErr?.code === "permission_denied" || plannerErr?.httpStatus === 403);

      if (kommendeTimer.length > 0) {
        await setCache(
          userKey(userId, "kalender", "kommende"),
          JSON.stringify(kommendeTimer),
          600,
        );
        logger.info(
          {
            userId,
            eventCount: kommendeTimer.length,
            fromLectures: fromLectures.length,
            fromPlanner: fromPlanner.length,
            lectureFailed,
            plannerFailed,
          },
          "Kalender-bro-cache fylt on-demand (kombinert lectures+planner)",
        );
        timetableContext = await hentKommendeTimerForChat(userId);
      } else if (lectureBlockedByCanvas) {
        // Forelesninger er blokkert av Canvas. Selv om Planner kan ha frister i
        // vinduet, er det poenget brukeren spør om — «neste time» = forelesning,
        // ikke oppgavefrist. Si ærlig at Canvas ikke gir oss tilgang til timeplanen.
        calendarBlockedByCanvas = true;
        logger.warn(
          {
            userId,
            lecturesErr,
            plannerFailed,
            fromPlanner: fromPlanner.length,
          },
          "Calendar Events blokkert av Canvas (planner ga ingen frister) — gir modellen ærlig forklaring",
        );
      } else {
        logger.info(
          { userId, lectureFailed, plannerFailed, fromLectures: fromLectures.length, fromPlanner: fromPlanner.length, plannerBlockedByCanvas },
          "On-demand henting av kalender ga ingen kommende timer/frister",
        );
      }
    }

    if (timetableContext) {
      timetableBlockEarly = timetableContext;
      logger.info(
        { userId, contextAddedLength: timetableBlockEarly.length },
        "Timeplan pre-bygget for kontekst-injeksjon",
      );
    } else if (calendarBlockedByCanvas) {
      // Lever en eksplisitt melding inn i konteksten så modellen forstår at
      // problemet IKKE er en mangel hos StudyWise. Dette signalet plukker
      // modellen opp i system-prompten ved å lese «calendar_api_blocked».
      timetableBlockEarly =
        "\nKOMMANDE TIMER OG FORELESNINGER (neste 7 dager):\n" +
        "(calendar_api_blocked) Canvas-instansen til denne brukeren tillater " +
        "ikke at studenters personlige API-token henter kalenderhendelser " +
        "(`/api/v1/calendar_events` returnerte 403). Dette er en institusjons-" +
        "policy som StudyWise ikke kan jobbe rundt. Si dette ærlig til brukeren " +
        "og henvis dem til Canvas-kalenderen direkte (Calendar i venstre menyen) " +
        "eller TimeEdit/StudentWeb hvis instituttet bruker det.\n";
      logger.info(
        { userId },
        "Timeplan markert som blokkert av Canvas — modellen får ærlig forklaring",
      );
    } else {
      logger.info(
        { userId },
        "Bruker spurte om timeplan, men ingen kalenderdata tilgjengelig",
      );
    }
  }

  // Hjelper: injiserer pre-bygde strukturerte blokker (kunngjøringer/timeplan)
  // i en eksisterende kontekst. Brukes i alle return-paths fra metadata-grenen
  // slik at f.eks. «oppgi alle timer i mai» får timeplandata selv om Pinecone/Redis-
  // baserte konteksten ikke inneholder den. Sikrer at <canvas-kursdata>-wrapper
  // legges til hvis kontektsten ikke har den.
  const injiserStrukturerteBlokker = (kontekst: string): string => {
    if (!announcementBlockEarly && !timetableBlockEarly) return kontekst;
    let resultat = kontekst;
    const harWrapper = resultat.includes("</canvas-kursdata>");
    if (!harWrapper) {
      resultat = "<canvas-kursdata>\n" + resultat + "\n</canvas-kursdata>";
    }
    if (announcementBlockEarly) {
      resultat = resultat.replace("</canvas-kursdata>", announcementBlockEarly + "\n</canvas-kursdata>");
    }
    if (timetableBlockEarly) {
      resultat = resultat.replace("</canvas-kursdata>", timetableBlockEarly + "\n</canvas-kursdata>");
    }
    return resultat;
  };

  if (wantsCourseOverview) {
    // Hvis brukeren samtidig spør om kunngjøringer/timeplan (f.eks.
    // «oppsummer mine 10 siste kunngjøringer fra alle emner» — som matcher
    // BÅDE kursoversikt OG kunngjøringer), skal den spesifikke datakilden
    // vinne. Ellers ville snarveien returnert kun kursnavn og hoppet over
    // de pre-bygde blokkene.
    if (announcementBlockEarly || timetableBlockEarly) {
      logger.info(
        { userId, intent, hasAnnouncements: !!announcementBlockEarly, hasTimetable: !!timetableBlockEarly },
        "wantsCourseOverview overstyrt — bruker har spurt spesifikt om kunngjøringer/timeplan",
      );
      const kombinert =
        "<canvas-kursdata>\n" +
        (announcementBlockEarly ? announcementBlockEarly + "\n" : "") +
        (timetableBlockEarly ? timetableBlockEarly + "\n" : "") +
        "</canvas-kursdata>";
      return { kontekst: kombinert, hasCanvasData: true, source: "redis" };
    }

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

  // Hybrid søk når chunkHint finnes (uavhengig av intent)
  // chunkHint indikerer at brukeren spør om spesifikt faginnhold, selv om
  // intent er canvas_light (f.eks. "forklar kvantitativ metode").
  // Resultatet huskes i hybridAlreadyAttempted slik at Trinn 0 ikke gjentar identisk søk.
  // NB: Skipper hybrid-søk for timeplan-spørsmål — chunkHint="time" matcher
  // tilfeldige ord som "runtime"/"time complexity" i fagfiler, og forurenser
  // kildelisten med irrelevante treff. Timeplanen ligger allerede i
  // timetableBlockEarly og injiseres via canvas_full-grenen lenger ned.
  let hybridAlreadyAttempted = false;
  if (!shouldPreferStructuredContext && hasStoredAIContent && message && target?.chunkHint && !wantsTimetable) {
    hybridAlreadyAttempted = true;
    const hybridResult = await byggKontekstFraHybridSearch(userId, message, target, hiddenCourseIds, baseUrl);
    if (hybridResult) {
      // Berik med modulstruktur-oversikt slik at KI vet hva som finnes i emnet
      let kontekst = hybridResult.kontekst;
      if (hasCourseTarget(target)) {
        const strukturOversikt = await byggModulStrukturOversikt(userId, target, hiddenCourseIds);
        if (strukturOversikt) {
          kontekst = kontekst.replace("</canvas-kursdata>", strukturOversikt + "\n</canvas-kursdata>");
        }
      }
      // Strukturert data (kunngjøringer/timeplan) ligger ikke i Pinecone, så
      // hybrid-søket finner dem aldri — injiser direkte fra de pre-bygde blokkene.
      if (announcementBlockEarly) {
        kontekst = kontekst.replace("</canvas-kursdata>", announcementBlockEarly + "\n</canvas-kursdata>");
      }
      if (timetableBlockEarly) {
        kontekst = kontekst.replace("</canvas-kursdata>", timetableBlockEarly + "\n</canvas-kursdata>");
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
        ...(hybridResult.fullDocumentTriggerWord
          ? { fullDocumentTriggerWord: hybridResult.fullDocumentTriggerWord }
          : {}),
        ...(hybridResult.primaryFileId != null
          ? { primaryFileId: hybridResult.primaryFileId }
          : {}),
        kilder: hybridResult.kilder,
      };
    }
    // Hvis hybrid søk ikke ga resultater, fortsett med vanlig intent-basert flyt
    logger.info(
      { userId, intent, chunkHint: target.chunkHint },
      "Hybrid søk (chunkHint) ga ingen resultater — fortsetter med intent-basert flyt",
    );
  }

  // canvas_light
  if (intent === "canvas_light") {
    // Faglige spørsmål havner av og til feilaktig i canvas_light uten chunkHint.
    // Prøv hybrid-søk også her når vi har lagret AI-innhold.
    if (!hybridAlreadyAttempted && !shouldPreferStructuredContext && hasStoredAIContent && message && !wantsAnnouncements && !wantsTimetable) {
      const hybridResult = await byggKontekstFraHybridSearch(userId, message, target, hiddenCourseIds, baseUrl);
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
          const beriket = injiserStrukturerteBlokker(redisKontekst);
          logger.info(
            { userId, intent, target, source: "redis", contextLength: beriket.length },
            "Canvas-kontekst lastet fra Redis (målrettet metadata)",
          );
          return { kontekst: beriket, hasCanvasData: true, source: "redis" };
        }
      }

      const mongoKontekst = await byggMålrettetKontekstFraMongo(userId, target, contextPrefs);
      if (mongoKontekst) {
        const beriket = injiserStrukturerteBlokker(mongoKontekst);
        logger.info(
          { userId, intent, target, source: "mongodb", contextLength: beriket.length },
          "Canvas-kontekst lastet fra MongoDB (målrettet metadata fallback)",
        );
        if (redisAvailable) {
          syncCanvasDataForUser(userId, canvasToken, baseUrl, signal, { priorityCourseId: target?.courseIdHint ?? undefined }).catch((err) => {
            logger.warn({ err, userId }, "Bakgrunns-sync feilet etter målrettet metadata-fallback");
          });
        }
        return { kontekst: beriket, hasCanvasData: true, source: "mongodb" };
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
        const beriket = injiserStrukturerteBlokker(redisKontekst);
        logger.info(
          { userId, intent, source: "redis", contextLength: beriket.length },
          "Canvas-kontekst lastet fra Redis (lett)",
        );
        return {
          kontekst: beriket,
          hasCanvasData: true,
          source: "redis",
        };
      }
    }

    // MongoDB fallback (permanent lagring, ~10-30ms)
    const mongoKontekst = await byggLettKontekstFraMongo(userId, contextPrefs);
    if (mongoKontekst) {
      const beriket = injiserStrukturerteBlokker(mongoKontekst);
      logger.info(
        { userId, intent, source: "mongodb", contextLength: beriket.length },
        "Canvas-kontekst lastet fra MongoDB (lett fallback)",
      );
      // Trigger bakgrunns-sync for å oppdatere Redis
      if (redisAvailable) {
        syncCanvasDataForUser(userId, canvasToken, baseUrl, signal, { priorityCourseId: target?.courseIdHint ?? undefined }).catch((err) => {
          logger.warn({ err, userId }, "Bakgrunns-sync feilet etter MongoDB-fallback");
        });
      }
      return { kontekst: beriket, hasCanvasData: true, source: "mongodb" };
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

  // canvas_full
  // Kunngjøringer/timeplan ble pre-bygget tidligere i funksjonen (se
  // `announcementBlockEarly` / `timetableBlockEarly`) slik at også chunkHint-
  // pathen kan injisere dem. Bruk samme variabler her under canvas_full.
  const announcementBlock = announcementBlockEarly;
  const timetableBlock = timetableBlockEarly;

  // Sjekk abort-signal før canvas_full søketrinn
  if (signal?.aborted) return ABORTED_RESULT;

  // Trinn 0: Hybrid søk (Pinecone + BM25 → RRF → Cohere Rerank)
  // Hopp over om chunkHint-stien allerede kjørte identisk søk.
  if (!hybridAlreadyAttempted && !shouldPreferStructuredContext && hasStoredAIContent && message) {
    const hybridResult = await byggKontekstFraHybridSearch(userId, message, target, hiddenCourseIds, baseUrl);
    if (hybridResult) {
      let kontekst = hybridResult.kontekst;
      // Injiser kunngjøringer
      if (announcementBlock) {
        kontekst = kontekst.replace("</canvas-kursdata>", announcementBlock + "\n</canvas-kursdata>");
      }
      // Injiser timeplan (kommer typisk når hybrid-søk rotet seg bort i kode-
      // chunks for et generelt ord som "time").
      if (timetableBlock) {
        kontekst = kontekst.replace("</canvas-kursdata>", timetableBlock + "\n</canvas-kursdata>");
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
        ...(hybridResult.fullDocumentTriggerWord
          ? { fullDocumentTriggerWord: hybridResult.fullDocumentTriggerWord }
          : {}),
        ...(hybridResult.primaryFileId != null
          ? { primaryFileId: hybridResult.primaryFileId }
          : {}),
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

  // Samme prinsipp for timeplan-spørsmål — returner fra bro-cachen i stedet
  // for å kaste bort tid på chunk-søk som ikke finner kalenderhendelser.
  if (wantsTimetable && timetableBlock) {
    const kontekst = "<canvas-kursdata>\n" + timetableBlock + "\n</canvas-kursdata>";
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
