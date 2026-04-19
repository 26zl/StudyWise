/**
 * Document parsing service
 * Konverterer dokumenter (PDF, Word, TXT, bilder) til ren tekst for KI-analyse
 * Bruker pdf-parse for PDF-tekst, unpdf for PDF-rendring i OCR-fallback,
 * mammoth for Word, sharp for bildeforbehandling, og tesseract.js for OCR
 */

// --- Polyfill: ArrayBuffer.prototype.transfer / transferToFixedLength ---
// pdf.js (brukt av unpdf) kaller transferToFixedLength under rendering.
// Metoden ble lagt til i Node 22; i Node 20 mangler den og rendring feiler stille
// med ein blank PNG. Polyfill-en gjenskaper semantikken: kopier data til ny buffer
// og detach originalen (via structured clone av 0-byte slice).
if (!ArrayBuffer.prototype.transfer) {
    ArrayBuffer.prototype.transfer = function (newByteLength?: number): ArrayBuffer {
        const len = newByteLength ?? this.byteLength;
        const newBuf = new ArrayBuffer(len);
        new Uint8Array(newBuf).set(new Uint8Array(this, 0, Math.min(this.byteLength, len)));
        // Frigjør den opprinnelige bufferen ved å overføre via structuredClone
        try { structuredClone(this, { transfer: [this] }); } catch { /* allerede frigjort eller ustøttet */ }
        return newBuf;
    };
}
if (!ArrayBuffer.prototype.transferToFixedLength) {
    ArrayBuffer.prototype.transferToFixedLength = function (newByteLength?: number): ArrayBuffer {
        return this.transfer(newByteLength);
    };
}
// --- End polyfill ---

import { renderPageAsImage } from "unpdf";
import { PDFParse } from "pdf-parse";
import mammoth from "mammoth";
import Tesseract from "tesseract.js";
import sharp from "sharp";
import pLimit from "p-limit";
import { logger } from "../utils/logger.js";
import { isProd } from "../utils/env.js";
import { DocumentParseResultSchema } from "common/document";
import type { DocumentParseResult } from "common/document";
import { extractTextFromFile, getCodeLanguage } from "./fileExtractor.js";

// Konfigurasjon
const OCR_TIMEOUT_MS = 60000; // 60 sekunder timeout for OCR
const MAX_FILE_SIZE_BYTES = 50 * 1024 * 1024; // 50MB maks filstørrelse for parsing
const MAX_OCR_PAGES = 10; // Maks antall PDF-sider som OCR-es (interaktiv analyse)
/**
 * Maks antall PDF-sider som OCR-es under Canvas sync.
 * Default 1 for Heroku 512MB-dynoer; kan overstyres med SYNC_OCR_MAX_PAGES
 * for lokal kjøring eller større dynoer.
 */
const MAX_OCR_PAGES_SYNC = (() => {
  const raw = process.env.SYNC_OCR_MAX_PAGES;
  const parsed = raw ? Number.parseInt(raw, 10) : NaN;
  if (Number.isFinite(parsed) && parsed > 0) return parsed;
  // Lokalt: ingen praktisk grense (samme som interaktiv MAX_OCR_PAGES). Prod: 1 side.
  return isProd ? 1 : MAX_OCR_PAGES;
})();
/**
 * Maks filstørrelse for OCR under sync — store skannede PDF-er hopper over OCR.
 * Default 5MB i prod (Heroku); lokalt er grensen praktisk talt fjernet.
 * Kan overstyres med SYNC_OCR_MAX_FILE_MB.
 */
const MAX_OCR_FILE_SIZE_SYNC = (() => {
  const raw = process.env.SYNC_OCR_MAX_FILE_MB;
  const parsedMb = raw ? Number.parseInt(raw, 10) : NaN;
  if (Number.isFinite(parsedMb) && parsedMb > 0) return parsedMb * 1024 * 1024;
  // Lokalt: 1 GB (effektivt ubegrenset). Prod: 5 MB.
  const mb = isProd ? 5 : 1024;
  return mb * 1024 * 1024;
})();
/** Maks dekompresjonsforhold for ZIP-baserte filer (DOCX/PPTX/XLSX) — beskytter mot zip-bomber */
const MAX_ZIP_DECOMPRESSION_RATIO = 100;

/**
 * Global OCR-semafor: begrenser samtidige OCR-operasjoner på tvers av alle
 * forespørsler for å unngå at minnet spiser opp Heroku-dynoen.
 * Tesseract + sharp + renderPageAsImage bruker ~8-12 MB per side.
 */
const ocrLimit = pLimit(1);

// Støttede MIME-typer og deres filtype
export const SUPPORTED_DOCUMENT_TYPES: Record<string, string> = {
    "application/pdf": "pdf",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
    "application/msword": "doc",
    "application/vnd.openxmlformats-officedocument.presentationml.presentation": "pptx",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx",
    "text/plain": "txt",
    "text/markdown": "md",
    "text/csv": "csv",
    "application/rtf": "rtf",
    // Kodefiler
    "text/x-java-source": "code",
    "text/javascript": "code",
    "application/javascript": "code",
    "text/typescript": "code",
    "text/x-python": "code",
    "text/html": "code",
    "text/css": "code",
    "text/x-scss": "code",
    "text/x-sql": "code",
    "text/x-c": "code",
    "text/x-c++src": "code",
    "text/x-csharp": "code",
    "text/x-go": "code",
    "text/x-rust": "code",
    "text/x-php": "code",
    "text/x-ruby": "code",
    "text/x-swift": "code",
    "text/x-kotlin": "code",
    "text/xml": "code",
    "application/xml": "code",
    "application/json": "code",
    "text/yaml": "code",
    "text/x-shellscript": "code",
    "application/x-powershell": "code",
    "text/x-r": "code",
    "text/x-dart": "code",
    // Bildestøtte for OCR
    "image/png": "image",
    "image/jpeg": "image",
    "image/jpg": "image",
    "image/webp": "image",
    "image/gif": "image",
    "image/bmp": "image",
    "image/tiff": "image",
};

/**
 * Magic bytes (file signatures) for støttede formater – brukes for å validere at filinnhold
 * matcher deklarert MIME-type (mot MIME-spoofing og farlige filtyper).
 * Kilde: https://en.wikipedia.org/wiki/List_of_file_signatures
 */
