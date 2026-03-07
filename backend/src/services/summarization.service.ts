/*
 * Single-Call Oppsummeringsmodul
 *
 * Bruker Anthropic Claude til å oppsummere lange tekster (PDF, Canvas-moduler, osv.)
 * via én enkelt API-kall:
 *   1. Ekstraher de første 30% av teksten (intro-kontekst)
 *   2. Scorer resterende avsnitt etter nøkkelord-overlapp med intro
 *   3. Fyll budsjett med høyest-scorende avsnitt opp til 12 000 tegn
 *   4. Én Anthropic-kall med max_tokens: 4096
 */

import { logger } from "../utils/logger.js";
import { anthropicClient } from "../rutere/ki/aiClient.js";
import { DEFAULT_MODEL } from "../rutere/ki/aiModels.js";

// Konstanter

/** Maks tegn i kontekst sendt til AI (~3 000 tokens) */
const MAX_CONTEXT_CHARS = 12_000;

/** Andel av teksten som brukes som intro (første 30%) */
const INTRO_RATIO = 0.3;

/** Tegngrense for å aktivere extract+summarize (under dette sendes tekst direkte) */
const EXTRACT_THRESHOLD_CHARS = 12_000;

/** Ordgrense for å aktivere oppsummering */
const SUMMARIZE_THRESHOLD = 2500;

/** max_tokens for enkel oppsummering */
const MAX_RESPONSE_TOKENS = 4096;

// Typer

export type ContentSource = "uploaded_file" | "canvas_file" | "canvas_module";

export interface SummarizationMetadata {
  fileName?: string;
  moduleName?: string;
  courseName?: string;
}

export interface SummarizationOptions {
  text: string;
  source: ContentSource;
  metadata?: SummarizationMetadata;
  /** Kalles for hvert tekst-delta i streaming (for SSE) */
  onStream?: (chunk: string) => void;
}

// Teksthjelpere

/** Teller antall ord i en tekst (splitter på whitespace) */
export function countWords(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

/** Returnerer true når teksten er lang nok til at oppsummering lønner seg */
export function shouldSummarize(text: string): boolean {
  return countWords(text) > SUMMARIZE_THRESHOLD;
}

// Intelligent tekstekstraksjon

/**
 * Ekstraher de mest relevante delene av en lang tekst:
 *   1. Ta de første 30% (intro/oversikt)
 *   2. Bygg nøkkelord-sett fra introen
 *   3. Score hvert gjenværende avsnitt basert på overlapp med intro-nøkkelord
 *   4. Fyll budsjett med høyest-scorende avsnitt (i original rekkefølge)
 */
function extractRelevantContent(text: string): string {
  const chars = text.length;

  // Kort nok → send hele teksten
  if (chars <= MAX_CONTEXT_CHARS) return text;

  // Splitt i avsnitt
  const paragraphs = text
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean);

  if (paragraphs.length === 0) return text.slice(0, MAX_CONTEXT_CHARS);

  // Beregn intro-grense (30% av tegnene)
  const introCharBudget = Math.floor(chars * INTRO_RATIO);

  // Samle intro-avsnitt
  let introChars = 0;
  let introEndIdx = 0;
  for (let i = 0; i < paragraphs.length; i++) {
    introChars += paragraphs[i].length;
    introEndIdx = i + 1;
    if (introChars >= introCharBudget) break;
  }

  const introParagraphs = paragraphs.slice(0, introEndIdx);
  const introText = introParagraphs.join("\n\n");

  // Bygg nøkkelord fra intro (ord ≥ 4 tegn, lowercased, unike)
  const keywords = new Set(
    introText
      .toLowerCase()
      .split(/\s+/)
      .filter((w) => w.length >= 4)
      .map((w) => w.replace(/[^a-zæøå0-9]/g, ""))
      .filter(Boolean),
  );

  // Score gjenværende avsnitt
  const remaining = paragraphs.slice(introEndIdx);
  const scored = remaining.map((para, originalIdx) => {
    const words = para.toLowerCase().split(/\s+/);
    const matches = words.filter((w) => {
      const cleaned = w.replace(/[^a-zæøå0-9]/g, "");
      return cleaned.length >= 4 && keywords.has(cleaned);
    }).length;
    const score = words.length > 0 ? matches / words.length : 0;
    return { para, score, originalIdx };
  });

  // Sorter etter score (høyest først)
  scored.sort((a, b) => b.score - a.score);

  // Fyll budsjett med høyest-scorende avsnitt
  let budgetLeft = MAX_CONTEXT_CHARS - introText.length - 10; // 10 for separator
  const selectedIndices: number[] = [];

  for (const item of scored) {
    if (budgetLeft <= 0) break;
    if (item.para.length <= budgetLeft) {
      selectedIndices.push(item.originalIdx);
      budgetLeft -= item.para.length + 2; // +2 for \n\n
    }
  }

  // Sorter tilbake til original rekkefølge
  selectedIndices.sort((a, b) => a - b);
  const selectedParagraphs = selectedIndices.map((i) => remaining[i]);

  if (selectedParagraphs.length === 0) {
    return introText.slice(0, MAX_CONTEXT_CHARS);
  }

  return introText + "\n\n[...]\n\n" + selectedParagraphs.join("\n\n");
}

// Prompt-bygging

