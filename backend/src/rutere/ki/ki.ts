/*
* Rutere for KI-relaterte endepunkter
* Bruker Claude (Anthropic) som AI-leverandør
*/

import { Router } from "express";
import { createHash } from "crypto";
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
} from "common/ki";
import { kiHistoryRouter } from "./kiHistory.js";
import { kiAnalyseRouter } from "./kiAnalyse.js";
import { kiShareRouter } from "./kiShare.js";
import { SUPPORTED_MODELS, DEFAULT_MODEL, resolveModel } from "./aiModels.js";
import { STUDYWISE_SYSTEM_PROMPT } from "./systemPrompt.js";
import { chatCompletion } from "./aiClient.js";
import { handleAIError, checkAIClientUnavailable } from "./handleAIError.js";
import { loadCanvasContext, ensureCanvasSync, ContextResultSchema, type IntentType, type ContextResult } from "../../services/context-loader.service.js";
import { isSyncing, waitForSync } from "../../services/canvas-sync.service.js";
import { trimToTokenLimit, countTokens } from "../../utils/tokenCounter.js";
import { knyttCanvasTokenValgfritt } from "../../middleware/auth.js";
import { setupSSE, writeSSE } from "../../utils/sseUtils.js";
import { createLinkedAbortController } from "../../utils/abort.js";

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
  "slide", "dokument", "kunngjøring", "kunngjøringer", "kunngjøringene", "sideinnhold",
  // Faglige spørsmål — indikerer at brukeren spør om innhold, ikke struktur
  "hvordan fungerer", "hvordan virker", "hva skjer med",
  "definer", "definisjon", "konsept", "teori",
  "forskjell mellom", "forskjellen",
];

/**
 * Fagbegreper som indikerer et innholds-/tematisk spørsmål.
 * Når brukeren bruker et slikt begrep, er det ALLTID canvas_full.
 */
const TOPIC_KEYWORDS = [
  // Algoritmer og datastrukturer
  "avl", "tree", "binary", "heap", "graf", "graph", "stack", "queue",
  "linked list", "hashtabell", "hash", "sortering", "søk", "rekursjon",
  "kompleksitet", "big-o", "big o", "traversering", "dfs", "bfs",
  "dijkstra", "dynamic programming", "dynamisk programmering",
  // Generelle CS-begreper
  "design pattern", "objektorientert", "arv", "polymorfisme",
  "interface", "abstraksjon", "innkapsling", "tråd", "mutex",
  "sql", "normalisering", "relasjon", "kryptering", "protokoll",
];

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
];