const MAGIC_SIGNATURES: Array<{ mime: string; sig: number[]; offset?: number }> = [
    { mime: "application/pdf", sig: [0x25, 0x50, 0x44, 0x46] }, // %PDF
    { mime: "image/png", sig: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] },
    { mime: "image/jpeg", sig: [0xff, 0xd8, 0xff] },
    { mime: "image/gif", sig: [0x47, 0x49, 0x46, 0x38] }, // GIF8
    { mime: "image/bmp", sig: [0x42, 0x4d] },
    { mime: "image/webp", sig: [0x52, 0x49, 0x46, 0x46], offset: 0 }, // RIFF
    { mime: "image/tiff", sig: [0x49, 0x49, 0x2a, 0x00] }, // little-endian
    { mime: "image/tiff", sig: [0x4d, 0x4d, 0x00, 0x2a] }, // big-endian
    { mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", sig: [0x50, 0x4b, 0x03, 0x04] },
    { mime: "application/msword", sig: [0xd0, 0xcf, 0x11, 0xe0] }, // Eldre .doc (CFB)
    { mime: "application/rtf", sig: [0x7b, 0x5c, 0x72, 0x74, 0x66] }, // {\rtf
];

function getMimeFromMagicBytes(buffer: Buffer): string | null {
    if (buffer.length < 12) return null;
    for (const { mime, sig, offset = 0 } of MAGIC_SIGNATURES) {
        if (offset + sig.length > buffer.length) continue;
        if (sig.every((byte, i) => buffer[offset + i] === byte)) {
            if (mime === "image/webp") {
                if (buffer.length >= 12 && buffer[8] === 0x57 && buffer[9] === 0x45 && buffer[10] === 0x42 && buffer[11] === 0x50) return mime;
                continue;
            }
            return mime;
        }
    }
    return null;
}

/**
 * Verifiserer at ZIP-basert Office-fil (OOXML) inneholder forventede interne filer.
 * DOCX → word/document.xml, XLSX → xl/workbook.xml, PPTX → ppt/presentation.xml.
 * Returnerer feilmelding ved mismatch, ellers null.
 */
function validateOfficeZipStructure(buffer: Buffer, declaredMime: string): string | null {
    // Nøkkelmappe/-fil som identifiserer hvert Office-format
    const expectedEntries: Record<string, string> = {
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "word/",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xl/",
        "application/vnd.openxmlformats-officedocument.presentationml.presentation": "ppt/",
    };

    const expected = expectedEntries[declaredMime];
    if (!expected) return null; // Ukjent type, ingen ekstra sjekk

    try {
        // ZIP central directory entries er synlige som ASCII-strenger i bufferen.
        // Enkel sjekk: søk etter forventet mappeprefix i rå buffer.
        const content = buffer.toString("latin1");
        if (!content.includes(expected)) {
            return `Filinnholdet mangler forventet ${expected}-mappe for ${declaredMime}. Filen kan være et annet Office-format.`;
        }
    } catch {
        // Kan ikke lese buffer — la det passere
    }
    return null;
}

/**
 * Sjekker at buffer matcher forventet MIME (eller at det er ren tekst for text/*).
 * Returnerer feilmelding ved mismatch, ellers null.
 */
export function validateFileMagicBytes(buffer: Buffer, declaredMimeType: string): string | null {
    const fromMagic = getMimeFromMagicBytes(buffer);
    const declaredNorm = declaredMimeType.toLowerCase().trim();

    if (declaredNorm.startsWith("text/") || declaredNorm === "text/plain" || declaredNorm === "text/markdown" || declaredNorm === "text/csv") {
        if (fromMagic !== null) {
            return `Filen inneholder binært innhold (signatur for ${fromMagic}), ikke tekst. Opplastet som "${declaredMimeType}".`;
        }
        return null;
    }

    if (fromMagic === null) {
        if (declaredNorm === "application/rtf") return null;
        return `Kunne ikke bekrefte filtype fra innhold (ingen kjent signatur). Forventet ${declaredMimeType}.`;
    }

    // Alle Office Open XML-formater (docx, pptx, xlsx) deler PK ZIP-signatur.
    // Verifiser intern ZIP-struktur for å skille mellom formatene.
    // application/msword (legacy .doc) bruker OLE2-signatur, ikke ZIP — hører ikke hjemme her
    const allowedForZip = [
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    ];
    if (fromMagic === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" && allowedForZip.includes(declaredNorm)) {
        // Sjekk intern struktur for å verifisere at ZIP-innholdet matcher deklarert type
        const structureError = validateOfficeZipStructure(buffer, declaredNorm);
        if (structureError) return structureError;
        return null;
    }
    if (fromMagic === "application/msword" && declaredNorm === "application/msword") return null;

    if (fromMagic !== declaredNorm) {
        return `Filinnhold matcher ikke deklarert type: innhold ser ut som ${fromMagic}, opplastet som ${declaredMimeType}.`;
    }
    return null;
}

/**
 * Estimerer total ukomprimert størrelse fra ZIP Local File Headers.
 * Leser felt «uncompressed size» (4 bytes, little-endian) fra hver entry
 * uten å faktisk dekomprimere. Returnerer null hvis bufferen ikke er gyldig ZIP.
 */
function estimateZipDecompressedSize(buffer: Buffer): number | null {
    // ZIP Local File Header signatur: PK\x03\x04
    if (buffer.length < 30 || buffer[0] !== 0x50 || buffer[1] !== 0x4B) return null;

    let total = 0;
    let offset = 0;

    while (offset + 30 <= buffer.length) {
        // Sjekk Local File Header signatur
        if (buffer[0 + offset] !== 0x50 || buffer[1 + offset] !== 0x4B ||
            buffer[2 + offset] !== 0x03 || buffer[3 + offset] !== 0x04) {
            break;
        }
        // Uncompressed size: offset 22, 4 bytes LE
        const uncompressedSize = buffer.readUInt32LE(offset + 22);
        total += uncompressedSize;

        // Hopp til neste entry: 30 + filename length (offset 26) + extra field length (offset 28) + compressed size (offset 18)
        const fileNameLen = buffer.readUInt16LE(offset + 26);
        const extraFieldLen = buffer.readUInt16LE(offset + 28);
        const compressedSize = buffer.readUInt32LE(offset + 18);

        offset += 30 + fileNameLen + extraFieldLen + compressedSize;
    }

    return total > 0 ? total : null;
}

