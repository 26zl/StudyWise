/*
 * Sentralisert feilhåndtering for AI-kall (Claude)
 * Brukes av ki.ts, kiAnalyse.ts og kiOppsummering.ts
 */

import type { Response } from "express";
import { ZodError, type ZodType } from "zod";
import { logger } from "../../utils/logger.js";
import { CircuitBreakerError } from "../../utils/circuitBreaker.js";
import { apiError, sendError } from "../../utils/apiError.js";
import {
    isClientAvailable,
    getMissingClientError,
    recordAnthropicCreditFailure,
} from "./aiClient.js";

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

/** Kategori av AI-feil som styrer valg av brukermelding og statuskode. */
export type AIErrorCategory =
    | "credit_exhausted"
    | "auth_error"
    | "rate_limit"
    | "overloaded"
    | "model_not_found"
    | "timeout"
    | "circuit_breaker"
    | "generic";

export interface ClassifiedAIError {
    category: AIErrorCategory;
    /** Bruker-rettet melding på norsk, trygg å vise i chat eller toast. */
    userMessage: string;
    /** HTTP-statuskode som matcher feiltypen. */
    status: number;
}

/**
 * Henter kombinert feilmelding fra hele error-kjeden. ai-sdk pakker
 * underliggende APICallError inn i NoOutputGeneratedError, så den originale
 * "Credit balance too low"-teksten bor på error.cause (eller error.data).
 */
function extractErrorText(error: unknown): string {
    const parts: string[] = [];
    let current: unknown = error;
    let depth = 0;
    while (current && depth < 5) {
        if (current instanceof Error) {
            if (current.message) parts.push(current.message);
            // ai-sdk AI_APICallError har ofte en data.error.message med den
            // faktiske Anthropic-responsen ("Credit balance is too low...").
            const dataBlock = (current as { data?: unknown }).data;
            if (
                dataBlock
                && typeof dataBlock === "object"
                && "error" in dataBlock
                && typeof (dataBlock as { error?: { message?: unknown } }).error?.message === "string"
            ) {
                parts.push((dataBlock as { error: { message: string } }).error.message);
            }
            // responseBody kan inneholde rå JSON med message-feltet
            const body = (current as { responseBody?: unknown }).responseBody;
            if (typeof body === "string") parts.push(body);
            current = (current as { cause?: unknown }).cause;
        } else if (typeof current === "string") {
            parts.push(current);
            break;
        } else {
            break;
        }
        depth++;
    }
    return parts.join(" | ");
}

/**
 * Klassifiserer en vilkårlig AI-feil til en kategori og brukermelding.
 * Brukes både av JSON-response-flyten (`handleAIError`) og SSE-flyten
 * (hvor vi allerede har sendt status 200 og må sende feil via stream).
 */
export function classifyAIError(
    error: unknown,
    options?: { timeoutLabel?: string; timeoutMessage?: string },
): ClassifiedAIError {
    if (error instanceof CircuitBreakerError) {
        return {
            category: "circuit_breaker",
            userMessage: error.message,
            status: 503,
        };
    }

    const errorMessage = extractErrorText(error);
    const lower = errorMessage.toLowerCase();
    const errorStatus =
        typeof error === "object"
        && error !== null
        && "status" in error
        && typeof (error as { status?: unknown }).status === "number"
            ? (error as { status: number }).status
            : undefined;

    // Timeout — eksplisitt label-match fra kallsted (SSE-ruter setter dette
    // når de vet hvilken etikett deres timeout-wrapper bruker).
    if (options?.timeoutLabel && errorMessage.includes(options.timeoutLabel)) {
        return {
            category: "timeout",
            userMessage:
                options.timeoutMessage ?? "Forespørselen tok for lang tid. Prøv igjen.",
            status: 504,
        };
    }

    // Generisk timeout-fallback: fanger provider-feil ("Request timeout",
    // "timeout exceeded", "operation timed out") og AbortSignal-aborter uten
    // at kallstedet må vite den eksakte etiketten. JSON-ruter (taskBreakdown
    // m.fl.) kan lene seg på denne i stedet for å sette timeoutLabel.
    if (lower.includes("timeout") || lower.includes("timed out")) {
        return {
            category: "timeout",
            userMessage:
                options?.timeoutMessage ?? "Forespørselen tok for lang tid. Prøv igjen.",
            status: 504,
        };
    }

    // Kredit/tokens tomt — sjekkes FØR rate limit.
    // NB: `extractErrorText` slår sammen message + data.error.message +
    // responseBody, så vi må være forsiktige med substringer som kan dukke
    // opp i hjelpe-URLer eller generisk feiltekst. "billing" alene er for
    // bredt (fins i mange Anthropic-feilmeldinger som peker til billing-
    // docs uten å bety at kontoen er tom). Anchor-er derfor til enten
    // HTTP 402 (Payment Required) eller spesifikke "billing error/issue/
    // required"-fraser.
    if (
        lower.includes("credit balance")
        || lower.includes("insufficient_quota")
        || lower.includes("out of credits")
        || lower.includes("insufficient credits")
        || lower.includes("quota exceeded")
        || lower.includes("no credits")
        || lower.includes("purchase credits")
        || lower.includes("credits depleted")
        || lower.includes("credit depleted")
        || errorStatus === 402
        || lower.includes("billing error")
        || lower.includes("billing issue")
        || lower.includes("billing required")
    ) {
        // Signal til helsesjekken at Anthropic skal markeres som "down" —
        // /v1/models-pingen kan ikke oppdage tom konto alene.
        recordAnthropicCreditFailure();
        return {
            category: "credit_exhausted",
            userMessage:
                "Kontokreditt for KI-tjenesten er oppbrukt. Kontakt administrator, eller prøv igjen senere.",
            status: 503,
        };
    }

    // Auth / konfig
    if (
        errorStatus === 401
        || errorStatus === 403
        || lower.includes("authentication_error")
        || lower.includes("invalid x-api-key")
        || lower.includes("invalid api key")
        || (lower.includes("api key") && lower.includes("invalid"))
        || lower.includes("unauthorized")
        || lower.includes("permission denied")
        || lower.includes("forbidden")
    ) {
        return {
            category: "auth_error",
            userMessage:
                "KI-tjenesten er ikke konfigurert riktig akkurat nå. Kontakt administrator.",
            status: 503,
        };
    }

    // Rate limit
    if (
        lower.includes("rate limit")
        || lower.includes("rate_limit")
        || errorMessage.includes("429")
    ) {
        return {
            category: "rate_limit",
            userMessage: "For mange forespørsler. Vent litt og prøv igjen.",
            status: 429,
        };
    }

    // Modell ikke funnet
    if (lower.includes("model") && lower.includes("not found")) {
        return {
            category: "model_not_found",
            userMessage: "Modellen er midlertidig utilgjengelig. Prøv igjen senere.",
            status: 503,
        };
    }

    // Overloaded
    if (lower.includes("overloaded") || errorMessage.includes("529")) {
        return {
            category: "overloaded",
            userMessage: "KI-tjenesten er overbelastet. Prøv igjen om litt.",
            status: 503,
        };
    }

    return {
        category: "generic",
        userMessage: "Kunne ikke få svar fra KI-assistenten. Prøv igjen senere.",
        status: 500,
    };
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
    const kontekst = options?.kontekst ?? "AI";
    logger.error({ err: error }, `${kontekst} feil`);

    const classified = classifyAIError(error, {
        timeoutLabel: options?.timeoutLabel,
        timeoutMessage: options?.timeoutMessage,
    });

    if (classified.category === "credit_exhausted") {
        logger.warn(`${kontekst}: kreditt/tokens oppbrukt på Claude-konto`);
    } else if (classified.category === "auth_error") {
        logger.error({ err: error }, `${kontekst}: Anthropic auth/config-feil`);
    } else if (classified.category === "generic") {
        logger.warn({ err: error }, "Uhåndtert AI-feil — sender generisk feilmelding");
    }

    res.status(classified.status).json(
        parseErrorResponse(schema, classified.userMessage),
    );
    return true;
}

