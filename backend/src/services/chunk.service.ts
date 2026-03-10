/**
 * Chunk Service
 *
 * Deler PDF-tekst i overlappende chunks for effektiv kontekst-lasting.
 * Chunks lagres i Redis under canvas:user:{userId}:emne:{courseId}:chunks
 * og brukes av context-loader for å bygge relevant kontekst til KI-chatten.
 *
 * Chunking-strategi:
 *   - ~2000 tegn per chunk med 200 tegn overlap
 *   - Bryter på avsnitt- eller setningsgrenser
 *   - Hvert chunk beholder metadata (filnavn, modul, emne)
 *
 * Redis-nøkkelstruktur:
 *   canvas:user:{userId}:emne:{courseId}:chunks — JSON-array av ContentChunk
 *
 * Eksporterte funksjoner:
 *   - chunkText(text, opts)           — del tekst i overlappende chunks
 *   - storeChunksForCourse(...)       — lagre chunks i Redis
 *   - getChunksForCourse(...)         — hent chunks fra Redis
 *   - searchChunks(chunks, terms)     — keyword-søk i chunks
 *   - buildChunkContext(chunks, budget) — bygg token-budsjettert kontekst
 */

import { logger } from "../utils/logger.js";
import { getCache, setCache } from "../cache/redis.js";
import { userKey } from "./canvas-sync.service.js";
import { extractSearchTerms, scoreText } from "./semantic-search.service.js";

// ─── Typer ─────────────────────────────────────────────────

export interface ContentChunk {
  /** Unik ID for chunken (courseId:fileId:chunkIndex) */
  id: string;
  /** Selve tekstinnholdet */
  text: string;
  /** Metadata for sporbarhet */
  source: {
    courseId: string;
    courseName: string;
    moduleTitle: string;
    fileName: string;
    fileId: number;
  };
  /** Chunk-indeks innen filen (0-basert) */
  index: number;
}

export interface ScoredChunk extends ContentChunk {
  score: number;
}

// ─── Konstanter ────────────────────────────────────────────

/** Mål-størrelse for hver chunk i tegn */
const CHUNK_SIZE = 2000;

/** Overlap mellom chunks i tegn */
const CHUNK_OVERLAP = 200;

/** TTL for chunk-data i Redis (matcher sync TTL: 1 time) */
const CHUNK_CACHE_TTL = 3600;

/** Maks antall chunks å returnere fra søk */
const MAX_SEARCH_RESULTS = 10;

/** Maks kontekst-lengde i tegn (~3000 tokens ≈ 12000 tegn) */
const MAX_CONTEXT_CHARS = 12000;

// ─── Chunking ──────────────────────────────────────────────

/**
 * Deler en tekst i overlappende chunks.
 * Prøver å bryte på avsnittgrenser (\n\n), deretter setningsgrenser (.),
 * og faller tilbake til ordgrenser som siste utvei.
 */
export function chunkText(
  text: string,
  opts?: { chunkSize?: number; overlap?: number },
): string[] {
  const chunkSize = opts?.chunkSize ?? CHUNK_SIZE;
  const overlap = opts?.overlap ?? CHUNK_OVERLAP;

  if (!text || text.length === 0) return [];
  if (text.length <= chunkSize) return [text.trim()].filter(Boolean);

  const chunks: string[] = [];
  let start = 0;

  while (start < text.length) {
    let end = Math.min(start + chunkSize, text.length);

    // Forsøk å bryte på naturlig grense (kun hvis vi ikke er på slutten)
    if (end < text.length) {
      end = findBreakPoint(text, start, end);
    }

    const chunk = text.slice(start, end).trim();
    if (chunk.length > 0) {
      chunks.push(chunk);
    }

    // Flytt start fremover med overlap
    const advance = end - start - overlap;
    start += Math.max(advance, 1); // Sikre fremgang
  }

  return chunks;
}

/**
 * Finn beste brytepunkt nær slutten av en chunk.
 * Prioriterer avsnitt > setning > ord.
 */
function findBreakPoint(text: string, start: number, end: number): number {
  // Søk i siste 20% av chunken for et naturlig brudd
  const searchStart = Math.max(start, end - Math.floor((end - start) * 0.2));
  const segment = text.slice(searchStart, end);

  // Prioritet 1: Avsnittsbrudd
  const paraBreak = segment.lastIndexOf("\n\n");
  if (paraBreak !== -1) return searchStart + paraBreak + 2;

  // Prioritet 2: Linjeskift
  const lineBreak = segment.lastIndexOf("\n");
  if (lineBreak !== -1) return searchStart + lineBreak + 1;

  // Prioritet 3: Setningsgrense (. etterfulgt av mellomrom eller slutt)
  const sentenceBreak = segment.lastIndexOf(". ");
  if (sentenceBreak !== -1) return searchStart + sentenceBreak + 2;

  // Prioritet 4: Ordgrense
  const wordBreak = segment.lastIndexOf(" ");
  if (wordBreak !== -1) return searchStart + wordBreak + 1;

  // Ingen naturlig grense funnet — bruk hard grense
  return end;
}

// ─── Redis-lagring ─────────────────────────────────────────

/**
 * Oppretter chunks fra et PDF-dokuments tekst og returnerer dem.
 */
