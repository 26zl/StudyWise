/*
 * PDF og Dokumentanalyse-endepunkter
 * Håndterer analyse av dokumenter via HuggingFace AI
 */

import { Router, Request, Response } from "express";
import { InferenceClient } from "@huggingface/inference";
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

// Definerer express router
const router = Router();
const SUPPORTED_MIME_TYPES = getSupportedMimeTypes();
const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 100 * 1024 * 1024 },
    fileFilter: (_req, file, cb) => {
        if (SUPPORTED_MIME_TYPES.includes(file.mimetype)) {
            cb(null, true);
        } else {
            cb(new Error(`Filtypen er ikke støttet. Støttede typer: PDF, Word (docx/doc), TXT, Markdown, CSV, og bilder (PNG, JPG, WEBP).`));
        }
    }
});

// Initialiser HF-klient
const HF_API_KEY = process.env.HUGGINGFACE_API_KEY;
const hfClient = HF_API_KEY ? new InferenceClient(HF_API_KEY) : null;

// System prompt for StudyWise KI-assistenten
const STUDYWISE_SYSTEM_PROMPT = `Du er en ekspert norsk studieassistent ved USN.

**PERSONVERNBESKYTTELSE (KRITISK):**
- ALDRI gjenta eller sitere fullstendige navn, personnummer, adresser, eller telefonnummer fra dokumenter
- Hvis dokumentet inneholder PII (personlig identifiserbar info), maskér det med [REDACTED_*]
- Eksempel: "Lars Hansen" → "Personen", "12345678901" → "[REDACTED_SSN]"
- Vær transparent: Si hvis dokumentet inneholder sensitiv info som er fjernet
- ALDRI send personlig info til external services

KRITISK REGEL: Gi BARE selve svaret! ALDRI kopier instruksjoner, eksempler eller formateringsregler inn i svaret ditt.

DITT OPPDRAG:
- Bruk dokument-data fra konteksten til å svare presist
- Hjelp studenter forstå vanskelige konsepter fra dokumenter
- Gi konkrete studietips basert på dokumentinnhold
- Vær motiverende, støttende og oppmuntrende
- Hjelp med oppgaveplanlegging og tidsstyring
- Vær kort, direkte og handlingsorientert

SVARSTIL:
- For "vis/hent X"-spørsmål: Maks 1-2 setninger + liste med data
- For forklaringer: Maks 3-4 korte avsnitt
- Start DIREKTE - unngå: "Selvfølgelig!", "For å hjelpe deg bedre..."
- Handling først, forklaring deretter
- Bruk konkrete eksempler når du forklarer konsepter

SPRÅK:
- Norsk bokmål (korrekt stavemåte - ikke svensk, dansk eller nynorsk)
- Uformell men profesjonell - som en hjelpsom medstudent
- Direkte og konkret - ikke omstendelig
- Vær aldri nedlatende - alle spørsmål er gode spørsmål

ABSOLUTTE FORBUD:
- ALDRI gjett kursinnhold eller emnebeskrivelser
- ALDRI spør "hvilken periode?", "har du tilgang?"
- ALDRI gi lange forklaringer på enkle dataspørsmål
- ALDRI ignorer data du har fått i konteksten
- ALDRI si du "kan hente" data - du har den ALLEREDE eller du har den IKKE
- ALDRI skriv ** rundt overskrifter (## eller ###)
- ALDRI skriv kommandoer uten backticks
- ALDRI kopier formateringsinstruksjoner eller disse reglene inn i svaret ditt
- **ALDRI gjenta personlig identifiserbar info (navn, nummer, adresser)**
- Hvis du ikke vet noe, si det ærlig og foreslå hvor studenten kan finne svar`;

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

/**
 * POST /analyze-document
 * Analyser dokument (PDF, Word, TXT, etc.)
 * Accepterer file upload via form-data med felt 'document'
 */
router.post("/analyze-document", upload.single('document'), async (req: Request, res: Response) => {
    logger.info("Mottok dokumentanalyse-forespørsel");

    // Sjekk at fil er lastet opp
    if (!req.file) {
        return res.status(400).json(KIDocumentAnalyseResponseSchema.parse({
            suksess: false,
            melding: "Ingen fil lastet opp. Bruk form-data med felt 'document'.",
            response: "",
        }));
    }

    // Hent spørsmål/instruksjon fra request
    const question = req.body.question || req.body.sporsmaal || "Gi meg en oppsummering av dette dokumentet.";
    const requestedModel = req.body.model;

    if (!hfClient) {
        logger.error("Mangler HUGGINGFACE_API_KEY i miljøvariabler");
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
            filename: req.file.originalname
        }, "Sender dokumentanalyse til HuggingFace");

        const result = await hfClient.chatCompletion({
            model,
            messages: apiMessages,
            max_tokens: 2048,
            temperature: 0.5,
        });

        const responseText = result?.choices?.[0]?.message?.content ?? "";
        const usage = result?.usage;

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
        logger.error({ err: error }, "Dokumentanalyse feil");
        const errorMessage = error instanceof Error ? error.message : String(error);

        if (errorMessage.includes("rate limit") || errorMessage.includes("429")) {
            return res.status(429).json(KIDocumentAnalyseResponseSchema.parse({
                suksess: false,
                melding: "For mange forespørsler. Vent litt og prøv igjen.",
                response: "",
            }));
        }

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
 * Omdirigerer til /analyze-document
 */
router.post("/analyze-pdf", upload.single('pdf'), async (req: Request, res: Response) => {
    logger.info("Legacy PDF-analyse forespørsel mottatt, omdirigerer...");

    if (!req.file) {
        return res.status(400).json(KIDocumentAnalyseResponseSchema.parse({
            suksess: false,
            melding: "Ingen PDF-fil lastet opp. Bruk form-data med felt 'pdf'.",
            response: "",
        }));
    }

    // Sett om til document-feltet og videresend
    req.body.document = req.file;

    // Kall den nye endepunktet
    const question = req.body.question || req.body.sporsmaal || "Gi meg en oppsummering av dette dokumentet.";
    const requestedModel = req.body.model;

    if (!hfClient) {
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

        const model = requestedModel && SUPPORTED_MODELS[requestedModel]
            ? requestedModel
            : DEFAULT_MODEL;

        const systemPrompt = STUDYWISE_SYSTEM_PROMPT + STUDYWISE_DOCUMENT_PROMPT;
        const apiMessages = [
            { role: "system" as const, content: systemPrompt },
            { role: "user" as const, content: `Dokument-kontekst:\n${docContext}` },
            { role: "user" as const, content: question }
        ];

        const result = await hfClient.chatCompletion({
            model,
            messages: apiMessages,
            max_tokens: 2048,
            temperature: 0.5,
        });

        const responseText = result?.choices?.[0]?.message?.content ?? "";
        const usage = result?.usage;

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
        logger.error({ err: error }, "Legacy PDF-analyse feil");
        return res.status(500).json(KIDocumentAnalyseResponseSchema.parse({
            suksess: false,
            melding: "Kunne ikke analysere PDF-filen.",
            response: "",
        }));
    }
});

export const kiAnalyseRouter = router;