/**
 * Håndterer vanlige AI-feil for JSON-ruter som bruker apiError/sendUnknownError
 * i stedet for skjema-baserte feilresponser.
 */
export function handleAIJsonRouteError(
    res: Response,
    error: unknown,
    options: {
        kontekst?: string;
        /** Etikett som identifiserer timeout-feil i error-meldingen (f.eks. "Quiz-generering"). */
        timeoutLabel?: string;
        timeoutMessage?: string;
        invalidResponseMessage?: string;
        invalidResponseTest?: (error: unknown) => boolean;
    } = {},
): boolean {
    const errorMessage = error instanceof Error ? error.message : String(error);
    const lower = errorMessage.toLowerCase();
    const kontekst = options.kontekst ?? "AI";
    const isJsonSyntaxError =
        error instanceof SyntaxError &&
        (lower.includes("json") ||
            lower.includes("unexpected token") ||
            lower.includes("unexpected end") ||
            lower.includes("unterminated"));

    logger.error({ err: error }, `${kontekst} feil`);

    // ZodError / JSON-parse-feil håndteres separat (disse er ikke AI-provider-
    // feil, men responsformat-feil som vi ønsker å synliggjøre til kaller).
    if (
        error instanceof ZodError ||
        isJsonSyntaxError ||
        options.invalidResponseTest?.(error)
    ) {
        apiError.badRequest(
            res,
            options.invalidResponseMessage ?? "KI-responsen kunne ikke tolkes",
        );
        return true;
    }

    // Bruk samme klassifiserer som SSE-flyten — gir korrekt melding + status,
    // og trigger recordAnthropicCreditFailure når kreditt er oppbrukt.
    const classified = classifyAIError(error, {
        timeoutLabel: options.timeoutLabel,
        timeoutMessage:
            options.timeoutMessage ?? "Genereringen tok for lang tid. Prøv igjen.",
    });

    if (classified.category === "timeout") {
        apiError.timeout(res, classified.userMessage);
        return true;
    }
    if (classified.category === "rate_limit") {
        apiError.rateLimited(res, classified.userMessage);
        return true;
    }
    // circuit_breaker, credit_exhausted, auth_error, overloaded, model_not_found,
    // generic → 503 med klassifisererens ferdig-formulerte brukermelding.
    // NB: apiError.serviceUnavailable(res, navn) legger selv på
    // "er midlertidig utilgjengelig…"-suffiks, så den ville gitt dobbel-melding
    // her — vi bruker sendError direkte for å unngå det.
    sendError(res, "service_unavailable", { melding: classified.userMessage });
    return true;
}

/**
 * Sjekker at AI-klienten er tilgjengelig for gitt modell.
 * Returnerer true (håndtert, respons sendt) hvis IKKE tilgjengelig, false hvis alt OK.
 * Brukes i KI-ruter for å unngå duplisert isClientAvailable-sjekk.
 *
 * @example
 * if (checkAIClientUnavailable(res, model, KIChatResponseSchema)) return;
 */
export function checkAIClientUnavailable(res: Response, model: string, schema: ZodType): boolean {
    if (isClientAvailable(model)) return false;
    logger.error(getMissingClientError(model));
    res.status(500).json(parseErrorResponse(schema, "KI-tjenesten er ikke konfigurert. Kontakt administrator."));
    return true;
}
