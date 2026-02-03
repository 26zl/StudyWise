/*
 * AI Model Configuration
 * Felles konfigurasjon for støttede AI-modeller
 */

// Støttede modeller med beskrivelser
export const SUPPORTED_MODELS: Record<string, { name: string; description: string }> = {
    "Qwen/Qwen3-1.7B": {
        name: "Qwen 3 1.7B",
        description: "Ultralett og rask modell for enkel bruk"
    },
    "Qwen/Qwen2.5-7B-Instruct": {
        name: "Qwen 2.5 7B",
        description: "Rask og effektiv modell for generelle oppgaver"
    },
    "Qwen/Qwen2.5-72B-Instruct": {
        name: "Qwen 2.5 72B",
        description: "Kraftigere modell for komplekse oppgaver"
    },
    "Qwen/Qwen2.5-Coder-32B-Instruct": {
        name: "Qwen 2.5 Coder 32B",
        description: "Spesialisert for programmering og kode"
    },
    "mistralai/Mistral-7B-Instruct-v0.3": {
        name: "Mistral 7B",
        description: "Effektiv europeisk modell"
    },
    "meta-llama/Llama-3.2-3B-Instruct": {
        name: "Llama 3.2 3B",
        description: "Kompakt og rask modell fra Meta"
    },
};

// Standard modell (kan overstyres via miljøvariabel)
export const DEFAULT_MODEL = process.env.KI_DEFAULT_MODEL || "Qwen/Qwen2.5-7B-Instruct";

// Typedefinisjoner
export type SupportedModelId = keyof typeof SUPPORTED_MODELS;
