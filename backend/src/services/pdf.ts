/**
 * PDF parsing service
 * Konverterer PDF-filer til ren tekst for KI-analyse
 */

import * as pdfParseModule from "pdf-parse";
import { logger } from "../utils/logger.js";

// pdf-parse v2 eksporterer named exports, men TS-typene er ikke oppdatert
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mod = pdfParseModule as any;
const PDFParse = mod.PDFParse as new (options: { data: Buffer }) => {
    getInfo(opts?: { parsePageInfo?: boolean }): Promise<{ total?: number }>;
    getText(): Promise<{ text?: string }>;
    destroy(): Promise<void>;
};
const PasswordException = mod.PasswordException as new () => Error;
const InvalidPDFException = mod.InvalidPDFException as new () => Error;
const FormatError = mod.FormatError as new () => Error;

interface PdfParseResult {
    success: boolean;
    text: string;
    pages: number;
    redacted: boolean;
    truncated: boolean;
    error?: string;
}

/**
 * Parser en PDF-fil og returnerer tekstinnhold
 * @param buffer - PDF-fil som Buffer
 * @returns Tekstinnhold, antall sider og success status
 */
export async function parsePdf(buffer: Buffer): Promise<PdfParseResult> {
    const parser = new PDFParse({ data: buffer });

    try {
        // Hent metadata (sideantall)
        const info = await parser.getInfo({ parsePageInfo: false });
        const numPages = info.total ?? 0;

        // Hent tekstinnhold
        const textResult = await parser.getText();

        // Valider at vi faktisk fikk tekst
        if (!textResult.text || textResult.text.trim().length === 0) {
            logger.warn("PDF inneholder ingen lesbar tekst");
            return {
                success: false,
                text: "",
                pages: numPages,
                redacted: false,
                truncated: false,
                error: "PDF-filen inneholder ingen lesbar tekst. Den kan være basert på bilder.",
            };
        }

        // Sanitize tekst: fjern null bytes
        let cleanText = textResult.text.replace(/\0/g, "");

        // Masker enkel PII (epost og telefon)
        let redacted = false;
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

        // Begrens størrelse (max ~50k tegn for å ikke overbelaste AI)
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
            "PDF parsed successfully"
        );

        return {
            success: true,
            text: limitedText,
            pages: numPages,
            redacted,
            truncated,
        };
    } catch (error) {
        logger.error({ err: error }, "PDF parsing failed");

        // Typed exceptions fra pdf-parse v2
        if (error instanceof PasswordException) {
            return {
                success: false,
                text: "",
                pages: 0,
                redacted: false,
                truncated: false,
                error: "PDF-filen er passordbeskyttet eller kryptert.",
            };
        }

        if (error instanceof InvalidPDFException) {
            return {
                success: false,
                text: "",
                pages: 0,
                redacted: false,
                truncated: false,
                error: "Ugyldig PDF-fil. Filen kan være korrupt.",
            };
        }

        if (error instanceof FormatError) {
            return {
                success: false,
                text: "",
                pages: 0,
                redacted: false,
                truncated: false,
                error: "PDF-filen har et ugyldig format.",
            };
        }

        // Fallback til string-matching for andre feil
        const errorMessage = error instanceof Error ? error.message : String(error);

        if (errorMessage.includes("password") || errorMessage.includes("encrypted")) {
            return {
                success: false,
                text: "",
                pages: 0,
                redacted: false,
                truncated: false,
                error: "PDF-filen er passordbeskyttet eller kryptert.",
            };
        }

        if (errorMessage.includes("Invalid PDF")) {
            return {
                success: false,
                text: "",
                pages: 0,
                redacted: false,
                truncated: false,
                error: "Ugyldig PDF-fil. Filen kan være korrupt.",
            };
        }

        return {
            success: false,
            text: "",
            pages: 0,
            redacted: false,
            truncated: false,
            error: "Kunne ikke lese PDF-filen. Sørg for at den er en gyldig PDF.",
        };
    } finally {
        // Frigjør interne ressurser
        await parser.destroy();
    }
}

/**
 * Formaterer PDF-innhold for KI-kontekst
 * @param text - Tekstinnhold fra PDF
 * @param pages - Antall sider
 * @returns Formatert kontekst-string
 */
export function formatPdfContext(
    text: string,
    pages: number,
    opts?: { redacted?: boolean; truncated?: boolean }
): string {
    const infoLines: string[] = [];
    if (opts?.redacted) infoLines.push("[Personopplysninger er maskert]");
    if (opts?.truncated) infoLines.push("[Dokumentet er forkortet for analyse]");
    const info = infoLines.length ? `\n${infoLines.join(" ")}` : "";

    return `
DOKUMENT LASTET OPP AV STUDENT (${pages} sider):

${text}

--- SLUTT PÅ DOKUMENT ---

Bruk dette dokumentet til å svare på studentens spørsmål.${info}
`.trim();
}