export function createChunksFromContent(
  text: string,
  source: ContentChunk["source"],
): ContentChunk[] {
  const textChunks = chunkText(text);
  return textChunks.map((t, i) => ({
    id: `${source.courseId}:${source.fileId}:${i}`,
    text: t,
    source,
    index: i,
  }));
}

/**
 * Lagrer chunks for et emne i Redis.
 * Erstatter eventuelle eksisterende chunks for emnet.
 */
export async function storeChunksForCourse(
  userId: string,
  courseId: string,
  chunks: ContentChunk[],
): Promise<void> {
  const key = userKey(userId, "emne", courseId, "chunks");
  await setCache(key, JSON.stringify(chunks), CHUNK_CACHE_TTL);
  logger.info(
    { userId, courseId, chunkCount: chunks.length },
    "Chunks lagret i Redis",
  );
}

/**
 * Henter chunks for et emne fra Redis.
 */
export async function getChunksForCourse(
  userId: string,
  courseId: string,
): Promise<ContentChunk[]> {
  const key = userKey(userId, "emne", courseId, "chunks");
  const raw = await getCache(key);
  if (!raw) return [];

  try {
    return JSON.parse(raw) as ContentChunk[];
  } catch {
    return [];
  }
}

/**
 * Fornyer TTL på chunks for et emne.
 */
export async function renewChunksTTL(
  userId: string,
  courseId: string,
): Promise<void> {
  const key = userKey(userId, "emne", courseId, "chunks");
  const existing = await getCache(key);
  if (existing) {
    await setCache(key, existing, CHUNK_CACHE_TTL);
  }
}

// ─── Søk ───────────────────────────────────────────────────

/**
 * Søker i chunks basert på keyword-matching.
 * Returnerer maks MAX_SEARCH_RESULTS chunks sortert etter score.
 *
 * Scoring-faktorer:
 *   - TF-score fra scoreText()
 *   - Bonus for modulnavn-match
 *   - Bonus for filnavn-match
 */
export function searchChunks(
  chunks: ContentChunk[],
  message: string,
  opts?: { moduleHint?: string | null; fileHint?: string | null },
): ScoredChunk[] {
  const terms = extractSearchTerms(message);
  if (terms.length === 0) return [];

  const scored: ScoredChunk[] = [];

  for (const chunk of chunks) {
    let score = scoreText(chunk.text, terms);
    if (score === 0) continue;

    // Bonus: modulnavn-match
    if (opts?.moduleHint) {
      const modLower = chunk.source.moduleTitle.toLowerCase();
      if (modLower.includes(opts.moduleHint.toLowerCase())) {
        score *= 1.5;
      }
    }

    // Bonus: filnavn-match
    if (opts?.fileHint) {
      const fileLower = chunk.source.fileName.toLowerCase();
      const hintLower = opts.fileHint.toLowerCase().replace(/\.pdf$/i, "");
      if (fileLower.includes(hintLower) || hintLower.includes(fileLower.replace(/\.pdf$/i, ""))) {
        score *= 2.0;
      }
    }

    scored.push({ ...chunk, score });
  }

  // Sorter etter score (høyest først), deretter etter posisjon
  scored.sort((a, b) => {
    if (Math.abs(a.score - b.score) > 0.01) return b.score - a.score;
    // Ved lik score: tidligere chunks først
    return a.index - b.index;
  });

  return scored.slice(0, MAX_SEARCH_RESULTS);
}

// ─── Kontekst-bygging ─────────────────────────────────────

/**
 * Bygger kontekst fra søkeresultater med token-budsjett.
 * Bruker grounding-tags (--- PDF-INNHOLD ---) for å skille
 * faktisk innhold fra metadata i systemprompt.
 *
 * @param chunks - Scorede chunks fra searchChunks()
 * @param maxChars - Maks tegn (default: MAX_CONTEXT_CHARS ≈ 3000 tokens)
 * @returns Formatert kontekst-streng
 */
export function buildChunkContext(
  chunks: ScoredChunk[],
  maxChars?: number,
): string {
  const budget = maxChars ?? MAX_CONTEXT_CHARS;
  if (chunks.length === 0) return "";

  let kontekst = "";
  let used = 0;

  // Grupper chunks etter fil for bedre lesbarhet
  const byFile = new Map<string, ScoredChunk[]>();
  for (const chunk of chunks) {
    const key = `${chunk.source.courseId}:${chunk.source.fileId}`;
    const existing = byFile.get(key) ?? [];
    existing.push(chunk);
    byFile.set(key, existing);
  }

  for (const [, fileChunks] of byFile) {
    // Sorter chunks innen filen etter indeks (leserekkefølge)
    fileChunks.sort((a, b) => a.index - b.index);

    const source = fileChunks[0].source;
    const header = `\n--- PDF-INNHOLD: ${source.fileName} (${source.courseName}, ${source.moduleTitle}) ---\n`;

    if (used + header.length >= budget) break;
    kontekst += header;
    used += header.length;

    for (const chunk of fileChunks) {
      const entry = chunk.text + "\n";
      if (used + entry.length > budget) {
        // Legg til det vi kan
        const remaining = budget - used;
        if (remaining > 100) {
          kontekst += entry.slice(0, remaining - 30) + "\n(forkortet)\n";
          used = budget;
        }
        break;
      }
      kontekst += entry;
      used += entry.length;
    }

    kontekst += "--- SLUTT PDF-INNHOLD ---\n";
    used += 26; // lengde av slutt-tag

    if (used >= budget) break;
  }

  return kontekst;
}
