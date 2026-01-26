/*
* Rutere for KI-relaterte endepunkter
* Bruker huggingface/inference for å kommunisere med Hugging Face API
* Modell: Qwen2.5-7B-Instruct
*/

import { Router } from "express";
import { InferenceClient } from "@huggingface/inference";
import { logger } from "../../middleware/logger.js";

// Definerer express router
const router = Router();

// Endepunkt for å teste tilkobling til Hugging Face API
router.get("/test-connection", async (_req, res) => {
    logger.info("Testing Hugging Face connection...");
    const HF_API_KEY = process.env.HUGGINGFACE_API_KEY;
    if (!HF_API_KEY) {
        logger.error("Mangler HUGGINGFACE_API_KEY i miljøvariabler");
        return res.status(500).json({
            suksess: false,
            melding: "Mangler HUGGINGFACE_API_KEY i miljøvariabler.",
            response: "",
        });
    }
    // Oppretter klient og sender testmelding
    try {
        const hf = new InferenceClient(HF_API_KEY);
        const model = "Qwen/Qwen2.5-7B-Instruct";
        const result = await hf.chatCompletion({
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
        return res.json({
            suksess: true,
            melding: "Vellykket kobling til Hugging Face API!",
            response: text,
        });
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