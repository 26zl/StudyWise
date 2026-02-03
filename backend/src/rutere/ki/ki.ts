/*
* Rutere for KI-relaterte endepunkter
* Bruker huggingface/inference for å kommunisere med Hugging Face API
* Støtter flere modeller: Qwen, Mistral, og andre HuggingFace-modeller
*/

import { Router } from "express";
import { InferenceClient } from "@huggingface/inference";
import { logger } from "../../utils/logger.js";
import { getCache, setCache } from "../../cache/redis.js";
import { rateLimitKi } from "../../middleware/rate-limit.js";
import {
    KIChatRequestSchema,
    KIChatResponseSchema,
    KIModelsResponseSchema,
    KI_MAX_MESSAGE_LENGTH_BACKEND,
} from "common/ki";
import { byggKiCanvasKontekst } from "./kiCanvas.js";
import { kiHistoryRouter } from "./kiHistory.js";
import { kiAnalyseRouter } from "./kiAnalyse.js";
import { SUPPORTED_MODELS, DEFAULT_MODEL } from "./aiModels.js";
import { STUDYWISE_SYSTEM_PROMPT } from "./systemPrompt.js";

// Definerer express router
const router = Router();
// Rate limiting for KI-endepunkter
router.use(rateLimitKi);
// Chat historikk ruter
router.use(kiHistoryRouter);
// Dokumentanalyse ruter
router.use(kiAnalyseRouter);

// Initialiser HF-klient én gang ved oppstart (gjenbrukes for alle requests)
const HF_API_KEY = process.env.HUGGINGFACE_API_KEY;
const hfClient = HF_API_KEY ? new InferenceClient(HF_API_KEY) : null;

// Cache-konfigurasjon
const CACHE_KEY = "ki:test-connection";
const KI_CACHE_TTL = 300; // 5 minutter

// Endepunkt for å liste støttede modeller
router.get("/models", (_req, res) => {
    logger.info("Henter liste over støttede modeller");
    const models = Object.entries(SUPPORTED_MODELS).map(([id, info]) => ({
        id,
        ...info,
        isDefault: id === DEFAULT_MODEL
    }));
    return res.json(KIModelsResponseSchema.parse({ models, defaultModel: DEFAULT_MODEL }));
});

// Endepunkt for å teste tilkobling til Hugging Face API
router.get("/test-connection", async (_req, res) => {
    logger.info("Testing Hugging Face connection...");

    // Sjekk cache først
    const cached = await getCache(CACHE_KEY);
    if (cached) {
        logger.info("Returnerer cachet KI test-resultat");
        return res.json(KIChatResponseSchema.parse(JSON.parse(cached)));
    }
    if (!hfClient) {
        logger.error("Mangler HUGGINGFACE_API_KEY i miljøvariabler");
        return res.status(500).json(KIChatResponseSchema.parse({
            suksess: false,
            melding: "Mangler HUGGINGFACE_API_KEY i miljøvariabler.",
            response: "",
        }));
    }
    // Sender testmelding med gjenbrukt klient
    try {
        const model = DEFAULT_MODEL;
        const result = await hfClient.chatCompletion({
            model,
            messages: [
                { role: "system", content: STUDYWISE_SYSTEM_PROMPT },
                { role: "user", content: "Hei! Hvem er du?" }
            ],
            max_tokens: 150,
            temperature: 0.7,
        });
        // Henter svartekst fra resultatet
        const text = result?.choices?.[0]?.message?.content ?? "";
        logger.info("Vellykket svar fra Hugging Face");
        const response = KIChatResponseSchema.parse({
            suksess: true,
            melding: "Vellykket kobling til Hugging Face API!",
            response: text,
            model: model,
        });
        // Cache resultatet
        await setCache(CACHE_KEY, JSON.stringify(response), KI_CACHE_TTL);
        return res.json(response);
    } catch (error) {
        logger.error({ err: error }, "Hugging Face Error");
        const errorMessage = error instanceof Error ? error.message : String(error);

        // Håndter fakturerings-/kredittfeil fra HuggingFace
        if (errorMessage.includes("Credit balance") || errorMessage.includes("depleted") || errorMessage.includes("purchase")) {
            return res.status(503).json(KIChatResponseSchema.parse({
                suksess: false,
                melding: "KI-tjenesten er midlertidig utilgjengelig.",
                response: "",
            }));
        }

        return res.status(500).json(KIChatResponseSchema.parse({
            suksess: false,
            melding: "Feil under kommunikasjon med KI-tjenesten. Prøv igjen senere.",
            response: "",
        }));
    }
});

