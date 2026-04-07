/**
 * Chunk Service
 *
 * Rene hjelpefunksjoner for å dele tekst i chunks, score chunks og bygge
 * KI-kontekst. Lagring håndteres av MongoDB via embedding.service.ts.
 */

import { extractSearchTerms, scoreText } from "./semantic-search.service.js";
import { logger } from "../utils/logger.js";

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

interface ContextChunkEntry {
  text: string;
  source: ContentChunk["source"];
  index: number;
}

/** Mål-størrelse for hver chunk i tegn */
const CHUNK_SIZE = 2000;

/** Overlap mellom chunks i tegn */
const CHUNK_OVERLAP = 200;

/**
 * Minimum tegn-lengde for at en chunk skal beholdes.
 * Filtrerer ut støy fra OCR-rester, side-headere og fragment-rester
 * etter findBreakPoint. Tilsvarer ca. 30 tokens.
 */
const MIN_CHUNK_CHARS = 120;

/** Maks antall chunks å returnere fra søk */
const MAX_SEARCH_RESULTS = 10;

/** Maks kontekst-lengde i tegn (~3000 tokens ≈ 12000 tegn) */
const MAX_CONTEXT_CHARS = 12000;

/** Terskel for gjennomsnittlig ord per linje for å flagge sparse chunks */
const SPARSE_AVG_WORDS_THRESHOLD = 8;

/** Minimum antall linjer for at en chunk skal vurderes som sparse */
const SPARSE_MIN_LINES = 3;

/** Maks tegn for ekspandert filinnhold (~3000 tokens ≈ 12000 tegn) */
const MAX_EXPANDED_FILE_CHARS = 12000;

/**
 * Velger chunks fra en fil for full ekspansjon i konteksten.
 * Prioriterer: 1) allerede matchede chunks, 2) nærliggende chunks, 3) resten i dokumentrekkefølge.
 *
 * @param allChunks - Alle chunks fra filen, sortert etter index
 * @param matchedChunkIndexes - Set med chunk-indekser som allerede er matchet
 * @param maxChars - Maks tegn for ekspanderte chunks
 * @returns Array av chunks å inkludere (ekskluderer allerede matchede)
 */
export function selectChunksForExpansion(
  allChunks: ContentChunk[],
  matchedChunkIndexes: Set<number>,
  maxChars: number = MAX_EXPANDED_FILE_CHARS,
): ContentChunk[] {
  // Filtrer ut allerede matchede chunks
  const unmatchedChunks = allChunks.filter((c) => !matchedChunkIndexes.has(c.index));
  if (unmatchedChunks.length === 0) return [];

  // Sorter etter prioritet: nærliggende til matchede chunks først
  const matchedIndexArray = Array.from(matchedChunkIndexes);
  const minMatched = Math.min(...matchedIndexArray);
  const maxMatched = Math.max(...matchedIndexArray);

  // Chunks i samme "seksjon" (innenfor ±3 av matchede chunks) prioriteres
  const nearbyChunks: ContentChunk[] = [];
  const otherChunks: ContentChunk[] = [];

  for (const chunk of unmatchedChunks) {
    const isNearby = chunk.index >= minMatched - 3 && chunk.index <= maxMatched + 3;
    if (isNearby) {
      nearbyChunks.push(chunk);
    } else {
      otherChunks.push(chunk);
    }
  }

  // Sorter begge grupper etter dokumentrekkefølge
  nearbyChunks.sort((a, b) => a.index - b.index);
  otherChunks.sort((a, b) => a.index - b.index);

  // Velg chunks innenfor budsjett
  const selectedChunks: ContentChunk[] = [];
  let totalLength = 0;

  // Først nærliggende chunks
  for (const chunk of nearbyChunks) {
    if (totalLength + chunk.text.length > maxChars) break;
    selectedChunks.push(chunk);
    totalLength += chunk.text.length;
  }

  // Deretter andre chunks hvis det er plass
  for (const chunk of otherChunks) {
    if (totalLength + chunk.text.length > maxChars) break;
    selectedChunks.push(chunk);
    totalLength += chunk.text.length;
  }

  // Sorter endelig utvalg etter dokumentrekkefølge
  selectedChunks.sort((a, b) => a.index - b.index);

  return selectedChunks;
}

/**
 * Sjekker om en chunk er "sparse" — typisk PowerPoint-kulepunkter
 * eller konverterte PDF-slides med lite tekst per linje.
 *
 * @returns { sparse: boolean, avgWordsPerLine: number }
 */