// Filendelser til MIME-type mapping (fallback)
export const EXTENSION_TO_MIME: Record<string, string> = {
    ".pdf": "application/pdf",
    ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ".doc": "application/msword",
    ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    ".txt": "text/plain",
    ".md": "text/markdown",
    ".csv": "text/csv",
    ".rtf": "application/rtf",
    // Kodefiler
    ".java": "text/x-java-source",
    ".js": "text/javascript",
    ".ts": "text/typescript",
    ".jsx": "text/javascript",
    ".tsx": "text/typescript",
    ".py": "text/x-python",
    ".html": "text/html",
    ".css": "text/css",
    ".scss": "text/x-scss",
    ".sql": "text/x-sql",
    ".cpp": "text/x-c++src",
    ".c": "text/x-c",
    ".h": "text/x-c",
    ".cs": "text/x-csharp",
    ".go": "text/x-go",
    ".rs": "text/x-rust",
    ".php": "text/x-php",
    ".rb": "text/x-ruby",
    ".swift": "text/x-swift",
    ".kt": "text/x-kotlin",
    ".xml": "text/xml",
    ".json": "application/json",
    ".yaml": "text/yaml",
    ".yml": "text/yaml",
    ".sh": "text/x-shellscript",
    ".bash": "text/x-shellscript",
    ".ps1": "application/x-powershell",
    ".r": "text/x-r",
    ".m": "text/x-c",
    ".dart": "text/x-dart",
    // Bildestøtte
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".webp": "image/webp",
    ".gif": "image/gif",
    ".bmp": "image/bmp",
    ".tiff": "image/tiff",
    ".tif": "image/tiff",
};

/**
 * Saniterer og renser tekst fra dokumenter.
 * Maskerer strukturert PII (epost, telefon, norske fødselsnummer, studentnummer,
 * norske adresser og postnummer) samt kontekst-drevne personnavn (signatur-blokker
 * og navn-felter). Navn-dekningen er best-effort — uten NER-modell kan navn uten
 * kontekst-ledetråd (f.eks. midt i løpende tekst) slippe gjennom. System-prompten
 * i Document Mode instruerer modellen om å ikke gjengi personnavn som en
 * forsvarslinje-2.
 */
function sanitizeText(text: string): { cleanText: string; redacted: boolean } {
    let cleanText = text;
    let redacted = false;

    // Fjern null bytes
    cleanText = cleanText.replace(/\0/g, "");

    // Masker epost
    const emailRegex = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
    cleanText = cleanText.replace(emailRegex, () => {
        redacted = true;
        return "[REDACTED_EMAIL]";
    });

    // Masker telefonnummer (norske og internasjonale)
    const phoneRegex = /\b(?:\+?\d[\d\s-]{6,14}\d)\b/g;
    cleanText = cleanText.replace(phoneRegex, () => {
        redacted = true;
        return "[REDACTED_PHONE]";
    });

    // Masker norske fødselsnummer (11 siffer, ddmmyyxxxxx)
    const fodselsnummerRegex = /\b([0-3]\d[0-1]\d{3}\s?\d{5})\b/g;
    cleanText = cleanText.replace(fodselsnummerRegex, () => {
        redacted = true;
        return "[REDACTED_SSN]";
    });

    // Masker studentnummer — krever kontekst-prefiks for å unngå falske treff på
    // vilkårlige 6-8-sifrede tall i kode, datasett og fagstoff (f.eks. år,
    // portnumre, ID-er, timestamps).
    // Fanger: "s123456", "stud-123456", "stud.1234567", "student 12345678",
    // "studentnr: 1234567", "studentnummer 12345678".
    const studentnummerRegex = /\b(?:s|stud(?:ent)?(?:nr|nummer)?[.:\s-]{0,3})\d{6,8}\b/gi;
    cleanText = cleanText.replace(studentnummerRegex, () => {
        redacted = true;
        return "[REDACTED_STUDENT_ID]";
    });

    // Masker norske adresser (gatenavn + nummer + eventuelt postnummer/sted)
    // Enkel heuristikk: "Gatenavn 123" eller "Gatenavn 123A" fulgt av eventuelt 4-sifret postnummer
    // eslint-disable-next-line security/detect-unsafe-regex
    const adresseRegex = /\b([A-ZÆØÅ][a-zæøå]+(?:gata|gaten|veien|vegen|vei|gate|plass|allé|alléen|vn\.|gt\.)?)\s+\d{1,4}[A-Za-z]?\b(?:\s*,?\s*\d{4}\s+[A-ZÆØÅ][a-zæøå]+)?/gi;
    cleanText = cleanText.replace(adresseRegex, () => {
        redacted = true;
        return "[REDACTED_ADDRESS]";
    });

    // Masker postnummer + sted (4 siffer + stedsnavn)
    // eslint-disable-next-line security/detect-unsafe-regex
    const postnummerRegex = /\b\d{4}\s+[A-ZÆØÅ][a-zæøå]+(?:\s+[A-ZÆØÅ][a-zæøå]+)?\b/g;
    cleanText = cleanText.replace(postnummerRegex, () => {
        redacted = true;
        return "[REDACTED_POSTAL]";
    });

    // Masker personnavn i signatur-blokker (Mvh, Med vennlig hilsen, Skrevet av, Regards)
    // og eksplisitte navn-felter (Navn:, Student:, Forfatter:, Kandidat:).
    // Matcher 1-4 kapitaliserte navne-tokens etter en kontekst-ledetråd.
    // Kontekst-kravet holder false-positive-raten lav sammenlignet med NER-fri
    // deteksjon i løpende tekst.
    const NAVN_TOKEN = "[A-ZÆØÅ][A-Za-zÆØÅæøå'\\-]{1,30}";
    const NAVN_SEKVENS = `${NAVN_TOKEN}(?:\\s+${NAVN_TOKEN}){0,3}`;

    // Signatur-linjer
    const signaturRegex = new RegExp(
        `\\b(med\\s+vennlig\\s+hilsen|mvh|vennlig\\s+hilsen|hilsen|signert|skrevet\\s+av|levert\\s+av|innlevert\\s+av|best\\s+regards|kind\\s+regards|regards|sincerely|signed)[\\s:,.-]+(${NAVN_SEKVENS})`,
        "gi",
    );
    cleanText = cleanText.replace(signaturRegex, (_m, lead: string) => {
        redacted = true;
        return `${lead} [REDACTED_NAME]`;
    });

    // Navn-felter: "Navn: X Y", "Student: X Y", "Forfatter: X Y"
    const navnFeltRegex = new RegExp(
        `\\b(navn|fullt\\s+navn|name|full\\s+name|student|studentnavn|kandidat|forfatter|author|skrevet\\s+av|av)\\s*[:=]\\s*(${NAVN_SEKVENS})`,
        "gi",
    );
    cleanText = cleanText.replace(navnFeltRegex, (_m, lead: string) => {
        redacted = true;
        return `${lead}: [REDACTED_NAME]`;
    });

    // Fjern kontrollkarakterer (ASCII 0-31 og 127), behold tab/newline/CR
    cleanText = cleanText
        .split("")
        .filter((char: string) => {
            const code = char.charCodeAt(0);
            return code >= 32 || code === 9 || code === 10 || code === 13;
        })
        .join("")
        .trim();

    return { cleanText, redacted };
}

