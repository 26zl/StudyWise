/*
 * Map-Reduce Oppsummeringsmodul
 *
 * Bruker Anthropic Claude til å oppsummere lange tekster (PDF, Canvas-moduler, osv.)
 * via en map-reduce-strategi:
 *   1. Deler teksten i overlappende chunks (~800 ord)
 *   2. MAP:    Oppsummerer hver chunk parallelt (begrenset concurrency)
 *   3. REDUCE: Kombinerer deloppsummeringene til én sammenhengende tekst (med streaming)
 *
 * For korte tekster (≤ 3 000 ord) brukes direkte oppsummering uten map-reduce.
 */

import { logger } from "../utils/logger.js";
import { anthropicClient } from "../rutere/ki/aiClient.js";
import { DEFAULT_MODEL } from "../rutere/ki/aiModels.js";

// Konstanter

/** Ordgrense for å aktivere map-reduce i stedet for direkte oppsummering */
const MAP_REDUCE_THRESHOLD = 3000;

/** Maks ord per chunk i MAP-fasen */
const CHUNK_MAX_WORDS = 800;

/** Overlapp mellom chunks (ord) for kontekstkontinuitet */
const CHUNK_OVERLAP_WORDS = 100;

/** Maks samtidige MAP-kall (unngå rate-limit) */
const MAP_CONCURRENCY = 3;

/** max_tokens for MAP-kall (deloppsummering) */
const MAP_MAX_TOKENS = 2048;

/** max_tokens for REDUCE / direkte oppsummering */
const REDUCE_MAX_TOKENS = 6000;

/** Forsinkelse før retry ved feil i MAP-kall (ms) */
const MAP_RETRY_DELAY_MS = 800;

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
  /** Kalles for hvert tekst-delta i REDUCE / direkte oppsummering (for SSE-streaming) */
  onStream?: (chunk: string) => void;
}

// Teksthjelpere

