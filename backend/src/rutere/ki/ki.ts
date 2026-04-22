/*
* Rutere for KI-relaterte endepunkter
* Bruker Claude (Anthropic) som AI-leverandør
*/

import { Router } from "express";
import { createHash } from "crypto";
import { lookup } from "node:dns/promises";
import net from "net";
import { logger } from "../../utils/logger.js";
import { apiError, sendZodError } from "../../utils/apiError.js";
import { audit, AUDIT_ACTIONS } from "../../utils/auditLog.js";
import { getCache, setCache } from "../../cache/redis.js";
import { rateLimitKi } from "../../middleware/rate-limit.js";
import {
    KIChatRequestSchema,
    KIChatResponseSchema,
    KIModelsResponseSchema,
    KI_MAX_MESSAGE_LENGTH_BACKEND,
    type ExplanationLevel,
} from "common/ki";
import { kiHistoryRouter } from "./kiHistory.js";
import { kiAnalyseRouter } from "./kiAnalyse.js";
import { kiShareRouter } from "./kiShare.js";
import { kiCourseKnowledgeRouter } from "./kiCourseKnowledge.js";
import { kiFeedbackRouter } from "./kiFeedback.js";
import { SUPPORTED_MODELS, DEFAULT_MODEL, resolveModel } from "./aiModels.js";
import { STUDYWISE_SYSTEM_PROMPT, STUDYWISE_COMPARISON_PROMPT } from "./systemPrompt.js";
import { evaluateCrossCourseGuard } from "./crossCourseGuard.js";
import {
  buildChatResponseCacheKey,
  classifyTriggerWord,
  getCachedChatResponse,
  setCachedChatResponse,
} from "../../services/chat-response-cache.service.js";
import { chatCompletion } from "./aiClient.js";
import { handleAIError, checkAIClientUnavailable } from "./handleAIError.js";
import {
  loadCanvasContext,
  ensureCanvasSync,
  resolveTargetAgainstKnownCourses,
  resolveModuleHintToCourse,
  ContextResultSchema,
  type IntentType,
  type ContextResult,
} from "../../services/context-loader.service.js";
import { isSyncing, waitForSync } from "../../services/canvas-sync.service.js";
import { isStructuredCanvasQuery } from "../../services/canvasStructuredQueries.js";
import { trimToTokenLimit, countTokens } from "../../utils/tokenCounter.js";
import { knyttCanvasTokenValgfritt } from "../../middleware/auth.js";
import { User } from "../../database/models/User.js";
import { ChatHistory } from "../../database/models/ChatHistory.js";
import { KnowledgeBase } from "../../database/models/Kunnskapsbase.js";
import { searchKBContent, buildKBContext } from "../../services/kunnskapsbase-indeksering.service.js";
import { createDefaultCanvasContextPreferences } from "common/auth";
import {
  KB_CRAWL_MAX_DEPTH,
  KB_CRAWL_MAX_PAGES,
  KB_CRAWL_MAX_DOCUMENTS,
} from "common/kunnskapsbase";
import { setupSSE, writeSSE } from "../../utils/sseUtils.js";
import { createLinkedAbortController } from "../../utils/abort.js";
import { loadStudyContextForUser, updateStudyContext } from "../../services/studyContext.service.js";
import { escapeRegex } from "../../utils/regexUtils.js";
import { stripHtml } from "../../utils/htmlUtils.js";
import { parseDocument } from "../../services/document.js";
import {
  fetchExternalContent,
  extractTextFromHtml,
  findContentLinks,
  findPdfLinks,
  downloadAndProcessPdf,
  getDomainSelectors,
  fetchWithSafeRedirects,
  readResponseBodyWithLimit,
  discardResponseBody,
  getHeaderValue,
  BodyTooLargeError,
  MAX_PDF_SIZE_BYTES,
  MAX_TEXT_CONTENT_SIZE_BYTES,
  MAX_OFFICE_DOC_SIZE_BYTES,
} from "../../services/crawler.js";
import {
  AI_COMPLETION_PUSH_MIN_DURATION_MS,
  sendAICompletionWebPush,
} from "../../services/webPush.service.js";

type ChatSource = import("common/ki").KIChatSource;

function mapKBResultsToChatSources(
  results: import("../../services/kunnskapsbase-indeksering.service.js").KBSearchResult[],
  baseName: string,
  baseId: string,
): ChatSource[] {
  const seen = new Set<string>();
  const sources: ChatSource[] = [];
  for (const result of results) {
    const sourceKind = result.sourceType === "link" ? "kb_link" : "kb_file";
    const sourceUrl = result.sourceUrl;
    const key = `${sourceKind}:${result.sourceId ?? result.sourceName}:${sourceUrl ?? ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    sources.push({
      courseId: "kb",
      courseName: baseName,
      fileName: result.sourceName,
      sourceUrl,
      sourceKind,
      sourceId: result.sourceId,
      baseId,
      score: result.score,
    });
  }
  return sources.slice(0, 100);
}

function mergeChatSources(
  ...groups: Array<ChatSource[] | undefined>
): ChatSource[] | undefined {
  const merged: ChatSource[] = [];
  const seen = new Set<string>();
  for (const group of groups) {
    if (!group || group.length === 0) continue;
    for (const source of group) {
      const hasDownloadableCanvasFile = Number.isFinite(source.fileId);
      const hasNavigableUrl = typeof source.sourceUrl === "string" && source.sourceUrl.length > 0;
      // kb_file er indeksert innhold uten originalfil — aksepteres hvis baseId+sourceId
      // finnes, så UI kan navigere til KB-siden i stedet for å prøve å laste ned.
      const hasKbFileReference =
        source.sourceKind === "kb_file" &&
        typeof source.baseId === "string" &&
        typeof source.sourceId === "string";
      if (!hasDownloadableCanvasFile && !hasNavigableUrl && !hasKbFileReference) {
        continue;
      }
      const key = `${source.sourceKind ?? "canvas_file"}:${source.courseId}:${source.fileId ?? "na"}:${source.fileName}:${source.sourceUrl ?? ""}:${source.sourceId ?? ""}`;
      if (seen.has(key)) continue;
      seen.add(key);
      merged.push(source);
    }
  }
  return merged.length > 0 ? merged.slice(0, 100) : undefined;
}

/** Parser JSON sync-status fra Redis. Returnerer statusfeltet, eller null ved ugyldig verdi. */
function parseSyncStatus(raw: string | null): string | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    return typeof parsed.status === "string" ? parsed.status : null;
  } catch {
    return null;
  }
}

/** Nøkkelord som krever full kontekst (moduler, PDFer, sideinnhold) */
const CANVAS_FULL_KEYWORDS = [
  // Handlingsverb (inkl. konjugasjoner)
  "oppsummer", "oppsummere", "oppsummering",
  "forklar", "forklare", "forklaring",
  "beskriv", "beskrive", "beskrivelse",
  "hva handler", "hva er", "hva betyr", "hva menes",
  "fortell om", "gi meg", "lag en", "vis meg", "vise meg",
  // Innholdstyper
  "pdf", "fil", "last ned", "leksjon",
  "modul", "kompendium", "forelesning", "pensum", "kapittel",
  "slide", "dokument", "sideinnhold",
  // Faglige spørsmål — indikerer at brukeren spør om innhold, ikke struktur
  "hvordan fungerer", "hvordan virker", "hva skjer med",
  "definer", "definisjon", "konsept", "teori",
  "forskjell mellom", "forskjellen",
  // Sammenligninger — krever fullt innhold fra flere kilder
  "sammenlign", "sammenligne", "sammenligning",
  "ulikhet mellom", "ulikheter mellom",
  "fordeler og ulemper", "likheter og forskjeller",
  // Engelske handlingsverb og innholdsord
  "summarize", "summarise", "summary",
  "explain", "explanation", "describe", "description",
  "what is", "what does", "what means", "tell me about",
  "give me", "show me", "create a",
  "how does", "how works", "what happens",
  "define", "definition", "concept", "theory",
  "difference between", "differences",
  "compare", "comparison",
  "pros and cons", "similarities and differences",
  // Engelske innholdstyper
  "file", "download", "lesson", "module", "lecture", "syllabus", "chapter",
  "document", "page content",
];

// TOPIC_KEYWORDS fjernet bevisst — hardkoding av IT/CS-fagbegreper ("dijkstra",
// "avl", "polymorfisme" osv.) favoriserte IT-studenter i intent-deteksjon og
// ekskluderte jus/medisin/pedagogikk/humaniora. StudyWise skal støtte alle
// norske studier likestilt. Intent-ruting baseres nå utelukkende på universelle
// handlingssignaler i CANVAS_FULL_KEYWORDS ("forklar", "hva er", "teori",
// "definisjon", "konsept" osv.) + struktur-signaler i CANVAS_LIGHT_KEYWORDS.
//
// Konsekvens: Enkeltord-spørringer uten action-verb ("dijkstra?", "kontraktsbrudd?")
// ruter nå til general_chat for ALLE fagfelt. Brukere som ønsker kurs-kontekst
// kan bruke "forklar X" eller "hva er X" — som er naturlig uansett studie.

/** Nøkkelord som indikerer at brukeren ber om en sammenligning */
const COMPARISON_KEYWORDS = [
  // Norsk
  "sammenlign", "sammenligne", "sammenligning",
  "forskjell mellom", "forskjellen mellom", "forskjeller mellom",
  "ulikhet mellom", "ulikheter mellom",
  "vs", "versus", "kontra", "mot",
  "hva skiller", "hva er forskjellen",
  "fordeler og ulemper",
  "når bør jeg bruke", "når velger man",
  "likheter og forskjeller",
  // Engelsk
  "compare", "comparison", "comparing",
  "difference between", "differences between",
  "pros and cons", "advantages and disadvantages",
  "what distinguishes", "what is the difference",
  "when should i use", "when to use",
  "similarities and differences",
];

/**
 * Sjekker om en melding er et sammenligningsspørsmål.
 */
function isComparisonQuery(message: string): boolean {
  const lower = message.toLowerCase();
  return COMPARISON_KEYWORDS.some((kw) => lower.includes(kw));
}

/** Nøkkelord som kun trenger lett kontekst (emner + frister) */
const CANVAS_LIGHT_KEYWORDS = [
  // Frister og innleveringer
  "frist", "deadline", "oblig",
  "innlevering", "eksamen",
  "karakter",
  // Strukturelle spørsmål
  "emne", "emnekode", "kurs",
  "oppgave", "canvas",
  // Tidsspørsmål
  "hva har jeg", "neste frist", "denne uken", "denne uka",
  "hva skjer", "kommende", "kalender", "timeplan", "når er",
  // Engelske nøkkelord
  "course", "courses", "enrolled", "assignment", "assignments",
  "submission", "schedule", "announcement", "upcoming",
];

/**
 * Vanlige skrivefeil/forkortelser og deres normaliserte form.
 *
 * Designprinsipp: Kun UNIVERSELLE termer som gjelder alle norske studier.
 * Domene-spesifikke substantiver (algoritmer, database, organisasjon osv.)
 * hardkodes IKKE her — det ville gjort assistenten skjev mot enkelte fagfelt.
 * Embedding-basert hybrid-søk håndterer fagspesifikke termer uansett.
 *
 * Entries er organisert i tematiske blokker:
 * 1. Canvas UI-termer (kunngjøringer)
 * 2. Universelt akademiske termer (bacheloroppgave, matematikk, statistikk,
 *    sikkerhet — disse er så brede at de dekker de fleste studier)
 * 3. Universelle action-verb (forklar)
 * 4. Studiestrukturelle keywords (forelesning, kapittel, leksjon, modul,
 *    tema, seksjon, sesjon) — cache-kritisk
 * 5. Universelle triggere for full-doc-mode (oppsummer, sammendrag, utdyp)
 * 6. Universelle akademiske substantiver (oppgave, prosjekt, analyse,
 *    pensum, eksamen, teori, definisjon, eksempel, begrep)
 */
const SKRIVEFEIL_MAP: Record<string, string> = {
  // Canvas UI-termer
  "kungjøring": "kunngjøring",
  "kungjøringer": "kunngjøringer",
  "kungjøringene": "kunngjøringene",
  "kunngjøringane": "kunngjøringene",
  // Universelle akademiske substantiver som brukes i alle studier
  "sikkerhe": "sikkerhet",
  "matmatikk": "matematikk",
  "statistik": "statistikk",
  "bachelro": "bacheloroppgave",
  "bacheloropp": "bacheloroppgave",
  // Vanlige skrivefeil for "forklar"
  "forkalre": "forklar",
  "forklra": "forklar",
  "forklrae": "forklar",
  "forkaler": "forklar",
  // Vanlige skrivefeil for "forelesning" — bruker hopper ofte over en "e" eller "n",
  // eller skriver nynorsk-form "forelesing". Normaliseres til bokmål for konsistent
  // ordinal-, modul- og chunkHint-matching nedstrøms.
  "forlesning": "forelesning",
  "forlesninger": "forelesninger",
  "forlesningen": "forelesningen",
  "forelsning": "forelesning",
  "forelesing": "forelesning",
  "forelesinga": "forelesningen",
  "forelesingar": "forelesninger",
  "førelesning": "forelesning",
  "førelesing": "forelesning",
  "førelesinga": "forelesningen",
  "førelesingar": "forelesninger",
  "forlesing": "forelesning",
  // Vanlige skrivefeil for "kapittel"
  "kapitel": "kapittel",
  "kapitell": "kapittel",
  "kaptel": "kapittel",
  "kaptiel": "kapittel",
  // Modul-keywords (kritisk for cache-key: uten normalisering mister vi
  // moduleHint → buildChatResponseCacheKey returnerer null → ingen caching.
  // Observert "eksjon 6" → null moduleHint selv når svaret var korrekt.
  // Ordgrense-sjekk i normaliserSkrivefeil (lookbehind/lookahead på [a-zæøå])
  // forhindrer at innslagene korrumperer riktig-stavede ord som "seksjon".
  //
  // Leksjon-varianter
  "eksjon": "leksjon",
  "eksjonen": "leksjonen",
  "eksjoner": "leksjoner",
  "lesjon": "leksjon",
  "lesjonen": "leksjonen",
  "leksjn": "leksjon",
  // Modul-varianter
  "mdul": "modul",
  "moudl": "modul",
  "modl": "modul",
  "mdulen": "modulen",
  "moudlen": "modulen",
  // Tema-varianter
  "teema": "tema",
  "teemaet": "temaet",
  "temet": "temaet",
  // Seksjon-varianter (reelt modul-nivå, skiller seg fra "section" engelsk)
  "seksion": "seksjon",
  "seksjn": "seksjon",
  "seksjonn": "seksjon",
  "seksionen": "seksjonen",
  // Sesjon-varianter
  "sesjn": "sesjon",
  "sesion": "sesjon",
  "sesjonn": "sesjon",

  // Trigger-ord for full-dokument-mode (uten match → chunk-mode → lengre
  // svartid ved første gang og ingen cache-skriving for leksjon-gjennomgang).
  //
  // Oppsummer / oppsummere
  "oppsumer": "oppsummer",
  "oppsumere": "oppsummere",
  "ppsummer": "oppsummer",
  "opsummer": "oppsummer",
  "ossummer": "oppsummer",
  "oppsummerr": "oppsummer",
  // Sammendrag
  "samendrag": "sammendrag",
  "sammendrg": "sammendrag",
  "samendrg": "sammendrag",
  // Utdyp / utdype
  "udyp": "utdyp",
  "utdp": "utdyp",
  "utdpe": "utdype",
  "udype": "utdype",
  "utydp": "utdyp",

  // Universelle akademiske substantiver (ikke domene-spesifikke) — gjelder
  // på tvers av alle norske studier. Domene-substantiver (organisasjon,
  // database, strategi, metode osv.) hardkodes bevisst IKKE her — embedding-
  // basert hybrid-søk håndterer fagspesifikke termer, og å favorisere
  // enkelte fagfelt ville gjøre assistenten skjev mot visse studieretninger.
  //
  // Oppgave / oppgaven / oppgaver (universell studieterm)
  "oppave": "oppgave",
  "oppgve": "oppgave",
  "opgave": "oppgave",
  "oppaven": "oppgaven",
  "oppaver": "oppgaver",
  // Prosjekt / prosjektet (universell — bacheloroppgave, semesteroppgave mm.)
  "prosekt": "prosjekt",
  "prosjket": "prosjekt",
  "prsjekt": "prosjekt",
  "prosektet": "prosjektet",
  // Analyse / analyser (universell — brukes i alle fagfelt)
  "anaylse": "analyse",
  "analse": "analyse",
  "anaylser": "analyser",
  // Pensum (universell studieterm)
  "pensm": "pensum",
  "pesum": "pensum",
  // Eksamen (universell)
  "eksmen": "eksamen",
  "eksaman": "eksamen",
  "exsamen": "eksamen",
  // Teori / teorier (universell akademisk)
  "teroi": "teori",
  "teroier": "teorier",
  // Definisjon (universell akademisk)
  "definsjon": "definisjon",
  "definisjn": "definisjon",
  "defnisjon": "definisjon",
  // Eksempel / eksempler (universell)
  "eksmpel": "eksempel",
  "ekspel": "eksempel",
  "eksmpler": "eksempler",
  // Begrep / begreper (universell akademisk)
  "begrp": "begrep",
  "bgrep": "begrep",
};

// Pre-kompilerte regex-patterns for skrivefeil (unngår re-kompilering per kall)
const SKRIVEFEIL_PATTERNS = Object.entries(SKRIVEFEIL_MAP).map(([feil, riktig]) => ({
  feil,
  riktig,
  // eslint-disable-next-line security/detect-non-literal-regexp -- entries er fra hardkodet SKRIVEFEIL_MAP, ikke brukerinput
  pattern: new RegExp(`(?<![a-zæøå])${feil}(?![a-zæøå])`, "g"),
}));

/**
 * Normaliserer vanlige skrivefeil i en melding.
 * Bruker ordgrense-sjekk (lookahead/lookbehind) for å unngå at
 * prefiks-match korrumperer riktig-stavede ord.
 * F.eks. "sikkerhe" → "sikkerhet" MÅ IKKE trigge inne i "sikkerhet".
 */
function normaliserSkrivefeil(text: string): string {
  let result = text.toLowerCase();
  for (const { feil, riktig, pattern } of SKRIVEFEIL_PATTERNS) {
    if (result.includes(feil)) {
      result = result.replace(pattern, riktig);
    }
  }
  return result;
}

/**
 * Lager et stabilt og Redis-trygt nøkkelsegment for courseHint.
 * Hashing hindrer problemer med mellomrom/spesialtegn i nøkler.
 */
function buildCourseHintCacheSegment(courseHint: string): string {
  const normalized = normaliserSkrivefeil(courseHint)
    .normalize("NFKC")
    .replace(/\s+/g, " ")
    .trim();

  return createHash("sha256")
    .update(normalized)
    .digest("hex")
    .slice(0, 12);
}

/**
 * Saniterer courseHint-verdi for Redis-lagring.
 * Normaliserer mellomrom, casing og spesialtegn slik at verdier som
 * "MET1020", "MET 1020" og "met1020" alle matcher.
 * Logger advarsel hvis verdien ble endret.
 */
function sanitizeCourseHintValue(courseHint: string): string {
  const original = courseHint;
  const sanitized = courseHint
    .trim()
    .toUpperCase()
    .normalize("NFKC")
    .replace(/\s+/g, "")  // Fjern alle mellomrom
    .replace(/[^A-Z0-9\-:]/g, "");  // Behold kun alfanumeriske, kolon og bindestrek

  if (original !== sanitized) {
    logger.warn(
      { original, sanitized },
      "courseHint-verdi sanitert før Redis-lagring",
    );
  }
  return sanitized;
}

// Norske ordinaler → sifferform. Brukes av extractModuleHint til å oversette
// "første forelesning" → "forelesning 1" før modulmatching kjører.
const NORWEGIAN_ORDINAL_TO_DIGIT: Record<string, string> = {
  første: "1", forste: "1", "1ste": "1", "1.": "1",
  andre: "2", annen: "2", "2dre": "2", "2.": "2",
  tredje: "3", "3dje": "3", "3.": "3",
  fjerde: "4", "4de": "4", "4.": "4",
  femte: "5", "5te": "5", "5.": "5",
  sjette: "6", "6te": "6", "6.": "6",
  sjuende: "7", syvende: "7", "7de": "7", "7.": "7",
  åttende: "8", attende: "8", "8de": "8", "8.": "8",
  niende: "9", "9de": "9", "9.": "9",
  tiende: "10", "10de": "10", "10.": "10",
  ellevte: "11", "11te": "11", "11.": "11",
  tolvte: "12", "12te": "12", "12.": "12",
};

const MODULE_KEYWORDS_RE = "forelesning|forelesningen|forelesninga|forelesningar|lecture|modul|modulen|leksjon|lesson|kapittel|kapitlet|kap|chapter|uke|uka|week|tema|temaet|sesjon|session|time|timen|økt|økta|del|delen|seksjon|section";

/**
 * Konverterer "første forelesning", "1. forelesning", "forelesning nr 1" og
 * lignende til kanonisk "<keyword> <digit>". Gjør norske ordinaler ekvivalente
 * med numeriske referanser i nedstrøms modul- og filnavn-matching.
 */
function normaliserOrdinaler(text: string): string {
  let result = text;

  // "første forelesning" / "1. forelesning" → "forelesning 1"
  const ordinalBefore = new RegExp(
    `(?<![a-zæøå0-9])(første|forste|andre|annen|tredje|fjerde|femte|sjette|sjuende|syvende|åttende|attende|niende|tiende|ellevte|tolvte|\\d{1,2}\\.?)\\s+(${MODULE_KEYWORDS_RE})\\b`,
    "gi",
  );
  result = result.replace(ordinalBefore, (_, ord, kw) => {
    const key = ord.toLowerCase();
    const digit = NORWEGIAN_ORDINAL_TO_DIGIT[key]
      ?? (/^\d{1,2}\.?$/.test(key) ? key.replace(/\.$/, "") : null);
    return digit ? `${kw} ${digit}` : `${ord} ${kw}`;
  });

  // "forelesning nr 1" → "forelesning 1"
  result = result.replace(
    new RegExp(`(${MODULE_KEYWORDS_RE})\\s+(?:nr\\.?|nummer|no\\.?)\\s+(\\d{1,3})\\b`, "gi"),
    "$1 $2",
  );

  return result;
}

function extractModuleHint(message: string): string | null {
  const lower = normaliserOrdinaler(normaliserSkrivefeil(message));

  // Fast-path: kap/kapittel-shorthand → normaliser til kanonisk "kapittel X"
  // slik at nedstrøms modulmatching blir konsistent ("kap 16.18" → "kapittel 16-18").
  const chapterPrefixMatch = lower.match(/\bkap(?:ittel)?\.?\s*([^\s,;:!?]+)/i);
  const rawChapterToken = chapterPrefixMatch?.[1];
  if (rawChapterToken) {
    const normalizedToken = rawChapterToken
      .toLowerCase()
      .replace(/[^0-9a-z.\-–]/g, "");

    // eslint-disable-next-line security/detect-unsafe-regex -- avgrenset validering av kapittel-token (maks 2x 1-2 sifre + valgfri bokstav)
    const chapterTokenMatch = normalizedToken.match(/^(\d{1,2})(?:[.\-–](\d{1,2}))?([a-z])?$/i);
    if (chapterTokenMatch) {
      const from = chapterTokenMatch[1];
      const to = chapterTokenMatch[2];
      const suffix = chapterTokenMatch[3] ? chapterTokenMatch[3].toLowerCase() : "";
      const chapterRange = to ? `${from}-${to}` : from;
      return `kapittel ${chapterRange}${suffix}`;
    }
  }

  // Utvidet støtte for andre prefikser (tema, sesjon, modul, uke, forelesning, ...)
  // inkludert range, oppramsing og bøyninger. Fast-pathen over håndterer kap/kapittel.
  //   "tema 4", "sesjon 2", "økt 5"
  //   "modul 16-18", "leksjon 16.18"
  //   "forelesning 1 og 2", "uke 1, 2 og 3"
  // Merk: bruker negativ lookbehind istedenfor \b fordi JS's \b ikke fungerer
  // for æøå (ASCII-basert \w) — "økt" ville aldri matche med \b.
  const numberedMatch = lower.match(
    // eslint-disable-next-line security/detect-unsafe-regex -- bounded: \d{1,3}-kvantifikatorer og fast alternasjon; input er brukermelding <2000 tegn
    /(?<![a-zæøå0-9])(?:modul|modulen|leksjon|lesson|module|forelesning|forelesningen|forelesninga|uke|uka|week|kapittel|kapitlet|kap|chapter|chapters|ch|tema|temaet|enhet|sesjon|session|time|timen|økt|økta|del|delen|seksjon|section|side|page|oppgave|oppgaven|foredrag|note|notat|slide|lysark)\.?\s+(\d{1,3}(?:\s*(?:[.\-,]|\s+og\s+|\s+and\s+)\s*\d{1,3})*[a-z]?)\b/i,
  );
  if (numberedMatch) {
    return numberedMatch[0]
      .toLowerCase()
      .replace(/\s+/g, " ")
      .trim();
  }

  const quotedMatch = lower.match(
    /\b(?:modul|leksjon|lesson|module|forelesning|kapittel|kap|chapter|tema|seksjon)\s+["'«»]([^"'«»]{3,80})["'«»]/i,
  );
  if (quotedMatch?.[1]) {
    return quotedMatch[1].trim().toLowerCase();
  }

  return null;
}

function detectIntent(messages: Array<{ role: string; content: string }>): IntentType {
  // Sjekk de siste bruker-meldingene (maks 3) for nøkkelord
  const recentUserMessages = messages
    .filter((m) => m.role === "user")
    .slice(-3)
    .map((m) => normaliserSkrivefeil(m.content));

  const hasCanvasSpecificSignals = (msg: string): boolean => {
    const hasCourseOrFileHints =
      /\b(?:canvas|emne|kurs|modul|forelesning|leksjon|kapittel|fil|pdf|docx|pptx|xlsx)\b/i.test(msg) ||
      /\b[a-zæøå]{2,4}-?\d{2,4}\b/i.test(msg);
    const hasLightSignals = CANVAS_LIGHT_KEYWORDS.some((kw) => msg.includes(kw));
    const hasNonGenericFullSignals = CANVAS_FULL_KEYWORDS
      .filter((kw) => !["hva er", "what is", "hva betyr", "what means"].includes(kw))
      .some((kw) => msg.includes(kw));
    return hasCourseOrFileHints || hasLightSignals || hasNonGenericFullSignals;
  };

  const isLikelyGeneralDefinition = (msg: string): boolean => {
    const words = msg.trim().split(/\s+/).filter(Boolean);
    const startsLikeDefinition =
      msg.startsWith("hva er ") ||
      msg.startsWith("hva betyr ") ||
      msg.startsWith("what is ") ||
      msg.startsWith("what does ");
    return startsLikeDefinition && words.length <= 7 && !hasCanvasSpecificSignals(msg);
  };

  if (recentUserMessages.some((msg) => isLikelyGeneralDefinition(msg))) {
    return "general_chat";
  }

  // Prioritet 0: Rene struktur-/oppslagsspørsmål skal ikke routes til innholdssøk
  for (const msg of recentUserMessages) {
    if (isStructuredCanvasQuery(msg)) {
      return "canvas_light";
    }
  }

  // Prioritet 1: Eksplisitte innholds-nøkkelord → canvas_full
  // (universelle action-verb og innholdstyper: "forklar", "oppsummer",
  //  "teori", "konsept", "definisjon", "leksjon", "pdf" osv.)
  for (const msg of recentUserMessages) {
    if (CANVAS_FULL_KEYWORDS.some((kw) => msg.includes(kw))) return "canvas_full";
  }

  // Prioritet 2: Strukturelle Canvas-spørsmål (frister, oppgaver) → canvas_light
  for (const msg of recentUserMessages) {
    if (CANVAS_LIGHT_KEYWORDS.some((kw) => msg.includes(kw))) return "canvas_light";
  }
  return "general_chat";
}

function selectModel(
  intent: IntentType | "canvas_hint",
  messageCount: number,
  contextLength: number,
): string {
  if (intent === "general_chat" || intent === "canvas_hint") {
    return "claude-haiku-4-5";
  }
  if (intent === "canvas_light" || (messageCount <= 4 && contextLength < 6000)) {
    return "claude-haiku-4-5";
  }
  return "claude-sonnet-4-6";
}

function chooseModelForFullDocumentMode(
  baseModel: string,
  systemPrompt: string,
  canvasContext: string,
  historyMessages: Array<{ role: string; content: string }>,
): { model: string; reason: "base" | "largest_context" } {
  const historyTokens = historyMessages.reduce((sum, msg) => sum + countTokens(msg.content) + 4, 0);
  const requestedWindowTokens = countTokens(systemPrompt) + countTokens(canvasContext) + historyTokens + 2000;
  const largestAvailableContextModel = "claude-sonnet-4-6";
  const largestAvailableContextWindow = 200000;

  if (requestedWindowTokens > largestAvailableContextWindow) {
    return { model: largestAvailableContextModel, reason: "largest_context" };
  }
  return { model: baseModel, reason: "base" };
}

/**
 * Kapper innholdet i eldre historikk-meldinger slik at de ikke dominerer
 * input-token-budsjettet i lange samtaler. De to siste meldingene beholdes
 * uendret (siste bruker-input + forrige AI-svar er viktig referanse). Eldre
 * meldinger kuttes til et head+tail-utdrag så modellen fortsatt ser essensen
 * av samtalen uten å betale for fulle 4000-token-responser.
 */
function capHistoryMessageSizes<T extends { role: string; content: string }>(
  messages: T[],
): T[] {
  const MAX_OLDER_CHARS = 1600; // ~400 tokens — nok for referanseformål
  const HEAD_CHARS = 900;
  const TAIL_CHARS = 600;
  const SEPARATOR = "\n\n[…utdrag klippet…]\n\n";
  const PROTECTED_TAIL = 2;

  return messages.map((msg, idx) => {
    const isProtected = idx >= messages.length - PROTECTED_TAIL;
    if (isProtected) return msg;
    if (msg.content.length <= MAX_OLDER_CHARS) return msg;
    const head = msg.content.slice(0, HEAD_CHARS);
    const tail = msg.content.slice(-TAIL_CHARS);
    return { ...msg, content: `${head}${SEPARATOR}${tail}` };
  });
}

const KB_SESSION_TTL = 3600;

/**
 * Bygger Redis-nøkkel for chat-scoped state. Alt som hører til en samtale
 * (låst kurshint, aktiv kunnskapsbase, session-cache) SKAL skopes per chat
 * for å hindre lekkasje mellom samtaler. Bruk alltid denne helperen i stedet
 * for å bygge per-bruker-nøkler manuelt — historisk har ad hoc-nøkler ført
 * til at courseHint fra én chat lekket inn i en annen.
 */
function chatScopedKey(userId: string, chatLockId: string, ...parts: string[]): string {
  return `ki:user:${userId}:chat:${chatLockId}:${parts.join(":")}`;
}

function kbSessionKey(userId: string, chatLockId: string): string {
  return chatScopedKey(userId, chatLockId, "active-kb");
}

function extractSlashKBBaseName(message: string): string | null {
  const trimmed = message.trim();
  // /skolebasen
  // /my base
  // ignorerer /help, /? og URL-er
  const slashMatch = trimmed.match(/^\/([^\s/][^\n]*)$/);
  if (!slashMatch?.[1]) return null;
  const candidate = slashMatch[1].trim();
  if (!candidate || candidate === "?" || candidate.toLowerCase() === "help") return null;
  if (candidate.startsWith("http://") || candidate.startsWith("https://")) return null;
  return candidate;
}

function extractFirstHttpUrl(message: string): string | null {
  const markdownMatch = message.match(/\[[^\]]*\]\((https?:\/\/[^)\s]+)\)/i);
  if (markdownMatch?.[1]) return markdownMatch[1];

  const candidates = message.match(/https?:\/\/[^\s<>"'`]+/gi) ?? [];
  for (const candidate of candidates) {
    const cleaned = candidate
      .replace(/[)\]}>,.!?;:]+$/g, "")
      .replace(/^<|>$/g, "");
    try {
      const parsed = new URL(cleaned);
      if (parsed.protocol === "http:" || parsed.protocol === "https:") {
        return parsed.toString();
      }
    } catch {
      // prøv neste kandidat
    }
  }
  return null;
}