/**
 * Forbehandler bilde for bedre OCR-resultater
 * - Konverterer til gråskala for bedre kontrast
 * - Øker kontrast og skarphet
 * - Normaliserer størrelse
 * - Inverterer farger hvis bildet har lys tekst på mørk bakgrunn
 */
async function preprocessImageForOCR(buffer: Buffer): Promise<Buffer> {
    try {
        const image = sharp(buffer);
        const metadata = await image.metadata();
        
        logger.info({ 
            width: metadata.width, 
            height: metadata.height, 
            format: metadata.format 
        }, "Preprocessing image for OCR");

        // Analyser bildet for å detektere om det har mørk bakgrunn (lys tekst)
        const stats = await image.stats();
        const avgBrightness = stats.channels.reduce((sum, ch) => sum + ch.mean, 0) / stats.channels.length;
        const isDarkBackground = avgBrightness < 128;

        let processed = sharp(buffer)
            // Konverter til gråskala
            .grayscale()
            // Øk kontrast
            .normalize()
            // Skarp opp tekst
            .sharpen({ sigma: 1.5 });

        // Inverter hvis mørk bakgrunn (gjør tekst mørk på lys bakgrunn)
        if (isDarkBackground) {
            logger.info("Detected dark background, inverting image for better OCR");
            processed = processed.negate();
        }

        // Skaler opp små bilder for bedre OCR (min 1000px bredde)
        if (metadata.width && metadata.width < 1000) {
            const scale = Math.min(2, 1000 / metadata.width);
            processed = processed.resize({
                width: Math.round(metadata.width * scale),
                height: metadata.height ? Math.round(metadata.height * scale) : undefined,
                fit: "inside",
            });
        }

        // Konverter til PNG for best kvalitet
        const result = await processed.png().toBuffer();
        
        logger.info({ 
            originalSize: buffer.length, 
            processedSize: result.length,
            inverted: isDarkBackground 
        }, "Image preprocessing complete");

        return result;
    } catch (error) {
        logger.warn({ err: error }, "Image preprocessing failed, using original");
        return buffer; // Fallback til original hvis forbehandling feiler
    }
}

/**
 * Utfører OCR på et bilde med tesseract.js
 * Støtter norsk og engelsk tekst
 * Inkluderer bildeforbehandling og timeout
 */
async function performOCR(buffer: Buffer): Promise<{ text: string; confidence: number }> {
    try {
        logger.info({ bufferLength: buffer.length }, "Starting OCR processing");
        
        // Forbehandle bildet for bedre OCR-resultater
        const processedBuffer = await preprocessImageForOCR(buffer);
        
        // Wrap OCR i en Promise med timeout
        const ocrPromise = Tesseract.recognize(processedBuffer, "nor+eng", {
            logger: (info) => {
                if (info.status === "recognizing text") {
                    logger.debug({ progress: info.progress }, "OCR progress");
                }
            },
        });

        let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
        const timeoutPromise = new Promise<never>((_, reject) => {
            timeoutHandle = setTimeout(() => {
                reject(new Error(`OCR timed out after ${OCR_TIMEOUT_MS / 1000} seconds`));
            }, OCR_TIMEOUT_MS);
        });

        const result = await Promise.race([ocrPromise, timeoutPromise]);
        if (timeoutHandle) {
            clearTimeout(timeoutHandle);
            timeoutHandle = undefined;
        }

        const text = result.data.text;
        const confidence = result.data.confidence;

        logger.info(
            { textLength: text.length, confidence },
            "OCR completed"
        );

        return { text, confidence };
    } catch (error) {
        logger.error({ err: error }, "OCR failed");
        throw error;
    }
}

/**
 * Parser et bilde med OCR
 */
async function parseImageDocument(buffer: Buffer): Promise<DocumentParseResult> {
    try {
        const { text, confidence } = await ocrLimit(() => performOCR(buffer));

        if (!text || text.trim().length === 0) {
            logger.warn("Bildet inneholder ingen lesbar tekst");
            return {
                success: false,
                text: "",
                pages: 1,
                fileType: "image",
                redacted: false,
                truncated: false,
                error: "Kunne ikke finne tekst i bildet. Dette kan skyldes: stilisert/dekorativ tekst, tekst over komplekse bakgrunner, eller lav bildekvalitet. Prøv et bilde med tydelig, vanlig tekst på enkel bakgrunn.",
            };
        }

        // Lav OCR-konfidens kan bety dårlig bildekvalitet eller stilisert tekst
        let warning: string | undefined;
        if (confidence < 30) {
            logger.warn({ confidence }, "Low OCR confidence");
            warning = `OBS: Lav tekstgjenkjenning (${Math.round(confidence)}% sikkerhet). Resultatet kan inneholde feil. Stiliserte fonter, tekst på bilder/bakgrunner, eller lav kvalitet kan påvirke nøyaktigheten.`;
        } else if (confidence < 60) {
            warning = `Merk: Moderat tekstgjenkjenning (${Math.round(confidence)}% sikkerhet). Noe tekst kan være feil gjenkjent.`;
        }

        // Saniterer tekst
        const { cleanText, redacted } = sanitizeText(text);

        // Begrens størrelse
        const truncated = cleanText.length > 50000;
        const limitedText = truncated
            ? cleanText.slice(0, 50000) +
              "\n\n[... Teksten fortsetter, men er forkortet for analyse ...]"
            : cleanText;

        logger.info(
            {
                textLength: limitedText.length,
                confidence,
                wasTruncated: truncated,
                redacted,
                hasWarning: !!warning,
            },
            "Image parsed successfully with OCR"
        );

        return {
            success: true,
            text: limitedText,
            pages: 1,
            fileType: "image",
            redacted,
            truncated,
            warning, // Inkluder advarsel om lav konfidens
        };
    } catch (error) {
        logger.error({ err: error }, "Image OCR parsing failed");
        return {
            success: false,
            text: "",
            pages: 0,
            fileType: "image",
            redacted: false,
            truncated: false,
            error: "Kunne ikke lese tekst fra bildet. Sørg for at det er et gyldig bilde med lesbar tekst.",
        };
    }
}

/**
 * Rasteriserer PDF-sider til bilder og kjører OCR på dem.
 * Bruker unpdf sin renderPageAsImage for å konvertere sider til PNG,
 * deretter Tesseract for tekstgjenkjenning.
 */