/** Teller antall ord i en tekst (splitter på whitespace) */
export function countWords(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

/** Returnerer true når teksten er lang nok til at map-reduce lønner seg */
export function shouldUseMapReduce(text: string): boolean {
  return countWords(text) > MAP_REDUCE_THRESHOLD;
}

/**
 * Deler tekst i overlappende chunks ≤ maxWordsPerChunk ord.
 *
 * Strategi:
 *  1. Splitt teksten på doble linjeskift (avsnitt).
 *  2. Grupper avsnitt slik at hvert chunk holder seg under ordgrensen.
 *  3. Prepend de siste `overlapWords` ordene fra forrige chunk til neste.
 */
export function splitIntoChunks(
  text: string,
  maxWordsPerChunk = CHUNK_MAX_WORDS,
  overlapWords = CHUNK_OVERLAP_WORDS,
): string[] {
  // Splitt på doble (eller flere) linjeskift = avsnittgrenser
  const paragraphs = text
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean);

  if (paragraphs.length === 0) return [];

  // Grupper avsnitt i «rå-chunks»
  const rawChunks: string[] = [];
  let currentParagraphs: string[] = [];
  let currentWordCount = 0;

  for (const paragraph of paragraphs) {
    const pWords = countWords(paragraph);

    // Hvis avsnittet alene er > maks, push det som sin egen chunk
    if (pWords > maxWordsPerChunk) {
      // Flush eksisterende først
      if (currentParagraphs.length > 0) {
        rawChunks.push(currentParagraphs.join("\n\n"));
        currentParagraphs = [];
        currentWordCount = 0;
      }
      rawChunks.push(paragraph);
      continue;
    }

    if (currentWordCount + pWords > maxWordsPerChunk && currentParagraphs.length > 0) {
      // Flush nåværende chunk
      rawChunks.push(currentParagraphs.join("\n\n"));
      currentParagraphs = [];
      currentWordCount = 0;
    }

    currentParagraphs.push(paragraph);
    currentWordCount += pWords;
  }

  // Flush siste rest
  if (currentParagraphs.length > 0) {
    rawChunks.push(currentParagraphs.join("\n\n"));
  }

  if (rawChunks.length <= 1) return rawChunks;

  // Legg til overlapp fra slutten av forrige chunk
  const chunks: string[] = [rawChunks[0]];

  for (let i = 1; i < rawChunks.length; i++) {
    const prevWords = rawChunks[i - 1].trim().split(/\s+/);
    const overlapSlice = prevWords.slice(-overlapWords).join(" ");
    chunks.push(overlapSlice + "\n\n" + rawChunks[i]);
  }

  return chunks.filter(Boolean);
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

function buildMapPrompt(chunkText: string, metadata?: SummarizationMetadata): string {
  const ctx = buildContextLine(metadata);

  return `You are a student-focused AI assistant helping to understand course material.

Task: Summarize this part of a study document in Norwegian.

Focus on:
- Central ideas and definitions
- Important examples, formulas, or algorithms
- Relationships between concepts
- Anything that seems relevant for exercises or exams

Be concrete and technical rather than fluffy.
Do NOT create bullet-only output; use short paragraphs.

${ctx}

Text:
${chunkText}`;
}

function buildReducePrompt(
  combinedPartials: string,
  metadata?: SummarizationMetadata,
): string {
  const ctx = buildContextLine(metadata);

  return `You are a student-focused AI assistant helping with a university course.
Write your answer in Norwegian.

You will receive several partial summaries of one larger document.
Your task is to combine them into ONE coherent summary that:

- Gives a high-level overview of what the document is about
- Explains central concepts and terms in a precise, technical way
- Includes important examples, formulas, algorithms or key procedures
- Highlights what is especially relevant for solving assignments or exams
- Uses clear sections and paragraphs, not just bullet lists

Avoid motivational fluff. Focus on information and understanding.

${ctx}

Here are the partial summaries:
${combinedPartials}

Important: Cover every single concept, framework, and named model explicitly. When a framework has named components (e.g. VRIO has V, R, I, O), list every component individually. Never group items with 'and others' or 'etc.' Write out every item in every list. Do not end your response until all concepts have been addressed.

Now write the final summary for a student who wants to understand the material well enough
to solve tasks and exam-style questions.`;
}

function buildDirectPrompt(text: string, metadata?: SummarizationMetadata): string {
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

// Concurrency-limiter (ingen eksterne deps)

async function runWithConcurrency<T>(
  tasks: (() => Promise<T>)[],
  maxConcurrency: number,
): Promise<T[]> {
  const results: T[] = new Array(tasks.length);
  let nextIndex = 0;

  async function worker() {
    while (nextIndex < tasks.length) {
      const idx = nextIndex++;
      results[idx] = await tasks[idx]();
    }
  }

  const workers = Array.from(
    { length: Math.min(maxConcurrency, tasks.length) },
    () => worker(),
  );
  await Promise.all(workers);
  return results;
}

// MAP-fase

/**
 * Oppsummerer hver chunk parallelt med begrenset concurrency.
 * Enkelt retry (1×) per chunk; ved endelig feil -> placeholder.
 */
async function mapSummaries(
  chunks: string[],
  metadata?: SummarizationMetadata,
): Promise<string[]> {
  if (!anthropicClient) {
    throw new Error("Anthropic-klient ikke initialisert (mangler ANTHROPIC_API_KEY)");
  }

  const tasks = chunks.map((chunk, idx) => async (): Promise<string> => {
    const prompt = buildMapPrompt(chunk, metadata);

    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const result = await anthropicClient!.messages.create({
          model: DEFAULT_MODEL,
          max_tokens: MAP_MAX_TOKENS,
          temperature: 0.3,
          messages: [{ role: "user", content: prompt }],
        });

        const text = result.content
          .filter((b) => b.type === "text")
          .map((b) => b.text)
          .join("");

        return text.trim();
      } catch (err) {
        if (attempt === 0) {
          logger.warn(
            { chunkIndex: idx, err },
            "MAP-chunk feilet — prøver én gang til",
          );
          await sleep(MAP_RETRY_DELAY_MS);
        } else {
          logger.error(
            { chunkIndex: idx, err },
            "MAP-chunk feilet etter retry — bruker placeholder",
          );
        }
      }
    }

    return "(Denne delen av dokumentet kunne ikke oppsummeres på grunn av en teknisk feil.)";
  });

  return runWithConcurrency(tasks, MAP_CONCURRENCY);
}

// REDUCE-fase

/**
 * Kombinerer deloppsummeringer til én endelig oppsummering.
 * Støtter streaming via `onStream`-callback.
 */
