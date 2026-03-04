/*
 * PDF og Dokumentanalyse-endepunkter
 * Håndterer analyse av dokumenter via AI (HuggingFace / Anthropic)
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
import { chatCompletion, isClientAvailable } from "./aiClient.js";
import { STUDYWISE_SYSTEM_PROMPT, STUDYWISE_DOCUMENT_PROMPT } from "./systemPrompt.js";
import { handleAIError } from "./handleAIError.js";

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
    const requestedModel = req.body.model;

    // Velg modell tidlig for å sjekke klient-tilgjengelighet
    const model = requestedModel && SUPPORTED_MODELS[requestedModel]
        ? requestedModel
        : DEFAULT_MODEL;

    if (!isClientAvailable(model)) {
        logger.error("AI-klient ikke tilgjengelig for modell: %s", model);
        return res.status(500).json(KIDocumentAnalyseResponseSchema.parse({
            suksess: false,
            melding: "KI-tjenesten er ikke konfigurert. Kontakt administrator.",
            response: "",
        }));
    }

    try {
        // Parse dokument
        const docResult = await parseDocument(req.file.buffer, req.file.mimetype, req.file.originalname);

        if (!docResult.success) {
            return res.status(400).json(KIDocumentAnalyseResponseSchema.parse({
                suksess: false,
                melding: docResult.error || "Kunne ikke lese dokumentet.",
                response: "",
            }));
        }

        // Formater dokumentkontekst
        const docContext = formatDocumentContext(
            docResult.text,
            docResult.pages,
            docResult.fileType,
            {
                redacted: docResult.redacted,
                truncated: docResult.truncated,
            }
        );

        // Bygg meldingsarray med base prompt + dokument-tillegg
        const systemPrompt = STUDYWISE_SYSTEM_PROMPT + STUDYWISE_DOCUMENT_PROMPT;
        const apiMessages: Array<{ role: "system" | "user" | "assistant"; content: string }> = [
            { role: "system", content: systemPrompt },
            { role: "user", content: `Dokument-kontekst:\n${docContext}\n\nSpørsmål: ${question}` }
        ];

        logger.info({
            model,
            fileType: docResult.fileType,
            pages: docResult.pages,
            textLength: docResult.text.length,
            filename: req.file.originalname
        }, "Sender dokumentanalyse til AI-tjenesten");

        // Timeout guard — dokumentanalyse kan ta lengre tid enn chat, men bør ikke henge evig
        const ANALYSE_TIMEOUT_MS = 60000;
        const timeoutPromise = new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error("ANALYSE_TIMEOUT")), ANALYSE_TIMEOUT_MS)
        );

        const result = await Promise.race([
            chatCompletion({
                model,
                messages: apiMessages,
                max_tokens: 2048,
                temperature: 0.5,
            }),
            timeoutPromise,
        ]);

        const responseText = result.text;
        const usage = result.usage;

        logger.info({
            model,
            responseLength: responseText.length,
            tokens: usage?.total_tokens
        }, "Vellykket dokumentanalyse");

        return res.json(KIDocumentAnalyseResponseSchema.parse({
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
        }));

    } catch (error) {
        if (handleAIError(res, error, KIDocumentAnalyseResponseSchema, {
            timeoutLabel: "ANALYSE_TIMEOUT",
            timeoutMessage: "Dokumentanalysen tok for lang tid. Prøv med et mindre dokument eller prøv igjen.",
            kontekst: "dokumentanalyse",
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

    const question = req.body.question || req.body.sporsmaal || "Gi meg en oppsummering av dette dokumentet.";
    const requestedModel = req.body.model;

    const model = requestedModel && SUPPORTED_MODELS[requestedModel]
        ? requestedModel
        : DEFAULT_MODEL;

    if (!isClientAvailable(model)) {
        return res.status(500).json(KIDocumentAnalyseResponseSchema.parse({
            suksess: false,
            melding: "KI-tjenesten er ikke konfigurert.",
            response: "",
        }));
    }

    try {
        const docResult = await parseDocument(req.file.buffer, req.file.mimetype, req.file.originalname);

        if (!docResult.success) {
            return res.status(400).json(KIDocumentAnalyseResponseSchema.parse({
                suksess: false,
                melding: docResult.error || "Kunne ikke lese PDF-filen.",
                response: "",
            }));
        }

        const docContext = formatDocumentContext(
            docResult.text,
            docResult.pages,
            docResult.fileType,
            { redacted: docResult.redacted, truncated: docResult.truncated }
        );

        const systemPrompt = STUDYWISE_SYSTEM_PROMPT + STUDYWISE_DOCUMENT_PROMPT;
        const apiMessages: Array<{ role: "system" | "user" | "assistant"; content: string }> = [
            { role: "system", content: systemPrompt },
            { role: "user", content: `Dokument-kontekst:\n${docContext}\n\nSpørsmål: ${question}` }
        ];

        const ANALYSE_TIMEOUT_MS = 60000;
        const timeoutPromise = new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error("ANALYSE_TIMEOUT")), ANALYSE_TIMEOUT_MS)
        );

        const result = await Promise.race([
            chatCompletion({
                model,
                messages: apiMessages,
                max_tokens: 2048,
                temperature: 0.5,
            }),
            timeoutPromise,
        ]);

        const responseText = result.text;
        const usage = result.usage;

        return res.json(KIDocumentAnalyseResponseSchema.parse({
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
        }));
    } catch (error) {
        if (handleAIError(res, error, KIDocumentAnalyseResponseSchema, {
            timeoutLabel: "ANALYSE_TIMEOUT",
            timeoutMessage: "PDF-analysen tok for lang tid. Prøv igjen.",
            kontekst: "legacy-pdf-analyse",
        })) return;

        return res.status(500).json(KIDocumentAnalyseResponseSchema.parse({
            suksess: false,
            melding: "Kunne ikke analysere PDF-filen.",
            response: "",
        }));
    }
});

export const kiAnalyseRouter = router;