async function ocrPdfPages(pdfSource: Buffer, numPages: number, opts?: { maxPages?: number }): Promise<{ text: string; avgConfidence: number; pagesProcessed: number }> {
    const pageLimit = opts?.maxPages ?? MAX_OCR_PAGES;
    const pagesToProcess = Math.min(numPages, pageLimit);
    logger.info({ totalPages: numPages, pagesToProcess }, "Starting PDF page rasterization for OCR");

    const pageTexts: string[] = [];
    let totalConfidence = 0;
    let successfulPages = 0;

    // VIKTIG: renderPageAsImage/pdf.js kan detache den underliggende ArrayBuffer-en.
    // Hvis vi gjenbruker samme Uint8Array for flere sider, kan side 2+ feile med
    // DataCloneError i Node 20. Derfor lager vi en fersk bytekopi per side.

    for (let page = 1; page <= pagesToProcess; page++) {
        try {
            const pdfDataForPage = Uint8Array.from(pdfSource);

            // Rasteriser PDF-side til PNG-bilde (scale 2.0 for bedre OCR-kvalitet)
            // canvasImport er påkrevd i Node.js — unpdf auto-detecter IKKE @napi-rs/canvas
            const imageBuffer = await renderPageAsImage(pdfDataForPage, page, {
                scale: 2.0,
                canvasImport: () => import("@napi-rs/canvas"),
            });

            // Konverter ArrayBuffer til Buffer for Tesseract
            const imgBuffer = Buffer.from(imageBuffer);

            logger.info({ page, imageSize: imgBuffer.length }, "PDF page rasterized, running OCR");

            // Kjør OCR på det rasteriserte bildet (gjennom global semafor)
            const { text, confidence } = await ocrLimit(() => performOCR(imgBuffer));

            if (text && text.trim().length > 0) {
                pageTexts.push(`--- Side ${page} ---\n${text.trim()}`);
                totalConfidence += confidence;
                successfulPages++;
            } else {
                logger.warn({ page }, "OCR returned empty text for PDF page");
            }
        } catch (pageError) {
            logger.warn({ page, err: pageError }, "Failed to OCR PDF page, skipping");
        }
    }

    const avgConfidence = successfulPages > 0 ? totalConfidence / successfulPages : 0;

    logger.info({
        pagesAttempted: pagesToProcess,
        pagesProcessed: successfulPages,
        pagesWithText: successfulPages,
        avgConfidence,
        skippedPages: numPages > MAX_OCR_PAGES ? numPages - MAX_OCR_PAGES : 0,
    }, "PDF OCR completed");

    let fullText = pageTexts.join("\n\n");
    if (numPages > MAX_OCR_PAGES) {
        fullText += `\n\n[... OCR utført på ${pagesToProcess} av ${numPages} sider. Resterende sider er hoppet over ...]`;
    }

    return { text: fullText, avgConfidence, pagesProcessed: successfulPages };
}

/**
 * Parser en PDF-fil med unpdf
 */
async function parsePdfDocument(buffer: Buffer, options?: ParseDocumentOptions): Promise<DocumentParseResult> {
    try {
        logger.info({ bufferLength: buffer.length }, "Starting PDF extraction");

        // pdf-parse er mer robust for ren tekstekstraksjon og unngår kjente
        // unhandled-rejection-problemer vi har observert i unpdf/pdf.js-løpet.
        const parser = new PDFParse({ data: buffer });
        let text: string;
        let numPages: number;
        try {
            const parsed = await parser.getText();
            text = typeof parsed.text === "string" ? parsed.text : "";
            numPages = Number.isFinite(parsed.total) && parsed.total > 0
                ? parsed.total
                : 1;
        } finally {
            await parser.destroy().catch((destroyError) => {
                logger.debug({ err: destroyError }, "PDF parser destroy feilet (ignoreres)");
            });
        }

        logger.info(
            {
                totalPages: numPages,
                extractedTextLength: text.length,
            },
            "PDF extraction completed",
        );

        // Sjekk om teksten inneholder ekte lesbart innhold.
        // Mange skannede PDF-er har usynlige tekstlag med whitespace, kontrollkarakterer
        // eller uleselige tegn som passerer en enkel lengdesjekk.
        const hasRealText = typeof text === "string"
            && text.trim().length > 0
            && /[a-zA-ZæøåÆØÅ0-9]{3,}/.test(text);

        logger.info({
            extractedTextLength: typeof text === "string" ? text.length : 0,
            trimmedLength: typeof text === "string" ? text.trim().length : 0,
            hasRealText,
            sample: typeof text === "string" ? text.slice(0, 120) : "(not a string)",
        }, "PDF text extraction quality check");

        // Valider at vi faktisk fikk ekte tekst - hvis ikke, rasteriser sider og kjør OCR
        if (!hasRealText) {
            // I sync-modus: hopp over OCR for store filer for å spare minne
            if (options?.syncMode && buffer.length > MAX_OCR_FILE_SIZE_SYNC) {
                logger.info(
                    { bufferSize: buffer.length, threshold: MAX_OCR_FILE_SIZE_SYNC },
                    "Hopper over OCR for stor PDF under sync (minnegrense)",
                );
                return {
                    success: false,
                    text: "",
                    pages: numPages,
                    fileType: "pdf",
                    redacted: false,
                    truncated: false,
                    error: "PDF-filen inneholder ingen lesbar tekst og er for stor for OCR under synkronisering.",
                };
            }

            logger.warn("PDF inneholder ingen lesbar tekst via standard ekstraksjon, rasteriserer sider for OCR");

            // Rasteriser PDF-sider til bilder og kjør OCR per side
            try {
                const maxPages = options?.syncMode ? MAX_OCR_PAGES_SYNC : MAX_OCR_PAGES;
                const ocrResult = await ocrPdfPages(buffer, numPages, { maxPages });
                logger.info({
                    ocrTextLength: ocrResult.text.length,
                    ocrTrimmedLength: ocrResult.text.trim().length,
                    avgConfidence: ocrResult.avgConfidence,
                    pagesProcessed: ocrResult.pagesProcessed,
                    sample: ocrResult.text.slice(0, 120),
                }, "PDF OCR fallback result");

                if (ocrResult.text && ocrResult.text.trim().length > 0) {
                    logger.info({
                        avgConfidence: ocrResult.avgConfidence,
                        pagesProcessed: ocrResult.pagesProcessed,
                    }, "PDF OCR fallback successful");
                    
                    const { cleanText, redacted } = sanitizeText(ocrResult.text);
                    const truncated = cleanText.length > 50000;
                    const limitedText = truncated
                        ? cleanText.slice(0, 50000) +
                          "\n\n[... Dokumentet fortsetter, men er forkortet for analyse ...]"
                        : cleanText;

                    return {
                        success: true,
                        text: limitedText,
                        pages: numPages,
                        fileType: "pdf",
                        redacted,
                        truncated,
                    };
                }
                logger.warn("OCR returned empty text despite processing pages");
            } catch (ocrError) {
                logger.error({
                    err: ocrError,
                    message: ocrError instanceof Error ? ocrError.message : String(ocrError),
                    stack: ocrError instanceof Error ? ocrError.stack : undefined,
                }, "PDF OCR fallback failed with exception");
            }
            
            return {
                success: false,
                text: "",
                pages: numPages,
                fileType: "pdf",
                redacted: false,
                truncated: false,
                error: "PDF-filen inneholder ingen lesbar tekst. Verken tekstekstraksjon eller OCR klarte å lese innholdet.",
            };
        }

        // Saniterer tekst
        const { cleanText, redacted } = sanitizeText(text);

        // Begrens størrelse (max ~50k tegn)
        const truncated = cleanText.length > 50000;
        const limitedText = truncated
            ? cleanText.slice(0, 50000) +
              "\n\n[... Dokumentet fortsetter, men er forkortet for analyse ...]"
            : cleanText;

        logger.info(
            {
                pages: numPages,
                textLength: limitedText.length,
                wasTruncated: truncated,
                redacted,
            },
            "PDF parsed successfully with unpdf"
        );

        return {
            success: true,
            text: limitedText,
            pages: numPages,
            fileType: "pdf",
            redacted,
            truncated,
        };
    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        const errorStack = error instanceof Error ? error.stack : undefined;
        logger.error({ err: error, errorMessage, errorStack }, "PDF parsing failed with unpdf");

        if (errorMessage.includes("password") || errorMessage.includes("encrypted")) {
            return {
                success: false,
                text: "",
                pages: 0,
                fileType: "pdf",
                redacted: false,
                truncated: false,
                error: "PDF-filen er passordbeskyttet eller kryptert.",
            };
        }

        if (errorMessage.includes("Invalid") || errorMessage.includes("corrupt")) {
            return {
                success: false,
                text: "",
                pages: 0,
                fileType: "pdf",
                redacted: false,
                truncated: false,
                error: "Ugyldig PDF-fil. Filen kan være korrupt.",
            };
        }

        return {
            success: false,
            text: "",
            pages: 0,
            fileType: "pdf",
            redacted: false,
            truncated: false,
            error: `Kunne ikke lese PDF-filen: ${errorMessage}`,
        };
    }
}

