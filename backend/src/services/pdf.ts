/**
 * PDF parsing service
 * Konverterer PDF-filer til ren tekst for KI-analyse
 */

import { PDFParse } from 'pdf-parse';
import { logger } from '../utils/logger.js';

interface PdfParseResult {
    success: boolean;
    text: string;
    pages: number;
    error?: string;
}

/**
 * Parser en PDF-fil og returnerer tekstinnhold
 * @param buffer - PDF-fil som Buffer
 * @returns Tekstinnhold, antall sider og success status
 */
export async function parsePdf(buffer: Buffer): Promise<PdfParseResult> {
    try {
        const parser = new PDFParse({ data: buffer });
        const textResult = await parser.getText();
        
        // Valider at vi faktisk fikk tekst
        if (!textResult.text || textResult.text.trim().length === 0) {
            logger.warn("PDF inneholder ingen lesbar tekst");
            return {
                success: false,
                text: "",
                pages: 0,
                error: "PDF-filen inneholder ingen lesbar tekst. Den kan være basert på bilder."
            };
        }

        // Sanitize tekst: fjern null bytes og kontrollkarakterer
        let cleanText = textResult.text
            .replace(/\0/g, ''); // Null bytes
        
        // Fjern kontrollkarakterer (ASCII 0-31 og 127) uten regex
        cleanText = cleanText.split('').filter(char => {
            const code = char.charCodeAt(0);
            // Behold normale tegn, tab (9), newline (10), carriage return (13)
            return code >= 32 || code === 9 || code === 10 || code === 13;
        }).join('').trim();

        // Begrens størrelse (max ~50k tegn for å ikke overbelaste AI)
        const limitedText = cleanText.length > 50000 
            ? cleanText.slice(0, 50000) + "\n\n[... Dokumentet fortsetter, men er forkortet for analyse ...]"
            : cleanText;

        const numPages = textResult.pages?.length || 0;

        logger.info({ 
            pages: numPages, 
            textLength: limitedText.length,
            wasTruncated: cleanText.length > 50000
        }, "PDF parsed successfully");

        return {
            success: true,
            text: limitedText,
            pages: numPages,
        };

    } catch (error) {
        logger.error({ err: error }, "PDF parsing failed");
        
        // Spesifikke feilmeldinger
        const errorMessage = error instanceof Error ? error.message : String(error);
        
        if (errorMessage.includes('password') || errorMessage.includes('encrypted')) {
            return {
                success: false,
                text: "",
                pages: 0,
                error: "PDF-filen er passordbeskyttet eller kryptert."
            };
        }
        
        if (errorMessage.includes('Invalid PDF')) {
            return {
                success: false,
                text: "",
                pages: 0,
                error: "Ugyldig PDF-fil. Filen kan være korrupt."
            };
        }

        return {
            success: false,
            text: "",
            pages: 0,
            error: "Kunne ikke lese PDF-filen. Sørg for at den er en gyldig PDF."
        };
    }
}

/**
 * Formaterer PDF-innhold for KI-kontekst
 * @param text - Tekstinnhold fra PDF
 * @param pages - Antall sider
 * @returns Formatert kontekst-string
 */
export function formatPdfContext(text: string, pages: number): string {
    return `
DOKUMENT LASTET OPP AV STUDENT (${pages} sider):

${text}

--- SLUTT PÅ DOKUMENT ---

Bruk dette dokumentet til å svare på studentens spørsmål.
`.trim();
}
