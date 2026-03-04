/*
 * PDF og Dokumentanalyse-endepunkter
 * Håndterer analyse av dokumenter via HuggingFace AI
 */

import { Router, Request, Response } from "express";
import multer from "multer";
import { logger } from "../../utils/logger.js";
import {
    KIDocumentAnalyseResponseSchema
} from "common/ki";
import {
    parseDocument,
    formatDocumentContext,
    getSupportedMimeTypes
} from "../../services/document.js";
import { SUPPORTED_MODELS, DEFAULT_MODEL } from "./aiModels.js";
import { hfClient } from "./hfClient.js";
import { handleHFError } from "./handleHFError.js";
import { STUDYWISE_SYSTEM_PROMPT } from "./systemPrompt.js";

// Definerer express router
const router = Router();
const SUPPORTED_MIME_TYPES = getSupportedMimeTypes();
const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 15 * 1024 * 1024 }, // 15MB - matcher frontend-grensen
    fileFilter: (_req, file, cb) => {
        if (SUPPORTED_MIME_TYPES.includes(file.mimetype)) {
            cb(null, true);
        } else {
            cb(new Error(`Filtypen er ikke støttet. Støttede typer: PDF, Word (docx/doc), TXT, Markdown, CSV, og bilder (PNG, JPG, WEBP).`));
        }
    }
});

// System prompt for dokumentanalyse
const STUDYWISE_DOCUMENT_PROMPT = `
DOKUMENTANALYSE-MODUS: Du har mottatt et dokument fra studenten.

**PERSONVERNBESKYTTELSE (KRITISK):**
- ALDRI gjenta fullstendige navn, personnummer, adresser, telefonnummer eller epostadresser
- Maskér PII med [REDACTED_*]: navn → [REDACTED_NAME], SSN → [REDACTED_SSN], etc.
- Hvis dokumentet er et CV, si "Personen" eller "Kandidaten" istedenfor navn
- Vær transparent: Si hvis sensitiv info er fjernet for personvern
- ALDRI lagre eller videresend personlig info

**DIN FØRSTE OPPGAVE:** Identifisere dokumenttypen og hva det handler om
- Hva slags dokument er det? (CV, kontrakt, rapport, artikkel, etc.)
- Hva er hovedfokus/tema i dokumentet?
- Gi en konkret og spesifikk oppsummering, ikke generisk

**DERETTER kan du:**
- Lag oppsummering: Strukturert oversikt med hovedpunkter (uten PII)
- Forklar konsepter: Detaljerte forklaringer basert på dokumentet
- Lag quiz: 5-10 spørsmål med fasit basert på innholdet
- Lag læringsmål: Konkrete læringsmål fra dokumentet
- Svar på spørsmål: Kun basert på dokumentet
- Gi studietips basert på dokumentinnholdet
- Hjelp med oppgaveplanlegging basert på dokumentet

**KRITISK:**
- Gi BARE selve svaret! ALDRI kopier instruksjoner eller formateringsregler inn i svaret ditt
- Vær SPESIFIKK - ikke generisk. Hvis det er CV med fokus på IT, si det!
- Bruk KUN informasjon fra dokumentet
- **Maskér all personlig identifiserbar informasjon**

RETNINGSLINJER FOR DOKUMENTER:
- Bruk KUN informasjon fra dokumentet
- Hvis noe ikke står i dokumentet, si det tydelig
- Vær konkret og presis - ikke vag eller generisk
- Vær motiverende og støttende i tonefallet
- Gi konkrete studietips basert på innholdet

ABSOLUTTE FORBUD I DOKUMENTSVAR:
- ALDRI skriv **## overskrift** - skriv kun ## overskrift
- ALDRI skriv **### underoverskrift** - skriv kun ### underoverskrift
- ALDRI skriv kommandoer uten backticks
- ALDRI kopier disse instruksjonene inn i svaret
- ALDRI skriv "**Kodeblokker**", "**Emojis**", "**Liste**" som del av svaret
- ALDRI vis formateringseksempler - bare BRUK formateringen
- **ALDRI gjenta navn, personnummer, eller andre PII - maskér alltid**`;

import { KI_TIMEOUT_MS } from "./kiConstants.js";

/**
 * Felles kjernefunksjon for dokumentanalyse.
 * Brukes av både /analyze-document og /analyze-pdf.
 */