/**
 * Ekstraherer innebygde bilder fra et Word-dokument (.docx) via mammoth.
 * Returnerer en liste med Buffer-er, én per bilde.
 */
async function extractImagesFromDocx(buffer: Buffer): Promise<Buffer[]> {
    const images: Buffer[] = [];

    await mammoth.convertToHtml(
        { buffer },
        {
            convertImage: mammoth.images.inline((element) => {
                return element.read("base64").then((base64Data) => {
                    images.push(Buffer.from(base64Data, "base64"));
                    // Returnerer et dummy src — vi bryr oss ikke om HTML-output
                    return { src: "data:image/png;base64," };
                });
            }),
        },
    );

    return images;
}

/**
 * Kjører OCR på en liste med bildeBuffere og returnerer kombinert tekst.
 */
async function ocrImageBuffers(
    images: Buffer[],
    maxImages: number = MAX_OCR_PAGES,
): Promise<{ text: string; avgConfidence: number; imagesProcessed: number }> {
    const imagesToProcess = Math.min(images.length, maxImages);
    logger.info({ totalImages: images.length, imagesToProcess }, "Starting OCR on extracted images");

    const texts: string[] = [];
    let totalConfidence = 0;
    let successfulImages = 0;

    for (let i = 0; i < imagesToProcess; i++) {
        try {
            const { text, confidence } = await ocrLimit(() => performOCR(images[i]));

            if (text && text.trim().length > 0) {
                texts.push(`--- Bilde ${i + 1} ---\n${text.trim()}`);
                totalConfidence += confidence;
                successfulImages++;
            } else {
                logger.warn({ image: i + 1 }, "OCR returned empty text for image");
            }
        } catch (err) {
            logger.warn({ image: i + 1, err }, "Failed to OCR image, skipping");
        }
    }

    const avgConfidence = successfulImages > 0 ? totalConfidence / successfulImages : 0;
    return { text: texts.join("\n\n"), avgConfidence, imagesProcessed: successfulImages };
}

/**
 * Parser Word-dokumenter (docx/doc) med mammoth.
 * Hvis dokumentet inneholder lite/ingen tekst men har bilder,
 * kjøres OCR på bildene for å fange bildebasert innhold.
 */
