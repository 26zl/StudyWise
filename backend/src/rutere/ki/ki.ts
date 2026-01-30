/*
* Rutere for KI-relaterte endepunkter
* Bruker huggingface/inference for å kommunisere med Hugging Face API
* Modell: Qwen3-1.7B
*/

import { Router } from "express";
import { InferenceClient } from "@huggingface/inference";
import { logger } from "../../utils/logger.js";
import { getCache, setCache } from "../../cache/redis.js";
import { rateLimitKi } from "../../middleware/rate-limit.js";

// Definerer express router
const router = Router();
// Rate limiting for KI-endepunkter
router.use(rateLimitKi);

// Initialiser HF-klient én gang ved oppstart (gjenbrukes for alle requests)
const HF_API_KEY = process.env.HUGGINGFACE_API_KEY;
const hfClient = HF_API_KEY ? new InferenceClient(HF_API_KEY) : null;

// Cache-konfigurasjon
const CACHE_KEY = "ki:test-connection";
const CACHE_TTL = 300; // 5 minutter

// Endepunkt for å teste tilkobling til Hugging Face API
router.get("/test-connection", async (_req, res) => {
    logger.info("Testing Hugging Face connection...");

    // Sjekk cache først
    const cached = await getCache(CACHE_KEY);
    if (cached) {
        logger.info("Returnerer cachet KI test-resultat");
        return res.json(JSON.parse(cached));
    }
    if (!hfClient) {
        logger.error("Mangler HUGGINGFACE_API_KEY i miljøvariabler");
        return res.status(500).json({
            suksess: false,
            melding: "Mangler HUGGINGFACE_API_KEY i miljøvariabler.",
            response: "",
        });
    }
    // Sender testmelding med gjenbrukt klient
    try {
        const model = "Qwen/Qwen2.5-7B-Instruct"; 
        const result = await hfClient.chatCompletion({
            model,
            messages: [
                { role: "system", content: "Du er en hjelpsom assistent. Svar kun på norsk bokmål. Unngå svenske eller danske ord." },
                { role: "user", content: "Hei! Hvem er du?" }
            ],
            max_tokens: 100,
            temperature: 0.2,
        });
        // Henter svartekst fra resultatet
        const text = result?.choices?.[0]?.message?.content ?? "";
        logger.info("Vellykket svar fra Hugging Face");
        const response = {
            suksess: true,
            melding: "Vellykket kobling til Hugging Face API!",
            response: text,
        };
        // Cache resultatet
        await setCache(CACHE_KEY, JSON.stringify(response), CACHE_TTL);
        return res.json(response);
    } catch (error) {
        logger.error({ err: error }, "Hugging Face Error");
        const errorMessage = error instanceof Error ? error.message : String(error);
        return res.status(500).json({
            suksess: false,
            melding: "Feil under kommunikasjon med Hugging Face API: " + errorMessage,
            response: "",
        });
    }
});

// Endepunkt for chat med AI
router.post("/chat", async (req, res) => {
    const { messages, temperature = 0.7 } = req.body;

    // Validering
    if (!messages || !Array.isArray(messages) || messages.length === 0) {
        return res.status(400).json({
            suksess: false,
            melding: "Mangler meldinger i forespørselen",
            response: "",
        });
    }

    if (!hfClient) {
        logger.error("Mangler HUGGINGFACE_API_KEY");
        return res.status(500).json({
            suksess: false,
            melding: "Mangler HUGGINGFACE_API_KEY i miljøvariabler.",
            response: "",
        });
    }

    try {
       const model = "Qwen/Qwen2.5-7B-Instruct"; 
        
        // System prompt for å gi AI kontekst
        const systemPrompt = {
            role: "system" as const,
            content: `Du er en hjelpsom studieassistent for norske studenter. 
Du hjelper med:
- Forklare konsepter fra forelesninger
- Planlegge studieøkter
- Svare på spørsmål om Canvas-innhold
- Gi studietips og motivasjon
- Hjelpe med oppgaver og prosjekter

Svar alltid på norsk bokmål. Vær konsis men hjelpsom. Bruk emojis sparsomt. Unngå svenske eller danske ord.`
        };

        // Kombiner system prompt med brukerens meldinger
        const fullMessages = [systemPrompt, ...messages];

        logger.info({ messageCount: messages.length, model }, "Sender chat til HuggingFace");

        const result = await hfClient.chatCompletion({
            model,
            messages: fullMessages,
            max_tokens: 500,
            temperature: temperature,
        });

        const text = result?.choices?.[0]?.message?.content ?? "";

        logger.info("Mottok svar fra HuggingFace");

        return res.json({
            suksess: true,
            melding: "Chat fullført",
            response: text,
            usage: {
                prompt_tokens: 0, // HF gir ikke dette enkelt
                completion_tokens: 0,
                total_tokens: 0,
            },
        });
    } catch (error) {
        logger.error({ err: error }, "HuggingFace chat error");
        const errorMessage = error instanceof Error ? error.message : String(error);
        return res.status(500).json({
            suksess: false,
            melding: "Feil under kommunikasjon med AI: " + errorMessage,
            response: "",
        });
    }
});

export default router;