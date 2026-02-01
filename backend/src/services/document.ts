/**
 * Document parsing service
 * Konverterer dokumenter (PDF, Word, TXT, bilder) til ren tekst for KI-analyse
 * Bruker unpdf for PDF, mammoth for Word, og tesseract.js for OCR på bilder
 */

import { extractText } from "unpdf";
import mammoth from "mammoth";
import Tesseract from "tesseract.js";
import { logger } from "../utils/logger.js";
import { DocumentParseResult } from "common/document";

// Støttede MIME-typer og deres filtype
export const SUPPORTED_DOCUMENT_TYPES: Record<string, string> = {
    "application/pdf": "pdf",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
    "application/msword": "doc",
    "text/plain": "txt",
    "text/markdown": "md",
    "text/csv": "csv",
    "application/rtf": "rtf",
    // Bildestøtte for OCR
    "image/png": "image",
    "image/jpeg": "image",
    "image/jpg": "image",
    "image/webp": "image",
    "image/gif": "image",
    "image/bmp": "image",
    "image/tiff": "image",
};

// Filendelser til MIME-type mapping (fallback)
export const EXTENSION_TO_MIME: Record<string, string> = {
    ".pdf": "application/pdf",
    ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ".doc": "application/msword",
    ".txt": "text/plain",
    ".md": "text/markdown",
    ".csv": "text/csv",
    ".rtf": "application/rtf",
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
 * Saniterer og renser tekst fra dokumenter
 */
function sanitizeText(text: string): { cleanText: string; redacted: boolean } {
    let cleanText = text;
    let redacted = false;

    // Fjern null bytes
    cleanText = cleanText.replace(/\0/g, "");

    // Masker enkel PII (epost og telefon)
    const emailRegex = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
    const phoneRegex = /\b(?:\+?\d[\d\s-]{6,14}\d)\b/g;

    cleanText = cleanText.replace(emailRegex, () => {
        redacted = true;
        return "[REDACTED_EMAIL]";
    });

    cleanText = cleanText.replace(phoneRegex, () => {
        redacted = true;
        return "[REDACTED_PHONE]";
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
 * Utfører OCR på et bilde med tesseract.js
 * Støtter norsk og engelsk tekst
 */
async function performOCR(buffer: Buffer): Promise<{ text: string; confidence: number }> {
    try {
        logger.info({ bufferLength: buffer.length }, "Starting OCR processing");
        
        // Tesseract kan ta Buffer direkte
        const result = await Tesseract.recognize(
            buffer,
            "nor+eng", // Norsk og engelsk
            {
                logger: (info: { status?: string; progress?: number }) => {
                    if (info.status === "recognizing text") {
                        logger.debug({ progress: info.progress }, "OCR progress");
                    }
                },
            }
        );

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
        const { text, confidence } = await performOCR(buffer);

        if (!text || text.trim().length === 0) {
            logger.warn("Bildet inneholder ingen lesbar tekst");
            return {
                success: false,
                text: "",
                pages: 1,
                fileType: "image",
                redacted: false,
                truncated: false,
                error: "Kunne ikke finne tekst i bildet. Sjekk at bildet inneholder lesbar tekst.",
            };
        }

        // Lav OCR-konfidens kan bety dårlig bildekvalitet
        if (confidence < 30) {
            logger.warn({ confidence }, "Low OCR confidence");
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
 * Parser en PDF-fil med unpdf
 */
async function parsePdfDocument(buffer: Buffer): Promise<DocumentParseResult> {
    try {
        // unpdf kan ta Buffer direkte, men vi konverterer til Uint8Array for å være sikre
        // Buffer.from sørger for at vi har en ren kopi av dataene
        const pdfData = new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength);
        
        logger.info({ bufferLength: buffer.length, pdfDataLength: pdfData.length }, "Starting PDF extraction");
        
        // Ekstraher tekst direkte - unpdf håndterer dette internt
        const result = await extractText(pdfData, { mergePages: true });
        
        logger.info({ resultKeys: Object.keys(result), totalPages: result.totalPages }, "PDF extraction completed");
        
        const text = result.text;
        const numPages = result.totalPages || 1;

        // Valider at vi faktisk fikk tekst - hvis ikke, prøv OCR
        if (!text || text.trim().length === 0) {
            logger.warn("PDF inneholder ingen lesbar tekst via standard ekstraksjon, prøver OCR");
            
            // Prøv OCR som fallback for bilde-baserte PDFer
            try {
                const ocrResult = await performOCR(buffer);
                if (ocrResult.text && ocrResult.text.trim().length > 0) {
                    logger.info({ confidence: ocrResult.confidence }, "OCR fallback successful for PDF");
                    
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
            } catch (ocrError) {
                logger.warn({ err: ocrError }, "OCR fallback also failed for PDF");
            }
            
            return {
                success: false,
                text: "",
                pages: numPages,
                fileType: "pdf",
                redacted: false,
                truncated: false,
                error: "PDF-filen inneholder ingen lesbar tekst. Den kan være basert på bilder som ikke kunne leses.",
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
 * Parser Word-dokumenter (docx/doc) med mammoth
 */
async function parseWordDocument(buffer: Buffer): Promise<DocumentParseResult> {
    try {
        const result = await mammoth.extractRawText({ buffer });
        const text = result.value;

        if (!text || text.trim().length === 0) {
            logger.warn("Word-dokument inneholder ingen lesbar tekst");
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

        logger.info(
            {
                estimatedPages,
                textLength: limitedText.length,
                wasTruncated: truncated,
                redacted,
                warnings: result.messages.length,
            },
            "Word document parsed successfully"
        );

        return {
            success: true,
            text: limitedText,
            pages: estimatedPages,
            fileType: "docx",
            redacted,
            truncated,
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
export async function parseDocument(
    buffer: Buffer,
    mimeType: string,
    filename?: string
): Promise<DocumentParseResult> {
    // Sjekk at MIME-type er støttet
    let fileType = SUPPORTED_DOCUMENT_TYPES[mimeType];

    // Fallback til filendelse hvis MIME-type ikke er støttet
    if (!fileType && filename) {
        const ext = filename.toLowerCase().match(/\.[^.]+$/)?.[0];
        if (ext && EXTENSION_TO_MIME[ext]) {
            const detectedMime = EXTENSION_TO_MIME[ext];
            fileType = SUPPORTED_DOCUMENT_TYPES[detectedMime];
            logger.info({ filename, detectedMime, fileType }, "Detected file type from extension");
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
            error: `Filtypen "${mimeType}" er ikke støttet. Støttede typer: PDF, Word (docx/doc), TXT, Markdown, CSV, og bilder (PNG, JPG, WEBP).`,
        };
    }

    logger.info({ mimeType, fileType, filename }, "Parsing document");

    // Velg riktig parser basert på filtype
    switch (fileType) {
        case "pdf":
            return parsePdfDocument(buffer);

        case "docx":
        case "doc":
            return parseWordDocument(buffer);

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
                error: `Parser for filtype "${fileType}" er ikke implementert.`,
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
        txt: "Tekstfil",
        md: "Markdown-fil",
        csv: "CSV-fil",
        rtf: "RTF-fil",
        image: "Bilde (OCR)",
    };

    const typeName = fileTypeNames[fileType] || "Dokument";
    const infoLines: string[] = [];
    if (opts?.redacted) infoLines.push("[Personopplysninger er maskert]");
    if (opts?.truncated) infoLines.push("[Dokumentet er forkortet for analyse]");
    const info = infoLines.length ? `\n${infoLines.join(" ")}` : "";

    return `
${typeName.toUpperCase()} LASTET OPP AV STUDENT (${pages} sider):

${text}

--- SLUTT PÅ DOKUMENT ---

Bruk dette dokumentet til å svare på studentens spørsmål.${info}
`.trim();
}

/**
 * Henter liste over støttede filtyper for frontend
 */
export function getSupportedFileTypes(): string[] {
    return Object.keys(EXTENSION_TO_MIME).map((ext) => ext.slice(1)); // Fjern punktum
}

/**
 * Henter MIME-typer for multer accept
 */
export function getSupportedMimeTypes(): string[] {
    return Object.keys(SUPPORTED_DOCUMENT_TYPES);
}