export function checkChunkSparsity(text: string): { sparse: boolean; avgWordsPerLine: number } {
  const lines = text
    .split(/\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  if (lines.length < SPARSE_MIN_LINES) {
    return { sparse: false, avgWordsPerLine: 0 };
  }

  const totalWords = lines.reduce((sum, line) => {
    const words = line.split(/\s+/).filter((w) => w.length > 0);
    return sum + words.length;
  }, 0);

  const avgWordsPerLine = totalWords / lines.length;
  const sparse = avgWordsPerLine < SPARSE_AVG_WORDS_THRESHOLD;

  return { sparse, avgWordsPerLine };
}

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

    if (end < text.length) {
      end = findBreakPoint(text, start, end);
    }

    const chunk = text.slice(start, end).trim();
    // Drop chunks som er for små til å være meningsfulle — typisk fragmenter
    // når findBreakPoint returnerer en posisjon nær start. Disse forsøpler
    // ellers Pinecone/BM25-indeksen med nesten-identiske mikro-chunks.
    if (chunk.length >= MIN_CHUNK_CHARS) {
      chunks.push(chunk);
    }

    // Garanter minst 50% framdrift av chunkSize per iterasjon. Tidligere
    // brukte vi `Math.max(actualLen - effectiveOverlap, 1)`, som kunne ende
    // på 1-tegns-stepping når findBreakPoint returnerte en kort segment —
    // det produserte hundrevis av sliding-window chunks forskjøvet med 1 tegn.
    const actualLen = end - start;
    const effectiveOverlap = Math.min(overlap, Math.floor(actualLen / 2));
    const minStep = Math.max(1, Math.floor(chunkSize / 2));
    start += Math.max(actualLen - effectiveOverlap, minStep);
  }

  return chunks;
}

function findBreakPoint(text: string, start: number, end: number): number {
  const searchStart = Math.max(start, end - Math.floor((end - start) * 0.2));
  const segment = text.slice(searchStart, end);

  const paraBreak = segment.lastIndexOf("\n\n");
  if (paraBreak !== -1) return searchStart + paraBreak + 2;

  const lineBreak = segment.lastIndexOf("\n");
  if (lineBreak !== -1) return searchStart + lineBreak + 1;

  const sentenceBreak = segment.lastIndexOf(". ");
  if (sentenceBreak !== -1) return searchStart + sentenceBreak + 2;

  const wordBreak = segment.lastIndexOf(" ");
  if (wordBreak !== -1) return searchStart + wordBreak + 1;

  return end;
}

/**
 * Oppretter chunks fra et dokument og tilhørende kildemetadata.
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
 * Søker i chunks basert på keyword-matching.
 * Returnerer maks MAX_SEARCH_RESULTS chunks sortert etter score.
 */
export function searchChunks(
  chunks: ContentChunk[],
  message: string,
  opts?: { moduleHint?: string | null; fileHint?: string | null },
): ScoredChunk[] {
  const terms = extractSearchTerms(message);
  if (terms.length === 0) {
    logger.debug({ messagePreview: message.substring(0, 80) }, "searchChunks: ingen søketermer ekstrahert fra melding");
    return [];
  }

  const scored: ScoredChunk[] = [];

  for (const chunk of chunks) {
    let score = scoreText(chunk.text, terms);
    if (score === 0) continue;

    if (opts?.moduleHint) {
      const modLower = chunk.source.moduleTitle.toLowerCase();
      if (modLower.includes(opts.moduleHint.toLowerCase())) {
        score *= 1.5;
      }
    }

    if (opts?.fileHint) {
      const fileLower = chunk.source.fileName.toLowerCase();
      const hintLower = opts.fileHint.toLowerCase().replace(/\.pdf$/i, "");
      if (
        fileLower.includes(hintLower) ||
        hintLower.includes(fileLower.replace(/\.pdf$/i, ""))
      ) {
        score *= 2.0;
      }
    }

    scored.push({ ...chunk, score });
  }

  scored.sort((a, b) => {
    if (Math.abs(a.score - b.score) > 0.01) return b.score - a.score;
    return a.index - b.index;
  });

  return scored.slice(0, MAX_SEARCH_RESULTS);
}

/**
 * Bygger kontekst fra generiske chunk-entryer.
 * Brukes av både keyword-søk og vector-søk for å unngå duplisert formattering.
 */
export function buildChunkContextFromEntries(
  chunks: ContextChunkEntry[],
  maxChars?: number,
): string {
  const budget = maxChars ?? MAX_CONTEXT_CHARS;
  if (chunks.length === 0) return "";

  let kontekst = "";
  let used = 0;

  const byFile = new Map<string, ContextChunkEntry[]>();
  for (const chunk of chunks) {
    const key = `${chunk.source.courseId}:${chunk.source.fileId}`;
    const existing = byFile.get(key) ?? [];
    existing.push(chunk);
    byFile.set(key, existing);
  }

  for (const [, fileChunks] of byFile) {
    fileChunks.sort((a, b) => a.index - b.index);

    const source = fileChunks[0].source;
    const ext = source.fileName.split(".").pop()?.toLowerCase() ?? "";
    const label = ext === "pdf" ? "PDF-INNHOLD" : "FIL-INNHOLD";
    const header = `\n--- ${label}: ${source.fileName} (${source.courseName}, ${source.moduleTitle}) ---\n`;

    if (used + header.length >= budget) break;
    kontekst += header;
    used += header.length;

    for (const chunk of fileChunks) {
      const entry = chunk.text + "\n";
      if (used + entry.length > budget) {
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

    const footer = `--- SLUTT ${label} ---\n`;
    kontekst += footer;
    used += footer.length;

    if (used >= budget) break;
  }

  return kontekst;
}

/**
 * Beholder eksisterende signatur for keyword-søk-kontekst.
 */
export function buildChunkContext(
  chunks: ScoredChunk[],
  maxChars?: number,
): string {
  return buildChunkContextFromEntries(
    chunks.map((chunk) => ({
      text: chunk.text,
      source: chunk.source,
      index: chunk.index,
    })),
    maxChars,
  );
}
