/*
 * AI Model Configuration
 * Claude er primær-AI, HuggingFace er fallback.
 * Støtter leverandører: Anthropic (Claude) og HuggingFace
 */

// Leverandørtype for AI-modeller
export type AIProvider = "huggingface" | "anthropic";

// Modellinfo med leverandør
export interface ModelInfo {
    name: string;
    description: string;
    provider: AIProvider;
}

// Støttede modeller med beskrivelser og leverandør
export const SUPPORTED_MODELS: Record<string, ModelInfo> = {
    // --- Anthropic (Claude) — primær ---
    "claude-sonnet-4-20250514": {
        name: "Claude Sonnet 4",
        description: "Avansert resonneringsmodell fra Anthropic",
        provider: "anthropic",
    },
    // --- HuggingFace — fallback ---
    "Qwen/Qwen3-1.7B": {
        name: "Qwen 3 1.7B",
        description: "Ultralett og rask modell for enkel bruk",
        provider: "huggingface",
    },
    "Qwen/Qwen2.5-7B-Instruct": {
        name: "Qwen 2.5 7B",
        description: "Rask og effektiv modell for generelle oppgaver",
        provider: "huggingface",
    },
    "Qwen/Qwen2.5-72B-Instruct": {
        name: "Qwen 2.5 72B",
        description: "Kraftigere modell for komplekse oppgaver",
        provider: "huggingface",
    },
    "Qwen/Qwen2.5-Coder-32B-Instruct": {
        name: "Qwen 2.5 Coder 32B",
        description: "Spesialisert for programmering og kode",
        provider: "huggingface",
    },
    "mistralai/Mistral-7B-Instruct-v0.3": {
        name: "Mistral 7B",
        description: "Effektiv europeisk modell",
        provider: "huggingface",
    },
    "meta-llama/Llama-3.2-3B-Instruct": {
        name: "Llama 3.2 3B",
        description: "Kompakt og rask modell fra Meta",
        provider: "huggingface",
    },
};

// Standard modell — Claude er primær
export const DEFAULT_MODEL = "claude-sonnet-4-20250514";

// Fallback-modell brukes automatisk hvis Claude feiler og HF er tilgjengelig
export const FALLBACK_MODEL = "Qwen/Qwen2.5-7B-Instruct";

// Typedefinisjoner
export type SupportedModelId = keyof typeof SUPPORTED_MODELS;

// Hjelpefunksjon for å sjekke leverandør
export function getModelProvider(modelId: string): AIProvider {
    return SUPPORTED_MODELS[modelId]?.provider ?? "huggingface";
}

// Sjekk om modell er en Anthropic-modell
export function isAnthropicModel(modelId: string): boolean {
    return getModelProvider(modelId) === "anthropic";
}
