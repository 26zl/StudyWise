/*
* Rutere for KI-relaterte endepunkter
* Bruker huggingface/inference for å kommunisere med Hugging Face API
* Modell: Qwen2.5-7B-Instruct
*/

import { Router } from "express";
import { InferenceClient } from "@huggingface/inference";
import { logger } from "../../middleware/logger.js";
import { getCache, setCache } from "../../cache/redis.js";

// Definerer express router
const router = Router();

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

export default router;