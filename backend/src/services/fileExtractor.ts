/**
 * File Extractor Service
 *
 * Delt verktøy for tekstutvinning fra ulike filtyper.
 * Brukes av både Canvas sync (canvas-sync.service) og opplastingshåndterer (document.ts).
 *
 * Støttede filtyper:
 *   - Kodefiler: .java, .js, .ts, .jsx, .tsx, .py, .html, .css, .scss,
 *     .sql, .cpp, .c, .h, .cs, .go, .rs, .php, .rb, .swift, .kt, .xml,
 *     .json, .yaml, .yml, .sh, .bash, .ps1, .r, .m, .dart
 *   - Office: .pptx, .xlsx, .docx (via mammoth)
 *   - Tekst: .txt, .md
 *   - PDF: håndteres IKKE her — bruk fetchPdfContent / parsePdfDocument
 */

import mammoth from "mammoth";
import AdmZip from "adm-zip";
import { logger } from "../utils/logger.js";

// Konstanter
/** Maks filstørrelse for ekstraksjon (10 MB) */
export const MAX_EXTRACT_FILE_SIZE = 10 * 1024 * 1024;

/** Maks antall ark/slides å prosessere. 200 dekker alle forelesninger vi
 *  ser i praksis — inkludert hele pensum-PDF-er på 100+ slides og multi-
 *  kapittel-dekk. Lagringen chunker nå fullText over flere rader, så ingen
 *  grunn til å begrense hardt her. */
const MAX_SHEETS_OR_SLIDES = 200;

/** Maks tegn for ekstrahert innhold. Beskyttelse mot uforholdsmessig store
 *  filer (minnebruk under ekstraksjon), ikke mot lagringsgrense — lagringen
 *  chunker fullText så det finnes ingen cap der. 2 000 000 tegn (~2 MB
 *  tekst) dekker hele pensumbøker uten å være risikabelt for ekstraktorens
 *  minnebruk. */
const MAX_CONTENT_LENGTH = 2_000_000;

/** Maks dekomprimert størrelse per intern XML-fil for å forhindre Zip-bomber (50 MB) */
const MAX_DECOMPRESSED_ENTRY_SIZE = 50 * 1024 * 1024;

// Filtype-klassifisering
/** Kodefil-endelser → språknavn for AI-kontekst */
export const CODE_EXTENSIONS: Record<string, string> = {
  ".java": "Java",
  ".js": "JavaScript",
  ".ts": "TypeScript",
  ".jsx": "JSX",
  ".tsx": "TSX",
  ".py": "Python",
  ".html": "HTML",
  ".css": "CSS",
  ".scss": "SCSS",
  ".sql": "SQL",
  ".cpp": "C++",
  ".c": "C",
  ".h": "C/C++ Header",
  ".cs": "C#",
  ".go": "Go",
  ".rs": "Rust",
  ".php": "PHP",
  ".rb": "Ruby",
  ".swift": "Swift",
  ".kt": "Kotlin",
  ".xml": "XML",
  ".json": "JSON",
  ".yaml": "YAML",
  ".yml": "YAML",
  ".sh": "Shell",
  ".bash": "Bash",
  ".ps1": "PowerShell",
  ".r": "R",
  ".m": "MATLAB/Objective-C",
  ".dart": "Dart",
};

/** Tekst-endelser (leses direkte) */
const TEXT_EXTENSIONS = new Set([".txt", ".md", ".csv"]);

/** Office-endelser med spesialbehandling */
const OFFICE_EXTENSIONS = new Set([".docx", ".pptx", ".xlsx"]);

/** Alle støttede filendelser (for Canvas sync-filtrering) */
export const SUPPORTED_FILE_EXTENSIONS = new Set([
  ...Object.keys(CODE_EXTENSIONS),
  ...TEXT_EXTENSIONS,
  ...OFFICE_EXTENSIONS,
  ".pdf",
]);

/**
 * Sjekker om en filendelse er en støttet filtype.
 */
export function isSupportedFileType(filename: string): boolean {
  const ext = getExtension(filename);
  return SUPPORTED_FILE_EXTENSIONS.has(ext);
}

/**
 * Hent filendelsen fra et filnavn (.lowercase).
 */
export function getExtension(filename: string): string {
  const match = filename.toLowerCase().match(/\.[^.]+$/);
  return match?.[0] ?? "";
}

/**
 * Returnerer språknavn for kodefiler, eller null.
 */
export function getCodeLanguage(filename: string): string | null {
  return CODE_EXTENSIONS[getExtension(filename)] ?? null;
}

// Tekstutvinning
export interface ExtractResult {
  content: string;
  truncated: boolean;
  /** Filendelse (f.eks. ".java") */
  fileExtension: string;
  /** Språk for kodefiler (f.eks. "Java"), ellers null */
  language: string | null;
  /** Metode brukt for ekstraksjon */
  method: "utf8-text" | "mammoth" | "pptx-xml" | "xlsx-xml";
}