function buildContextLine(metadata?: SummarizationMetadata): string {
  const parts: string[] = [];
  if (metadata?.courseName) parts.push(`- Emne: ${metadata.courseName}`);
  if (metadata?.moduleName) parts.push(`- Modul: ${metadata.moduleName}`);
  if (metadata?.fileName) parts.push(`- Fil: ${metadata.fileName}`);
  return parts.length > 0
    ? `Kontekst (hvis tilgjengelig):\n${parts.join("\n")}`
    : "";
}

function buildPrompt(text: string, metadata?: SummarizationMetadata): string {
  const ctx = buildContextLine(metadata);

  return `You are a student-focused AI assistant helping with a university course.
Write your answer in Norwegian.

Summarize the following study material into a clear and complete summary that:

- Gives a high-level overview of what the document is about
- Explains central concepts and terms in a precise, technical way
- Includes important examples, formulas, algorithms or key procedures
- Highlights what is especially relevant for solving assignments or exams
- Uses clear sections and paragraphs, not just bullet lists

Avoid motivational fluff. Focus on information and understanding.

${ctx}

Text:
${text}

Important: Cover every single concept, framework, and named model explicitly. When a framework has named components (e.g. VRIO has V, R, I, O), list every component individually. Never group items with 'and others' or 'etc.' Write out every item in every list. Do not end your response until all concepts have been addressed.

Now write the summary for a student who wants to understand the material well enough
to solve tasks and exam-style questions.`;
}

// Streaming-hjelper

async function streamAnthropicResponse(
  prompt: string,
  onStream: (chunk: string) => void,
): Promise<string> {
  let accumulated = "";

  const stream = anthropicClient!.messages.stream({
    model: DEFAULT_MODEL,
    max_tokens: MAX_RESPONSE_TOKENS,
    temperature: 0.4,
    messages: [{ role: "user", content: prompt }],
  });

  for await (const event of stream) {
    if (
      event.type === "content_block_delta" &&
      event.delta.type === "text_delta"
    ) {
      const delta = event.delta.text;
      accumulated += delta;
      onStream(delta);
    }
  }

  return accumulated.trim();
}

// Orkestrator (hovedfunksjon)

/**
 * Oppsummerer innhold fra en vilkårlig kilde (fil, Canvas-modul, osv.).
 *
 * - Korte tekster (≤ 12 000 tegn): sendes direkte til AI
 * - Lange tekster (> 12 000 tegn): extract+score for å velge relevante avsnitt
 *
 * Alltid én enkelt API-kall. Feiler aldri med ubehandlet unntak.
 */
export async function summarizeContent(
  options: SummarizationOptions,
): Promise<string> {
  const words = countWords(options.text);
  const needsExtraction = options.text.length > EXTRACT_THRESHOLD_CHARS;

  logger.info(
    {
      source: options.source,
      words,
      chars: options.text.length,
      needsExtraction,
      fileName: options.metadata?.fileName,
      moduleName: options.metadata?.moduleName,
      courseName: options.metadata?.courseName,
    },
    "summarizeContent startet (single-call)",
  );

  try {
    if (!anthropicClient) {
      throw new Error("Anthropic-klient ikke initialisert");
    }

    // Ekstraher relevante deler hvis teksten er for lang, ellers bruk hele
    const contextText = needsExtraction
      ? extractRelevantContent(options.text)
      : options.text;

    if (needsExtraction) {
      logger.info(
        { originalChars: options.text.length, extractedChars: contextText.length },
        "Tekst forkortet via extract+score",
      );
    }

    const prompt = buildPrompt(contextText, options.metadata);

    if (options.onStream) {
      const result = await streamAnthropicResponse(prompt, options.onStream);
      logger.info({ resultLength: result.length }, "Streaming-oppsummering ferdig");
      return result;
    }

    const result = await anthropicClient.messages.create({
      model: DEFAULT_MODEL,
      max_tokens: MAX_RESPONSE_TOKENS,
      temperature: 0.4,
      messages: [{ role: "user", content: prompt }],
    });

    const text = result.content
      .filter((b) => b.type === "text")
      .map((b) => b.text)
      .join("")
      .trim();

    logger.info({ resultLength: text.length }, "Oppsummering ferdig");
    return text;
  } catch (err) {
    logger.error(
      {
        err,
        source: options.source,
        words,
        fileName: options.metadata?.fileName,
      },
      "summarizeContent feilet",
    );

    const fallback =
      "Oppsummeringen kunne ikke genereres på grunn av en intern feil. Prøv igjen.";
    if (options.onStream) {
      options.onStream(fallback);
    }
    return fallback;
  }
}

/**
 * Wrapper: oppsummerer tekst via single-call hvis den overstiger terskelen.
 * Returnerer \`{ text, summarized }\` — der \`text\` er enten oppsummert eller uendret,
 * og \`summarized\` indikerer om oppsummering ble brukt.
 */
export async function summarizeIfNeeded(
  text: string,
  source: ContentSource,
  metadata?: SummarizationMetadata,
): Promise<{ text: string; summarized: boolean }> {
  if (!shouldSummarize(text)) {
    return { text, summarized: false };
  }

  const words = countWords(text);
  logger.info(
    { words, source, ...metadata },
    "Tekst over terskel — pre-oppsummerer (single-call)",
  );

  try {
    const result = await summarizeContent({ text, source, metadata });
    return { text: result, summarized: true };
  } catch (err) {
    logger.warn({ err, source }, "Oppsummering feilet — bruker full tekst");
    return { text, summarized: false };
  }
}