async function parseWordDocument(buffer: Buffer): Promise<DocumentParseResult> {
    try {
        const result = await mammoth.extractRawText({ buffer });
        const text = result.value;

        const hasRealTextContent = typeof text === "string"
            && text.trim().length > 0
            && /[a-zA-ZæøåÆØÅ0-9]{3,}/.test(text);

        logger.info({
            extractedTextLength: text?.length ?? 0,
            hasRealText: hasRealTextContent,
        }, "Word text extraction result");

        // Hvis teksten er mangelfull, forsøk å ekstrahere og OCR-e bilder
        if (!hasRealTextContent) {
            logger.info("Word-dokument mangler lesbar tekst, forsøker bilde-OCR");

            try {
                const images = await extractImagesFromDocx(buffer);
                logger.info({ imageCount: images.length }, "Images extracted from Word document");

                if (images.length > 0) {
                    const ocrResult = await ocrImageBuffers(images);

                    logger.info({
                        ocrTextLength: ocrResult.text.length,
                        avgConfidence: ocrResult.avgConfidence,
                        imagesProcessed: ocrResult.imagesProcessed,
                    }, "Word image OCR result");

                    if (ocrResult.text && ocrResult.text.trim().length > 0) {
                        const { cleanText, redacted } = sanitizeText(ocrResult.text);
                        const truncated = cleanText.length > 50000;
                        const limitedText = truncated
                            ? cleanText.slice(0, 50000) +
                              "\n\n[... Dokumentet fortsetter, men er forkortet for analyse ...]"
                            : cleanText;
                        const estimatedPages = Math.ceil(limitedText.length / 3000);

                        return {
                            success: true,
                            text: limitedText,
                            pages: estimatedPages,
                            fileType: "docx",
                            redacted,
                            truncated,
                            warning: ocrResult.avgConfidence < 70
                                ? "Lav OCR-konfidens. Teksten kan inneholde feil."
                                : undefined,
                        };
                    }
                }
            } catch (ocrError) {
                logger.warn({ err: ocrError }, "Word image OCR fallback failed");
            }

            return {
                success: false,
                text: "",
                pages: 1,
                fileType: "docx",
                redacted: false,
                truncated: false,
                error: "Word-dokumentet inneholder ingen lesbar tekst.",
            };
        }

        // Saniterer tekst
        const { cleanText, redacted } = sanitizeText(text);

        // Begrens størrelse
        const truncated = cleanText.length > 50000;
        const limitedText = truncated
            ? cleanText.slice(0, 50000) +
              "\n\n[... Dokumentet fortsetter, men er forkortet for analyse ...]"
            : cleanText;

        // Word-dokumenter har ikke sideantall på samme måte
        const estimatedPages = Math.ceil(limitedText.length / 3000);

        // Sjekk om dokumentet også har bilder som bør OCR-es
        // (f.eks. tekst + bilder med viktig innhold)
        let imageOcrText = "";
        try {
            const images = await extractImagesFromDocx(buffer);
            if (images.length > 0) {
                logger.info({ imageCount: images.length }, "Word document has embedded images, running OCR");
                const ocrResult = await ocrImageBuffers(images);
                if (ocrResult.text && ocrResult.text.trim().length > 0 && ocrResult.avgConfidence >= 50) {
                    imageOcrText = "\n\n--- Tekst fra innebygde bilder ---\n" + ocrResult.text.trim();
                }
            }
        } catch (imgErr) {
            logger.warn({ err: imgErr }, "Failed to extract/OCR images from Word document");
        }

        const combinedText = limitedText + imageOcrText;
        const finalTruncated = combinedText.length > 50000;
        const finalText = finalTruncated
            ? combinedText.slice(0, 50000) +
              "\n\n[... Dokumentet fortsetter, men er forkortet for analyse ...]"
            : combinedText;

        logger.info(
            {
                estimatedPages,
                textLength: finalText.length,
                wasTruncated: finalTruncated,
                redacted,
                warnings: result.messages.length,
                hasImageOcr: imageOcrText.length > 0,
            },
            "Word document parsed successfully"
        );

        return {
            success: true,
            text: finalText,
            pages: estimatedPages,
            fileType: "docx",
            redacted,
            truncated: finalTruncated,
        };
    } catch (error) {
        logger.error({ err: error }, "Word document parsing failed");
        return {
            success: false,
            text: "",
            pages: 0,
            fileType: "docx",
            redacted: false,
            truncated: false,
            error: "Kunne ikke lese Word-dokumentet. Sørg for at det er en gyldig fil.",
        };
    }
}

/**
 * Parser tekstfiler (txt, md, csv)
 */
async function parseTextDocument(
    buffer: Buffer,
    fileType: string
): Promise<DocumentParseResult> {
    try {
        const text = buffer.toString("utf-8");

        if (!text || text.trim().length === 0) {
            return {
                success: false,
                text: "",
                pages: 1,
                fileType,
                redacted: false,
                truncated: false,
                error: "Filen inneholder ingen tekst.",
            };
        }

        // Saniterer tekst
        const { cleanText, redacted } = sanitizeText(text);

        // Begrens størrelse
        const truncated = cleanText.length > 50000;
        const limitedText = truncated
            ? cleanText.slice(0, 50000) +
              "\n\n[... Dokumentet fortsetter, men er forkortet for analyse ...]"
            : cleanText;

        const estimatedPages = Math.ceil(limitedText.length / 3000);

        logger.info(
            {
                estimatedPages,
                textLength: limitedText.length,
                fileType,
                wasTruncated: truncated,
                redacted,
            },
            "Text document parsed successfully"
        );

        return {
            success: true,
            text: limitedText,
            pages: estimatedPages,
            fileType,
            redacted,
            truncated,
        };
    } catch (error) {
        logger.error({ err: error }, "Text document parsing failed");
        return {
            success: false,
            text: "",
            pages: 0,
            fileType,
            redacted: false,
            truncated: false,
            error: "Kunne ikke lese tekstfilen.",
        };
    }
}

/**
 * Hovedfunksjon for å parse dokumenter
 * Velger riktig parser basert på MIME-type
 */
/** Normaliserer filnavn til trygg basename (ingen path traversal i logging/extension) */
function safeBasename(filename: string | undefined): string {
    if (!filename || typeof filename !== "string") return "";
    const normalized = filename.replace(/\\/g, "/");
    const last = normalized.split("/").pop() ?? "";
    return last.includes("..") ? "" : last.slice(0, 255);
}

export interface ParseDocumentOptions {
  /** Sync-modus: strengere minnegrenser (færre OCR-sider, hopper over OCR for store filer) */
  syncMode?: boolean;
}

export async function parseDocument(
    buffer: Buffer,
    mimeType: string,
    filename?: string,
    options?: ParseDocumentOptions,
): Promise<DocumentParseResult> {
  // Kjør intern parsing og valider resultatet mot skjemaet
  const result = await parseDocumentInternal(buffer, mimeType, filename, options);
  return DocumentParseResultSchema.parse(result);
}