/** Vanlige skrivefeil/forkortelser og deres normaliserte form */
const SKRIVEFEIL_MAP: Record<string, string> = {
  "algoritme": "algoritmer",
  "algortimer": "algoritmer",
  "algoritmner": "algoritmer",
  "datastrkuturer": "datastrukturer",
  "datstrukturer": "datastrukturer",
  "datastruk": "datastrukturer",
  "kungjøring": "kunngjøring",
  "kungjøringer": "kunngjøringer",
  "kungjøringene": "kunngjøringene",
  "kunngjøringane": "kunngjøringene",
  "sikkerhe": "sikkerhet",
  "nettvek": "nettverk",
  "matmatikk": "matematikk",
  "statistik": "statistikk",
  "progammering": "programmering",
  "programering": "programmering",
  "masinlæring": "maskinlæring",
  "operativssytem": "operativsystem",
  "operativsytem": "operativsystem",
  "bachelro": "bacheloroppgave",
  "bacheloropp": "bacheloroppgave",
  // Vanlige skrivefeil for "forklar"
  "forkalre": "forklar",
  "forklra": "forklar",
  "forklrae": "forklar",
  "forkaler": "forklar",

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

function detectIntent(messages: Array<{ role: string; content: string }>): IntentType {
  // Sjekk de siste bruker-meldingene (maks 3) for nøkkelord
  const recentUserMessages = messages
    .filter((m) => m.role === "user")
    .slice(-3)
    .map((m) => normaliserSkrivefeil(m.content));

  // Prioritet 1: Eksplisitte innholds-nøkkelord → canvas_full
  for (const msg of recentUserMessages) {
    if (CANVAS_FULL_KEYWORDS.some((kw) => msg.includes(kw))) return "canvas_full";
  }

  // Prioritet 2: Fagbegreper/emneord → canvas_full (brukeren spør om innhold)
  for (const msg of recentUserMessages) {
    if (TOPIC_KEYWORDS.some((kw) => msg.includes(kw))) return "canvas_full";
  }

  // Prioritet 3: Strukturelle Canvas-spørsmål (frister, oppgaver) → canvas_light
  for (const msg of recentUserMessages) {
    if (CANVAS_LIGHT_KEYWORDS.some((kw) => msg.includes(kw))) return "canvas_light";
  }
  return "general_chat";
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
  ];

  return followUpPrefixes.some((prefix) => lower.startsWith(prefix));
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

  // "i windows emnet", "i dat2000-kurset", "i inf2010-faget"
  // Tolkes som eksplisitt kurskontekst, ikke bare tematisk ord.
  if (/\bi\s+[a-zæøå0-9-]{2,}\s+(?:emnet|kurset|faget)\b/i.test(lower)) {
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
  "alt", "alle", "noe", "noen", "denne", "dette", "disse", "sin", "sitt", "sine",
  // Generiske kontekst-ord (ikke fagspesifikke)
  "emnet", "emne", "faget", "fag", "kurset", "kurs", "temaet", "tema",
  "innholdet", "innhold", "stoffet", "stoff", "materialet", "materiale",
  "pensum", "leksjonen", "leksjon", "forelesningen", "forelesning",
  "modulen", "modul", "kapitlet", "kapittel", "dokumentet", "dokument",
  // Engelske stoppord (ofte brukt i norske setninger)
  "the", "a", "an", "is", "are", "was", "were", "be", "been", "being",
  "have", "has", "had", "do", "does", "did", "will", "would", "could", "should",
  "what", "how", "why", "when", "where", "who", "which",
  "about", "explain", "describe", "tell", "give", "show", "make", "write",
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
  const lower = normaliserSkrivefeil(message);

  // Del opp i ord (kun alfanumeriske + æøå)
  const words = lower
    .replace(/[^\wæøå\s-]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length >= 3) // Ignorer veldig korte ord
    .filter((w) => !CHUNK_STOPWORDS.has(w));

  // Fjern duplikater og behold rekkefølge
  const unique = [...new Set(words)];

  // Returner 3–6 viktigste ord
  const keywords = unique.slice(0, 6);

  if (keywords.length === 0) return null;

  const chunkHint = keywords.join(" ");
  return chunkHint;
}

function extractQueryTarget(message: string): TargetedQuery {
  const lower = normaliserSkrivefeil(message);

  // Ekstraher modul/leksjon-nummer eller -navn
  const moduleMatch = lower.match(
    /(?:modul|leksjon|lesson|module|uke|week)\s*(\d+|[a-zæøå]+)/i,
  );
  const rawModuleHint = moduleMatch ? moduleMatch[0] : null;
  // Filtrer bort generiske ord (f.eks. "leksjonen") som ikke identifiserer en bestemt modul
  const moduleHint = rawModuleHint && !GENERIC_MODULE_WORDS.has(rawModuleHint) ? rawModuleHint : null;

  // Vanlige emnefragmenter som kan dukke opp i Canvas-emnenavn
  const courseKeywords = [
    "algoritmer", "datastrukturer", "database", "strategi", "sikkerhet",
    "python", "objekt", "web", "nettverk", "metode", "mobil", "ki",
    "maskinlæring", "machine learning", "windows", "server",
    "operativsystem", "matematikk", "statistikk", "økonomi", "ledelse",
    "prosjekt", "bacheloroppgave", "kommunikasjon", "innovasjon",
    "ikt", "informasjon", "system", "programmering", "java", "c#",
    "embedded", "elektronikk", "fysikk", "diskret",
    // Tillegg: vanlige norske fag og emnekode-prefikser
    "analyse", "logistikk", "regnskap", "markedsføring", "juss", "etikk",
    "organisasjon", "sosiologi", "psykologi", "filosofi", "historie",
    "biologi", "kjemi", "geografi", "engelsk", "norsk", "spansk", "tysk",
    "finans", "investering", "revisjon", "skatt", "forretning",
  ];

  // Vanlige emnekode-prefikser (2-4 bokstaver som ofte starter emnekoder)
  const courseCodePrefixes = [
    "is", "dat", "itk", "inf", "bsy", "ing", "te", "fo", "ikt", "alg",
    "mat", "sta", "øko", "adm", "led", "pro", "kom", "inn", "sik", "net",
    "mob", "web", "sys", "ele", "fys", "bio", "kje", "geo", "his", "fil",
  ];

  // Sammensatte ord: "algoritmer og datastrukturer" → matcher "algoritmer"
  const compoundKeywords: Record<string, string> = {
    "algoritmer og datastrukturer": "algoritmer",
    "algoritmer og data strukturer": "algoritmer",
    "data structures": "datastrukturer",
    "it-sikkerhet": "sikkerhet",
    "it sikkerhet": "sikkerhet",
    "machine learning": "maskinlæring",
    "diskret matematikk": "diskret",
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

  // Sjekk emnekode-prefikser (f.eks. "dat", "inf") som selvstendige ord
  if (!courseHint) {
    for (const prefix of courseCodePrefixes) {
      // Match som helt ord, ikke del av et annet ord
      // eslint-disable-next-line security/detect-non-literal-regexp -- prefix er fra konstant liste, ikke brukerinput
      const prefixRegex = new RegExp(`\\b${prefix}\\b`, "i");
      if (prefixRegex.test(cleanedForCourse)) {
        courseHint = prefix;
        logger.info({ courseHint, pattern: "codePrefix" }, "Ekstraherte emnekode-prefiks fra melding");
        break;
      }
    }
  }

  // Fallback til enkle nøkkelord
  if (!courseHint) {
    courseHint = courseKeywords.find((kw) => cleanedForCourse.includes(kw)) ?? null;
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

/** Definerer express router */
const router = Router();
// Rate limiting for KI-endepunkter
router.use(rateLimitKi);
// Chat historikk ruter
router.use(kiHistoryRouter);
// Deling av chat
router.use(kiShareRouter);
// Dokumentanalyse ruter
router.use(kiAnalyseRouter);

import { KI_TIMEOUT_MS, SESSION_CONTEXT_TTL } from "./kiConstants.js";

/** Maks ventetid på Canvas-sync før vi fortsetter med API/vector — kortere = raskere første svar, sync fortsetter i bakgrunn */
const SYNC_WAIT_MAX_MS = 8_000;

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

// GET /test-connection fjernet: KI-tilgjengelighet vises nå ved reelle feil (chat/dokumentanalyse).
// Unngår dedikert round-trip og 3–4 s latency; bruker får samme feilbanner når et kall feiler.

// Hovedendepunkt for chat
router.post("/chat", knyttCanvasTokenValgfritt, async (req, res) => {
  logger.info("Mottok chat-forespørsel");

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

  const model = resolveModel(requestedModel);

  if (checkAIClientUnavailable(res, model, KIChatResponseSchema)) return;

  if (requestedModel && !SUPPORTED_MODELS[requestedModel]) {
    logger.warn(
      { requestedModel },
      "Forespurt modell ikke støttet, bruker default",
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
    // Start med base system prompt
    let enhancedSystemPrompt = STUDYWISE_SYSTEM_PROMPT;

    // ——— Intent-deteksjon: Trenger denne meldingen Canvas-data? ———
    const intent = detectIntent(messages);

    if (intent !== "general_chat" && !req.canvasToken) {
      // Brukeren spør om Canvas men har ikke token
      logger.info({ intent }, "Canvas-spørsmål uten token");
      return res.json(
        KIChatResponseSchema.parse({
          suksess: true,
          response:
            "Jeg har ikke tilgang til Canvas-data akkurat nå. Sjekk at du har:\n\n1. Lagt inn et gyldig Canvas API-token i Innstillinger\n2. Valgt minst ett datasett under «Gi AI tilgang til» i chatten",
          model: model,
        }),
      );
    }

    // SSE-headere og keepalive tidlig slik at proxy/klient ikke lukker under lang kontekstlasting (f.eks. PDF-oppsummering)
    if (!res.headersSent) {
      const sse = setupSSE(req, res, 130_000); // maks timeout (canvas_full=120s) + margin
      sseCleanup = sse.clearKeepalive;
      sseStarted = true;
    }

    // ——— Laste Canvas-kontekst via context-loader (Redis → API fallback) ———
    let canvasKontekst = "";
    let hasCanvasData = false;

    if (intent !== "general_chat" && req.canvasToken && req.user?.id) {
      const baseUrl = req.canvasBaseUrl;

      // Sync-venting er best-effort — feil her skal IKKE stoppe KI-flyten
      try {
        // Sikre at bakgrunns-sync er igangsatt
        ensureCanvasSync(req.user.id, req.canvasToken, baseUrl).catch((err) => {
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
      const lastUserMsg = messages.filter((m: { role: string }) => m.role === "user").at(-1)?.content ?? "";
      const target = extractQueryTarget(lastUserMsg);

      // ─── Session-locked courseHint ───
      // Bruker Redis for å låse courseHint til første gyldige ekstraksjon i sesjonen.
      // Oppdateres KUN ved eksplisitt kursbytte-signal fra brukeren.
      const courseHintLockKey = `ki:session:${req.user.id}:locked-course-hint`;
      const SESSION_COURSEHINT_TTL = 3600; // 1 time — matcher typisk chat-sesjon

      const lockedCourseHint = await getCache(courseHintLockKey);
      const hasOverride = hasExplicitCourseOverride(lastUserMsg);

      if (hasOverride && target.courseHint) {
        // Bruker vil eksplisitt bytte kurs — oppdater låsen
        await setCache(courseHintLockKey, target.courseHint, SESSION_COURSEHINT_TTL);
        logger.info(
          { courseHint: target.courseHint, override: true },
          "courseHint låst (eksplisitt override)",
        );
      } else if (lockedCourseHint) {
        // Bruk eksisterende låst courseHint kun når meldingen ikke gir ny eksplisitt courseHint.
        // Dette hindrer at sesjonslås overstyrer ny emnekode som 6105N.
        if (!target.courseHint) {
          target.courseHint = lockedCourseHint;
          logger.info(
            { courseHint: target.courseHint, fromLock: true },
            "courseHint arvet fra sesjonslås",
          );
        } else if (target.courseHint !== lockedCourseHint && hasOverride) {
          await setCache(courseHintLockKey, target.courseHint, SESSION_COURSEHINT_TTL);
          logger.info(
            { previousCourseHint: lockedCourseHint, courseHint: target.courseHint, override: true },
            "courseHint oppdatert fra ny eksplisitt hint",
          );
        } else if (target.courseHint !== lockedCourseHint) {
          target.courseHint = lockedCourseHint;
          logger.info(
            { courseHint: target.courseHint, fromLock: true, ignoredHint: true },
            "courseHint beholdt fra sesjonslås (ingen eksplisitt override)",
          );
        }
      } else if (target.courseHint) {
        // Første gang vi ekstraherer courseHint — lås den for sesjonen
        await setCache(courseHintLockKey, target.courseHint, SESSION_COURSEHINT_TTL);
        logger.info(
          { courseHint: target.courseHint, newLock: true },
          "courseHint låst (første ekstraksjon)",
        );
      }
      // Hvis ingen courseHint finnes og ingen lås — fortsett uten (bredt søk)

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
        intent === "canvas_full" &&
        !target.courseHint &&
        isLikelyFollowUpQuestion(lastUserMsg);
      const lastCourseSessionKey =
        intent === "canvas_full" ? `ki:session:${req.user.id}:last-course` : null;
      const sessionCacheKey = intent === "canvas_full"
        ? target.courseHint
          ? `ki:session:${req.user.id}:${target.courseHint}:${queryHash}`
          : followUpWithoutCourseHint
            ? lastCourseSessionKey
            : null
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
            contextResult = parsed.data;
            usedSessionCache = true;
            logger.info(
              { sessionCacheKey, contextLength: contextResult.kontekst.length },
              "Bruker cached session-kontekst for kurs",
            );
          }
        } catch {
          logger.warn({ sessionCacheKey }, "Ugyldig JSON i session-cache — henter på nytt");
        }
      }

      if (!usedSessionCache) {
        contextResult = await Promise.race([
          loadCanvasContext(
            req.user.id,
            req.canvasToken,
            intent,
            target,
            lastUserMsg,
            baseUrl,
            abortController.signal,
          ),
          new Promise<ContextResult>((resolve) =>
            setTimeout(
              () => resolve({ kontekst: "[CANVAS STATUS: Henting tok for lang tid. Prøv igjen.]", hasCanvasData: false, source: "none" }),
              KI_TIMEOUT_MS,
            ),
          ),
        ]);

        // Cache for oppfølgingsspørsmål i samme sesjon (kun når vi fikk faktisk data)
        const hasRichCanvasContent =
          contextResult.hasCanvasData &&
          (contextResult.kontekst.includes("--- PDF-INNHOLD:") ||
            contextResult.kontekst.includes("--- FIL-INNHOLD:") ||
            target.courseIdHint !== null ||
            !!target.courseHint ||
            !!target.moduleHint ||
            !!target.fileHint);

        if (sessionCacheKey && contextResult.hasCanvasData) {
          await setCache(sessionCacheKey, JSON.stringify(contextResult), SESSION_CONTEXT_TTL);
        }
        // lastCourseSessionKey og sessionCacheKey kan peke på samme nøkkel når followUpWithoutCourseHint=true.
        // Skriv kun til lastCourseSessionKey separat når de er forskjellige, og kun ved rikt innhold —
        // unngår at svakt innhold fra follow-up forgifter last-course-cachen.
        if (lastCourseSessionKey && hasRichCanvasContent && lastCourseSessionKey !== sessionCacheKey) {
          await setCache(lastCourseSessionKey, JSON.stringify(contextResult), SESSION_CONTEXT_TTL);
        }
      }

      canvasKontekst = contextResult.kontekst;
      hasCanvasData = contextResult.hasCanvasData;

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

    // Legg Canvas-kontekst inn i system-prompten kun hvis tilgjengelig
    if (hasCanvasData) {
      enhancedSystemPrompt += "\n\n" + canvasKontekst;
    }

    // Dynamisk timeout og max_tokens basert på intent
    const maxTokens = intent === "canvas_full" ? 4096 : 2048;
    const TIMEOUT_MS = intent === "canvas_full" ? 120000 : intent === "canvas_light" ? 60000 : 30000;

    // Token-basert trimming av samtalehistorikk.
    // Reserverer plass til system-prompt + AI-respons, bruker resten til historikk.
    // Claude Sonnet har 200k kontekst, men vi begrenser for kostnads- og latens-kontroll.
    const systemPromptTokens = countTokens(enhancedSystemPrompt);
    const MAX_CONTEXT_TOKENS = intent === "canvas_full" ? 16000 : 8000;
    const historyBudget = Math.max(MAX_CONTEXT_TOKENS - systemPromptTokens - maxTokens, 1000);
    const trimmedMessages = trimToTokenLimit(messages, historyBudget);

    // System-prompt styres kun av backend (KIChatClientMessageSchema tillater ikke "system" fra klient — prompt-injection-sikring).
    const fullMessages = [
      { role: "system" as const, content: enhancedSystemPrompt },
      ...trimmedMessages.map((m: { role: string; content: string }) => ({
        role: m.role as "user" | "assistant",
        content: m.content,
      })),
    ];

    logger.info(
      {
        intent,
        model,
        messageCount: fullMessages.length,
        harCanvasToken: !!req.canvasToken,
        systemPromptLength: enhancedSystemPrompt.length,
        maxTokens,
        timeoutMs: TIMEOUT_MS,
      },
      "Sender til AI-tjenesten",
    );

    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutHandle = setTimeout(() => reject(new Error("CHAT_TIMEOUT")), TIMEOUT_MS);
    });

    const result = await Promise.race([
      chatCompletion({
        model,
        messages: fullMessages,
        max_tokens: maxTokens,
        temperature: Math.min(Math.max(temperature, 0), 1),
        signal: abortController.signal,
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
        model,
        responseLength: responseText.length,
        tokens: usage?.total_tokens,
      },
      "Vellykket chat-svar",
    );

    const payload = KIChatResponseSchema.parse({
      suksess: true,
      response: responseText,
      model: model,
      usage: usage
        ? {
            prompt_tokens: usage.prompt_tokens,
            completion_tokens: usage.completion_tokens,
            total_tokens: usage.total_tokens,
          }
        : undefined,
    });
    // writeSSE base64-koder JSON-payloaden før den skrives til event-streamen.
    if (writeSSE(res, payload)) {
      res.end();
    }

    void audit({
      actorUserId: req.user!.id,
      action: AUDIT_ACTIONS.KI_CHAT,
      category: "ki",
      outcome: "success",
      metadata: { model, tokens: usage?.total_tokens, messageCount: messages.length },
      req,
    }).catch((err) => {
      logger.warn({ err, userId: req.user!.id }, "Audit-feil for KI chat");
    });

    return;
  } catch (error) {
    sseCleanup?.();

    // Respons allerede avsluttet — ingenting mer å gjøre
    if (res.writableEnded) return;

    // If SSE headers were already sent, send error via SSE
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
    if (
      handleAIError(res, error, KIChatResponseSchema, {
        timeoutLabel: "CHAT_TIMEOUT",
        timeoutMessage:
          "Chat-forespørselen tok for lang tid. Prøv igjen eller forenkle spørsmålet.",
        kontekst: "ki-chat",
      })
    )
      return;

    if (res.headersSent) return;
    return res.status(500).json(
      KIChatResponseSchema.parse({
        suksess: false,
        melding: "Kunne ikke få svar fra KI-assistenten. Prøv igjen senere.",
        response: "",
      }),
    );
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