/**
 * Ekstraherer tekst fra en fil basert på filnavn/endelse.
 *
 * For kodefiler og klartekst: leser direkte som UTF-8.
 * For .docx: bruker mammoth.
 * For .pptx: leser ut slide-XML fra ZIP.
 * For .xlsx: leser ut sheet-XML fra ZIP.
 *
 * Returnerer null for ustøttede filtyper og filer uten lesbar tekst.
 * PDF håndteres IKKE her — bruk eksisterende fetchPdfContent / parsePdfDocument.
 */
export async function extractTextFromFile(
  buffer: Buffer,
  filename: string,
): Promise<ExtractResult | null> {
  const ext = getExtension(filename);
  const language = CODE_EXTENSIONS[ext] ?? null;

  // Størrelsesjekk
  if (buffer.length > MAX_EXTRACT_FILE_SIZE) {
    logger.warn(
      { filename, size: buffer.length, maxSize: MAX_EXTRACT_FILE_SIZE },
      "Fil for stor for ekstraksjon — hoppet over",
    );
    return null;
  }

  // Kodefiler og klartekst → les direkte
  if (language || TEXT_EXTENSIONS.has(ext)) {
    const raw = buffer.toString("utf-8");
    if (!raw.trim()) {
      logger.info({ filename }, "Fil inneholder ingen tekst");
      return null;
    }
    const truncated = raw.length > MAX_CONTENT_LENGTH;
    const content = truncated ? raw.substring(0, MAX_CONTENT_LENGTH) : raw;
    logger.info(
      { filename, ext, language, method: "utf8-text", textLength: content.length, truncated },
      language ? "Kodefil ekstrahert" : "Tekstfil lest direkte",
    );
    return { content, truncated, fileExtension: ext, language, method: "utf8-text" };
  }

  // .docx → mammoth
  if (ext === ".docx") {
    return extractDocx(buffer, filename);
  }

  // .pptx → ZIP/XML
  if (ext === ".pptx") {
    return extractPptx(buffer, filename);
  }

  // .xlsx → ZIP/XML
  if (ext === ".xlsx") {
    return extractXlsx(buffer, filename);
  }

  return null;
}

// Office-parsere
async function extractDocx(buffer: Buffer, filename: string): Promise<ExtractResult | null> {
  try {
    const result = await mammoth.extractRawText({ buffer });
    const text = result.value?.trim();
    if (!text) {
      logger.info({ filename }, "DOCX inneholder ingen tekst");
      return null;
    }
    const truncated = text.length > MAX_CONTENT_LENGTH;
    const content = truncated ? text.substring(0, MAX_CONTENT_LENGTH) : text;
    logger.info(
      { filename, method: "mammoth", textLength: content.length, truncated },
      "DOCX-tekst ekstrahert",
    );
    return { content, truncated, fileExtension: ".docx", language: null, method: "mammoth" };
  } catch (error) {
    logger.warn({ err: error, filename }, "DOCX-ekstraksjon feilet");
    return null;
  }
}

function extractPptx(buffer: Buffer, filename: string): ExtractResult | null {
  try {
    const zip = new AdmZip(buffer);
    const slideTexts: string[] = [];
    let slideCount = 0;

    // PPTX slides er i ppt/slides/slide1.xml, slide2.xml, ...
    const entries = zip
      .getEntries()
      .filter((e) => /^ppt\/slides\/slide\d+\.xml$/i.test(e.entryName))
      .sort((a, b) => {
        const numA = parseInt(a.entryName.match(/slide(\d+)/)?.[1] ?? "0", 10);
        const numB = parseInt(b.entryName.match(/slide(\d+)/)?.[1] ?? "0", 10);
        return numA - numB;
      });

    for (const entry of entries) {
      if (slideCount >= MAX_SHEETS_OR_SLIDES) break;
      if (entry.header.size > MAX_DECOMPRESSED_ENTRY_SIZE) {
        logger.warn(
          { filename, entryName: entry.entryName, size: entry.header.size },
          "Utpakket fil for stor (mulig zip bomb), hopper over data",
        );
        continue;
      }
      const xml = entry.getData().toString("utf-8");
      // Ekstraher tekst fra <a:t>-tagger (DrawingML text runs)
      const textParts = [...xml.matchAll(/<a:t[^>]*>([\s\S]*?)<\/a:t>/g)]
        .map((m) => m[1].trim())
        .filter(Boolean);
      if (textParts.length > 0) {
        slideTexts.push(`--- Slide ${slideCount + 1} ---\n${textParts.join(" ")}`);
      }
      slideCount++;
    }

    if (slideTexts.length === 0) {
      logger.info({ filename, totalSlides: entries.length }, "PPTX inneholder ingen tekst");
      return null;
    }

    let text = slideTexts.join("\n\n");
    if (entries.length > MAX_SHEETS_OR_SLIDES) {
      text += `\n\n[... ${entries.length - MAX_SHEETS_OR_SLIDES} slides ikke inkludert ...]`;
    }
    const truncated = text.length > MAX_CONTENT_LENGTH;
    const content = truncated ? text.substring(0, MAX_CONTENT_LENGTH) : text;
    logger.info(
      {
        filename,
        method: "pptx-xml",
        slidesProcessed: slideCount,
        textLength: content.length,
        truncated,
      },
      "PPTX-tekst ekstrahert",
    );
    return { content, truncated, fileExtension: ".pptx", language: null, method: "pptx-xml" };
  } catch (error) {
    logger.warn({ err: error, filename }, "PPTX-ekstraksjon feilet");
    return null;
  }
}

