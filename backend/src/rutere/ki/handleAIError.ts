/*
 * Sentralisert feilhåndtering for AI-kall (Claude)
 * Brukes av ki.ts, kiAnalyse.ts og kiOppsummering.ts
 */

import type { Response } from "express";
import type { ZodType } from "zod";
import { logger } from "../../utils/logger.js";

/**
 * Parser feilrespons med riktig skjema.
 * Noen skjemaer (KIChatResponseSchema, KIDocumentAnalyseResponseSchema) krever `response`,
 * mens andre (KIOppsummeringResponseSchema) ikke har det feltet.
 */
function parseErrorResponse(schema: ZodType, melding: string): unknown {
    // Prøv med response-felt først (for skjemaer som krever det)
    const withResponse = schema.safeParse({ suksess: false, melding, response: "" });
    if (withResponse.success) return withResponse.data;

    // Fallback uten response-felt (for KIOppsummeringResponseSchema o.l.)
    return schema.parse({ suksess: false, melding });
}

/**
 * Håndterer vanlige AI-feil med standardisert respons.
 * Returnerer true hvis feilen ble håndtert (respons sendt), false ellers.
 */
export function handleAIError(
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
    const kontekst = options?.kontekst ?? "AI";

    logger.error({ err: error }, `${kontekst} feil`);

    // Timeout
    if (options?.timeoutLabel && errorMessage === options.timeoutLabel) {
        const melding = options.timeoutMessage ?? "Forespørselen tok for lang tid. Prøv igjen.";
        res.status(504).json(parseErrorResponse(schema, melding));
        return true;
    }

    // Tom for tokens/kreditt på Claude-konto (Anthropic) – sjekk FØRST slik at vi ikke viser «rate limit» når kontoen bare er tom
    const lower = errorMessage.toLowerCase();
    if (
        errorMessage.includes("Credit balance") ||
        errorMessage.includes("depleted") ||
        errorMessage.includes("purchase") ||
        errorMessage.includes("insufficient_quota") ||
        errorMessage.includes("billing") ||
        lower.includes("out of credits") ||
        lower.includes("insufficient credits") ||
        lower.includes("quota exceeded") ||
        lower.includes("no credits")
    ) {
        logger.warn(`${kontekst}: kreditt/tokens oppbrukt på Claude-konto`);
        res.status(503).json(parseErrorResponse(
            schema,
            "Kontokreditt for KI-tjenesten er oppbrukt. Fyll på kreditt i Anthropic (Claude)-kontoen eller prøv igjen senere.",
        ));
        return true;
    }

    // Rate limit (ekte 429 / for mange forespørsler)
    if (errorMessage.includes("rate limit") || errorMessage.includes("429") || errorMessage.includes("rate_limit")) {
        res.status(429).json(parseErrorResponse(schema, "For mange forespørsler. Vent litt og prøv igjen."));
        return true;
    }

    // Modell ikke funnet
    if (errorMessage.includes("model") && errorMessage.includes("not found")) {
        res.status(503).json(parseErrorResponse(schema, "Modellen er midlertidig utilgjengelig. Prøv igjen senere."));
        return true;
    }

    // Anthropic overloaded
    if (errorMessage.includes("overloaded") || errorMessage.includes("529")) {
        res.status(503).json(parseErrorResponse(schema, "KI-tjenesten er overbelastet. Prøv igjen om litt."));
        return true;
    }

    return false;
}
