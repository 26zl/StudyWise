/*
 * Delt feilhåndtering for HuggingFace API-kall
 * Brukes av ki.ts, kiAnalyse.ts og kiOppsummering.ts
 */

import type { Response } from "express";
import type { ZodType } from "zod";
import { logger } from "../../utils/logger.js";

/**
 * Håndterer vanlige HuggingFace-feil med standardisert respons.
 * Returnerer true hvis feilen ble håndtert (respons sendt), false ellers.
 */
export function handleHFError(
    res: Response,
    error: unknown,
    schema: ZodType,
    options?: {
        timeoutLabel?: string;
        timeoutMessage?: string;
        kontekst?: string;
    },
): boolean {
    const errorMessage = error instanceof Error ? error.message : String(error);
    const kontekst = options?.kontekst ?? "HuggingFace";

    logger.error({ err: error }, `${kontekst} feil`);

    // Timeout
    if (options?.timeoutLabel && errorMessage === options.timeoutLabel) {
        res.status(504).json(schema.parse({
            suksess: false,
            melding: options.timeoutMessage ?? "Forespørselen tok for lang tid. Prøv igjen.",
            response: "",
        }));
        return true;
    }

    // Rate limit
    if (errorMessage.includes("rate limit") || errorMessage.includes("429")) {
        res.status(429).json(schema.parse({
            suksess: false,
            melding: "For mange forespørsler. Vent litt og prøv igjen.",
            response: "",
        }));
        return true;
    }

    // Modell ikke funnet
    if (errorMessage.includes("model") && errorMessage.includes("not found")) {
        res.status(503).json(schema.parse({
            suksess: false,
            melding: "Modellen er midlertidig utilgjengelig. Prøv igjen senere.",
            response: "",
        }));
        return true;
    }

    // Kreditt-/faktureringsfeil fra HuggingFace
    if (errorMessage.includes("Credit balance") || errorMessage.includes("depleted") || errorMessage.includes("purchase")) {
        logger.warn("HuggingFace kreditt oppbrukt");
        res.status(503).json(schema.parse({
            suksess: false,
            melding: "KI-tjenesten er midlertidig utilgjengelig. Prøv igjen senere.",
            response: "",
        }));
        return true;
    }

    return false;
}