function extractXlsx(buffer: Buffer, filename: string): ExtractResult | null {
  try {
    const zip = new AdmZip(buffer);

    // Les delt streng-tabell (xl/sharedStrings.xml)
    const sharedStrings: string[] = [];
    const ssEntry = zip.getEntry("xl/sharedStrings.xml");
    if (ssEntry) {
      if (ssEntry.header.size > MAX_DECOMPRESSED_ENTRY_SIZE) {
        logger.warn(
          { filename, entryName: ssEntry.entryName, size: ssEntry.header.size },
          "Utpakket sharedStrings for stor (mulig zip bomb), hopper over",
        );
      } else {
        const ssXml = ssEntry.getData().toString("utf-8");
        const matches = [...ssXml.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)];
        for (const m of matches) {
          sharedStrings.push(m[1]);
        }
      }
    }

    // Les ark (xl/worksheets/sheet1.xml, ...)
    const sheetEntries = zip
      .getEntries()
      .filter((e) => /^xl\/worksheets\/sheet\d+\.xml$/i.test(e.entryName))
      .sort((a, b) => {
        const numA = parseInt(a.entryName.match(/sheet(\d+)/)?.[1] ?? "0", 10);
        const numB = parseInt(b.entryName.match(/sheet(\d+)/)?.[1] ?? "0", 10);
        return numA - numB;
      });

    const sheetTexts: string[] = [];
    let sheetCount = 0;

    for (const entry of sheetEntries) {
      if (sheetCount >= MAX_SHEETS_OR_SLIDES) break;
      if (entry.header.size > MAX_DECOMPRESSED_ENTRY_SIZE) {
        logger.warn(
          { filename, entryName: entry.entryName, size: entry.header.size },
          "Utpakket ark for stort (mulig zip bomb), hopper over",
        );
        continue;
      }
      const xml = entry.getData().toString("utf-8");

      // Hent rader — <row>...</row>
      const rows = [...xml.matchAll(/<row[^>]*>([\s\S]*?)<\/row>/g)];
      const rowTexts: string[] = [];

      for (const row of rows) {
        const cellValues: string[] = [];
        // Sikker parsing: split på <c-tagger og prosesser individuelt (unngår ReDoS)
        const cellOpenings = [...row[1].matchAll(/<c\b/g)];
        for (const cellStart of cellOpenings) {
          const startIdx = cellStart.index!;
          const closeIdx = row[1].indexOf("</c>", startIdx);
          if (closeIdx === -1) continue;
          const cellXml = row[1].slice(startIdx, closeIdx + 4);

          // Hent type-attributt (t="s" betyr shared string)
          const typeMatch = cellXml.match(/\st="([^"]*)"/);
          const type = typeMatch?.[1];

          // Hent <v>-verdien
          const valueMatch = cellXml.match(/<v>([^<]*)<\/v>/);
          if (!valueMatch) continue;
          const value = valueMatch[1];

          if (type === "s") {
            const idx = parseInt(value, 10);
            cellValues.push(sharedStrings[idx] ?? value);
          } else {
            cellValues.push(value);
          }
        }
        if (cellValues.length > 0) {
          rowTexts.push(cellValues.join("\t"));
        }
      }

      if (rowTexts.length > 0) {
        sheetTexts.push(`--- Ark ${sheetCount + 1} ---\n${rowTexts.join("\n")}`);
      }
      sheetCount++;
    }

    if (sheetTexts.length === 0) {
      logger.info({ filename, totalSheets: sheetEntries.length }, "XLSX inneholder ingen data");
      return null;
    }

    let text = sheetTexts.join("\n\n");
    if (sheetEntries.length > MAX_SHEETS_OR_SLIDES) {
      text += `\n\n[... ${sheetEntries.length - MAX_SHEETS_OR_SLIDES} ark ikke inkludert ...]`;
    }
    const truncated = text.length > MAX_CONTENT_LENGTH;
    const content = truncated ? text.substring(0, MAX_CONTENT_LENGTH) : text;
    logger.info(
      {
        filename,
        method: "xlsx-xml",
        sheetsProcessed: sheetCount,
        textLength: content.length,
        truncated,
      },
      "XLSX-data ekstrahert",
    );
    return { content, truncated, fileExtension: ".xlsx", language: null, method: "xlsx-xml" };
  } catch (error) {
    logger.warn({ err: error, filename }, "XLSX-ekstraksjon feilet");
    return null;
  }
}