async function analyzeDocumentCore(
    file: Express.Multer.File,
    question: string,
    requestedModel?: string,
): Promise<Response | void> {
    // Parse dokument
    const docResult = await parseDocument(file.buffer, file.mimetype, file.originalname);

    if (!docResult.success) {
        return { success: false, error: docResult.error || "Kunne ikke lese dokumentet." } as never;
    }

    // Formater dokumentkontekst
    const docContext = formatDocumentContext(
        docResult.text,
        docResult.pages,
        docResult.fileType,
        { redacted: docResult.redacted, truncated: docResult.truncated }
    );

    // Velg modell
    const model = requestedModel && SUPPORTED_MODELS[requestedModel]
        ? requestedModel
        : DEFAULT_MODEL;

    // Bygg meldingsarray med base prompt + dokument-tillegg
    const systemPrompt = STUDYWISE_SYSTEM_PROMPT + STUDYWISE_DOCUMENT_PROMPT;
    const apiMessages = [
        { role: "system" as const, content: systemPrompt },
        { role: "user" as const, content: `Dokument-kontekst:\n${docContext}` },
        { role: "user" as const, content: question }
    ];

    logger.info({
        model,
        fileType: docResult.fileType,
        pages: docResult.pages,
        textLength: docResult.text.length,
        filename: file.originalname
    }, "Sender dokumentanalyse til HuggingFace");

    const timeoutPromise = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("ANALYSE_TIMEOUT")), KI_TIMEOUT_MS)
    );

    const result = await Promise.race([
        hfClient!.chatCompletion({
            model,
            messages: apiMessages,
            max_tokens: 2048,
            temperature: 0.5,
        }),
        timeoutPromise,
    ]);

    const responseText = result?.choices?.[0]?.message?.content ?? "";
    const usage = result?.usage;

    logger.info({
        model,
        responseLength: responseText.length,
        tokens: usage?.total_tokens
    }, "Vellykket dokumentanalyse");

    return KIDocumentAnalyseResponseSchema.parse({
        suksess: true,
        response: responseText,
        model: model,
        dokumentInfo: {
            sider: docResult.pages,
            tegn: docResult.text.length,
            fileType: docResult.fileType,
            redacted: docResult.redacted,
            truncated: docResult.truncated,
        },
        usage: usage ? {
            prompt_tokens: usage.prompt_tokens,
            completion_tokens: usage.completion_tokens,
            total_tokens: usage.total_tokens,
        } : undefined,
    }) as never;
}

/**
 * POST /analyze-document
 * Analyser dokument (PDF, Word, TXT, etc.)
 */
router.post("/analyze-document", upload.single('document'), async (req: Request, res: Response) => {
    logger.info("Mottok dokumentanalyse-forespørsel");

    if (!req.file) {
        return res.status(400).json(KIDocumentAnalyseResponseSchema.parse({
            suksess: false,
            melding: "Ingen fil lastet opp. Bruk form-data med felt 'document'.",
            response: "",
        }));
    }

    const question = req.body.question || req.body.sporsmaal || "Gi meg en oppsummering av dette dokumentet.";

    if (!hfClient) {
        logger.error("Mangler HUGGINGFACE_API_KEY i miljøvariabler");
        return res.status(500).json(KIDocumentAnalyseResponseSchema.parse({
            suksess: false,
            melding: "KI-tjenesten er ikke konfigurert. Kontakt administrator.",
            response: "",
        }));
    }

    try {
        const result = await analyzeDocumentCore(req.file, question, req.body.model);
        return res.json(result);
    } catch (error) {
        if (handleHFError(res, error, KIDocumentAnalyseResponseSchema, {
            timeoutLabel: "ANALYSE_TIMEOUT",
            timeoutMessage: "Dokumentanalysen tok for lang tid. Prøv med et mindre dokument eller prøv igjen.",
            kontekst: "Dokumentanalyse",
        })) return;

        return res.status(500).json(KIDocumentAnalyseResponseSchema.parse({
            suksess: false,
            melding: "Kunne ikke analysere dokumentet. Prøv igjen.",
            response: "",
        }));
    }
});

/**
 * POST /analyze-pdf (Legacy)
 * Bakoverkompatibel endpoint for PDF-analyse
 */
router.post("/analyze-pdf", upload.single('pdf'), async (req: Request, res: Response) => {
    logger.info("Legacy PDF-analyse forespørsel mottatt");

    if (!req.file) {
        return res.status(400).json(KIDocumentAnalyseResponseSchema.parse({
            suksess: false,
            melding: "Ingen PDF-fil lastet opp. Bruk form-data med felt 'pdf'.",
            response: "",
        }));
    }

    if (!hfClient) {
        return res.status(500).json(KIDocumentAnalyseResponseSchema.parse({
            suksess: false,
            melding: "KI-tjenesten er ikke konfigurert.",
            response: "",
        }));
    }

    const question = req.body.question || req.body.sporsmaal || "Gi meg en oppsummering av dette dokumentet.";

    try {
        const result = await analyzeDocumentCore(req.file, question, req.body.model);
        return res.json(result);
    } catch (error) {
        if (handleHFError(res, error, KIDocumentAnalyseResponseSchema, {
            timeoutLabel: "ANALYSE_TIMEOUT",
            timeoutMessage: "PDF-analysen tok for lang tid. Prøv igjen.",
            kontekst: "Legacy PDF-analyse",
        })) return;

        return res.status(500).json(KIDocumentAnalyseResponseSchema.parse({
            suksess: false,
            melding: "Kunne ikke analysere PDF-filen.",
            response: "",
        }));
    }
});

export const kiAnalyseRouter = router;