/** Intern parsing-logikk — kalles av parseDocument() som validerer resultatet */
async function parseDocumentInternal(
    buffer: Buffer,
    mimeType: string,
    filename?: string,
    options?: ParseDocumentOptions,
): Promise<DocumentParseResult> {
  const safeName = safeBasename(filename);
  // Sjekk filstørrelse først
  if (buffer.length > MAX_FILE_SIZE_BYTES) {
    const sizeMB = (buffer.length / (1024 * 1024)).toFixed(1);
    const maxMB = (MAX_FILE_SIZE_BYTES / (1024 * 1024)).toFixed(0);
    logger.warn(
      { fileSize: buffer.length, maxSize: MAX_FILE_SIZE_BYTES },
      "File too large for parsing",
    );
    return {
      success: false,
      text: "",
      pages: 0,
      fileType: "unknown",
      redacted: false,
      truncated: false,
      error: `Filen er for stor (${sizeMB}MB). Maksimal filstørrelse er ${maxMB}MB.`,
    };
  }

  // Valider at filinnhold matcher deklarert MIME (mot MIME-spoofing; multer fileFilter kan ikke sjekke buffer i memory storage)
  const magicError = validateFileMagicBytes(buffer, mimeType);
  if (magicError) {
    logger.warn(
      { mimeType, filename: safeName || undefined },
      "File magic bytes mismatch",
    );
    return {
      success: false,
      text: "",
      pages: 0,
      fileType: "unknown",
      redacted: false,
      truncated: false,
      error: magicError,
    };
  }

  // Sjekk at MIME-type er støttet
  let fileType = SUPPORTED_DOCUMENT_TYPES[mimeType];

  // Fallback til filendelse hvis MIME-type ikke er støttet (bruk safe basename)
  if (!fileType && safeName) {
    const ext = safeName.toLowerCase().match(/\.[^.]+$/)?.[0];
    if (ext && EXTENSION_TO_MIME[ext]) {
      const detectedMime = EXTENSION_TO_MIME[ext];
      fileType = SUPPORTED_DOCUMENT_TYPES[detectedMime];
      logger.info(
        { detectedMime, fileType },
        "Detected file type from extension",
      );
    }
  }

  if (!fileType) {
    return {
      success: false,
      text: "",
      pages: 0,
      fileType: "unknown",
      redacted: false,
      truncated: false,
      error: "Filtypen støttes ikke. Last opp PDF, kode- eller Office-filer.",
    };
  }

  logger.info({ mimeType, fileType }, "Parsing document");

  // ZIP-baserte Office-formater: sjekk total ukomprimert størrelse for å beskytte mot zip-bomber.
  // En 14MB komprimert fil med 100:1 ratio ville blitt ~1.4GB i minne.
  if (fileType === "docx" || fileType === "pptx" || fileType === "xlsx") {
    const totalUncompressed = estimateZipDecompressedSize(buffer);
    if (totalUncompressed !== null) {
      const ratio = buffer.length > 0 ? totalUncompressed / buffer.length : 0;
      if (ratio > MAX_ZIP_DECOMPRESSION_RATIO) {
        const compressedMB = (buffer.length / (1024 * 1024)).toFixed(1);
        const uncompressedMB = (totalUncompressed / (1024 * 1024)).toFixed(0);
        logger.warn(
          { compressedMB, uncompressedMB, ratio: ratio.toFixed(0), fileType },
          "Potensiell zip-bombe avvist: dekompresjonsforhold for høyt",
        );
        return {
          success: false,
          text: "",
          pages: 0,
          fileType,
          redacted: false,
          truncated: false,
          error: `Filen ser ut til å ha et mistenkelig høyt dekompresjonsforhold (${compressedMB}MB → ${uncompressedMB}MB). Opplastingen ble avvist av sikkerhetsgrunner.`,
        };
      }
    }
  }

  // Velg riktig parser basert på filtype
  switch (fileType) {
    case "pdf":
      return parsePdfDocument(buffer, options);

    case "docx":
    case "doc":
      return parseWordDocument(buffer);

    case "pptx":
    case "xlsx":
    case "code": {
      const result = await extractTextFromFile(buffer, safeName || `file.${fileType}`);
      if (!result) {
        return {
          success: false,
          text: "",
          pages: 0,
          fileType,
          redacted: false,
          truncated: false,
          error: "Kunne ikke lese innholdet i filen.",
        };
      }
      const lang = getCodeLanguage(safeName || "");
      const { cleanText, redacted } = sanitizeText(result.content);
      const estimatedPages = Math.ceil(cleanText.length / 3000);
      return {
        success: true,
        text: cleanText,
        pages: estimatedPages,
        fileType: lang ? `code:${result.fileExtension}` : fileType,
        redacted,
        truncated: result.truncated,
      };
    }

    case "txt":
    case "md":
    case "csv":
    case "rtf":
      return parseTextDocument(buffer, fileType);

    case "image":
      return parseImageDocument(buffer);

    default:
      return {
        success: false,
        text: "",
        pages: 0,
        fileType,
        redacted: false,
        truncated: false,
        error: "Filtypen støttes ikke. Last opp PDF, kode- eller Office-filer.",
      };
  }
}

/**
 * Formaterer dokument-innhold for KI-kontekst
 */
export function formatDocumentContext(
    text: string,
    pages: number,
    fileType: string,
    opts?: { redacted?: boolean; truncated?: boolean }
): string {
    const fileTypeNames: Record<string, string> = {
        pdf: "PDF-dokument",
        docx: "Word-dokument",
        doc: "Word-dokument",
        pptx: "PowerPoint-presentasjon",
        xlsx: "Excel-regneark",
        txt: "Tekstfil",
        md: "Markdown-fil",
        csv: "CSV-fil",
        rtf: "RTF-fil",
        code: "Kodefil",
        image: "Bilde (OCR)",
    };

    const infoLines: string[] = [];
    if (opts?.redacted) infoLines.push("[Personopplysninger er maskert]");
    if (opts?.truncated) infoLines.push("[Dokumentet er forkortet for analyse]");
    const info = infoLines.length ? `\n${infoLines.join(" ")}` : "";

    // Kodefiler med språk-info (code:.ext) → fenced code block
    if (fileType.startsWith("code:")) {
        const ext = fileType.slice(5);
        const langNames: Record<string, string> = {
            ".java": "Java", ".js": "JavaScript", ".ts": "TypeScript",
            ".jsx": "JSX", ".tsx": "TSX", ".py": "Python",
            ".html": "HTML", ".css": "CSS", ".scss": "SCSS",
            ".sql": "SQL", ".cpp": "C++", ".c": "C", ".h": "C/C++ Header",
            ".cs": "C#", ".go": "Go", ".rs": "Rust", ".php": "PHP",
            ".rb": "Ruby", ".swift": "Swift", ".kt": "Kotlin",
            ".xml": "XML", ".json": "JSON", ".yaml": "YAML", ".yml": "YAML",
            ".sh": "Shell", ".bash": "Bash", ".ps1": "PowerShell",
            ".r": "R", ".m": "MATLAB/Obj-C", ".dart": "Dart",
        };
        const langName = langNames[ext] ?? "Kode";
        return `
${langName.toUpperCase()}-FIL LASTET OPP AV STUDENT:

\`\`\`${ext.slice(1)}
${text}
\`\`\`

--- SLUTT PÅ FIL ---

Bruk denne kodefilen til å svare på studentens spørsmål.${info}
`.trim();
    }

    const typeName = fileTypeNames[fileType] || "Dokument";

    return `
${typeName.toUpperCase()} LASTET OPP AV STUDENT (${pages} sider):

${text}

--- SLUTT PÅ DOKUMENT ---

Bruk dette dokumentet til å svare på studentens spørsmål.${info}
`.trim();
}

/**
 * Henter MIME-typer for multer accept
 */
export function getSupportedMimeTypes(): string[] {
    return Object.keys(SUPPORTED_DOCUMENT_TYPES);
}