function normalizeKbAliasText(value: string): string {
  return normaliserSkrivefeil(value)
    .replace(/https?:\/\/\S+/gi, " ")
    .replace(/[^\wæøå\s-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function extractLikelyKbAliases(message: string): string[] {
  const normalized = normalizeKbAliasText(message);
  if (!normalized) return [];

  const noStopwords = normalized
    .split(" ")
    .map((word) => word.trim())
    .filter((word) => word.length >= 3)
    .filter((word) => !CHUNK_STOPWORDS.has(word));

  return [...new Set(noStopwords)].slice(0, 4);
}

function normalizeTextContent(text: string): string {
  return text
    .replace(/\r/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

function isLoopbackOrPrivateIp(address: string): boolean {
  if (net.isIP(address) === 4) {
    const parts = address.split(".").map((part) => Number.parseInt(part, 10));
    const [a, b] = parts;
    if (a === 10 || a === 127 || a === 0) return true;
    if (a === 192 && b === 168) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 169 && b === 254) return true;
    return false;
  }

  if (net.isIP(address) === 6) {
    const lowered = address.toLowerCase();
    if (lowered === "::1") return true;
    if (lowered.startsWith("fc") || lowered.startsWith("fd")) return true; // ULA
    if (lowered.startsWith("fe80:")) return true; // link-local
    if (lowered === "::") return true;
    return false;
  }

  return true;
}

async function ensurePublicHttpUrl(rawUrl: string): Promise<URL | null> {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return null;
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
  const hostname = parsed.hostname.toLowerCase();
  if (!hostname || hostname === "localhost" || hostname.endsWith(".localhost") || hostname.endsWith(".local")) {
    return null;
  }

  // DNS-timeout for å forhindre at en treg/manipulert resolver henger SSE-strømmen.
  // NB: Dette er ikke en full DNS-rebinding-mitigering — for det måtte vi ha pinnet
  // den løste IP-en og brukt den direkte i fetch (krever http.Agent med custom lookup).
  // Som ekstra forsvar avviser vi alt som ser ut som privat/loopback IP og gir
  // fetch en kort total-timeout (12s) i buildLiveUrlContextFromMessage.
  const DNS_TIMEOUT_MS = 3_000;
  let dnsResults: import("node:dns").LookupAddress[];
  try {
    dnsResults = await Promise.race([
      lookup(hostname, { all: true }) as Promise<import("node:dns").LookupAddress[]>,
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("DNS_TIMEOUT")), DNS_TIMEOUT_MS),
      ),
    ]);
  } catch {
    return null;
  }
  if (!dnsResults.length) return null;
  if (dnsResults.some((entry) => isLoopbackOrPrivateIp(entry.address))) return null;
  return parsed;
}

const LIVE_URL_MAX_DEPTH = Math.min(3, KB_CRAWL_MAX_DEPTH);
const LIVE_URL_MAX_PAGES = Math.min(8, KB_CRAWL_MAX_PAGES);
const LIVE_URL_MAX_DOCUMENTS = Math.min(6, KB_CRAWL_MAX_DOCUMENTS);
const LIVE_URL_MAX_CHARS = 22_000;
const LIVE_URL_MAX_HTML_SECTION_CHARS = 3_500;
const LIVE_URL_MAX_PDF_SECTION_CHARS = 2_500;
const LIVE_URL_MIN_TEXT_CHARS = 80;
const LIVE_URL_SAME_PATH_ONLY = false;
const LIVE_URL_ENABLE_PDF_CONTEXT = !["0", "false", "no"].includes(
  (process.env.LIVE_URL_ENABLE_PDF_CONTEXT ?? "").trim().toLowerCase(),
);

function clipLiveUrlSection(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  return `${text.slice(0, maxChars)}\n[...klippet for å inkludere flere kilder...]`;
}

function buildPdfDisabledLiveUrlContext(url: string): string {
  return `<live_url source="${url}" contentType="pdf-unavailable">
PDF-innhold fra direkte URL er midlertidig deaktivert for stabil drift.
Lenke: ${url}
Du kan fortsatt oppsummere HTML-innhold fra nettsider, men ikke hente PDF-tekst fra denne URL-en akkurat nå.
</live_url>`;
}

function normalizeLiveCrawlUrl(urlStr: string): string {
  try {
    const url = new URL(urlStr);
    url.hash = "";
    url.hostname = url.hostname.toLowerCase();
    const params = new URLSearchParams(url.searchParams);
    const sortedParams = new URLSearchParams([...params.entries()].sort());
    url.search = sortedParams.toString();
    return url.toString();
  } catch {
    return urlStr;
  }
}

function isWithinLiveCrawlScope(seedUrl: string, candidateUrl: string, samePathOnly: boolean): boolean {
  try {
    const seed = new URL(seedUrl);
    const candidate = new URL(candidateUrl);
    const seedHost = seed.hostname.toLowerCase().replace(/^www\./, "");
    const candidateHost = candidate.hostname.toLowerCase().replace(/^www\./, "");
    if (seedHost !== candidateHost) return false;
    if (!samePathOnly) return true;
    const seedPath = seed.pathname.replace(/\/[^/]*$/, "");
    return candidate.pathname.startsWith(seedPath);
  } catch {
    return false;
  }
}

async function buildLiveUrlContextFromMessage(message: string): Promise<string | null> {
  const urlCandidate = extractFirstHttpUrl(message);
  if (!urlCandidate) return null;
  const startedAt = Date.now();
  logger.info({ urlCandidate }, "Direkte URL-kontekst: starter henting");

  const safeUrl = await ensurePublicHttpUrl(urlCandidate);
  if (!safeUrl) {
    logger.warn({ urlCandidate }, "Direkte URL blokkert (lokal/privat/ugyldig)");
    return null;
  }

  let finalUrl = safeUrl.toString();
  let outcome: "success" | "too_short" | "http_error" | "fetch_error" | "body_too_large" | "pdf_disabled" =
    "fetch_error";
  try {
    let usedLegacyFetchFallback = false;
    // Bruker crawler-pakkens SSRF-trygge fetch:
    // - Manuelle redirects, hver hop går gjennom DNS/IP-validering (forhindrer DNS-rebinding via redirect).
    // - Pinned IP-lookup på selve socketen (forhindrer second-resolve TOCTOU).
    // - Bounded body reader (DoS-vern mot enorme responses).
    const response = await fetchWithSafeRedirects(safeUrl.toString(), 12_000);
    if (!response || !response.ok) {
      if (response && !response.ok) {
        discardResponseBody(response);
      }
      // Fallback i samme stil som i commit 8e2e3ef:
      // noen URL-er fungerer i standard fetch-flyt, men ikke i safe-redirect-løpet.
      // Bruker redirect: "manual" + manuell hop-validering for å hindre SSRF via DNS-rebinding.
      const legacyController = new AbortController();
      const legacyTimeout = setTimeout(() => legacyController.abort(), 12_000);
      try {
        let legacyUrl = safeUrl.toString();
        let legacyResponse: globalThis.Response | null = null;
        const MAX_LEGACY_REDIRECTS = 5;
        for (let hop = 0; hop < MAX_LEGACY_REDIRECTS; hop++) {
          legacyResponse = await fetch(legacyUrl, {
            method: "GET",
            redirect: "manual",
            signal: legacyController.signal,
            headers: {
              "User-Agent": "StudyWise/1.0 (KI Live URL Context)",
              Accept: "text/html,application/xhtml+xml,application/pdf,text/plain,*/*",
            },
          });
          const status = legacyResponse.status;
          if (status >= 300 && status < 400) {
            const location = legacyResponse.headers.get("location");
            if (!location) break;
            const nextUrl = new URL(location, legacyUrl).toString();
            const safeNext = await ensurePublicHttpUrl(nextUrl);
            if (!safeNext) {
              logger.warn({ hop, nextUrl }, "Legacy fallback: redirect til privat/lokal IP blokkert");
              legacyResponse = null;
              break;
            }
            legacyUrl = safeNext.toString();
            continue;
          }
          break;
        }
        if (!legacyResponse) {
          outcome = "fetch_error";
          return null;
        }
        usedLegacyFetchFallback = true;

        if (!legacyResponse.ok) {
          outcome = "http_error";
          logger.warn(
            { url: safeUrl.toString(), status: legacyResponse.status, usedLegacyFetchFallback },
            "Direkte URL kunne ikke hentes",
          );
          return null;
        }

        finalUrl = legacyResponse.url || finalUrl;
        const legacyContentType = (legacyResponse.headers.get("content-type") ?? "").toLowerCase();
        logger.info(
          {
            requestedUrl: safeUrl.toString(),
            finalUrl,
            status: legacyResponse.status,
            contentType: legacyContentType,
            usedLegacyFetchFallback,
          },
          "Direkte URL-kontekst: innhold hentet",
        );

        let extracted: string;
        let labelType: string;
        if (legacyContentType.includes("text/html") || legacyContentType.includes("application/xhtml+xml")) {
          const html = await legacyResponse.text();
          extracted = normalizeTextContent(stripHtml(html, { removeStyles: true }));
          labelType = "html";
        } else if (legacyContentType.includes("application/pdf")) {
          if (!LIVE_URL_ENABLE_PDF_CONTEXT) {
            logger.info({ url: finalUrl }, "Direkte URL-kontekst: PDF parsing er deaktivert (LIVE_URL_ENABLE_PDF_CONTEXT)");
            outcome = "pdf_disabled";
            return buildPdfDisabledLiveUrlContext(safeUrl.toString());
          }
          const contentLength = Number(legacyResponse.headers.get("content-length") || "0");
          if (contentLength > MAX_PDF_SIZE_BYTES) {
            outcome = "body_too_large";
            logger.warn({ url: finalUrl, contentLength }, "Legacy fallback: PDF for stor");
            return null;
          }
          const buffer = Buffer.from(await legacyResponse.arrayBuffer());
          if (buffer.byteLength > MAX_PDF_SIZE_BYTES) {
            outcome = "body_too_large";
            logger.warn({ url: finalUrl, byteLength: buffer.byteLength }, "Legacy fallback: PDF-body for stor");
            return null;
          }
          const parsed = await parseDocument(buffer, "application/pdf", safeUrl.pathname || "document.pdf");
          extracted = normalizeTextContent(parsed.text);
          labelType = "pdf";
        } else if (
          legacyContentType.includes("application/vnd.openxmlformats-officedocument.wordprocessingml.document")
          || legacyContentType.includes("application/msword")
        ) {
          const buffer = Buffer.from(await legacyResponse.arrayBuffer());
          const filename = safeUrl.pathname.split("/").pop() || "document.docx";
          const parsed = await parseDocument(buffer, legacyContentType, filename);
          extracted = normalizeTextContent(parsed.text);
          labelType = "doc";
        } else {
          extracted = normalizeTextContent(await legacyResponse.text());
          labelType = "text";
        }

        if (!extracted || extracted.length < 80) {
          outcome = "too_short";
          logger.info(
            { url: finalUrl, contentType: legacyContentType, extractedChars: extracted.length },
            "Direkte URL ga for lite innhold",
          );
          return null;
        }

        const clipped = extracted.slice(0, LIVE_URL_MAX_CHARS);
        const truncated = extracted.length > LIVE_URL_MAX_CHARS;
        outcome = "success";
        logger.info(
          {
            url: finalUrl,
            contentType: labelType,
            extractedChars: extracted.length,
            clippedChars: clipped.length,
            truncated,
            usedLegacyFetchFallback,
          },
          "Direkte URL-kontekst: tekst ekstrahert",
        );
        return `<live_url source="${safeUrl.toString()}" contentType="${labelType}">
${clipped}
</live_url>`;
      } finally {
        clearTimeout(legacyTimeout);
      }
    }

    const contentType = (getHeaderValue(response.headers, "content-type") ?? "").toLowerCase();
    logger.info(
      {
        requestedUrl: safeUrl.toString(),
        finalUrl,
        status: response.status,
        contentType,
        usedLegacyFetchFallback,
      },
      "Direkte URL-kontekst: innhold hentet",
    );
    let extracted = "";
    let labelType: string;
    let crawledPages = 0;
    let crawledDocuments = 0;
    let discoveredLinks = 0;
    let discoveredDocuments = 0;

    if (contentType.includes("text/html") || contentType.includes("application/xhtml+xml")) {
      const htmlBuffer = await readResponseBodyWithLimit(response, MAX_TEXT_CONTENT_SIZE_BYTES);
      const html = htmlBuffer.toString("utf8");
      const domainSelectors = getDomainSelectors(finalUrl);
      const seedText = normalizeTextContent(extractTextFromHtml(html, domainSelectors) || stripHtml(html, { removeStyles: true }));
      const sections: string[] = [];
      const visited = new Set<string>();
      const queue: Array<{ url: string; depth: number; parentUrl?: string }> = [];

      const normalizedSeed = normalizeLiveCrawlUrl(finalUrl);
      visited.add(normalizedSeed);
      queue.push({ url: finalUrl, depth: 0 });

      if (seedText.length >= LIVE_URL_MIN_TEXT_CHARS) {
        sections.push(`[HTML depth=0 url=${finalUrl}]\n${clipLiveUrlSection(seedText, LIVE_URL_MAX_HTML_SECTION_CHARS)}`);
        crawledPages++;
      }

      const seedLinks = findContentLinks(html, finalUrl);
      const seedDocs = findPdfLinks(html, finalUrl);
      discoveredLinks += seedLinks.length;
      discoveredDocuments += seedDocs.length;
      for (const link of seedLinks) {
        if (queue.length >= LIVE_URL_MAX_PAGES) break;
        const normalized = normalizeLiveCrawlUrl(link.url);
        if (visited.has(normalized)) continue;
        if (!isWithinLiveCrawlScope(finalUrl, link.url, LIVE_URL_SAME_PATH_ONLY)) continue;
        visited.add(normalized);
        queue.push({ url: link.url, depth: 1, parentUrl: finalUrl });
      }
      if (LIVE_URL_ENABLE_PDF_CONTEXT) {
        for (const doc of seedDocs) {
          if (crawledDocuments >= LIVE_URL_MAX_DOCUMENTS) break;
          const normalized = normalizeLiveCrawlUrl(doc.url);
          if (visited.has(normalized)) continue;
          if (!isWithinLiveCrawlScope(finalUrl, doc.url, LIVE_URL_SAME_PATH_ONLY)) continue;
          visited.add(normalized);
          const pdfResult = await downloadAndProcessPdf(doc.url);
          if (!pdfResult || pdfResult.content.trim().length < LIVE_URL_MIN_TEXT_CHARS) continue;
          const pdfText = normalizeTextContent(pdfResult.content);
          sections.push(
            `[PDF depth=1 url=${doc.url} parent=${finalUrl}]\n${clipLiveUrlSection(pdfText, LIVE_URL_MAX_PDF_SECTION_CHARS)}`,
          );
          crawledDocuments++;
        }
      }

      let cursor = 1;
      while (
        cursor < queue.length &&
        crawledPages < LIVE_URL_MAX_PAGES &&
        (crawledPages + crawledDocuments) < (LIVE_URL_MAX_PAGES + LIVE_URL_MAX_DOCUMENTS)
      ) {
        const current = queue[cursor];
        cursor++;
        if (!current) break;
        if (current.depth > LIVE_URL_MAX_DEPTH) continue;

        const fetched = await fetchExternalContent(current.url);
        if (fetched.kind === "failed" || fetched.kind === "skip") continue;

        if (fetched.kind === "pdf") {
          if (!LIVE_URL_ENABLE_PDF_CONTEXT) {
            continue;
          }
          if (crawledDocuments >= LIVE_URL_MAX_DOCUMENTS) continue;
          const parsed = await parseDocument(fetched.buffer, "application/pdf", current.url);
          const pdfText = normalizeTextContent(parsed.text);
          if (pdfText.length < LIVE_URL_MIN_TEXT_CHARS) continue;
          sections.push(
            `[PDF depth=${current.depth} url=${current.url}${current.parentUrl ? ` parent=${current.parentUrl}` : ""}]\n${clipLiveUrlSection(pdfText, LIVE_URL_MAX_PDF_SECTION_CHARS)}`,
          );
          crawledDocuments++;
          continue;
        }

        const childSelectors = getDomainSelectors(current.url);
        const childText = normalizeTextContent(extractTextFromHtml(fetched.html, childSelectors));
        if (childText.length >= LIVE_URL_MIN_TEXT_CHARS) {
          sections.push(
            `[HTML depth=${current.depth} url=${current.url}${current.parentUrl ? ` parent=${current.parentUrl}` : ""}]\n${clipLiveUrlSection(childText, LIVE_URL_MAX_HTML_SECTION_CHARS)}`,
          );
          crawledPages++;
        }

        if (current.depth >= LIVE_URL_MAX_DEPTH) continue;
        const childLinks = findContentLinks(fetched.html, current.url);
        const childDocs = findPdfLinks(fetched.html, current.url);
        discoveredLinks += childLinks.length;
        discoveredDocuments += childDocs.length;

        for (const link of childLinks) {
          if (queue.length >= LIVE_URL_MAX_PAGES + LIVE_URL_MAX_DOCUMENTS) break;
          const normalized = normalizeLiveCrawlUrl(link.url);
          if (visited.has(normalized)) continue;
          if (!isWithinLiveCrawlScope(finalUrl, link.url, LIVE_URL_SAME_PATH_ONLY)) continue;
          visited.add(normalized);
          queue.push({ url: link.url, depth: current.depth + 1, parentUrl: current.url });
        }

        if (LIVE_URL_ENABLE_PDF_CONTEXT) {
          for (const doc of childDocs) {
            if (crawledDocuments >= LIVE_URL_MAX_DOCUMENTS) break;
            const normalized = normalizeLiveCrawlUrl(doc.url);
            if (visited.has(normalized)) continue;
            if (!isWithinLiveCrawlScope(finalUrl, doc.url, LIVE_URL_SAME_PATH_ONLY)) continue;
            visited.add(normalized);
            const pdfResult = await downloadAndProcessPdf(doc.url);
            if (!pdfResult || pdfResult.content.trim().length < LIVE_URL_MIN_TEXT_CHARS) continue;
            const pdfText = normalizeTextContent(pdfResult.content);
            sections.push(
              `[PDF depth=${current.depth + 1} url=${doc.url} parent=${current.url}]\n${clipLiveUrlSection(pdfText, LIVE_URL_MAX_PDF_SECTION_CHARS)}`,
            );
            crawledDocuments++;
          }
        }
      }

      extracted = normalizeTextContent(sections.join("\n\n"));
      labelType = sections.length > 1 ? "html+deep" : "html";
      logger.info(
        {
          seedUrl: finalUrl,
          maxDepth: LIVE_URL_MAX_DEPTH,
          maxPages: LIVE_URL_MAX_PAGES,
          maxDocuments: LIVE_URL_MAX_DOCUMENTS,
          crawledPages,
          crawledDocuments,
          discoveredLinks,
          discoveredDocuments,
          visitedCount: visited.size,
        },
        "Direkte URL-kontekst: deep crawl fullført",
      );
    } else if (contentType.includes("application/pdf")) {
      if (!LIVE_URL_ENABLE_PDF_CONTEXT) {
        logger.info({ url: finalUrl }, "Direkte URL-kontekst: PDF parsing er deaktivert (LIVE_URL_ENABLE_PDF_CONTEXT)");
        outcome = "pdf_disabled";
        return buildPdfDisabledLiveUrlContext(safeUrl.toString());
      }
      const buffer = await readResponseBodyWithLimit(response, MAX_PDF_SIZE_BYTES);
      const parsed = await parseDocument(buffer, "application/pdf", safeUrl.pathname || "document.pdf");
      extracted = normalizeTextContent(parsed.text);
      labelType = "pdf";
    } else if (
      contentType.includes("application/vnd.openxmlformats-officedocument.wordprocessingml.document") ||
      contentType.includes("application/msword")
    ) {
      const buffer = await readResponseBodyWithLimit(response, MAX_OFFICE_DOC_SIZE_BYTES);
      const filename = safeUrl.pathname.split("/").pop() || "document.docx";
      const parsed = await parseDocument(buffer, contentType, filename);
      extracted = normalizeTextContent(parsed.text);
      labelType = "doc";
    } else {
      const textBuffer = await readResponseBodyWithLimit(response, MAX_TEXT_CONTENT_SIZE_BYTES);
      extracted = normalizeTextContent(textBuffer.toString("utf8"));
      labelType = "text";
    }

    if (!extracted || extracted.length < 80) {
      outcome = "too_short";
      logger.info(
        { url: finalUrl, contentType, extractedChars: extracted.length },
        "Direkte URL ga for lite innhold",
      );
      return null;
    }

    const clipped = extracted.slice(0, LIVE_URL_MAX_CHARS);
    const truncated = extracted.length > LIVE_URL_MAX_CHARS;
    outcome = "success";
    logger.info(
      {
        url: finalUrl,
        contentType: labelType,
        extractedChars: extracted.length,
        clippedChars: clipped.length,
        truncated,
      },
      "Direkte URL-kontekst: tekst ekstrahert",
    );
    return `<live_url source="${safeUrl.toString()}" contentType="${labelType}">
${clipped}
</live_url>`;
  } catch (err) {
    if (err instanceof BodyTooLargeError) {
      outcome = "body_too_large";
      logger.warn(
        { url: safeUrl.toString(), maxBytes: err.maxBytes },
        "Direkte URL: respons overskred størrelsesgrensen",
      );
      return null;
    }
    logger.warn({ err, url: safeUrl.toString() }, "Direkte URL-henting feilet");
    return null;
  } finally {
    logger.info(
      {
        requestedUrl: safeUrl.toString(),
        finalUrl,
        outcome,
        elapsedMs: Date.now() - startedAt,
      },
      "Direkte URL-kontekst: ferdig",
    );
  }
}

function extractLiveUrlSource(context: string): ChatSource | null {
  const match = context.match(/<live_url\s+source="([^"]+)"\s+contentType="([^"]+)">/i);
  if (!match) return null;
  return {
    courseId: "live-url",
    courseName: "Direkte URL",
    fileName: match[1],
    sourceUrl: match[1],
    sourceKind: "live_url",
  };
}

function isLikelyFollowUpQuestion(message: string): boolean {
  const lower = normaliserSkrivefeil(message).trim();
  if (!lower) return false;

  const followUpPrefixes = [
    "hva med",
    "og hva med",
    "kan du også",
    "kan du ta med",
    "samme med",
    "hva så med",
    "og",
    "utdyp",
    "forklar mer",
    "si mer",
    "ta også",
    "det samme med",
  ];

  return followUpPrefixes.some((prefix) => lower.startsWith(prefix));
}

function refersToCurrentCourseContext(message: string): boolean {
  const lower = normaliserSkrivefeil(message).trim();
  if (!lower) return false;

  return /\b(?:samme|dette|det)\s+(?:emnet|faget|kurset|modulen|forelesningen|leksjonen|filen)\b/i.test(lower)
    || /\bi\s+(?:det|dette|samme)\s+(?:emnet|faget|kurset)\b/i.test(lower);
}

/**
 * Detekterer om brukeren eksplisitt vil bytte kurs/emne.
 * Returnerer true kun ved sterke signaler som "bytt til", "i stedet for", eller eksplisitt emnekode.
 */
function hasExplicitCourseOverride(message: string): boolean {
  const lower = normaliserSkrivefeil(message);

  // Eksplisitte byttefraser
  const overridePhrases = [
    "bytt til", "bytte til", "bytt emne", "bytte emne", "bytt fag", "bytte fag",
    "i stedet for", "istedenfor", "nå vil jeg", "gå til", "endre til",
    "snakk om", "spør om", "heller om", "endre fokus",
    "et annet fag", "et annet emne", "annet kurs",
  ];

  if (overridePhrases.some((phrase) => lower.includes(phrase))) {
    return true;
  }

  // Eksplisitt emnekode (f.eks. "INF2010", "MET1020", "DAT-102", "6105N")
  const courseCodePattern = /\b(?:[a-zæøå]{2,4}-?\d{2,4}|\d{4,5}[a-zæøå])\b/i;
  if (courseCodePattern.test(lower)) {
    return true;
  }

  // "i windows emnet", "til metode emnet", "fra metode emnet", "i dat2000-kurset", "om inf2010-faget"
  // Tolkes som eksplisitt kurskontekst, ikke bare tematisk ord.
  if (/\b(?:i|til|om|for|fra|av|på)\s+[a-zæøå0-9-]{2,}\s+(?:emnet|kurset|faget)\b/i.test(lower)) {
    return true;
  }

  // Bart "[X] emnet/kurset/faget" uten preposisjon, som "metode emnet spør jeg om".
  // Ekskluder pronomen som "dette/samme/det" — de fanges av refersToCurrentCourseContext.
  if (/\b(?!(?:dette|samme|det|denne|disse|ditt|din))[a-zæøå0-9-]{3,}\s+(?:emnet|kurset|faget)\b/i.test(lower)) {
    return true;
  }

  // Reversert rekkefølge: "i emnet X", "fra emnet organisering", "om kurset dat1000".
  // Her kommer kursnavnet ETTER emnet/kurset/faget, ikke før.
  if (/\b(?:emnet|kurset|faget)\s+(?!(?:mitt|ditt|sitt|vårt|deres|nå|her))[a-zæøå0-9-]{3,}\b/i.test(lower)) {
    return true;
  }

  return false;
}

// ————————————————————————————————————————————————————————
// Målrettet kontekst-ekstraksjon: identifiser hvilke(t) emne/modul brukeren spør om
// ————————————————————————————————————————————————————————
export interface TargetedQuery {
  courseIdHint: number | null;
  courseHint: string | null;
  moduleHint: string | null;
  fileHint: string | null;
  /** Nøkkelord fra brukerens melding for BM25/hybrid-søk (substantiv, fagbegreper) */
  chunkHint: string | null;
}

/** Generiske norske ord som ikke identifiserer en spesifikk modul — settes til null
 *
 * Test: "leksjonene" → moduleHint: null (generisk flertall)
 * Test: "forelesningene" → moduleHint: null (generisk flertall)
 * Test: "Leksjon 3"  → moduleHint: "leksjon 3" (spesifikt)
 * Test: "uke 5"      → moduleHint: "uke 5" (spesifikt)
 */
const GENERIC_MODULE_WORDS = new Set([
  // Entall
  "leksjonen", "leksjon", "forelesningen", "forelesning", "materialet",
  "kurset", "faget", "emnet", "pensum", "modulen", "modul",
  "innhold", "alt", "alle", "stoffet",
  // Flertall — disse er de vanligste falske treffene
  "leksjonene", "forelesningene", "modulene", "emner", "fagene",
  "forelesningane", "leksjonane",
]);

/** Stoppord som filtreres bort fra chunkHint — vanlige norske/engelske ord uten faglig verdi */
const CHUNK_STOPWORDS = new Set([
  // Hilsener og høflighetsfraser
  "hei", "hallo", "takk", "vennligst", "please", "hello", "hi",
  // Norske stoppord
  "kan", "du", "meg", "jeg", "vi", "de", "det", "den", "fra", "til", "om",
  "og", "i", "på", "av", "er", "en", "et", "som", "med", "for", "ha", "har",
  "være", "var", "vil", "skal", "må", "kunne", "bli", "ble", "blitt", "ikke",
  "hva", "hvordan", "hvorfor", "når", "hvor", "hvem", "hvilke", "hvilken",
  "gi", "lage", "lag", "vis", "vise", "skriv", "skrive", "fortell", "forklar",
  "forklare", "forklaring", "oppsummer", "oppsummere", "oppsummering",
  "beskriv", "beskrive", "beskrivelse",
  "dekker", "dekke", "handler", "handle", "menes", "mener", "betyr", "betydning",
  // Forklaringsnivå-modifikatorer (ikke fagbegreper)
  "enkelt", "enkel", "enklere", "detaljert", "detaljerte", "dypere", "dypt", "dyp",
  "grundig", "grundigere", "kortfattet", "kort", "simpelt", "simpel",
  "utdypende", "utdyp", "utdype", "ekspert", "avansert", "avanserte",
  "standard", "overordnet", "overordna", "bred", "bredt", "bredere",
  "alt", "alle", "noe", "noen", "denne", "dette", "disse", "sin", "sitt", "sine",
  "siste", "forrige", "neste", "første", "viktig", "viktige", "viktigste",
  "uke", "uken", "ukes", "dag", "dagen", "dagens", "idag", "nå", "akkurat",
  "eller", "bør", "burde", "prioritere", "prioritert",
  // Generiske kontekst-ord (ikke fagspesifikke)
  "emnet", "emne", "faget", "fag", "kurset", "kurs", "temaet", "tema",
  "emner", "emnene", "fagene", "kursene", "oversikt", "liste", "list",
  "innholdet", "innhold", "stoffet", "stoff", "materialet", "materiale",
  "pensum", "dokumentet", "dokument",
  "hent", "hente", "registrert", "registrere", "registrering",
  "mine", "min", "mitt", "vis", "vise",
  // Merk: "forelesning", "kapittel", "modul", "leksjon" er bevisst IKKE stoppord —
  // de er innholdsbærende nøkkelord som BM25 trenger for å diskriminere mellom filer
  // som "Forelesning1.pdf" og "Obligatorisk arbeidskrav.assignment".
  // Engelske stoppord (ofte brukt i norske setninger)
  "the", "a", "an", "is", "are", "was", "were", "be", "been", "being",
  "have", "has", "had", "do", "does", "did", "will", "would", "could", "should",
  "what", "how", "why", "when", "where", "who", "which",
  "about", "explain", "describe", "tell", "give", "show", "make", "write",
]);

const URL_ARTIFACT_TOKENS = new Set([
  "http", "https", "www",
  "com", "no", "net", "org", "edu", "gov", "io", "co",
  "html", "htm", "php", "asp", "aspx",
]);

/**
 * Ekstraherer de viktigste søkeordene (3–6) fra brukerens melding.
 * Fjerner stoppord og beholder substantiv/fagbegreper.
 *
 * Eksempel: "kan du lage en oppsummering av recursion som dekker alt"
 * → "recursion"
 *
 * Eksempel: "forklar kvantitativ og kvalitativ metode"
 * → "kvantitativ kvalitativ metode"
 */
function extractChunkHint(message: string): string | null {
  const lower = normaliserOrdinaler(normaliserSkrivefeil(message));
  const blockedHostTokens = new Set<string>();

  for (const match of message.matchAll(/https?:\/\/[^\s<>"'`]+/gi)) {
    const candidate = match[0];
    try {
      const parsed = new URL(candidate);
      for (const token of parsed.hostname.toLowerCase().split(".")) {
        const normalized = normaliserSkrivefeil(token).trim();
        if (normalized.length >= 2) blockedHostTokens.add(normalized);
      }
    } catch {
      // ignorer ugyldig URL-kandidat
    }
  }

  const withoutUrls = lower
    .replace(/https?:\/\/[^\s<>"'`]+/gi, " ")
    .replace(/\bwww\.[^\s<>"'`]+\b/gi, " ");

  // Del opp i ord (alfanumeriske + æøå + dot/dash i sammensatte numre).
  // Dot/dash beholdes slik at "16.18" og "16-18" forblir ett token istedenfor to.
  const words = withoutUrls
    .replace(/[^\wæøå\s.-]/g, " ")
    .split(/\s+/)
    .map((w) => w.replace(/^[.-]+|[.-]+$/g, "")) // Fjern ledende/halefølgende . og -
    .filter((w) => {
      if (w.length === 0) return false;
      // Behold alle rent numeriske tokens (kapittelnummer, årstall, osv.),
      // inkludert sammensatte som "16-18" og "16.18".
      // eslint-disable-next-line security/detect-unsafe-regex -- bounded: ankret regex (^...$), input er enkelt token <50 tegn
      if (/^\d+(?:[.-]\d+)*$/.test(w)) return true;
      return w.length >= 3;
    })
    .filter((w) => !CHUNK_STOPWORDS.has(w))
    .filter((w) => !URL_ARTIFACT_TOKENS.has(w))
    .filter((w) => !blockedHostTokens.has(w));

  // Fjern duplikater og behold rekkefølge
  const unique = [...new Set(words)];

  // Returner 3–8 viktigste ord (hever taket litt for å få plass til numeriske refs)
  const keywords = unique.slice(0, 8);

  if (keywords.length === 0) return null;

  const chunkHint = keywords.join(" ");
  return chunkHint;
}

function extractQueryTarget(message: string): TargetedQuery {
  const lower = normaliserSkrivefeil(message);

  // Ekstraher kun spesifikke modulhint (nummererte eller eksplisitt navngitte)
  const rawModuleHint = extractModuleHint(message);
  const moduleHint = rawModuleHint && !GENERIC_MODULE_WORDS.has(rawModuleHint) ? rawModuleHint : null;

  // Vanlige emnefragmenter som kan dukke opp i Canvas-emnenavn
  // Dekker ALLE fagfelt representert i norsk høyere utdanning — ikke bare IT/
  // økonomi. Målet er at en jus-, medisin-, pedagogikk- eller humaniora-
  // student skal få like god emne-matching som en IT-student.
  const courseKeywords = [
    // IT / teknologi / realfag
    "algoritmer", "datastrukturer", "database", "sikkerhet",
    "python", "objekt", "web", "nettverk", "mobil",
    "maskinlæring", "machine learning", "windows", "server",
    "operativsystem", "matematikk", "statistikk", "programmering",
    "java", "c#", "embedded", "elektronikk", "fysikk", "diskret",
    "informatikk", "informasjonsteknologi", "kybernetikk", "robotikk",
    "ikt", "informasjon", "system",
    // Økonomi / business / administrasjon
    "økonomi", "ledelse", "strategi", "finans", "investering",
    "revisjon", "skatt", "forretning", "innovasjon", "markedsføring",
    "regnskap", "logistikk", "entreprenørskap", "personalledelse",
    "prosjektledelse", "bedriftsøkonomi", "samfunnsøkonomi",
    // Organisasjon / arbeidsliv
    "organisasjon", "organisering", "organisatorisk",
    "arbeidsliv", "hr", "rekruttering",
    // Jus
    "juss", "rettsvitenskap", "strafferett", "sivilrett", "forvaltningsrett",
    "arbeidsrett", "kontraktsrett", "skatterett", "menneskerettigheter",
    "internasjonal rett", "rettsfilosofi",
    // Medisin / helsefag
    "medisin", "sykepleie", "sykepleier", "diagnose", "anatomi", "fysiologi",
    "farmakologi", "farmasi", "patologi", "klinisk",
    "folkehelse", "helsefag", "helse", "psykiatri",
    "fysioterapi", "ergoterapi", "radiografi", "bioingeniør",
    "tannpleie", "tannhelse", "paramedic", "akuttmedisin",
    "helsesykepleier", "jordmor", "vernepleier",
    // Psykologi
    "psykologi", "kognitiv", "atferd", "nevropsykologi",
    "utviklingspsykologi", "personlighet", "klinisk psykologi",
    "sosialpsykologi", "arbeidspsykologi", "psykoterapi",
    // Pedagogikk / utdanning
    "pedagogikk", "didaktikk", "læring", "undervisning", "utdanning",
    "klasseledelse", "spesialpedagogikk", "barnehagepedagogikk",
    "grunnskolelærer", "lektor", "adjunkt",
    // Sosialfag / samfunnsvitenskap
    "sosiologi", "samfunnsfag", "samfunnsvitenskap", "statsvitenskap",
    "sosialt arbeid", "barnevern", "sosialpolitikk",
    "kriminologi", "antropologi", "demografi",
    // Humaniora
    "filosofi", "historie", "litteratur", "kulturhistorie",
    "språkvitenskap", "lingvistikk", "arkeologi", "idéhistorie",
    "engelsk", "norsk", "spansk", "tysk", "fransk", "italiensk",
    "kunsthistorie", "musikkvitenskap",
    // Religion / teologi
    "religion", "teologi", "kristendom", "kirkehistorie",
    "religionsvitenskap", "islam", "jødedom",
    // Design / kunst / arkitektur
    "design", "kunst", "arkitektur", "formgiving", "visuell",
    "grafisk design", "industridesign", "interiørarkitektur",
    "mote", "fotografi", "film",
    // Naturvitenskap / biologi / miljø
    "biologi", "kjemi", "geografi", "geologi", "økologi",
    "miljø", "klima", "havforsk", "marinbiologi",
    "molekylærbiologi", "mikrobiologi", "genetikk",
    // Ingeniørfag / bygg / maritim
    "bygg", "anlegg", "maskinteknikk", "elektro",
    "materialteknologi", "energi", "maritim",
    "petroleum", "mekatronikk", "produksjonsteknologi",
    // Idrett / friluftsliv
    "idrett", "friluftsliv", "kroppsøving", "trenerutdanning",
    // Metodikk / vitenskapsteori (universelt akademisk)
    "metode", "vitenskapsteori", "forskningsmetode",
    // Tverrfaglige / felles
    "analyse", "etikk", "prosjekt", "bacheloroppgave",
    "kommunikasjon", "masteroppgave",
    // Engelske varianter (internasjonale kursnavn)
    "algorithms", "data structures", "security", "object", "network",
    "mobile", "operating system", "mathematics", "statistics",
    "economics", "management", "project", "communication", "innovation",
    "programming", "electronics", "physics", "analysis", "logistics",
    "accounting", "marketing", "law", "ethics", "organization",
    "sociology", "psychology", "philosophy", "history", "biology",
    "chemistry", "geography", "finance", "investment", "business",
    "medicine", "nursing", "anatomy", "physiology", "pharmacology",
    "pathology", "clinical", "public health", "pediatrics",
    "education", "pedagogy", "didactics", "learning",
    "design", "architecture", "theology", "religion",
    "linguistics", "literature", "archaeology", "anthropology",
    "political science", "social work", "criminology",
    "civil engineering", "mechanical engineering", "electrical engineering",
  ];

  // Vanlige emnekode-prefikser (2-4 bokstaver som ofte starter emnekoder)
  // Dekker alle fagfelt på norske universiteter/høgskoler (USN, NTNU, UiO,
  // UiB, UiT, OsloMet, HVL, NMH, NIH, BI, NHH, UiA, Nord, Høgskulen, etc.)
  const courseCodePrefixes = [
    // IT / data / teknologi / realfag
    "is", "dat", "itk", "inf", "bsy", "ing", "te", "fo", "ikt", "alg",
    "mat", "sta", "fys", "bio", "kje", "geo",
    "net", "web", "sys", "ele", "mob", "rob", "cyb",
    // Økonomi / administrasjon / business
    "øko", "adm", "led", "pro", "kom", "inn", "sik",
    "mrk", "fin", "reg", "log", "ent", "bed",
    // Jus
    "jur", "jus", "rett",
    // Medisin / helse / farmasi
    "med", "sy", "syk", "farm", "odont", "radio", "fysi", "ergo",
    "hels", "vern", "jord", "par",
    // Psykologi / pedagogikk / sosialfag
    "psy", "psyk", "ped", "did", "spe", "bhg", "lær",
    "sos", "bar", "krim",
    // Humaniora / språk / religion
    "his", "fil", "lit", "spr", "ark", "rel", "teo", "krist",
    "nor", "eng", "spa", "tys", "fra", "ita", "lat",
    "kult", "mus", "kun",
    // Design / kunst / arkitektur / media
    "des", "arc", "ark", "mot", "fot", "med",
    // Sport / friluftsliv
    "idr", "fri", "krø",
    // Ingeniør / bygg / maritim / energi
    "byg", "anl", "mas", "mat", "mar", "pet", "ene",
    // Tverrfaglige
    "bop",
  ];

  // Sammensatte ord: "algoritmer og datastrukturer" → matcher "algoritmer"
  // Sammensatte kursnavn-fraser på tvers av alle fagfelt i norsk høyere
  // utdanning. Venstre side er den fulle frasen brukeren kan skrive; høyre
  // side er nøkkelord som matcher mot faktisk kursnavn.
  const compoundKeywords: Record<string, string> = {
    // IT / teknologi
    "algoritmer og datastrukturer": "algoritmer",
    "algoritmer og data strukturer": "algoritmer",
    "algorithms and data structures": "algoritmer",
    "data structures": "datastrukturer",
    "it-sikkerhet": "sikkerhet",
    "it sikkerhet": "sikkerhet",
    "it security": "sikkerhet",
    "cyber security": "sikkerhet",
    "machine learning": "maskinlæring",
    "ki i studiene": "ki",
    "kunstig intelligens": "ki",
    "artificial intelligence": "ki",
    "diskret matematikk": "diskret",
    "discrete mathematics": "diskret",
    "operating system": "operativsystem",
    "operating systems": "operativsystem",
    // Jus
    "strafferett": "juss",
    "sivilrett": "juss",
    "forvaltningsrett": "juss",
    "arbeidsrett": "juss",
    "kontraktsrett": "juss",
    "skatterett": "juss",
    "menneskerettigheter": "juss",
    "internasjonal rett": "juss",
    "offentlig rett": "juss",
    "privat rett": "juss",
    "rettsvitenskap": "juss",
    // Psykologi
    "klinisk psykologi": "psykologi",
    "kognitiv psykologi": "psykologi",
    "sosialpsykologi": "psykologi",
    "arbeidspsykologi": "psykologi",
    "utviklingspsykologi": "psykologi",
    "nevropsykologi": "psykologi",
    // Medisin / helse
    "klinisk medisin": "medisin",
    "folkehelsevitenskap": "folkehelse",
    "folkehelse og samfunnsmedisin": "folkehelse",
    "klinisk sykepleie": "sykepleie",
    "akuttmedisin": "medisin",
    "allmennmedisin": "medisin",
    // Pedagogikk / utdanning
    "didaktikk og læring": "pedagogikk",
    "spesialpedagogikk": "pedagogikk",
    "barnehagepedagogikk": "pedagogikk",
    "utdanningsvitenskap": "pedagogikk",
    // Økonomi / business
    "bedriftsøkonomi": "økonomi",
    "samfunnsøkonomi": "økonomi",
    "finansiell analyse": "finans",
    "internasjonal økonomi": "økonomi",
    "strategisk ledelse": "ledelse",
    "organisasjon og ledelse": "ledelse",
    "prosjektledelse": "ledelse",
    "personalledelse": "ledelse",
    // Sosialfag
    "sosialt arbeid": "sosialfag",
    "barnevern og familiearbeid": "barnevern",
    // Humaniora
    "nordisk litteratur": "litteratur",
    "kulturhistorie": "historie",
    "idéhistorie": "historie",
    "kunsthistorie": "kunst",
    "musikkvitenskap": "musikk",
    // Religion / teologi
    "religionsvitenskap": "religion",
    "kirkehistorie": "teologi",
    // Design / kunst
    "grafisk design": "design",
    "industridesign": "design",
    "interiørarkitektur": "arkitektur",
    // Naturvitenskap
    "molekylærbiologi": "biologi",
    "marinbiologi": "biologi",
    "mikrobiologi": "biologi",
    // Ingeniørfag
    "mekanisk ingeniør": "maskinteknikk",
    "elektroingeniør": "elektro",
    "bygg og anlegg": "bygg",
    // Idrett
    "idrett og friluftsliv": "idrett",
    // Metodikk (tverrfaglig)
    "samfunnsvitenskapelig metode": "metode",
    "kvalitativ metode": "metode",
    "kvantitativ metode": "metode",
    "forskningsmetode": "metode",
    "vitenskapsteori": "metode",
  };

  // Fjern filnavn-mønstre fra søketeksten for å unngå falske positive
  const cleanedForCourse = lower.replace(/[\w.-]+\.\w{1,5}\b/g, "");

  // Sjekk sammensatte nøkkelord først (mer spesifikke)
  let courseHint: string | null = null;
  for (const [compound, mapped] of Object.entries(compoundKeywords)) {
    if (cleanedForCourse.includes(compound)) {
      courseHint = mapped;
      break;
    }
  }

  // Prøv å matche emnekoder direkte (f.eks. "DAT102", "ALG200", "IS-304", "6105N")
  if (!courseHint) {
    const courseCodeMatch = cleanedForCourse.match(/\b(?:([a-zæøå]{2,4})-?(\d{2,4})|(\d{4,5}[a-zæøå]))\b/i);
    if (courseCodeMatch) {
      // Returner hele emnekoden som hint (f.eks. "dat102")
      courseHint = courseCodeMatch[0].replace("-", "").toLowerCase();
      logger.info({ courseHint, pattern: "courseCode" }, "Ekstraherte emnekode fra melding");
    }
  }

  // Prøv å ekstrahere fag fra "i [FAG]" eller "om [FAG]" mønstre.
  // Bruk siste match i setningen for å unngå at tidlige preposisjoner
  // (f.eks. "til nettverk i windows emnet") låser hint til feil fag.
  if (!courseHint) {
    const prepositionMatches = [...cleanedForCourse.matchAll(/\b(?:i|om|fra|til|for)\s+([a-zæøå]{3,})\b/gi)];
    const prepositionMatch = prepositionMatches.at(-1);
    if (prepositionMatch?.[1]) {
      const potentialCourse = prepositionMatch[1].toLowerCase();
      // Sjekk om det matcher et kjent nøkkelord eller emnekode-prefiks
      if (courseKeywords.includes(potentialCourse) || courseCodePrefixes.includes(potentialCourse)) {
        courseHint = potentialCourse;
        logger.info({ courseHint, pattern: "preposition" }, "Ekstraherte fag fra preposisjonsfrase");
      }
    }
  }

  // Sjekk emnekode-prefikser (f.eks. "dat102", "inf2010", "DAT-2000") som
  // følges av tall eller bindestrek+tall. Krav om sifferkombinasjon er
  // bevisst: mange prefikser (inn, med, pro, led, sos, his, nor, eng osv.)
  // er også vanlige norske ord eller preposisjoner, og å fange dem alene
  // ga false-positive courseHints som "inn" fra "hente inn" eller "med"
  // fra "lær med eksempler". Kravet om `\d{2,4}` etter prefiks sikrer at
  // vi kun matcher faktiske emnekoder.
  if (!courseHint) {
    for (const prefix of courseCodePrefixes) {
      // Match prefiks umiddelbart etterfulgt av 2-4 siffer, med valgfri
      // bindestrek eller mellomrom mellom. Eksempler som matcher:
      //   "DAT2000", "dat-102", "INF 2010", "BSY-2000"
      // Eksempler som IKKE matcher lenger:
      //   "inn", "med DP", "ped", "pro", "led"
      // eslint-disable-next-line security/detect-non-literal-regexp -- prefix er fra konstant liste, ikke brukerinput
      const prefixRegex = new RegExp(`\\b${prefix}[\\s-]?\\d{2,4}\\b`, "i");
      if (prefixRegex.test(cleanedForCourse)) {
        courseHint = prefix;
        logger.info({ courseHint, pattern: "codePrefix" }, "Ekstraherte emnekode-prefiks fra melding");
        break;
      }
    }
  }

  // Fallback til enkle nøkkelord — bruker stem-matching slik at bøyninger
  // som "organiserings", "organiseringsemnet", "metoden", "databaser" også treffer.
  // Den ekstraherte hinten oppløses senere mot brukerens faktiske emnekatalog
  // (se context-loader.service.ts → Matchet kurshint mot brukerens faktiske emnekatalog).
  if (!courseHint) {
    for (const kw of courseKeywords) {
      const escaped = escapeRegex(kw);
      // Sammensatte (med mellomrom): krev hel-frase-match
      // Enkeltord: tillat trailing tegn (stem) for å fange norske bøyninger og sammensatte ord
      const pattern = kw.includes(" ")
        // eslint-disable-next-line security/detect-non-literal-regexp -- kw kommer fra hardkodet liste, escaped via escapeRegex
        ? new RegExp(`(^|\\s)${escaped}(\\s|$)`, "i")
        // eslint-disable-next-line security/detect-non-literal-regexp -- kw kommer fra hardkodet liste, escaped via escapeRegex
        : new RegExp(`\\b${escaped}[a-zæøå]*\\b`, "i");
      if (pattern.test(cleanedForCourse)) {
        courseHint = kw;
        logger.info({ courseHint, pattern: "keywordStem" }, "Ekstraherte fag fra nøkkelord (stem)");
        break;
      }
    }
  }

  // Ekstraher filnavn-hints (f.eks. "kapittel3.pdf", "2_Analyse_av_tema.pdf")
  // Filnavn med mellomrom fanges ved å lete etter anførselstegn eller kjente mønstre
  const quotedFileMatch = message.match(/["'«»]([^"'«»]+\.pdf)["'«»]/i);
  let fileHint: string | null = null;
  if (quotedFileMatch) {
    fileHint = quotedFileMatch[1].trim();
  } else {
    // Fang filnavn uten mellomrom (underscore/bindestrek-separert)
    const simpleFileMatch = lower.match(/[\wæøå][\wæøå.-]*\.pdf/i);
    if (simpleFileMatch) {
      fileHint = simpleFileMatch[0].trim();
    }
  }

  // Ekstraher chunkHint: nøkkelord for BM25/hybrid søk
  const chunkHint = extractChunkHint(message);
  if (chunkHint) {
    logger.info(
      { chunkHint, messagePreview: message.substring(0, 80) },
      "chunkHint ekstrahert",
    );
  }

  return { courseIdHint: null, courseHint, moduleHint, fileHint, chunkHint };
}

/**
 * Ekstraherer kurs-ID fra Canvas-kontekststrengen.
 * Brukes for å koble studiekontekst til riktig kurs.
 */
function extractCourseIdFromContext(kontekst: string): string | null {
  // Prøv EMNE-formatet først (Canvas-kontekst bruker dette)
  const emneMatch = kontekst.match(/EMNE:\s*(?:\[([A-Z]+-?\d+)\]|([A-Z]+-?\d+))/);
  if (emneMatch) return emneMatch[1] ?? emneMatch[2] ?? null;

  return null;
}

function sanitizeStudentName(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  const plain = stripHtml(value)
    .replace(/[^\p{L}\p{M}\s'-]/gu, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!plain) return null;
  return plain.slice(0, 40);
}

function extractPreferredStudentFirstName(
  profile: { firstName?: string | null } | null | undefined,
): string | null {
  // Bruk kun faktisk firstName fra profilen. Tidligere falt vi tilbake til
  // username/email-localpart, men det ga unaturlige hilsner (f.eks. "Hei laz!"
  // fra brukernavnet "laz2025", eller "Hei student!" fra "student123@usn.no").
  // Uten firstName viser vi heller en generisk hilsen uten personlig navn.
  const sanitized = sanitizeStudentName(profile?.firstName);
  if (!sanitized) return null;
  const firstToken = sanitized.split(" ")[0]?.trim();
  return firstToken || null;
}

/**
 * Bygger tilleggsinstruksjoner for forklaringsnivå.
 * Injiseres i systemprompt basert på brukerens valg.
 */
function buildExplanationLevelPrompt(level: ExplanationLevel): string {
  switch (level) {
    case "simple":
      return `

## Explanation Level: Simple

The student wants simple explanations. Adapt your responses:
- Use everyday words and avoid jargon where possible
- Explain technical terms in parentheses the first time, e.g. "variable (a box that stores a value)"
- Use everyday analogies and concrete examples
- Keep paragraphs short (2-3 sentences)
- Prioritize "what it does" over "how it works internally"
- Answer more briefly than usual — get straight to the point`;

    case "detailed":
      return `

## Explanation Level: Detailed

The student wants thorough explanations. Adapt your responses:
- Explain each step in detail with reasoning for why it works that way
- Include multiple examples — at least one simple and one more complex
- Show connections between concepts and related topics
- Include common mistakes and misconceptions students have
- Include complexity analysis and edge cases where relevant
- Use tables to compare related concepts`;

    case "expert":
      return `

## Explanation Level: Expert

The student has strong understanding and wants expert-level explanations. Adapt your responses:
- Use precise technical terminology without explaining basic concepts
- Focus on implementation details, trade-offs and design choices
- Include asymptotic analysis, proof sketches and formal definitions where relevant
- Discuss limitations, alternative approaches and state-of-the-art
- Reference academic concepts and relevant research areas
- Write code examples with optimized code, not just the basic version`;

    default:
      return "";
  }
}

/** Definerer express router */
const router = Router();
// Rate limiting for KI-endepunkter
router.use(rateLimitKi);
// Chat historikk ruter
router.use(kiHistoryRouter);
// Deling av chat
router.use(kiShareRouter);
// Course knowledge (hva KI har indeksert per kurs)
router.use(kiCourseKnowledgeRouter);
// Feedback (tommel opp/ned)
router.use(kiFeedbackRouter);
// Dokumentanalyse ruter
router.use(kiAnalyseRouter);

import { KI_TIMEOUT_MS, SESSION_CONTEXT_TTL } from "./kiConstants.js";

/** Maks ventetid på Canvas-sync før vi fortsetter med API/vector — kortere = raskere første svar, sync fortsetter i bakgrunn */
const SYNC_WAIT_MAX_MS = 1_500;

// Endepunkt for å liste støttede modeller
router.get("/models", (_req, res) => {
  logger.info("Henter liste over støttede modeller");
  const models = Object.entries(SUPPORTED_MODELS).map(([id, info]) => ({
    id,
    name: info.name,
    description: info.description,
    isDefault: id === DEFAULT_MODEL,
  }));
  return res.json(
    KIModelsResponseSchema.parse({ models, defaultModel: DEFAULT_MODEL }),
  );
});

// Hovedendepunkt for chat
router.post("/chat", knyttCanvasTokenValgfritt, async (req, res) => {
  logger.info("Mottok chat-forespørsel");
  const chatStartedAt = Date.now();

  // Sjekk autentisering
  if (!req.user?.id) {
    logger.warn("Chat-forespørsel uten autentisering");
    return apiError.unauthorized(res);
  }

  // Valider request body
  const parseResult = KIChatRequestSchema.safeParse(req.body);
  if (!parseResult.success) {
    logger.warn(
      { errors: parseResult.error.issues, userId: req.user.id },
      "Ugyldig chat-forespørsel",
    );
    return sendZodError(res, parseResult.error, "Ugyldig chat-forespørsel");
  }

  const {
    messages,
    model: requestedModel,
    temperature = 0.7,
    explanationLevel,
  } = parseResult.data;

  // Valider meldingsarray
  if (!messages || messages.length === 0) {
    logger.warn({ userId: req.user.id }, "Tom meldingsarray");
    return res.status(400).json(
      KIChatResponseSchema.parse({
        suksess: false,
        melding: "Du må sende minst en melding.",
        response: "",
      }),
    );
  }

  // Sjekk for veldig lange meldinger (unngå DoS)
  const totalLength = messages.reduce(
    (sum, m) => sum + (m.content?.length || 0),
    0,
  );
  if (totalLength > KI_MAX_MESSAGE_LENGTH_BACKEND) {
    logger.warn(
      {
        userId: req.user.id,
        totalLength,
        maxLength: KI_MAX_MESSAGE_LENGTH_BACKEND,
      },
      "Meldinger for lange",
    );
    return res.status(413).json(
      KIChatResponseSchema.parse({
        suksess: false,
        melding: `Meldingene er for lange. Maksimalt ${KI_MAX_MESSAGE_LENGTH_BACKEND} tegn totalt. Start en ny samtale.`,
        response: "",
      }),
    );
  }

  const resolvedRequestedModel = resolveModel(requestedModel);

  if (checkAIClientUnavailable(res, resolvedRequestedModel, KIChatResponseSchema)) return;

  if (requestedModel && requestedModel !== resolvedRequestedModel && !SUPPORTED_MODELS[requestedModel]) {
    logger.warn(
      { requestedModel, resolvedRequestedModel },
      "Forespurt modell normalisert/falt tilbake",
    );
  }

  let sseCleanup: (() => void) | undefined;
  let sseStarted = false;
  let timeoutHandle: ReturnType<typeof setTimeout> | undefined;

  const abortController = createLinkedAbortController(req.timeoutSignal);
  const abortOnResponseEnd = () => abortController.abort();
  res.once("finish", abortOnResponseEnd);
  res.once("close", abortOnResponseEnd);

  try {
    const bruker = await User.findOne({ _id: req.user.id, deletedAt: { $exists: false } })
      .select("firstName canvasContextPreferences hiddenCourseIds")
      .lean();

    // Start med base system prompt
    let enhancedSystemPrompt = STUDYWISE_SYSTEM_PROMPT;
    const hasAssistantMessages = messages.some((m) => m.role === "assistant");
    const firstUserMessage = messages.find((m) => m.role === "user")?.content ?? "";
    const normalizedFirstUserMessage = normaliserSkrivefeil(firstUserMessage).trim();

    // Stabil chat-identifikator. Brukes som suffix i sesjonslås-nøkkelen slik
    // at courseHint-låsen er per chat, ikke per bruker. Uten dette lekker state
    // mellom samtaler (f.eks. Metode-chatten arver kurs-låsen fra 6105N-chatten).
    //
    // Kilde-prioritering:
    //   1. chatId fra request (ChatHistory._id) — garantert unik per samtale
    //   2. Hash av første brukermelding — fallback når chatId mangler, men
    //      sårbart for kollisjoner når flere chatter starter med samme spørsmål
    //      (f.eks. "Hvilke emner er jeg registrert på?"). Beholdes kun for
    //      bakoverkompatibilitet hvis frontend ikke har oppdatert enda.
    const chatLockId = (() => {
      const explicitId = (req.body as { chatId?: unknown }).chatId;
      if (typeof explicitId === "string" && explicitId.trim().length > 0) {
        // Saniterer for Redis-nøkkel-bruk: kun alfanumerisk + bindestrek.
        return explicitId.trim().replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 64) || "default";
      }
      return firstUserMessage
        ? createHash("sha256").update(firstUserMessage).digest("hex").slice(0, 16)
        : "default";
    })();
    const isFirstUserGreetingOnly =
      /^(?:hei|heisann|hallo|hallais|hello|hi|god\s*dag|god\s*morgen|god\s*kveld|hey|yo)[\s!,.?]*$/iu
        .test(normalizedFirstUserMessage);

    const studentFirstName = extractPreferredStudentFirstName(bruker);

    if (studentFirstName) {
      enhancedSystemPrompt += `

## Student Profile

- The student's first name is "${studentFirstName}" (from account profile).
- You may use this first name naturally when relevant.
- Never use full names.
`;

      if (!hasAssistantMessages) {
        enhancedSystemPrompt += `

## First Reply Greeting

This is the first assistant reply in this conversation.
Start the response with a short, natural greeting that includes the student's first name, for example: "Hei ${studentFirstName}!".
Then continue directly with the academic answer.
`;

        if (isFirstUserGreetingOnly) {
          enhancedSystemPrompt += `

## Greeting Strictness

The student's first message is only a greeting.
The very first sentence MUST include the student's first name.
- If responding in Norwegian Bokmål, start with: "Hei ${studentFirstName}!"
- If responding in English, start with: "Hi ${studentFirstName}!"
Do not omit the name in this first sentence.
`;
        }
      }
    } else if (!hasAssistantMessages) {
      // Ingen firstName i profilen — bruk en generisk hilsen uten navn for
      // å unngå at KI-en prøver å gjette en "personlig" tiltaleform.
      enhancedSystemPrompt += `

## First Reply Greeting

This is the first assistant reply in this conversation, and the student has not
set a first name in their profile. Start with a short, neutral greeting WITHOUT
using any name — for example "Hei!" or "Hi there!" — then continue directly
with the academic answer.
`;

      if (isFirstUserGreetingOnly) {
        enhancedSystemPrompt += `

## Greeting Strictness

The student's first message is only a greeting.
Start the response with a warm, name-free greeting.
- If responding in Norwegian Bokmål: "Hei!"
- If responding in English: "Hi there!"
Never guess or invent a name from email, username, or other profile fields.
`;
      }
    }

    // ——— Forklaringsnivå-tilpasning ———
    if (explanationLevel && explanationLevel !== "standard") {
      enhancedSystemPrompt += buildExplanationLevelPrompt(explanationLevel);
    }

    // ——— Sammenligningsverktøy ———
    const lastUserMessage = [...messages].reverse().find((m) => m.role === "user")?.content ?? "";
    const isComparison = isComparisonQuery(lastUserMessage);
    if (isComparison) {
      enhancedSystemPrompt += STUDYWISE_COMPARISON_PROMPT;
      logger.info({ userId: req.user.id }, "Sammenligningsspørsmål detektert — injiserer sammenligningsinstruksjoner");
    }

    // ——— Intent-deteksjon: Trenger denne meldingen Canvas-data? ———
    let intent = detectIntent(messages);
    const lastMessageNormalized = normaliserSkrivefeil(lastUserMessage);
    const mentionsKnowledgeBase = /\b(?:basen|kunnskapsbase|knowledge base)\b/i.test(lastMessageNormalized);
    const hasDirectUrlInLastMessage = extractFirstHttpUrl(lastUserMessage) !== null;
    const hasSlashKbCommandInLastMessage = extractSlashKBBaseName(lastUserMessage) !== null;
    const shouldPrioritizeDirectUrl = hasDirectUrlInLastMessage && !hasSlashKbCommandInLastMessage;

    if (shouldPrioritizeDirectUrl && intent !== "general_chat") {
      logger.info(
        {
          previousIntent: intent,
          overriddenIntent: "general_chat",
          reason: "explicitDirectUrlInPrompt",
          messagePreview: lastUserMessage.substring(0, 120),
        },
        "Direkte URL i melding prioriteres over Canvas-kontekst",
      );
      intent = "general_chat";
    }

    let hasActiveKnowledgeBaseSession = false;
    if (req.user?.id) {
      const activeKbRawForIntent = await getCache(kbSessionKey(req.user.id, chatLockId));
      if (activeKbRawForIntent) {
        try {
          const parsed = JSON.parse(activeKbRawForIntent) as { id?: string; navn?: string };
          hasActiveKnowledgeBaseSession = Boolean(parsed.id && parsed.navn);
        } catch {
          hasActiveKnowledgeBaseSession = false;
        }
      }
    }

    if (
      intent !== "general_chat" &&
      !req.canvasToken &&
      (hasSlashKbCommandInLastMessage || mentionsKnowledgeBase || hasActiveKnowledgeBaseSession)
    ) {
      logger.info(
        {
          previousIntent: intent,
          overriddenIntent: "general_chat",
          reason: "knowledgeBaseContextWithoutCanvasToken",
          hasSlashKbCommandInLastMessage,
          mentionsKnowledgeBase,
          hasActiveKnowledgeBaseSession,
        },
        "KB-kontekst prioriteres over Canvas-intent når Canvas-token mangler",
      );
      intent = "general_chat";
    }

    if (intent === "general_chat" && req.user?.id) {
      const hasSlashKbCommand = hasSlashKbCommandInLastMessage;
      const hasFollowUpSignal =
        isLikelyFollowUpQuestion(lastUserMessage) || refersToCurrentCourseContext(lastUserMessage);
      const hasExplicitCourseSwitch = hasExplicitCourseOverride(lastUserMessage);
      const extractedTarget = extractQueryTarget(lastUserMessage);
      const hasNewCourseHintInMessage =
        hasExplicitCourseSwitch || !!extractedTarget.courseHint || extractedTarget.courseIdHint !== null;
      const haikuRequested = resolvedRequestedModel === "claude-haiku-4-5";
      const hasContentSignals =
        hasFollowUpSignal ||
        !!extractedTarget.moduleHint ||
        !!extractedTarget.fileHint ||
        !!extractedTarget.chunkHint;

      if (
        !shouldPrioritizeDirectUrl &&
        !hasNewCourseHintInMessage &&
        !mentionsKnowledgeBase &&
        !hasSlashKbCommand &&
        (hasFollowUpSignal || (haikuRequested && hasContentSignals))
      ) {
        const lockedCourseHintRaw = await getCache(chatScopedKey(req.user.id, chatLockId, "locked-course-hint"));
        const lockedCourseHint = lockedCourseHintRaw
          ? sanitizeCourseHintValue(lockedCourseHintRaw)
          : null;

        if (lockedCourseHint) {
          intent = hasFollowUpSignal ? "canvas_full" : "canvas_light";
          logger.info(
            {
              previousIntent: "general_chat",
              promotedIntent: intent,
              reason: hasFollowUpSignal ? "lockedCourseFollowUp" : "lockedCourseHaikuContentSignal",
              requestedModel: resolvedRequestedModel,
              lockedCourseHint,
              messagePreview: lastUserMessage.substring(0, 120),
            },
            "Intent oppjustert til canvas_full basert på låst kurskontekst",
          );
        }
      }
    }

    if (intent !== "general_chat" && !req.canvasToken) {
      // Brukeren spør om Canvas men har ikke token
      logger.info({ intent }, "Canvas-spørsmål uten token");
      return res.json(
        KIChatResponseSchema.parse({
          suksess: true,
          response:
            "Jeg har ikke tilgang til Canvas-data akkurat nå. Sjekk at du har:\n\n1. Lagt inn et gyldig Canvas API-token i Innstillinger\n2. Valgt minst ett datasett under «Gi AI tilgang til» i chatten",
          model: resolvedRequestedModel,
        }),
      );
    }

    // SSE-headere og keepalive tidlig slik at proxy/klient ikke lukker under lang kontekstlasting (f.eks. PDF-oppsummering)
    if (!res.headersSent) {
      // Må ligge over høyeste baseTimeoutMs lenger nede (deep full_document=240s)
      // pluss margin for kontekstlasting/embedding/rerank. Ellers kuttes dype
      // oppsummeringer midt i streamen før Claude er ferdig.
      const sse = setupSSE(req, res, 260_000);
      sseCleanup = sse.clearKeepalive;
      sseStarted = true;
    }

    // ——— Laste Canvas-kontekst via context-loader (Redis → API fallback) ———
    let canvasKontekst = "";
    let hasCanvasData = false;
    let fullDocumentModeActive = false;
    let fullDocumentStrictPrefix = "";
    let traceCourseIdHint: number | null = null;
    let traceCourseHint: string | null = null;
    let traceModuleHint: string | null = null;
    let traceFileHint: string | null = null;
    let fullDocumentTriggerWord: string | null = null;
    // Eksponeres fra context-loader og brukes av response-cache for
    // deterministisk nøkkel. Lagres her for tilgang etter Claude-generering.
    let fullDocumentPrimaryFileId: number | null = null;
    // Speilet verdi av persistentPrimaryCourseId for bruk i response-cache
    // (original variabel er scoped til try-blokken der den settes).
    let tracePersistentPrimaryCourseId: string | null = null;
    // Flagg som forhindrer response-cache når cross-course-guard trigget —
    // svaret da er uansett "beklager, spør om rett kurs"-stil og kurs-
    // konteksten er i konflikt med brukerens primær. Cache ville fått
    // korrupte treff.
    let crossCourseGuardTriggered = false;
    let contextKilder: import("common/ki").KIChatSource[] | undefined;
    let kbKilder: import("common/ki").KIChatSource[] | undefined;
    let liveUrlKilder: import("common/ki").KIChatSource[] | undefined;
    // Settes når context-loader måtte trigge prioritert sync — brukes av
    // modell-valg (Haiku for rask respons) og av system-prompt (sync-hint).
    let syncJustWaited = false;

    if (intent !== "general_chat" && req.canvasToken && req.user?.id) {
      const baseUrl = req.canvasBaseUrl;

      // Hent brukerens Canvas-kontekstpreferanser og skjulte emner
      const contextPrefs = bruker?.canvasContextPreferences ?? createDefaultCanvasContextPreferences();
      const hiddenCourseIds = new Set<number>(bruker?.hiddenCourseIds?.courseIds ?? []);

      // Sync-venting er best-effort — feil her skal IKKE stoppe KI-flyten
      try {
        // Sikre at bakgrunns-sync er igangsatt
        // Tråder abortController.signal videre slik at bakgrunns-sync stopper
        // når responsen avsluttes (klient navigerer bort, timeout, etc.).
        ensureCanvasSync(req.user.id, req.canvasToken, baseUrl, undefined, abortController.signal).catch((err) => {
          logger.warn({ err, userId: req.user!.id }, "ensureCanvasSync feilet — fortsetter uten sync");
        });

        // Vent på pågående sync slik at lagret KI-innhold er oppdatert.
        // Sjekk in-memory først (raskest), deretter Redis (cross-process).
        if (isSyncing(req.user.id)) {
          logger.info({ userId: req.user.id }, "Venter på Canvas sync før KI-kontekst (in-memory)");
          await waitForSync(req.user.id, SYNC_WAIT_MAX_MS);
        } else {
          const syncStatusRaw = await getCache(`canvas:user:${req.user.id}:sync:status`);
          const parsedStatus = parseSyncStatus(syncStatusRaw);
          if (parsedStatus === "running") {
            // Dobbelt-sjekk: ensureCanvasSync kan ha startet synkronisering
            // mellom isSyncing()-kallet og nå — prøv in-memory igjen
            if (isSyncing(req.user.id)) {
              logger.info({ userId: req.user.id }, "Venter på Canvas sync før KI-kontekst (in-memory, re-check)");
              await waitForSync(req.user.id, SYNC_WAIT_MAX_MS);
            } else {
              logger.info({ userId: req.user.id }, "Venter på Canvas sync før KI-kontekst (Redis-flagg)");
              const POLL_INTERVAL = 500;
              const maxPolls = Math.ceil(SYNC_WAIT_MAX_MS / POLL_INTERVAL);
              for (let i = 0; i < maxPolls; i++) {
                await new Promise((r) => setTimeout(r, POLL_INTERVAL));
                // Sjekk in-memory først — synkroniseringen kan ha blitt plukket opp lokalt
                if (isSyncing(req.user.id)) {
                  const remainingMs = Math.max(SYNC_WAIT_MAX_MS - (i + 1) * POLL_INTERVAL, 0);
                  await waitForSync(req.user.id, remainingMs);
                  break;
                }
                const statusRaw = await getCache(`canvas:user:${req.user.id}:sync:status`);
                if (parseSyncStatus(statusRaw) !== "running") break;
              }
            }
          }
        }
      } catch (syncErr) {
        logger.warn(
          { err: syncErr, userId: req.user.id },
          "Sync-venting feilet — fortsetter KI-flyt uten å vente på sync",
        );
      }

      // Ekstraher eventuelle emne/modul-hint fra siste brukermelding
      // NB: resolveTargetAgainstKnownCourses kalles ETTER sesjonslås-logikken
      // slik at låst courseHint ikke blir overstyrt av feilaktig kursoppløsning.
      const lastUserMsg = messages.filter((m: { role: string }) => m.role === "user").at(-1)?.content ?? "";

      // Referensielle fraser peker tilbake til forrige tur. Walk bakover gjennom
      // brukermeldinger til vi finner én med faktiske hints (moduleHint eller
      // numericHints) — brukeren kan ha stilt samme referensielle spørsmål
      // flere ganger på rad, og da må vi finne det opprinnelige konkrete
      // spørsmålet lenger bak i historikken.
      //
      // Mønsteret dekker:
      //   - Kvantifiserende referanser: "begge", "disse", "de to", "den første"
      //   - Objekt-referanser: "svaret ditt", "forrige svar", "det du sa/skrev"
      //   - Utdypings-verb uten nytt subjekt: "utdyp mer", "fortsett", "gi mer
      //     detaljer", "forklar mer" — disse er nesten alltid follow-up til
      //     noe allerede sagt.
      const REFERENTIAL_PATTERN =
        /\b(begge|disse|dem|de to|den første|den andre|den ene|those|these|both|svaret ditt|forrige svar|det du sa|det du skrev|utdype svaret|utdyp svaret|fortsett|forklar mer|gi mer detaljer|mer om dette|mer om det|kan du utdype)\b/i;
      // Ny-artefakt-mønster: når brukeren ber om et NYTT output (quiz,
      // oppgaver, flashcards, eksamensoppgaver, test), er det IKKE en
      // oppfølging av tidligere analyse — selv om meldingen inneholder
      // referensielle pronomener som "disse"/"dem".
      //
      // Bug-scenario dette forhindrer: etter "Leksjon 8 ta denne next"
      // spør brukeren "tidligere eksamensoppgavene kan du hjelpe med disse
      // og lage oppgaver om dem?". "disse" og "dem" refererer til eksamens-
      // oppgavene AI nevnte i sitt forrige svar — IKKE til Leksjon 8. Uten
      // denne sjekken arver systemet Leksjon 8-hint og serverer cached
      // Leksjon 8-oppsummering i stedet for å generere faktiske oppgaver.
      const NEW_ARTIFACT_PATTERN =
        /\b(lag(?:e|et|en)?\s+(?:oppgav|quiz|test|spørsmål|flashcard|eksempel)|generer|eksamensoppgav|test meg|spør meg|hjelp.{0,20}(?:lag|generer|lage))\b/i;
      const currentIsReferential = REFERENTIAL_PATTERN.test(lastUserMsg);
      const currentRequestsNewArtifact = NEW_ARTIFACT_PATTERN.test(lastUserMsg);
      // Ekstraher current-target én gang opp front — brukes både til å sjekke
      // om current HAR sine egne konkrete hint (i så fall skal vi IKKE arve
      // fra tidligere melding), og som utgangspunkt for `target` nedstrøms.
      //
      // Bug-scenario dette forhindrer: bruker spør "kapittel 16–18 kan du
      // oppsummere disse?" etter en tidligere melding om "kapittel 5 og 7".
      // Uten denne sjekken matcher "disse" REFERENTIAL_PATTERN, systemet
      // arver "kapittel 5 og 7", og moduleHint låses til feil kapittel —
      // selv om current-meldingen selv inneholder "kapittel 16–18". Vi skal
      // kun arve når current-meldingen er PURT referensiell (bare "disse",
      // "begge", "fortsett" osv. uten eget konkret hint).
      const currentTarget = extractQueryTarget(lastUserMsg);
      const currentHasOwnConcreteHint = !!(
        currentTarget.moduleHint || currentTarget.fileHint
      );
      let effectiveMsgForTargeting = lastUserMsg;
      let target = currentTarget;
      let inheritedFromPrior: string | null = null;
      if (
        currentIsReferential &&
        !currentHasOwnConcreteHint &&
        !currentRequestsNewArtifact
      ) {
        const priorUserMessages = messages
          .filter((m: { role: string }) => m.role === "user")
          .slice(0, -1) // alt unntatt nåværende
          .map((m: { content: string }) => m.content)
          .reverse(); // nyeste først
        for (const prev of priorUserMessages) {
          // Hopp over prior meldinger som også er referensielle (samme oppfølging)
          if (REFERENTIAL_PATTERN.test(prev)) continue;
          // Prøv å ekstrahere hints — hvis prev gir moduleHint eller fileHint,
          // er det en "konkret" melding å arve fra. (numericHints sjekkes ikke
          // her fordi de ekstraheres inne i context-loader; bruker moduleHint
          // som proxy — hvis bruker skrev "kapittel 1 og 2", vil moduleHint
          // fanges opp.)
          const prevTarget = extractQueryTarget(prev);
          if (prevTarget.moduleHint || prevTarget.fileHint) {
            inheritedFromPrior = prev;
            break;
          }
        }
        if (inheritedFromPrior) {
          effectiveMsgForTargeting = `${inheritedFromPrior} ${lastUserMsg}`;
          target = extractQueryTarget(effectiveMsgForTargeting);
          logger.info(
            {
              currentPreview: lastUserMsg.slice(0, 80),
              inheritedPreview: inheritedFromPrior.slice(0, 80),
            },
            "Referensiell oppfølging: arvet hint fra tidligere konkret melding",
          );
        }
      }
      // Variabel eksponert for evt. fremtidig bruk; ikke referert her.
      void inheritedFromPrior;
      const isLikelyFollowUp = isLikelyFollowUpQuestion(lastUserMsg);

      // ─── Session-locked courseHint ───
      // Bruker Redis for å låse courseHint til første gyldige ekstraksjon i sesjonen.
      // Oppdateres KUN ved eksplisitt kursbytte-signal fra brukeren.
      // Alle courseHint-verdier saniteres før lagring/sammenligning for konsistent matching.
      // NB: nøkkelen ligger BEVISST utenfor `ki:session:*`-pattern slik at canvas-sync sin
      // session-cache-invalidering ikke sletter sesjonslåsen mellom oppfølgingsspørsmål.
      // Per-chat lås (se chatScopedKey-kommentar). Tidligere var denne per-bruker,
      // som gjorde at courseHint lekket mellom samtaler — brukeren byttet fra 6105N-chat
      // til Metode-chat og fikk fortsatt 6105N-kontekst fordi låsen var delt.
      const courseHintLockKey = chatScopedKey(req.user.id, chatLockId, "locked-course-hint");
      const SESSION_COURSEHINT_TTL = 3600; // 1 time — matcher typisk chat-sesjon

      // Persistent kurs-lås på selve chat-dokumentet. Redis-låsen er ephemeral (1t TTL)
      // og overlever ikke serveromstart eller lange pauser, så vi lagrer også primær-
      // kurset på ChatHistory. Dette er siste forsvarslinje mot cross-course-lekkasje
      // når brukeren spør tvetydige oppfølginger som "modul 7" i en etablert samtale.
      const chatObjectIdRegex = /^[0-9a-fA-F]{24}$/;
      const chatIdIsObjectId = chatObjectIdRegex.test(chatLockId);
      let persistentPrimaryCourseId: string | null = null;
      let persistentPrimaryCourseHint: string | null = null;
      if (chatIdIsObjectId) {
        const chatDoc = await ChatHistory.findOne({ _id: chatLockId, user: req.user.id })
          .select("primaryCourseId primaryCourseHint")
          .lean();
        if (chatDoc) {
          persistentPrimaryCourseId = chatDoc.primaryCourseId ?? null;
          persistentPrimaryCourseHint = chatDoc.primaryCourseHint
            ? sanitizeCourseHintValue(chatDoc.primaryCourseHint)
            : null;
        }
      }

      const lockedCourseHintRaw = await getCache(courseHintLockKey);
      const redisLockedCourseHint = lockedCourseHintRaw ? sanitizeCourseHintValue(lockedCourseHintRaw) : null;
      // Redis-låsen går foran persistert primær når begge finnes — Redis gjenspeiler
      // siste aktive valg i sesjonen, mens persistert primær er satt første gang.
      const lockedCourseHint = redisLockedCourseHint ?? persistentPrimaryCourseHint;
      const sanitizedTargetHint = target.courseHint ? sanitizeCourseHintValue(target.courseHint) : null;
      const hasOverride = hasExplicitCourseOverride(lastUserMsg);
      const shouldReuseLockedCourseHint = isLikelyFollowUp
        || refersToCurrentCourseContext(lastUserMsg);
      const hasBaseSlashCommand = extractSlashKBBaseName(lastUserMsg) !== null;
      const mentionsKnowledgeBase = /\b(?:basen|kunnskapsbase|knowledge base)\b/i.test(normaliserSkrivefeil(lastUserMsg));

      if (hasOverride && sanitizedTargetHint) {
        // Bruker vil eksplisitt bytte kurs — oppdater låsen
        await setCache(courseHintLockKey, sanitizedTargetHint, SESSION_COURSEHINT_TTL);
        target.courseHint = sanitizedTargetHint;
        logger.info(
          { courseHint: sanitizedTargetHint, override: true },
          "courseHint låst (eksplisitt override)",
        );
      } else if (lockedCourseHint) {
        // Refresh Redis-låsen når den kun kom fra persistert primær — reduserer DB-hits
        // for oppfølgende spørsmål i samme sesjon.
        if (redisLockedCourseHint === null && persistentPrimaryCourseHint) {
          await setCache(courseHintLockKey, persistentPrimaryCourseHint, SESSION_COURSEHINT_TTL);
          logger.info(
            { courseHint: persistentPrimaryCourseHint, source: "persistentPrimary" },
            "Redis-lås refreshet fra persistert primær-kurs",
          );
        }
        // Bruk eksisterende låst courseHint kun når meldingen ikke gir ny eksplisitt courseHint.
        // Dette hindrer at sesjonslås overstyrer ny emnekode som 6105N.
        if (!sanitizedTargetHint && !hasBaseSlashCommand && !mentionsKnowledgeBase) {
          // Arv alltid den låste hintet når meldingen ikke nevner et nytt kurs.
          // Tidligere dropp ved "bredt spørsmål" førte til at oppfølginger som
          // "forklar hva forelesningene har gått ut på?" mistet kurskonteksten.
          target.courseHint = lockedCourseHint;
          // Prefill courseIdHint fra persistert primær når tilgjengelig — låste
          // courseHint-verdier er aggressivt saniterte (ingen mellomrom, ingen
          // æøå), og `resolveTargetAgainstKnownCourses` klarer ikke alltid å
          // matche dem tilbake mot emnekatalogen. Uten prefill havner vi i
          // fallback-modus med tom kurskontekst når brukeren stiller en
          // oppfølging uten eksplisitt kursnavn (observert: "utdyp dilemmaer"
          // i en ORL1000-samtale gav contextLength: 0).
          if (persistentPrimaryCourseId && target.courseIdHint == null) {
            const parsedId = Number(persistentPrimaryCourseId);
            if (Number.isFinite(parsedId)) target.courseIdHint = parsedId;
          }
          logger.info(
            {
              courseHint: target.courseHint,
              courseIdHint: target.courseIdHint,
              fromLock: true,
              fromPersistent: redisLockedCourseHint === null,
              reason: shouldReuseLockedCourseHint ? "followUpMarker" : "noNewCourseRef",
            },
            "courseHint arvet fra sesjonslås",
          );
        } else if (sanitizedTargetHint && sanitizedTargetHint !== lockedCourseHint && hasOverride) {
          await setCache(courseHintLockKey, sanitizedTargetHint, SESSION_COURSEHINT_TTL);
          target.courseHint = sanitizedTargetHint;
          logger.info(
            { previousCourseHint: lockedCourseHint, courseHint: sanitizedTargetHint, override: true },
            "courseHint oppdatert fra ny eksplisitt hint",
          );
        } else if (sanitizedTargetHint !== lockedCourseHint && !hasBaseSlashCommand && !mentionsKnowledgeBase) {
          target.courseHint = lockedCourseHint;
          // Prefill courseIdHint fra persistert primær — ellers trigger
          // resolveModuleHintToCourse og kan hoppe til feil kurs (f.eks.
          // ORL1000 "leksjon 8 (ledelse)" → fant "Leksjon 8: Graph Basics"
          // i 6124-1 Algoritmer). Lås-hinten er aggressivt sanitert og
          // matcher ikke alltid katalogen, så en tom courseIdHint fører
          // til katalogtraversering som ignorerer låsens faktiske kurs.
          if (persistentPrimaryCourseId) {
            const parsedId = Number(persistentPrimaryCourseId);
            target.courseIdHint = Number.isFinite(parsedId) ? parsedId : null;
          } else {
            target.courseIdHint = null;
          }
          logger.info(
            {
              courseHint: target.courseHint,
              courseIdHint: target.courseIdHint,
              fromLock: true,
              ignoredHint: sanitizedTargetHint,
            },
            "courseHint beholdt fra sesjonslås (ingen eksplisitt override)",
          );
        } else {
          // Verdiene er like etter sanitering — bruk låst verdi
          target.courseHint = lockedCourseHint;
        }
      } else if (sanitizedTargetHint) {
        // Første gang vi ekstraherer courseHint — lås den for sesjonen
        await setCache(courseHintLockKey, sanitizedTargetHint, SESSION_COURSEHINT_TTL);
        target.courseHint = sanitizedTargetHint;
        logger.info(
          { courseHint: sanitizedTargetHint, newLock: true },
          "courseHint låst (første ekstraksjon)",
        );
      } else {
        // Ingen lås (f.eks. bruker har gjenåpnet en gammel chat etter at Redis-låsen
        // utløp) og ingen hint i siste melding — skann tidligere brukermeldinger i
        // samtalehistorikken for å gjenfinne kurskonteksten. Dette gjør at oppfølginger
        // i gamle chatter ikke "glemmer" hvilket emne samtalen handler om.
        const tidligereBrukerMeldinger = messages
          .filter((m: { role: string }) => m.role === "user")
          .slice(0, -1)
          .map((m: { content: string }) => m.content)
          .reverse();
        for (const tidligere of tidligereBrukerMeldinger) {
          const tidligereTarget = extractQueryTarget(tidligere);
          const tidligereHint = tidligereTarget.courseHint
            ? sanitizeCourseHintValue(tidligereTarget.courseHint)
            : null;
          if (tidligereHint) {
            target.courseHint = tidligereHint;
            await setCache(courseHintLockKey, tidligereHint, SESSION_COURSEHINT_TTL);
            logger.info(
              { courseHint: tidligereHint, fromHistory: true },
              "courseHint gjenfunnet fra samtalehistorikk (gjenopptatt chat)",
            );
            break;
          }
        }
      }
      // Hvis ingen courseHint finnes og ingen lås — fortsett uten (bredt søk)

      // Kjør alltid katalogmatching når courseIdHint mangler — også uten courseHint.
      // Dette gjør at meldinger som "Organiserings emnet snart eksamen" fortsatt kan
      // matches mot brukerens faktiske emnekatalog basert på selve meldingsteksten.
      if (target.courseIdHint == null) {
        target = await resolveTargetAgainstKnownCourses(req.user.id, target, lastUserMsg);
      }

      // Fallback: når det finnes moduleHint (f.eks. "uke 7") men ingen courseHint,
      // søk i CanvasStructure for å finne hvilket kurs som eier den modulen.
      if (target.courseIdHint == null && target.moduleHint) {
        target = await resolveModuleHintToCourse(req.user.id, target, lastUserMsg);

        // Oppdater sesjonslåsen hvis vi fant et kurs via moduloppslag
        if (target.courseHint) {
          const resolvedLockValue = sanitizeCourseHintValue(target.courseHint);
          await setCache(courseHintLockKey, resolvedLockValue, SESSION_COURSEHINT_TTL);
          logger.info(
            { courseHint: resolvedLockValue, source: "moduleHintResolution" },
            "courseHint oppdatert fra moduloppslag",
          );
        }
      }

      traceCourseIdHint = target.courseIdHint;
      traceCourseHint = target.courseHint;
      traceModuleHint = target.moduleHint;
      traceFileHint = target.fileHint;
      tracePersistentPrimaryCourseId = persistentPrimaryCourseId;

      // Persistér primær-kurs på ChatHistory første gang vi har løst det. Dette er
      // siste forsvarslinje mot at en tvetydig oppfølging ("modul 7") henter innhold
      // fra feil kurs etter at Redis-låsen har utløpt. Eksplisitt override oppdaterer
      // også den persistente primæren slik at senere oppfølginger følger det nye kurset.
      if (chatIdIsObjectId && target.courseIdHint != null) {
        const currentCourseIdStr = String(target.courseIdHint);
        const currentHintStr = target.courseHint ? sanitizeCourseHintValue(target.courseHint) : null;
        const hasExplicitOverrideNow = hasExplicitCourseOverride(lastUserMsg);
        const shouldPersist =
          persistentPrimaryCourseId === null
          || (hasExplicitOverrideNow && persistentPrimaryCourseId !== currentCourseIdStr);
        if (shouldPersist) {
          try {
            await ChatHistory.updateOne(
              { _id: chatLockId, user: req.user.id },
              {
                $set: {
                  primaryCourseId: currentCourseIdStr,
                  ...(currentHintStr ? { primaryCourseHint: currentHintStr } : {}),
                },
              },
            );
            persistentPrimaryCourseId = currentCourseIdStr;
            tracePersistentPrimaryCourseId = currentCourseIdStr;
            if (currentHintStr) persistentPrimaryCourseHint = currentHintStr;
            logger.info(
              {
                chatId: chatLockId,
                primaryCourseId: currentCourseIdStr,
                primaryCourseHint: currentHintStr,
                reason: hasExplicitOverrideNow ? "explicitOverride" : "firstResolve",
              },
              "Persistert primaryCourseId på chat-dokument",
            );
          } catch (err) {
            logger.warn(
              { err, chatId: chatLockId },
              "Kunne ikke persistere primaryCourseId — fortsetter uten",
            );
          }
        }
      }

      logger.info(
        { intent, target, messagePreview: lastUserMsg.substring(0, 100) },
        "KI chat: intent og target ekstrahert",
      );

      // Session-level chunk caching: gjenbruk kontekst kun for eksakt samme spørsmål om samme kurs.
      // queryHash sørger for at oppfølgingsspørsmål om nytt tema ikke gjenbruker gammel kontekst.
      // SHA-256 brukes (ikke MD5) for å tilfredsstille sikkerhetslinter; dette er kun cache-nøkkel, ikke passord.
      const queryHash = createHash("sha256")
        .update(lastUserMsg.toLowerCase().trim())
        .digest("hex")
        .slice(0, 8);
      const followUpWithoutCourseHint =
        !target.courseHint &&
        isLikelyFollowUpQuestion(lastUserMsg);
      const scopedCourseHint = target.courseHint ?? lockedCourseHint;
      const courseHintCacheSegment = scopedCourseHint
        ? buildCourseHintCacheSegment(scopedCourseHint)
        : null;
      // Chat-scoped session-cache (se chatScopedKey-kommentar). Tidligere var
      // last-course og course:<hint>:<query>-cachen per-bruker, noe som gjorde
      // at en oppfølging i én chat kunne treffe cache fra en annen chat.
      const lastCourseSessionKey =
        courseHintCacheSegment
          ? chatScopedKey(req.user.id, chatLockId, "last-course", courseHintCacheSegment)
          : chatScopedKey(req.user.id, chatLockId, "last-course");
      const sessionCacheKey = target.courseHint
        ? chatScopedKey(
            req.user.id,
            chatLockId,
            "course",
            buildCourseHintCacheSegment(target.courseHint),
            queryHash,
          )
        : followUpWithoutCourseHint
          ? lastCourseSessionKey
          : null;
      const cachedSessionCtx = sessionCacheKey ? await getCache(sessionCacheKey) : null;
      let contextResult: ContextResult = { kontekst: "", hasCanvasData: false, source: "none" };
      let usedSessionCache = false;

      if (cachedSessionCtx) {
        try {
          const parsed = ContextResultSchema.safeParse(JSON.parse(cachedSessionCtx));
          if (!parsed.success) {
            logger.warn({ sessionCacheKey, errors: parsed.error.issues }, "Ugyldig struktur i session-cache — henter på nytt");
          } else {
            const parsedData = parsed.data;
            const cacheMissingSources =
              parsedData.hasCanvasData &&
              parsedData.source !== "none" &&
              (!parsedData.kilder || parsedData.kilder.length === 0);
            if (cacheMissingSources) {
              logger.info(
                { sessionCacheKey, source: parsedData.source, contextLength: parsedData.kontekst.length },
                "Session-cache mangler kilder — henter fersk kontekst",
              );
            } else {
              contextResult = parsedData;
              usedSessionCache = true;
              logger.info(
                { sessionCacheKey, contextLength: contextResult.kontekst.length },
                "Bruker cached session-kontekst for kurs",
              );
            }
          }
        } catch {
          logger.warn({ sessionCacheKey }, "Ugyldig JSON i session-cache — henter på nytt");
        }
      }

      if (!usedSessionCache) {
        // Lagre timeout-handle slik at vi kan rydde opp etter Promise.race
        let contextTimeoutHandle: ReturnType<typeof setTimeout> | undefined;
        contextResult = await Promise.race([
          loadCanvasContext(
            req.user.id,
            req.canvasToken,
            intent,
            target,
            // effectiveMsgForTargeting = lastUserMsg når ikke referensiell.
            // Når referensiell, inkluderer den forrige brukermelding slik at
            // numericHints/moduleHint-ekstraksjon inne i context-loader
            // (f.eks. velgPrimaerFilForFullDocument) får tilgang til prior
            // kontekst uten at vi må endre funksjonssignaturen.
            effectiveMsgForTargeting,
            baseUrl,
            abortController.signal,
            contextPrefs,
            hiddenCourseIds,
          ),
          new Promise<ContextResult>((resolve) => {
            contextTimeoutHandle = setTimeout(
              () => resolve({ kontekst: "[CANVAS STATUS: Henting tok for lang tid. Prøv igjen.]", hasCanvasData: false, source: "none" }),
              KI_TIMEOUT_MS,
            );
          }),
        ]);
        // Rydd opp timeout for å unngå timer-lekkasje
        if (contextTimeoutHandle) clearTimeout(contextTimeoutHandle);

        // Cache for oppfølgingsspørsmål i samme sesjon (kun når vi fikk faktisk data)
        const hasRichCanvasContent =
          contextResult.hasCanvasData &&
          (contextResult.kontekst.includes("--- PDF-INNHOLD:") ||
            contextResult.kontekst.includes("--- FIL-INNHOLD:") ||
            target.courseIdHint !== null ||
            !!target.courseHint ||
            !!target.moduleHint ||
            !!target.fileHint);

        // Fil-/PDF-innhold skal aldri lagres i Redis (kun i MongoDB) — cache kun strukturell kontekst
        const kontekstHarFilInnhold =
          contextResult.kontekst.includes("--- PDF-INNHOLD:") ||
          contextResult.kontekst.includes("--- FIL-INNHOLD:") ||
          contextResult.kontekst.includes("--- FIL-INNHOLD (FULLT DOKUMENT):");

        if (sessionCacheKey && contextResult.hasCanvasData && !kontekstHarFilInnhold) {
          await setCache(sessionCacheKey, JSON.stringify(contextResult), SESSION_CONTEXT_TTL);
        }
        // lastCourseSessionKey og sessionCacheKey kan peke på samme nøkkel når followUpWithoutCourseHint=true.
        // Skriv kun til lastCourseSessionKey separat når de er forskjellige, og kun ved rikt innhold —
        // unngår at svakt innhold fra follow-up forgifter last-course-cachen.
        if (hasRichCanvasContent && !kontekstHarFilInnhold && lastCourseSessionKey !== sessionCacheKey) {
          await setCache(lastCourseSessionKey, JSON.stringify(contextResult), SESSION_CONTEXT_TTL);
        }
      }

      canvasKontekst = contextResult.kontekst;
      hasCanvasData = contextResult.hasCanvasData;
      fullDocumentModeActive = !!contextResult.fullDocumentMode;
      fullDocumentTriggerWord = contextResult.fullDocumentTriggerWord ?? null;
      fullDocumentPrimaryFileId = contextResult.primaryFileId ?? null;
      contextKilder = contextResult.kilder && contextResult.kilder.length > 0 ? contextResult.kilder : undefined;
      syncJustWaited = !!contextResult.syncWaited;

      // Cross-course-guard: hvis samtalens primær-kurs er satt og retrieval
      // returnerte innhold fra et ANNET kurs, må modellen varsle brukeren
      // eksplisitt — aldri skjule at kilden er fra feil kurs. Dette er sist-
      // linje-forsvar mot lekkasjen brukeren observerte da "modul 7" i en
      // MET1020-samtale ble besvart med 6105N-innhold.
      if (persistentPrimaryCourseId && contextKilder && contextKilder.length > 0) {
        const guard = evaluateCrossCourseGuard({
          primaryCourseId: persistentPrimaryCourseId,
          primaryCourseHint: persistentPrimaryCourseHint,
          kilder: contextKilder,
          userExplicitlyReferencedOtherCourse: hasExplicitCourseOverride(lastUserMsg),
        });
        if (guard.triggered && guard.promptBlock) {
          enhancedSystemPrompt += guard.promptBlock;
          crossCourseGuardTriggered = true;
          logger.warn(
            {
              chatId: chatLockId,
              primaryCourseId: persistentPrimaryCourseId,
              foreignCourseIds: guard.foreignCourseIds,
              inScopeCount: guard.inScopeCount,
              outOfScopeCount: guard.outOfScopeCount,
            },
            "Cross-course retrieval oppdaget — injiserte guard i system-prompt",
          );
        }
      }

      // Hvis Canvas-sync akkurat måtte trigges for dette emnet, kan filinnhold
      // være ufullstendig. Vi instruerer modellen om å være tydelig på årsaken
      // i stedet for å si "jeg har ikke tilgang" — og lenger ned bytter vi
      // også til Haiku for rask respons.
      if (contextResult.syncWaited) {
        enhancedSystemPrompt += `

## Canvas-sync pågår

StudyWise har nettopp startet synkronisering av dette emnet fra Canvas. Modul- og oppgavemetadata er tilgjengelig, men filinnhold er kanskje ikke ferdig indeksert ennå.

Hvis brukeren spør om konkret innhold i filer (presentasjoner, PDF, dokumenter):
- Forklar at synkroniseringen nettopp startet og at filinnholdet blir tilgjengelig innen ~30 sekunder.
- Be brukeren stille spørsmålet på nytt etter litt tid.
- Hvis du har metadata (filnavn, modulnavn), bruk det til å bekrefte at filen finnes, men vær ærlig om at selve innholdet ikke er lastet ennå.
- Ikke si bare "jeg har ikke tilgang" — si hvorfor (sync pågår) og hva brukeren kan gjøre (vente litt og spørre igjen).
`;
        logger.info(
          { userId: req.user.id, courseId: target.courseIdHint ?? null },
          "syncWaited=true — la til sync-hint i system prompt",
        );
      }

      // Append instruksjon for sparse innhold (PowerPoint-kulepunkter)
      if (contextResult.hasSparseChunks) {
        enhancedSystemPrompt += `

## Sparse Course Material

Some of the retrieved course material consists of sparse bullet points from PowerPoint slides. For these sections: use the bullet points as structural anchors, but provide a complete and thorough explanation of each point using your knowledge of the subject. Do not simply repeat the bullet points — expand them into full pedagogical explanations so the student gains real understanding.
`;
        logger.info(
          { userId: req.user.id },
          "Sparse chunks detektert — system prompt utvidet",
        );
      }

      if (fullDocumentModeActive) {
        fullDocumentStrictPrefix = `STRICT MODE: You must answer ONLY from the document provided below.
Do NOT use general knowledge. Do NOT invent section headings or examples that are not in the document. If content is missing from the document, say so explicitly. This overrides all other instructions.

`;
        enhancedSystemPrompt += `

## Full Document Mode

You have been given the complete content of the source file below.
Your answer must be based EXCLUSIVELY on this content.

### Course-resolution is already done — DO NOT ask for course clarification
The retrieval pipeline has ALREADY resolved which course the student meant, based
on the session's course-lock and the content of the loaded file. The file shown
below IS the correct source for this conversation.

ABSOLUTE RULE: If there is document content present below, you MUST summarize
it directly. You MUST NOT ask "hvilken kurs mener du?" / "which course do you
mean?" / anything similar. The filename in the context tells you which course
the file is from — use it.

Treat "leksjon N", "kapittel N", and "forelesning N" as equivalent references
to file N in the current course. Never refuse a summary because the terminology
is different from the filename (e.g. "leksjon 4" applied to "Forelesning4.pdf"
is a valid, resolved match — summarize the file).

Ignore any previous assistant turn that asked for course clarification — that
was a model error that should not be repeated. Always prefer summarizing the
loaded document over asking again.

If the same summary (or a summary of the same file) was produced earlier in
the conversation, DO NOT tell the student to "scroll up" or refuse to repeat
it. Produce a fresh summary of the loaded file every time the student asks,
even if similar content was covered before — the student may have forgotten,
want a different angle, or simply want it repeated. Silently provide the
summary; do not comment on having done it before.

### Multi-chapter files — LOCATE THE REQUESTED CHAPTER INSIDE THE FILE
Many lecture files cover MULTIPLE chapters in one PowerPoint/PDF. The
filename may state this explicitly: "Kapittel 5 og 7 - intervju.pptx",
"Kapittel 1 og 2", "Lesson 3-5", etc. When the filename contains multiple
chapter numbers OR separators like "og", "and", "-", "to" between numbers,
the file covers ALL the chapters listed in its name. The content for each
chapter is somewhere in the extracted text — often in order, but not always.

Procedure when the student asks about one specific chapter from a multi-
chapter file:
1. Scan the ENTIRE injected text before concluding anything
2. Look for headings, slide titles, chapter markers ("Kapittel N", slide-
   dividere, tematiske skift)
3. Identify the portion covering the chapter the student asked about
4. Write the summary from THAT portion

If you genuinely cannot find the requested chapter in the injected text
(e.g., the extracted content is truncated and stops before that chapter),
structure your response like this:
- Start with "Basert på [filnavn] fra [kurs]:" as normal
- Write a substantive partial summary of whatever content IS in the file
  that relates to the requested chapter (even slide titles and fragments
  are useful if that's all you have)
- End with ONE sentence noting that some content may be missing from the
  extract, and suggesting the student can upload the file directly for a
  fuller analysis
- Do NOT make "content unavailable" the main content of the response —
  that frustrates the student when you clearly have some information

### Source-match check — SINGLE-chapter files only
This check applies ONLY when the filename unambiguously points to a single
chapter/topic (e.g. "Forelesning4.pdf", "Kapittel 3 - Problemstilling"):
- If the filename clearly shows a different chapter than what the student
  asked for, tell the student explicitly (in Norwegian Bokmål): "Jeg fant
  ikke kapittel X i materialet, men jeg har funnet [filnavn] som dekker
  [faktisk innhold]. Vil du ha en oppsummering av det i stedet?"
- NEVER write a plausible-sounding summary of a chapter the document does not contain. Fabricating source citations is a critical failure.

Rules:
- Cover ALL main topics present in the document, in document order
- Never invent, assume, or add information that is not in the document
- If something is not in the document, say 'dette er ikkje dekka i dette dokumentet' — do not fill in with general knowledge
- Never write sections like 'Praktisk datainnsamling (frå obligoppgåva)' or similar unless that exact heading exists in the document
- If citing a source, always use the real filename provided in the context — never invent a plausible-sounding chapter title
- At the end, write one sentence listing other chapters or topics in this file the student can ask about next

### Depth expectations — GO DEEP, DON'T JUST HEADLINE
When a student asks to summarize a lecture/chapter/leksjon, they want a
pedagogical walkthrough they can study from — NOT a bullet-point table of
contents.

**Minimum length**: aim for **1500-2500 words** (≈ 7000-12000 characters)
whenever the source has enough material to support it. If the source is
~8000 chars or more, your summary MUST be at least 7000 chars. Only go
shorter than 5000 chars when the source itself is genuinely brief.

If you previously produced a compact summary of this same chapter in the
conversation, DO NOT replay the same shape. The student asking again
signals they want MORE depth this time — expand with concrete examples,
term definitions, and elaboration on every topic.

For EVERY main topic in the document:
- A clear heading (## or ###)
- **At least 2 full paragraphs** of explanatory prose (not bullet lists
  alone). Explain the concept, its motivation, and how it applies.
- Every concrete example from the source (tables, cases, quotes, names)
  must appear in your summary. Do not omit the bryllup-example, the
  Snorre-example, the teachers-seat-front example etc. if they are in
  the source.
- Inline definitions of all key terms that appear in the document
- When the document contains a comparison (deduktiv vs. induktiv,
  kvalitativ vs. kvantitativ, naturvitenskap vs. samfunnsvitenskap,
  primær- vs. sekundærkilder), render it as a Markdown table AND a
  short prose paragraph after the table — never table alone.

Explicitly DO NOT:
- Compress a multi-slide distinction (e.g. "begrep" vs. "term") into one
  line. If the source spends two slides on it, you need at least a full
  paragraph per side
- Skip quotes or memorable phrases from the source ("Kulturer spiser
  strategi til frokost", "Ver grei! — Søk sanninga! — Ta ansvar!", etc.)
- Use a flat bullet list where prose would teach better
- Claim to have covered everything by only listing headings — the
  student needs the substance, not the outline

End with a short "Hva kan du også spørre om?"-linje that lists other
chapters/topics in this course material.
`;
        logger.info(
          { userId: req.user.id },
          "Full dokument-mode aktivert — system prompt utvidet",
        );
      }

      logger.info(
        {
          intent,
          source: contextResult.source,
          contextLength: canvasKontekst.length,
          hasCanvasData,
          harCanvasToken: true,
          sessionCached: usedSessionCache,
        },
        "Canvas-kontekst lastet via context-loader",
      );
    } else if (intent === "general_chat") {
      logger.info(
        { intent, harCanvasToken: !!req.canvasToken },
        "Generell chat — hopper over Canvas-kontekst",
      );
    }

    // Dynamisk timeout og max_tokens basert på intent.
    // For tunge general-chat forespørsler (f.eks. live URL med stor PDF-kontekst)
    // øker vi timeout for å unngå falsk CHAT_TIMEOUT.
    //
    // - Full dokument-mode, fordypning ("utdyp", "mer om", "gå igjennom",
    //   "ta denne"): 10000 tokens (≈ 25-30k tegn). Økt fra 8000 etter
    //   telemetri-fanget truncation (TRUNCATION-WARN) på Algoritmer Leksjon
    //   10 "Efficient Algorithm Design" — dense leksjon med 6 tema (BFS,
    //   DP, Knapsack, Backtracking, Bucket/Radix Sort, kompleksitet) traff
    //   eksakt 8000-cap. Tidligere deep-tester brukte 5770-7077 tokens og
    //   var trygge; 10000 gir ~25% ekstra buffer for dense walkthroughs.
    //   Kostnadseffekt begrenset: kun deep-triggere, som cachees i 24 t
    //   etter første kald-generering.
    // - Full dokument-mode, standard ("oppsummer", "sammendrag"): 7000
    //   tokens (≈ 17-21k tegn). Økt fra 6000 etter telemetri-fanget
    //   truncation på "oppsummere kapittel 16-18" — flerkapittel-
    //   oppsummeringer (21k+ tegn PDF som dekker 3 kapitler) traff eksakt
    //   6000-cap. Enkelkapittel-oppsummeringer (Leksjon 4 2949, Leksjon 8
    //   5518, Kapittel 4 5301) var trygge innenfor 6000; 7000 gir buffer
    //   for multi-kapittel-scope uten å eskalere til deep-kost.
    // - Canvas_full chunk-mode: 6000 tokens. "Leksjon X"-spørsmål som ikke
    //   treffer full-dokument-trigger må likevel kunne gi fyldig pensum-
    //   dekning (observert ORL1000 Leksjon 6 kuttet mid-setning på 4000-cap).
    // - Canvas_light / general_chat: lavere cap siden dette er metadata/
    //   korte oppfølginger.
    //
    // classifyTriggerWord er delt med cache-nøkkel-bygging for å unngå at
    // token-cap og cache-klasse driver fra hverandre.
    const isDeepTriggerWord = fullDocumentTriggerWord
      ? classifyTriggerWord(fullDocumentTriggerWord) === "deep"
      : false;
    // Multi-fil-summering: når full_document-mode har lastet 2+ filer
    // (f.eks. "oppsummere leksjon 4 og 5"), trenger svaret tilsvarende mer
    // plass selv om trigger-ordet er "standard". Observert truncation
    // (finishReason=length, outputTokens=7000) på ORL1000 "leksjon 4 og 5"
    // der både Forelesning426.pdf og Forelesning526.pdf ble injisert
    // (totalContextChars 19048) — modellen hadde bare 7000 tokens å levere
    // to komplette leksjons-sammendrag i, og kuttet midt i leksjon 5.
    // Bruker samme cap som deep-triggere siden arbeidsmengden er den samme.
    const multiFileFullDoc =
      fullDocumentModeActive
      && Array.isArray(contextKilder)
      && contextKilder.length >= 2;
    const useDeepBudget = isDeepTriggerWord || multiFileFullDoc;
    const baseMaxTokens = fullDocumentModeActive
      ? (useDeepBudget ? 10000 : 7000)
      : intent === "canvas_full"
        ? 6000
        : intent === "canvas_light"
          ? 2000
          : 1400;
    // Full dokument-mode timeout: deep-cap 10000 tokens kan ta ~180-210 s
    // på Sonnet 4.6 (lineær med output). 240 s gir buffer uten å risikere
    // falske CHAT_TIMEOUT. Standard-cap 7000 tar ~135-150 s — 200 s holder.
    const baseTimeoutMs = fullDocumentModeActive
      ? (useDeepBudget ? 240000 : 200000)
      : intent === "canvas_full"
        ? 120000
        : intent === "canvas_light"
          ? 60000
          : 30000;

    // Token-basert trimming av samtalehistorikk.
    // Reserverer plass til system-prompt + AI-respons, bruker resten til historikk.
    // Claude Sonnet har 200k kontekst. Vi sikrer et minimum historikk-budsjett
    // slik at referensielle oppfølginger ("begge", "den første", "disse") har
    // samtaletråden tilgjengelig — det gamle floor-et på 1000 tokens var for
    // lavt når canvasKontekst er stor (en tidligere modellrespons på 1400+
    // tokens ble kastet i sin helhet).
    const systemPromptTokens = countTokens(enhancedSystemPrompt) + (hasCanvasData ? countTokens(canvasKontekst) : 0);
    const MAX_CONTEXT_TOKENS = intent === "canvas_full" ? 60000 : 20000;
    const MIN_HISTORY_TOKENS = 4000;
    const historyBudget = Math.max(
      MAX_CONTEXT_TOKENS - systemPromptTokens - baseMaxTokens,
      MIN_HISTORY_TOKENS,
    );
    const tokenTrimmedMessages = trimToTokenLimit(messages, historyBudget);
    const trimmedMessages = capHistoryMessageSizes(tokenTrimmedMessages.slice(-8));

    // ——— Studiekontekst fra tidligere samtaler ———
    const studyContextCourseId = hasCanvasData && canvasKontekst.length > 0
      ? extractCourseIdFromContext(canvasKontekst)
      : null;
    const studyContext = await loadStudyContextForUser(req.user!.id, studyContextCourseId);
    if (studyContext) {
      enhancedSystemPrompt += studyContext;
    }

    // ——— Kunnskapsbase via slash-kommando (/basenavn) + automatisk alias-match ———
    let kbKontekst = "";
    let liveUrlKontekst = "";
    const lastUserMessageForKB = trimmedMessages.filter((m) => m.role === "user").at(-1)?.content ?? "";
    const slashBaseName = extractSlashKBBaseName(lastUserMessageForKB);

    if (slashBaseName) {
      const escaped = escapeRegex(slashBaseName);
      const base = await KnowledgeBase.findOne({
        userId: req.user!.id,
        // eslint-disable-next-line security/detect-non-literal-regexp -- escaped via escapeRegex()
        navn: { $regex: new RegExp(`^${escaped}$`, "i") },
      }).lean();

      if (!base) {
        const availableBases = await KnowledgeBase.find({ userId: req.user!.id })
          .select("navn")
          .sort({ navn: 1 })
          .lean();
        const names = availableBases.map((b) => b.navn);
        const responseText = names.length > 0
          ? `Fant ikke kunnskapsbasen "${slashBaseName}". Tilgjengelige baser: ${names.join(", ")}`
          : `Fant ikke kunnskapsbasen "${slashBaseName}". Du har ingen kunnskapsbaser ennå.`;
        const payload = KIChatResponseSchema.parse({
          suksess: true,
          response: responseText,
          model: resolvedRequestedModel,
        });
        if (writeSSE(res, payload)) res.end();
        return;
      }

      await setCache(
        kbSessionKey(req.user!.id, chatLockId),
        JSON.stringify({ id: String(base._id), navn: base.navn }),
        KB_SESSION_TTL,
      );

      const responseText = `Kunnskapsbasen "${base.navn}" er nå aktivert med /. Still et spørsmål om innholdet.`;
      const payload = KIChatResponseSchema.parse({
        suksess: true,
        response: responseText,
        model: resolvedRequestedModel,
      });
      if (writeSSE(res, payload)) res.end();
      return;
    }

    const activeKbRaw = await getCache(kbSessionKey(req.user!.id, chatLockId));
    if (activeKbRaw) {
      try {
        const parsed = JSON.parse(activeKbRaw) as { id?: string; navn?: string };
        if (parsed.id && parsed.navn) {
          const kbResults = await searchKBContent(req.user!.id, parsed.id, lastUserMessageForKB, 8);
          if (kbResults.length > 0) {
            kbKontekst = buildKBContext(kbResults, parsed.navn);
            kbKilder = mapKBResultsToChatSources(kbResults, parsed.navn, parsed.id);
            enhancedSystemPrompt += `

## Kunnskapsbase (aktiv via /)

Bruk innholdet i <kunnskapsbase>-taggene som primærkilde når det er relevant.
Referer til kilde (fil/lenke) i svaret.
`;
            logger.info(
              {
                userId: req.user!.id,
                baseId: parsed.id,
                baseName: parsed.navn,
                resultCount: kbResults.length,
                activation: "session",
                kbContextLength: kbKontekst.length,
              },
              "KB-kontekst lagt til i prompt (sesjonsaktiv base)",
            );
          } else {
            logger.warn(
              {
                userId: req.user!.id,
                baseId: parsed.id,
                baseName: parsed.navn,
                activation: "session",
              },
              "KB aktiv via sesjon, men søk ga ingen treff — KB-kontekst utelatt",
            );
          }
        }
      } catch {
        // ignorer ugyldig cacheverdi
      }
    }

    // Auto-match på basenavn i spørsmål, f.eks. "oppsummer windows"
    if (!kbKontekst) {
      const aliases = extractLikelyKbAliases(lastUserMessageForKB);
      if (aliases.length > 0) {
        const baser = await KnowledgeBase.find({ userId: req.user!.id })
          .select("_id navn")
          .lean();

        // Krever eksakt match mellom et alias og et basenavn for å unngå at en
        // tilfeldig spørring med felles ord aktiverer feil base og dermed lekker
        // sensitivt KB-innhold inn i prompten. Substring-matching ble bevisst
        // fjernet — bruk /baseName for eksplisitt aktivering.
        const scored = baser
          .map((base) => {
            const baseName = normaliserSkrivefeil(base.navn);
            let score = 0;
            for (const alias of aliases) {
              if (baseName === alias) score += 100;
            }
            return { base, score };
          })
          .filter((entry) => entry.score >= 100)
          .sort((a, b) => b.score - a.score);

        const match = scored[0]?.base;
        if (match) {
          const matchId = String(match._id);
          const kbResults = await searchKBContent(req.user!.id, matchId, lastUserMessageForKB, 8);
          if (kbResults.length > 0) {
            kbKontekst = buildKBContext(kbResults, match.navn);
            kbKilder = mapKBResultsToChatSources(kbResults, match.navn, matchId);
            await setCache(
              kbSessionKey(req.user!.id, chatLockId),
              JSON.stringify({ id: matchId, navn: match.navn }),
              KB_SESSION_TTL,
            );

            enhancedSystemPrompt += `

## Kunnskapsbase (automatisk matchet)

Bruk innholdet i <kunnskapsbase>-taggene som primærkilde når det er relevant.
Referer til kilde (fil/lenke) i svaret.
`;
            logger.info(
              {
                userId: req.user!.id,
                baseId: matchId,
                baseName: match.navn,
                resultCount: kbResults.length,
                activation: "auto_match",
                aliases,
                kbContextLength: kbKontekst.length,
              },
              "KB-kontekst lagt til i prompt (auto-matchet fra spørsmål)",
            );
          } else {
            logger.warn(
              {
                userId: req.user!.id,
                baseId: matchId,
                baseName: match.navn,
                activation: "auto_match",
                aliases,
              },
              "KB auto-matchet fra spørsmål, men søk ga ingen treff — KB-kontekst utelatt",
            );
          }
        }
      }
    }

    // Direkte URL i melding (pdf/nettside) prioriteres alltid når bruker faktisk sendte URL.
    // Hvis ingen URL i meldingen, bruker vi eksisterende fallback: kun når KB ikke ga kontekst.
    const shouldFetchLiveUrlContext = hasDirectUrlInLastMessage || !kbKontekst;
    if (shouldFetchLiveUrlContext) {
      liveUrlKontekst = await buildLiveUrlContextFromMessage(lastUserMessageForKB) ?? "";
      if (liveUrlKontekst) {
        const liveSource = extractLiveUrlSource(liveUrlKontekst);
        if (liveSource) liveUrlKilder = [liveSource];
        logger.info(
          {
            intent,
            sourceUrl: liveSource?.sourceUrl ?? null,
            liveUrlContextChars: liveUrlKontekst.length,
            sourceUsedInFinalContext: true,
          },
          "Direkte URL-kontekst lagt til i prompt",
        );
        enhancedSystemPrompt += `

## Direkte URL-kontekst

Når <live_url>-tag finnes, skal du bruke det innholdet som primærkilde.
Oppgi tydelig at svaret er basert på den oppgitte URL-en.
`;
      }
    }

    // System-prompt styres kun av backend (KIChatClientMessageSchema tillater ikke "system" fra klient — prompt-injection-sikring).
    const fullMessages: Array<{
      role: "system" | "user" | "assistant";
      content: string;
      cache_control?: { type: "ephemeral"; ttl?: "5m" | "1h" };
    }> = [
      // 1-time TTL på systemprompt + Canvas-kontekst: studenter stiller ofte
      // flere oppfølgingsspørsmål om samme leksjon over en halvtime eller mer.
      // Standard 5-min TTL utløper ofte midt i en samtale og tvinger full re-
      // prosessering av ~25k tokens. 1h-cache koster marginalt mer per skriv
      // men sparer 5-15 sek per oppfølgning og er dermed netto-gevinst.
      { role: "system", content: fullDocumentStrictPrefix + enhancedSystemPrompt, cache_control: { type: "ephemeral", ttl: "1h" } },
      ...(hasCanvasData
        ? [{ role: "system" as const, content: canvasKontekst, cache_control: { type: "ephemeral" as const, ttl: "1h" as const } }]
        : []),
      ...(kbKontekst
        ? [{ role: "system" as const, content: kbKontekst, cache_control: { type: "ephemeral" as const, ttl: "1h" as const } }]
        : []),
      ...(liveUrlKontekst
        ? [{ role: "system" as const, content: liveUrlKontekst, cache_control: { type: "ephemeral" as const, ttl: "1h" as const } }]
        : []),
      ...trimmedMessages.map((m: { role: string; content: string }) => ({
        role: m.role as "user" | "assistant",
        content: m.content,
      })),
    ];
    const autoSelectedModelBase = selectModel(intent, trimmedMessages.length, hasCanvasData ? canvasKontekst.length : 0);
    const fullDocumentModelSelection = fullDocumentModeActive
      ? chooseModelForFullDocumentMode(autoSelectedModelBase, enhancedSystemPrompt, canvasKontekst, trimmedMessages)
      : { model: autoSelectedModelBase, reason: "base" as const };
    const normalizedLastUserMessage = normaliserSkrivefeil(lastUserMessageForKB);
    const asksForDeepSummary = /\b(oppsummer|oppsummering|summarize|summary|analyser|analyse|utdyp|forklar)\b/i.test(
      normalizedLastUserMessage,
    );
    const shouldEscalateGeneralChatToSonnet =
      intent === "general_chat" &&
      (
        liveUrlKontekst.length >= 2500 ||
        kbKontekst.length >= 6000 ||
        (hasDirectUrlInLastMessage && asksForDeepSummary)
      );
    // Korte oppfølgingsspørsmål på låst kurskontekst ("kan du utdype",
    // "forklar mer", "gi et eksempel") trenger sjelden Sonnet-dyp analyse —
    // Haiku 4.5 svarer ~3x raskere med tilsvarende kvalitet når konteksten
    // allerede er lastet. Full-dokument-modus beskyttes fortsatt av Sonnet
    // siden det er der kvalitetsregresjon er mest merkbar.
    //
    // MEN: når meldingen inneholder en konkret moduleHint eller fileHint
    // (f.eks. "leksjon 6 (makt og beslutninger)"), er dette en ny leksjon-
    // forespørsel — ikke en oppfølgning. Slike spørsmål skal Sonnet svare på
    // for å unngå "vagt svar" (observert ORL1000 Leksjon 6 → Haiku gav kun
    // 1695 tokens med overflatisk dekning).
    const hasModuleOrFileReference = Boolean(
      traceModuleHint || traceFileHint,
    );
    const shouldDowngradeShortFollowUpToHaiku =
      intent === "canvas_full" &&
      !fullDocumentModeActive &&
      !asksForDeepSummary &&
      !hasModuleOrFileReference &&
      lastUserMessageForKB.trim().length <= 80 &&
      trimmedMessages.some((m) => m.role === "assistant");
    // Hvis Canvas-sync nettopp ble trigget (cold data) bytter vi til Haiku
    // for å unngå lang ventetid på første spørsmål om et uindeksert emne.
    // Neste spørsmål vil treffe warm cache og få full Sonnet-kvalitet.
    const selectedModel = requestedModel
      ? resolvedRequestedModel
      : shouldEscalateGeneralChatToSonnet
        ? "claude-sonnet-4-6"
        : syncJustWaited && !fullDocumentModeActive
          ? "claude-haiku-4-5"
          : shouldDowngradeShortFollowUpToHaiku
            ? "claude-haiku-4-5"
            : fullDocumentModelSelection.model;
    const selectedModelReason = requestedModel
      ? "user_selected"
      : shouldEscalateGeneralChatToSonnet
        ? "sonnet_general_heavy"
      : syncJustWaited && !fullDocumentModeActive
        ? "haiku_sync_waited"
      : shouldDowngradeShortFollowUpToHaiku
        ? "haiku_short_followup"
      : selectedModel === "claude-haiku-4-5"
        ? "haiku"
        : "sonnet";
    const heavyGeneralChat = intent === "general_chat" && (
      liveUrlKontekst.length >= 8000 ||
      kbKontekst.length >= 12000 ||
      shouldEscalateGeneralChatToSonnet
    );
    const maxTokens = heavyGeneralChat
      ? Math.max(baseMaxTokens, 2200)
      : baseMaxTokens;
    const TIMEOUT_MS = heavyGeneralChat
      ? Math.max(baseTimeoutMs, 60000)
      : baseTimeoutMs;
    logger.info(
      {
        intent,
        model: selectedModel,
        reason: selectedModelReason,
        requestedModel: requestedModel ?? null,
        messageCount: trimmedMessages.length,
        contextLength: hasCanvasData ? canvasKontekst.length : 0,
      },
      "Valgte modell for KI chat",
    );
    if (fullDocumentModeActive) {
      logger.info(
        {
          mode: "full_document",
          selectedModel,
          selectionReason: fullDocumentModelSelection.reason,
        },
        "Valgte modell for full dokument-mode",
      );
    }

    logger.info(
      {
        intent,
        model: selectedModel,
        messageCount: fullMessages.length,
        harCanvasToken: !!req.canvasToken,
        systemPromptLength: enhancedSystemPrompt.length,
        canvasContextLength: hasCanvasData ? canvasKontekst.length : 0,
        historyCount: trimmedMessages.length,
        maxTokens,
        timeoutMs: TIMEOUT_MS,
        kbContextIncluded: !!kbKontekst,
        liveUrlContextIncluded: !!liveUrlKontekst,
        liveUrlContextLength: liveUrlKontekst.length,
      },
      "Sender til AI-tjenesten",
    );

    // Response-cache lookup: deterministiske leksjon-spørringer kan serveres
    // fra Redis på ~2 sek i stedet for 60-140 sek. Cachen bygges først når
    // vi har sett et vellykket Claude-svar, så første spørring om en leksjon
    // tar normal tid — påfølgende er instant.
    const cacheInput = fullDocumentModeActive && !crossCourseGuardTriggered
      ? {
          primaryCourseId:
            tracePersistentPrimaryCourseId ??
            (traceCourseIdHint != null ? String(traceCourseIdHint) : ""),
          primaryFileId: fullDocumentPrimaryFileId ?? 0,
          triggerWord: fullDocumentTriggerWord,
          moduleHint: traceModuleHint,
          fileHint: traceFileHint,
        }
      : null;
    const responseCacheKey = cacheInput ? buildChatResponseCacheKey(cacheInput) : null;
    if (responseCacheKey) {
      const cached = await getCachedChatResponse(responseCacheKey);
      if (cached) {
        logger.info(
          {
            responseCacheKey,
            responseLength: cached.response.length,
            cachedAt: cached.generatedAt,
            model: cached.model,
          },
          "Chat-respons servert fra cache",
        );
        const cachedKilder = cached.kilder as import("common/ki").KIChatSource[] | undefined;
        const cachedPayload = KIChatResponseSchema.parse({
          suksess: true,
          response: cached.response,
          model: cached.model,
          kilder: cachedKilder,
        });
        sseCleanup?.();
        if (writeSSE(res, cachedPayload)) {
          res.end();
        }
        void audit({
          actorUserId: req.user!.id,
          action: AUDIT_ACTIONS.KI_CHAT,
          category: "ki",
          outcome: "success",
          metadata: { model: cached.model, cached: true, messageCount: messages.length },
          req,
        }).catch((err) => {
          logger.warn({ err, userId: req.user!.id }, "Audit-feil for KI chat (cache-hit)");
        });
        return;
      }
    }

    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutHandle = setTimeout(() => reject(new Error("CHAT_TIMEOUT")), TIMEOUT_MS);
    });

    const result = await Promise.race([
      chatCompletion({
        model: selectedModel,
        messages: fullMessages,
        max_tokens: maxTokens,
        temperature: Math.min(Math.max(temperature, 0), 1),
        signal: abortController.signal,
        traceName: "chat",
        traceMeta: {
          userId: req.user?.id,
          courseId: traceCourseIdHint ?? undefined,
          intent,
          mode: hasCanvasData ? "canvas_context" : "chat",
        },
      }),
      timeoutPromise,
    ]);
    if (timeoutHandle) {
      clearTimeout(timeoutHandle);
      timeoutHandle = undefined;
    }

    sseCleanup?.();

    const responseText = result.text;
    const usage = result.usage;

    logger.info(
      {
        model: selectedModel,
        responseLength: responseText.length,
        tokens: usage?.total_tokens,
      },
      "Vellykket chat-svar",
    );

    // Output-truncation-telemetri: modellen ble kuttet av max_tokens-cap
    // før den fikk avsluttet naturlig. Brukt til å oppdage om cap for en
    // intent-klasse er for stram i praksis — før vi reagerer med å bumpe
    // cap reaktivt. Ved jevnlige hits her for samme intent/triggerWord bør
    // klassifikasjonen i chat-response-cache.service.ts vurderes, eller
    // max_tokens-allokering økes for den intent-klassen.
    if (result.finishReason === "length") {
      logger.warn(
        {
          intent,
          triggerWord: fullDocumentTriggerWord,
          model: selectedModel,
          maxTokens,
          outputTokens: usage?.completion_tokens,
          fullDocumentModeActive,
          primaryFileId: fullDocumentPrimaryFileId,
          moduleHint: traceModuleHint,
          courseId: traceCourseIdHint,
        },
        "TRUNCATION: svaret kuttet av max_tokens-cap — vurder bump eller re-klassifisering av trigger",
      );
    }

    // Når KB eller direkte URL er i spill, prioriter disse kildene over Canvas.
    // Dette unngår at courseHint-lås i Canvas forurenser kildelisten for "basen"-spørsmål.
    const preferNonCanvasSources =
      (kbKilder && kbKilder.length > 0) || (liveUrlKilder && liveUrlKilder.length > 0);
    const mergedSources = preferNonCanvasSources
      ? mergeChatSources(kbKilder, liveUrlKilder)
      : mergeChatSources(contextKilder, kbKilder, liveUrlKilder);

    const payload = KIChatResponseSchema.parse({
      suksess: true,
      response: responseText,
      model: selectedModel,
      usage: usage
        ? {
            prompt_tokens: usage.prompt_tokens,
            completion_tokens: usage.completion_tokens,
            total_tokens: usage.total_tokens,
          }
        : undefined,
      kilder: mergedSources,
    });
    // writeSSE base64-koder JSON-payloaden før den skrives til event-streamen.
    if (writeSSE(res, payload)) {
      res.end();
    }

    // Lagre til response-cache for fremtidige identiske spørringer.
    // Betingelser: full-document-mode aktivert, moduleHint/fileHint satt,
    // ingen cross-course guard, respons > 500 tegn (ikke apology-stil),
    // OG svaret avsluttet naturlig (ikke trunkert av max_tokens-cap).
    // Hvorfor siste krav: cache-TTL er 24 t — å lagre et trunkert svar
    // betyr at alle identiske forespørsler de neste 24 timene får den
    // kuttede versjonen i stedet for et fullstendig re-generert svar.
    // Observert på ORL1000 "leksjon 4 og 5" der et 7000-token-kuttet
    // svar ble cachet og servert tilbake selv etter cap-fiksen.
    const responseWasTruncated = result.finishReason === "length";
    if (
      responseCacheKey &&
      cacheInput &&
      !crossCourseGuardTriggered &&
      !responseWasTruncated &&
      responseText.length > 500
    ) {
      void setCachedChatResponse(responseCacheKey, {
        response: responseText,
        kilder: mergedSources,
        model: selectedModel,
        primaryCourseId: cacheInput.primaryCourseId,
        primaryFileId: cacheInput.primaryFileId,
        ...(fullDocumentTriggerWord ? { triggerWord: fullDocumentTriggerWord } : {}),
      }).catch((err) => {
        logger.warn({ err, responseCacheKey }, "setCachedChatResponse feilet");
      });
    } else if (responseCacheKey && responseWasTruncated) {
      // Eksplisitt skip-log: enklere å spore i telemetri at cap-problemer
      // ikke samtidig forgifter cachen.
      logger.info(
        { responseCacheKey, finishReason: result.finishReason },
        "Hopper over cache-lagring: svar ble trunkert",
      );
    }

    const responseDurationMs = Date.now() - chatStartedAt;
    if (responseDurationMs >= AI_COMPLETION_PUSH_MIN_DURATION_MS) {
      void sendAICompletionWebPush({
        userId: req.user!.id,
        url: "/dashboard",
        tag: `studywise-ai-response-${req.user!.id}`,
      }).catch((err) => {
        logger.warn(
          { err, userId: req.user!.id },
          "Kunne ikke sende nettleservarsel for ferdig KI-svar",
        );
      });
    }

    void audit({
      actorUserId: req.user!.id,
      action: AUDIT_ACTIONS.KI_CHAT,
      category: "ki",
      outcome: "success",
      metadata: { model: selectedModel, tokens: usage?.total_tokens, messageCount: messages.length },
      req,
    }).catch((err) => {
      logger.warn({ err, userId: req.user!.id }, "Audit-feil for KI chat");
    });

    // Oppdater studiekontekst for hukommelse på tvers av samtaler (fire-and-forget)
    if (hasCanvasData && lastUserMessage) {
      void updateStudyContext(
        req.user!.id,
        traceCourseIdHint != null ? String(traceCourseIdHint) : null,
        traceCourseHint,
        lastUserMessage,
        responseText,
      ).catch((err) => {
        logger.warn({ err, userId: req.user!.id }, "Feil ved oppdatering av studiekontekst");
      });
    }

    return;
  } catch (error) {
    sseCleanup?.();

    // Respons allerede avsluttet — ingenting mer å gjøre
    if (res.writableEnded) return;

    // Hvis SSE-headere allerede er sendt, send feil via SSE
    if (sseStarted) {
      const errorMessage = error instanceof Error && error.message === "CHAT_TIMEOUT"
        ? "Chat-forespørselen tok for lang tid. Prøv igjen eller forenkle spørsmålet."
        : "Kunne ikke få svar fra KI-assistenten. Prøv igjen senere.";

      logger.error({ err: error }, "ki-chat feil (SSE)");
      const errorPayload = KIChatResponseSchema.parse({
        suksess: false,
        melding: errorMessage,
        response: "",
      });
      if (writeSSE(res, errorPayload)) {
        res.end();
      }
      return;
    }

    // Headers not sent yet — use normal JSON error response
    handleAIError(res, error, KIChatResponseSchema, {
      timeoutLabel: "CHAT_TIMEOUT",
      timeoutMessage:
        "Chat-forespørselen tok for lang tid. Prøv igjen eller forenkle spørsmålet.",
      kontekst: "ki-chat",
    });
    return;
  } finally {
    if (timeoutHandle) {
      clearTimeout(timeoutHandle);
    }
    abortController.cleanup();
    res.off("finish", abortOnResponseEnd);
    res.off("close", abortOnResponseEnd);
  }
});

export default router;


