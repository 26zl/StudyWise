/*
 * AI Model Configuration
 * Claude (Anthropic) er eneste AI-leverandør.
 */

// Modellinfo
export interface ModelInfo {
    name: string;
    description: string;
}

// Støttede modeller med beskrivelser
export const SUPPORTED_MODELS: Record<string, ModelInfo> = {
    "claude-sonnet-4-20250514": {
        name: "Claude Sonnet 4",
        description: "Avansert resonneringsmodell fra Anthropic",
    },
};

// Standard modell
export const DEFAULT_MODEL = "claude-sonnet-4-20250514";

// Typedefinisjoner
export type SupportedModelId = keyof typeof SUPPORTED_MODELS;
