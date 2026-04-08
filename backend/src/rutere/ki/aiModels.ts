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
    "claude-sonnet-4-5": {
        name: "Claude Sonnet 4.5",
        description: "Avansert resonneringsmodell fra Anthropic",
    },
    "claude-haiku-4-5": {
        name: "Claude Haiku 4.5",
        description: "Rask modell for korte/lette svar",
    },
};

// Standard modell
export const DEFAULT_MODEL = "claude-sonnet-4-5";

/** Velg modell: forespurt hvis støttet, ellers default. */
export function resolveModel(requested?: string | null): string {
  return requested && SUPPORTED_MODELS[requested] ? requested : DEFAULT_MODEL;
}