async function reduceSummaries(
  partialSummaries: string[],
  options: SummarizationOptions,
): Promise<string> {
  if (!anthropicClient) {
    throw new Error("Anthropic-klient ikke initialisert (mangler ANTHROPIC_API_KEY)");
  }

  const combined = partialSummaries
    .map((s, i) => `=== DEL ${i + 1} ===\n${s}`)
    .join("\n\n");

  const prompt = buildReducePrompt(combined, options.metadata);

  try {
    if (options.onStream) {
      return await streamAnthropicResponse(prompt, REDUCE_MAX_TOKENS, options.onStream);
    }

    const result = await anthropicClient.messages.create({
      model: DEFAULT_MODEL,
      max_tokens: REDUCE_MAX_TOKENS,
      temperature: 0.4,
      messages: [{ role: "user", content: prompt }],
    });

    return result.content
      .filter((b) => b.type === "text")
      .map((b) => b.text)
      .join("")
      .trim();
  } catch (err) {
    logger.error({ err, partialsCount: partialSummaries.length }, "REDUCE-fase feilet");
    const fallback =
      "Oppsummeringen kunne ikke fullføres på grunn av en intern feil. Prøv igjen.";
    if (options.onStream) options.onStream(fallback);
    return fallback;
  }
}

// Direkte oppsummering (korte tekster)

async function directSummarize(options: SummarizationOptions): Promise<string> {
  if (!anthropicClient) {
    throw new Error("Anthropic-klient ikke initialisert (mangler ANTHROPIC_API_KEY)");
  }

  const prompt = buildDirectPrompt(options.text, options.metadata);

  try {
    if (options.onStream) {
      return await streamAnthropicResponse(prompt, REDUCE_MAX_TOKENS, options.onStream);
    }

    const result = await anthropicClient.messages.create({
      model: DEFAULT_MODEL,
      max_tokens: REDUCE_MAX_TOKENS,
      temperature: 0.4,
      messages: [{ role: "user", content: prompt }],
    });

    return result.content
      .filter((b) => b.type === "text")
      .map((b) => b.text)
      .join("")
      .trim();
  } catch (err) {
    logger.error({ err, source: options.source }, "Direkte oppsummering feilet");
    const fallback =
      "Oppsummeringen kunne ikke genereres på grunn av en intern feil. Prøv igjen.";
    if (options.onStream) options.onStream(fallback);
    return fallback;
  }
}

// Streaming-hjelper (delt av reduce + directSummarize)

async function streamAnthropicResponse(
  prompt: string,
  maxTokens: number,
  onStream: (chunk: string) => void,
): Promise<string> {
  let accumulated = "";

  const stream = anthropicClient!.messages.stream({
    model: DEFAULT_MODEL,
    max_tokens: maxTokens,
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
 * - Korte tekster (≤ 3 000 ord): direkte oppsummering
 * - Lange tekster (> 3 000 ord): map-reduce pipeline
 *
 * Feiler aldri med ubehandlet unntak — returnerer en feilmelding i stedet.
 */
export async function summarizeContent(
  options: SummarizationOptions,
): Promise<string> {
  const words = countWords(options.text);
  const useMapReduce = shouldUseMapReduce(options.text);

  logger.info(
    {
      source: options.source,
      words,
      useMapReduce,
      fileName: options.metadata?.fileName,
      moduleName: options.metadata?.moduleName,
      courseName: options.metadata?.courseName,
    },
    "summarizeContent startet",
  );

  try {
    if (!anthropicClient) {
      throw new Error("Anthropic-klient ikke initialisert");
    }

    if (useMapReduce) {
      const chunks = splitIntoChunks(options.text);

      logger.info(
        { chunkCount: chunks.length, avgWordsPerChunk: Math.round(words / chunks.length) },
        "MAP-fase starter",
      );

      const partials = await mapSummaries(chunks, options.metadata);

      logger.info(
        { partialsCount: partials.length },
        "MAP-fase ferdig — starter REDUCE",
      );

      const result = await reduceSummaries(partials, options);

      logger.info(
        { resultLength: result.length },
        "REDUCE-fase ferdig — oppsummering komplett",
      );

      return result;
    }

    const result = await directSummarize(options);

    logger.info(
      { resultLength: result.length },
      "Direkte oppsummering ferdig",
    );

    return result;
  } catch (err) {
    logger.error(
      {
        err,
        source: options.source,
        words,
        fileName: options.metadata?.fileName,
      },
      "summarizeContent feilet uventet",
    );

    const fallback =
      "Oppsummeringen kunne ikke genereres på grunn av en intern feil. Prøv igjen.";
    if (options.onStream) {
      options.onStream(fallback);
    }
    return fallback;
  }
}

// Hjelpefunksjon

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
