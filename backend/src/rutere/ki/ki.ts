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

function mapKBResultsToChatSources(results: import("../../services/kunnskapsbase-indeksering.service.js").KBSearchResult[], baseName: string): ChatSource[] {
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
      if (!hasDownloadableCanvasFile && !hasNavigableUrl) {
        continue;
      }
      const key = `${source.sourceKind ?? "canvas_file"}:${source.courseId}:${source.fileId ?? "na"}:${source.fileName}:${source.sourceUrl ?? ""}`;
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

/**
 * Fagbegreper som indikerer et innholds-/tematisk spørsmål.
 * Når brukeren bruker et slikt begrep, er det ALLTID canvas_full.
 */
const TOPIC_KEYWORDS = [
  // Algoritmer og datastrukturer
  "avl", "tree", "binary", "heap", "graf", "graph", "stack", "queue",
  "linked list", "hashtabell", "hash", "sortering", "sorting", "søk", "search",
  "rekursjon", "recursion", "kompleksitet", "complexity",
  "big-o", "big o", "traversering", "traversal", "dfs", "bfs",
  "dijkstra", "dynamic programming", "dynamisk programmering",
  // Generelle CS-begreper
  "design pattern", "objektorientert", "object-oriented", "arv", "inheritance",
  "polymorfisme", "polymorphism", "interface", "abstraksjon", "abstraction",
  "innkapsling", "encapsulation", "tråd", "thread", "mutex",
  "sql", "normalisering", "normalization", "relasjon", "relation",
  "kryptering", "encryption", "protokoll", "protocol",
];

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

function extractModuleHint(message: string): string | null {
  const lower = normaliserSkrivefeil(message);

  const numberedMatch = lower.match(
    /\b(?:modul|leksjon|lesson|module|forelesning|uke|week|kapittel)\s+\d{1,2}[a-z]?\b/i,
  );
  if (numberedMatch) {
    return numberedMatch[0].toLowerCase();
  }

  const quotedMatch = lower.match(
    /\b(?:modul|leksjon|lesson|module|forelesning|kapittel)\s+["'«»]([^"'«»]{3,80})["'«»]/i,
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
    const hasTopicSignals = TOPIC_KEYWORDS.some((kw) => msg.includes(kw));
    const hasLightSignals = CANVAS_LIGHT_KEYWORDS.some((kw) => msg.includes(kw));
    const hasNonGenericFullSignals = CANVAS_FULL_KEYWORDS
      .filter((kw) => !["hva er", "what is", "hva betyr", "what means"].includes(kw))
      .some((kw) => msg.includes(kw));
    return hasCourseOrFileHints || hasTopicSignals || hasLightSignals || hasNonGenericFullSignals;
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
  return "claude-sonnet-4-5";
}

function chooseModelForFullDocumentMode(
  baseModel: string,
  systemPrompt: string,
  canvasContext: string,
  historyMessages: Array<{ role: string; content: string }>,
): { model: string; reason: "base" | "largest_context" } {
  const historyTokens = historyMessages.reduce((sum, msg) => sum + countTokens(msg.content) + 4, 0);
  const requestedWindowTokens = countTokens(systemPrompt) + countTokens(canvasContext) + historyTokens + 2000;
  const largestAvailableContextModel = "claude-sonnet-4-5";
  const largestAvailableContextWindow = 200000;

  if (requestedWindowTokens > largestAvailableContextWindow) {
    return { model: largestAvailableContextModel, reason: "largest_context" };
  }
  return { model: baseModel, reason: "base" };
}

const KB_SESSION_TTL = 3600;

function kbSessionKey(userId: string): string {
  return `ki:session:${userId}:active-kb`;
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

  // "i windows emnet", "til metode emnet", "i dat2000-kurset", "om inf2010-faget"
  // Tolkes som eksplisitt kurskontekst, ikke bare tematisk ord.
  if (/\b(?:i|til|om|for)\s+[a-zæøå0-9-]{2,}\s+(?:emnet|kurset|faget)\b/i.test(lower)) {
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
  "pensum", "leksjonen", "leksjon", "forelesningen", "forelesning",
  "modulen", "modul", "kapitlet", "kapittel", "dokumentet", "dokument",
  "hent", "hente", "registrert", "registrere", "registrering",
  "mine", "min", "mitt", "vis", "vise",
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
  const lower = normaliserSkrivefeil(message);
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

  // Del opp i ord (kun alfanumeriske + æøå)
  const words = withoutUrls
    .replace(/[^\wæøå\s-]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length >= 3) // Ignorer veldig korte ord
    .filter((w) => !CHUNK_STOPWORDS.has(w))
    .filter((w) => !URL_ARTIFACT_TOKENS.has(w))
    .filter((w) => !blockedHostTokens.has(w));

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

  // Ekstraher kun spesifikke modulhint (nummererte eller eksplisitt navngitte)
  const rawModuleHint = extractModuleHint(message);
  const moduleHint = rawModuleHint && !GENERIC_MODULE_WORDS.has(rawModuleHint) ? rawModuleHint : null;

  // Vanlige emnefragmenter som kan dukke opp i Canvas-emnenavn
  const courseKeywords = [
    "algoritmer", "datastrukturer", "database", "strategi", "sikkerhet",
    "python", "objekt", "web", "nettverk", "metode", "mobil",
    "maskinlæring", "machine learning", "windows", "server",
    "operativsystem", "matematikk", "statistikk", "økonomi", "ledelse",
    "prosjekt", "bacheloroppgave", "kommunikasjon", "innovasjon",
    "ikt", "informasjon", "system", "programmering", "java", "c#",
    "embedded", "elektronikk", "fysikk", "diskret",
    // Tillegg: vanlige norske fag og emnekode-prefikser
    "analyse", "logistikk", "regnskap", "markedsføring", "juss", "etikk",
    "organisasjon", "organisering", "organisatorisk",
    "sosiologi", "psykologi", "filosofi", "historie",
    "biologi", "kjemi", "geografi", "engelsk", "norsk", "spansk", "tysk",
    "finans", "investering", "revisjon", "skatt", "forretning",
    // Engelske varianter
    "algorithms", "data structures", "security", "object", "network",
    "method", "mobile", "operating system", "mathematics", "statistics",
    "economics", "management", "project", "communication", "innovation",
    "programming", "electronics", "physics", "analysis", "logistics",
    "accounting", "marketing", "law", "ethics", "organization",
    "sociology", "psychology", "philosophy", "history", "biology",
    "chemistry", "geography", "finance", "investment", "business",
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
  profile: { firstName?: string | null; username?: string | null; email?: string | null } | null | undefined,
): string | null {
  const emailLocalPart = typeof profile?.email === "string" ? profile.email.split("@")[0] : null;
  const candidates = [profile?.firstName, profile?.username, emailLocalPart];
  for (const candidate of candidates) {
    if (typeof candidate !== "string") continue;
    const sanitized = sanitizeStudentName(candidate.replace(/[._-]+/g, " "));
    if (!sanitized) continue;
    const firstToken = sanitized.split(" ")[0]?.trim();
    if (firstToken) return firstToken;
  }
  return null;
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
      .select("firstName username email canvasContextPreferences hiddenCourseIds")
      .lean();

    // Start med base system prompt
    let enhancedSystemPrompt = STUDYWISE_SYSTEM_PROMPT;
    const hasAssistantMessages = messages.some((m) => m.role === "assistant");
    const firstUserMessage = messages.find((m) => m.role === "user")?.content ?? "";
    const normalizedFirstUserMessage = normaliserSkrivefeil(firstUserMessage).trim();
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
      const activeKbRawForIntent = await getCache(kbSessionKey(req.user.id));
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
        const lockedCourseHintRaw = await getCache(`ki:user:${req.user.id}:locked-course-hint`);
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
      const sse = setupSSE(req, res, 160_000); // maks timeout (full_document=150s) + margin
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
    let contextKilder: import("common/ki").KIChatSource[] | undefined;
    let kbKilder: import("common/ki").KIChatSource[] | undefined;
    let liveUrlKilder: import("common/ki").KIChatSource[] | undefined;

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
      let target = extractQueryTarget(lastUserMsg);
      const isLikelyFollowUp = isLikelyFollowUpQuestion(lastUserMsg);

      // ─── Session-locked courseHint ───
      // Bruker Redis for å låse courseHint til første gyldige ekstraksjon i sesjonen.
      // Oppdateres KUN ved eksplisitt kursbytte-signal fra brukeren.
      // Alle courseHint-verdier saniteres før lagring/sammenligning for konsistent matching.
      // NB: nøkkelen ligger BEVISST utenfor `ki:session:*`-pattern slik at canvas-sync sin
      // session-cache-invalidering ikke sletter sesjonslåsen mellom oppfølgingsspørsmål.
      const courseHintLockKey = `ki:user:${req.user.id}:locked-course-hint`;
      const SESSION_COURSEHINT_TTL = 3600; // 1 time — matcher typisk chat-sesjon

      const lockedCourseHintRaw = await getCache(courseHintLockKey);
      const lockedCourseHint = lockedCourseHintRaw ? sanitizeCourseHintValue(lockedCourseHintRaw) : null;
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
        // Bruk eksisterende låst courseHint kun når meldingen ikke gir ny eksplisitt courseHint.
        // Dette hindrer at sesjonslås overstyrer ny emnekode som 6105N.
        if (!sanitizedTargetHint && !hasBaseSlashCommand && !mentionsKnowledgeBase) {
          // Arv alltid den låste hintet når meldingen ikke nevner et nytt kurs.
          // Tidligere dropp ved "bredt spørsmål" førte til at oppfølginger som
          // "forklar hva forelesningene har gått ut på?" mistet kurskonteksten.
          target.courseHint = lockedCourseHint;
          logger.info(
            {
              courseHint: target.courseHint,
              fromLock: true,
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
          target.courseIdHint = null; // Nullstill — lar resolveTargetAgainstKnownCourses løse riktig kurs
          logger.info(
            { courseHint: target.courseHint, fromLock: true, ignoredHint: sanitizedTargetHint },
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
      const lastCourseSessionKey =
        courseHintCacheSegment
          ? `ki:session:${req.user.id}:last-course:${courseHintCacheSegment}`
          : `ki:session:${req.user.id}:last-course`;
      const sessionCacheKey = target.courseHint
        ? `ki:session:${req.user.id}:course:${buildCourseHintCacheSegment(target.courseHint)}:${queryHash}`
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
            lastUserMsg,
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
      contextKilder = contextResult.kilder && contextResult.kilder.length > 0 ? contextResult.kilder : undefined;

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

Rules:
- Cover ALL main topics present in the document, in document order
- Never invent, assume, or add information that is not in the document
- If something is not in the document, say 'dette er ikkje dekka i dette dokumentet' — do not fill in with general knowledge
- Never write sections like 'Praktisk datainnsamling (frå obligoppgåva)' or similar unless that exact heading exists in the document
- At the end, write one sentence listing other chapters or topics in this file the student can ask about next
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
    const baseMaxTokens = fullDocumentModeActive ? 6000 : intent === "canvas_full" ? 4000 : intent === "canvas_light" ? 2000 : 1400;
    // Full dokument-mode laster opp til ~70k tegn kontekst og kan generere flere tusen output-tokens —
    // 60 s er for stramt (Anthropic bruker typisk 60-90 s). Gi den 150 s.
    const baseTimeoutMs = fullDocumentModeActive
      ? 150000
      : intent === "canvas_full"
        ? 120000
        : intent === "canvas_light"
          ? 60000
          : 30000;

    // Token-basert trimming av samtalehistorikk.
    // Reserverer plass til system-prompt + AI-respons, bruker resten til historikk.
    // Claude Sonnet har 200k kontekst, men vi begrenser for kostnads- og latens-kontroll.
    const systemPromptTokens = countTokens(enhancedSystemPrompt) + (hasCanvasData ? countTokens(canvasKontekst) : 0);
    const MAX_CONTEXT_TOKENS = intent === "canvas_full" ? 10000 : 6000;
    const historyBudget = Math.max(MAX_CONTEXT_TOKENS - systemPromptTokens - baseMaxTokens, 1000);
    const tokenTrimmedMessages = trimToTokenLimit(messages, historyBudget);
    const trimmedMessages = tokenTrimmedMessages.slice(-8);

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
        kbSessionKey(req.user!.id),
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

    const activeKbRaw = await getCache(kbSessionKey(req.user!.id));
    if (activeKbRaw) {
      try {
        const parsed = JSON.parse(activeKbRaw) as { id?: string; navn?: string };
        if (parsed.id && parsed.navn) {
          const kbResults = await searchKBContent(req.user!.id, parsed.id, lastUserMessageForKB, 8);
          if (kbResults.length > 0) {
            kbKontekst = buildKBContext(kbResults, parsed.navn);
            kbKilder = mapKBResultsToChatSources(kbResults, parsed.navn);
            enhancedSystemPrompt += `

## Kunnskapsbase (aktiv via /)

Bruk innholdet i <kunnskapsbase>-taggene som primærkilde når det er relevant.
Referer til kilde (fil/lenke) i svaret.
`;
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
            kbKilder = mapKBResultsToChatSources(kbResults, match.navn);
            await setCache(
              kbSessionKey(req.user!.id),
              JSON.stringify({ id: matchId, navn: match.navn }),
              KB_SESSION_TTL,
            );

            enhancedSystemPrompt += `

## Kunnskapsbase (automatisk matchet)

Bruk innholdet i <kunnskapsbase>-taggene som primærkilde når det er relevant.
Referer til kilde (fil/lenke) i svaret.
`;
            logger.info(
              { userId: req.user!.id, matchedBaseName: match.navn, aliases },
              "Automatisk KB-basenavn matchet fra brukerens spørsmål",
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
      cache_control?: { type: "ephemeral" };
    }> = [
      { role: "system", content: fullDocumentStrictPrefix + enhancedSystemPrompt, cache_control: { type: "ephemeral" } },
      ...(hasCanvasData
        ? [{ role: "system" as const, content: canvasKontekst, cache_control: { type: "ephemeral" as const } }]
        : []),
      ...(kbKontekst
        ? [{ role: "system" as const, content: kbKontekst, cache_control: { type: "ephemeral" as const } }]
        : []),
      ...(liveUrlKontekst
        ? [{ role: "system" as const, content: liveUrlKontekst, cache_control: { type: "ephemeral" as const } }]
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
    const selectedModel = requestedModel
      ? resolvedRequestedModel
      : shouldEscalateGeneralChatToSonnet
        ? "claude-sonnet-4-5"
        : fullDocumentModelSelection.model;
    const selectedModelReason = requestedModel
      ? "user_selected"
      : shouldEscalateGeneralChatToSonnet
        ? "sonnet_general_heavy"
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


