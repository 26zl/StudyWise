import { Router } from "express";
import { InferenceClient } from "@huggingface/inference";

const router = Router();



router.get("/test-connection", async (_req, res) => {
    console.log("Testing Hugging Face connection...");

    const HF_API_KEY = process.env.HUGGINGFACE_API_KEY;

    if (!HF_API_KEY) {
        return res.status(500).json({
            suksess: false,
            melding: "Mangler HUGGINGFACE_API_KEY i miljøvariabler.",
            response: "",
        });
    }

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

        const text = result?.choices?.[0]?.message?.content ?? "";

        return res.json({
            suksess: true,
            melding: "Vellykket kobling til Hugging Face API!",
            response: text,
        });
    } catch (error) {
        console.error("Hugging Face Error:", error);
        const errorMessage = error instanceof Error ? error.message : String(error);
        return res.status(500).json({
            suksess: false,
            melding: "Feil under kommunikasjon med Hugging Face API: " + errorMessage,
            response: "",
        });
    }
});

export default router;