// Hovedendepunkt for chat
router.post("/chat", async (req, res) => {
    logger.info("Mottok chat-forespørsel");

    // Sjekk autentisering
    if (!req.user?.id) {
        logger.warn("Chat-forespørsel uten autentisering");
        return res.status(401).json(KIChatResponseSchema.parse({
            suksess: false,
            melding: "Du må være innlogget for å bruke KI-assistenten.",
            response: "",
        }));
    }

    // Valider request body
    const parseResult = KIChatRequestSchema.safeParse(req.body);
    if (!parseResult.success) {
        const errorMessages = parseResult.error.issues.map((issue) => issue.message).join(", ");
        logger.warn({ errors: parseResult.error.issues, userId: req.user.id }, "Ugyldig chat-forespørsel");
        return res.status(400).json(KIChatResponseSchema.parse({
            suksess: false,
            melding: "Ugyldig forespørsel: " + errorMessages,
            response: "",
        }));
    }

    const { messages, model: requestedModel, temperature = 0.7 } = parseResult.data;

    // Valider meldingsarray
    if (!messages || messages.length === 0) {
        logger.warn({ userId: req.user.id }, "Tom meldingsarray");
        return res.status(400).json(KIChatResponseSchema.parse({
            suksess: false,
            melding: "Du må sende minst en melding.",
            response: "",
        }));
    }

    // Sjekk for veldig lange meldinger (unngå DoS)
    const totalLength = messages.reduce((sum, m) => sum + (m.content?.length || 0), 0);
    if (totalLength > KI_MAX_MESSAGE_LENGTH_BACKEND) {
        logger.warn({ userId: req.user.id, totalLength, maxLength: KI_MAX_MESSAGE_LENGTH_BACKEND }, "Meldinger for lange");
        return res.status(413).json(KIChatResponseSchema.parse({
            suksess: false,
            melding: `Meldingene er for lange. Maksimalt ${KI_MAX_MESSAGE_LENGTH_BACKEND} tegn totalt. Start en ny samtale.`,
            response: "",
        }));
    }

    if (!hfClient) {
        logger.error("Mangler HUGGINGFACE_API_KEY i miljøvariabler");
        return res.status(500).json(KIChatResponseSchema.parse({
            suksess: false,
            melding: "KI-tjenesten er ikke konfigurert. Kontakt administrator.",
            response: "",
        }));
    }

    // Velg modell (bruk forespurt modell hvis støttet, ellers default)
    const model = requestedModel && SUPPORTED_MODELS[requestedModel]
        ? requestedModel
        : DEFAULT_MODEL;

    if (requestedModel && !SUPPORTED_MODELS[requestedModel]) {
        logger.warn({ requestedModel }, "Forespurt modell ikke støttet, bruker default");
    }

    try {
        // Finn Canvas context message fra frontend (hvis sendt)
        const canvasContextMessage = messages.find(
            (m: { role: string; content: string }) => 
                m.role === "system" && m.content.includes("Canvas data")
        );

        // Start med base system prompt
        let enhancedSystemPrompt = STUDYWISE_SYSTEM_PROMPT;

        // Filtrer ut Canvas context message fra messages for å unngå duplikater
        let filteredMessages = messages;
        
        // Finn Canvas context message fra frontend (for å vite brukerens valg)
        // Men ALLTID hent full data fra backend for å få moduler og innhold
        let canvasKontekst: string;
        let brukerFrontendContext = false;
        
        // Sjekk om frontend sendte context (indikerer at brukeren har gjort valg)
        if (canvasContextMessage && canvasContextMessage.content.trim().length > 20) {
            brukerFrontendContext = true;
            filteredMessages = messages.filter(
                (m: { role: string; content: string }) => m !== canvasContextMessage
            );
        }
        
        // ALLTID hent full Canvas-kontekst fra backend (inkluderer moduler, sider, filer)
        if (req.canvasToken) {
            const CANVAS_TIMEOUT_MS = 60000;
            canvasKontekst = await Promise.race([
                byggKiCanvasKontekst(req.canvasToken),
                new Promise<string>((resolve) =>
                    setTimeout(
                        () => resolve("[CANVAS STATUS: Henting tok for lang tid. Prøv igjen.]"),
                        CANVAS_TIMEOUT_MS
                    )
                ),
            ]);
            logger.info({ 
                contextLength: canvasKontekst.length,
                brukerFrontendContext
            }, "Hentet full Canvas-context fra backend (inkl. moduler og innhold)");
        } else {
            canvasKontekst = "[CANVAS STATUS: Ingen Canvas-token. Brukeren må legge inn token i Innstillinger.]";
        }

        // Sjekk om vi faktisk har Canvas-data (fra backend-kontekst)
        const hasCanvasData = (
            canvasKontekst.includes("CANVAS-DATA") || 
            canvasKontekst.includes("KUNNGJØRINGER") ||
            canvasKontekst.includes("EMNER") ||
            canvasKontekst.includes("OPPGAVER") ||
            canvasKontekst.includes("FRISTER") ||
            canvasKontekst.includes("MODULER")
        ) && !canvasKontekst.includes("Ingen Canvas-token") && !canvasKontekst.includes("IKKE lagt inn");
        
        logger.info({
            hasCanvasData,
            brukerFrontendContext,
            canvasKontekstLength: canvasKontekst.length,
            harCanvasToken: !!req.canvasToken,
            inkludererModuler: canvasKontekst.includes("MODULER")
        }, "Canvas-kontekst status");
        
        // Hvis ingen Canvas-data tilgjengelig, informer brukeren
        if (!hasCanvasData) {
            return res.json(KIChatResponseSchema.parse({
                suksess: true,
                response: "Jeg har ikke tilgang til Canvas-data akkurat nå. Sjekk at du har:\n\n1. Lagt inn et gyldig Canvas API-token i Innstillinger\n2. Valgt minst ett datasett under «Gi AI tilgang til» i chatten",
                model: model,
            }));
        }

        // Bygg meldingsarray med system prompt og Canvas-kontekst
        const systemPrompt = { role: "system" as const, content: enhancedSystemPrompt };
        const fullMessages = [
            systemPrompt,
            { role: "user" as const, content: canvasKontekst },
            { role: "assistant" as const, content: "Forstått, jeg har tilgang til Canvas-dataen din og er klar til å hjelpe deg." },
            ...filteredMessages.map((m: { role: string; content: string }) => ({
                role: m.role as "user" | "assistant" | "system",
                content: m.content
            }))
        ];

        logger.info({ 
            model, 
            messageCount: fullMessages.length, 
            harCanvasToken: !!req.canvasToken, 
            brukerFrontendContext 
        }, "Sender til HuggingFace");

        // Egen timeout guard (race) så klienten får svar selv om HF henger
        const TIMEOUT_MS = 25000;
        const timeoutPromise = new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error("CHAT_TIMEOUT")), TIMEOUT_MS)
        );

        const result = await Promise.race([
            hfClient.chatCompletion({
                model,
                messages: fullMessages,
                max_tokens: 1024,
                temperature: Math.min(Math.max(temperature, 0), 2), // Clamp mellom 0-2
            }),
            timeoutPromise,
        ]);

        const responseText = result?.choices?.[0]?.message?.content ?? "";
        const usage = result?.usage;

        logger.info({
            model,
            responseLength: responseText.length,
            tokens: usage?.total_tokens
        }, "Vellykket chat-svar");

        return res.json(KIChatResponseSchema.parse({
            suksess: true,
            response: responseText,
            model: model,
            usage: usage ? {
                prompt_tokens: usage.prompt_tokens,
                completion_tokens: usage.completion_tokens,
                total_tokens: usage.total_tokens,
            } : undefined,
        }));

    } catch (error) {
        // Logg feil uten sensitiv data (unngå å logge hele Canvas-konteksten)
        const sanitizedError = error instanceof Error ? {
            name: error.name,
            message: error.message,
            // Inkluder httpResponse men IKKE httpRequest.body (som inneholder Canvas-data)
            ...(('httpResponse' in error) ? {
                httpResponse: (error as Record<string, unknown>).httpResponse
            } : {}),
        } : String(error);
        logger.error({ err: sanitizedError, model }, "HuggingFace chat feil");
        const errorMessage = error instanceof Error ? error.message : String(error);

        if (error instanceof Error && error.message === "CHAT_TIMEOUT") {
            return res.status(504).json(KIChatResponseSchema.parse({
                suksess: false,
                melding: "Chat-forespørselen tok for lang tid (timeout etter 25s). Prøv igjen eller forenkle spørsmålet.",
                response: "",
            }));
        }
        
        // Sjekk for vanlige feil
        if (errorMessage.includes("rate limit") || errorMessage.includes("429")) {
            return res.status(429).json(KIChatResponseSchema.parse({
                suksess: false,
                melding: "For mange forespørsler. Vent litt og prøv igjen.",
                response: "",
            }));
        }
        
        if (errorMessage.includes("model") && errorMessage.includes("not found")) {
            return res.status(503).json(KIChatResponseSchema.parse({
                suksess: false,
                melding: `Modellen "${model}" er midlertidig utilgjengelig. Prøv igjen senere.`,
                response: "",
            }));
        }

        // Håndter fakturerings-/kredittfeil fra HuggingFace
        if (errorMessage.includes("Credit balance") || errorMessage.includes("depleted") || errorMessage.includes("purchase")) {
            logger.warn({ model }, "HuggingFace kreditt oppbrukt");
            return res.status(503).json(KIChatResponseSchema.parse({
                suksess: false,
                melding: "KI-tjenesten er midlertidig utilgjengelig. Vennligst prøv igjen senere.",
                response: "",
            }));
        }

        return res.status(500).json(KIChatResponseSchema.parse({
            suksess: false,
            melding: `Kunne ikke få svar fra KI-assistenten. Prøv igjen senere.`,
            response: "",
        }));
    }
});

export default router;