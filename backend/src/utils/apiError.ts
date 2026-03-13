/*
 * Standardisert API-feilhåndtering for backend.
 * Gir konsistente feilresponser på tvers av alle ruter.
 */

import type { Request, Response } from "express";
import { ZodError } from "zod";
import { logger } from "./logger.js";

// Standard feilresponse-format
export interface ApiErrorResponse {
    feil: string;
    melding: string;
    kode?: string;
    detaljer?: unknown;
}

// Feilkoder som brukes på tvers av backend
export type ApiErrorCode =
    | "validation_error"
    | "auth_error"
    | "forbidden"
    | "not_found"
    | "conflict"
    | "rate_limited"
    | "timeout"
    | "server_error"
    | "service_unavailable";

// Standard HTTP-statuskoder for feilkoder
const ERROR_CODE_STATUS: Record<ApiErrorCode, number> = {
    validation_error: 400,
    auth_error: 401,
    forbidden: 403,
    not_found: 404,
    conflict: 409,
    rate_limited: 429,
    timeout: 504,
    server_error: 500,
    service_unavailable: 503,
};

// Standard feilmeldinger
const ERROR_MESSAGES: Record<ApiErrorCode, string> = {
    validation_error: "Ugyldig forespørsel",
    auth_error: "Ikke autentisert",
    forbidden: "Manglende tilgang",
    not_found: "Ressurs ikke funnet",
    conflict: "Konflikt med eksisterende data",
    rate_limited: "For mange forespørsler",
    timeout: "Forespørselen tok for lang tid",
    server_error: "Intern serverfeil",
    service_unavailable: "Tjenesten er midlertidig utilgjengelig",
};

/**
 * Sender en standardisert feilrespons.
 */
export function sendError(
    res: Response,
    kode: ApiErrorCode,
    options?: {
        feil?: string;
        melding?: string;
        detaljer?: unknown;
        status?: number;
    }
): void {
    const status = options?.status ?? ERROR_CODE_STATUS[kode];
    const fallbackMelding =
        typeof options?.detaljer === "string" && options.detaljer.trim().length > 0
            ? options.detaljer
            : options?.feil ?? ERROR_MESSAGES[kode];
    const response: ApiErrorResponse = {
        feil: options?.feil ?? ERROR_MESSAGES[kode],
        melding: options?.melding ?? fallbackMelding,
        kode,
    };
    if (options?.detaljer !== undefined) {
        response.detaljer = options.detaljer;
    }

    res.status(status).json(response);
}

/**
 * Håndterer ZodError og sender standardisert respons.
 */
export function sendZodError(res: Response, error: ZodError, kontekst?: string): void {
    const issues = error.issues.map((issue) => ({
        felt: issue.path.join("."),
        feil: issue.message,
    }));
    const førsteFeil = issues[0]?.feil;

    sendError(res, "validation_error", {
        feil: kontekst ? `Valideringsfeil: ${kontekst}` : "Valideringsfeil i forespørsel",
        melding: førsteFeil,
        detaljer: issues,
    });
}

/**
 * Håndterer ukjente feil og logger dem.
 * Valgfri melding vises til brukeren; ellers brukes standardtekst.
 */
export function sendUnknownError(
    res: Response,
    error: unknown,
    logContext?: Record<string, unknown> & { melding?: string }
): void {
    const errorMessage = error instanceof Error ? error.message : String(error);
    const { melding: brukerMelding, ...context } = logContext ?? {};

    logger.error(
        { err: error, ...context },
        `Ukjent feil: ${errorMessage.substring(0, 100)}`
    );

    sendError(res, "server_error", {
        melding: brukerMelding ?? "Noe gikk galt. Prøv igjen senere.",
    });
}

/**
 * Hjelpefunksjoner for vanlige feiltyper
 */
export const apiError = {
    // Autentisering
    unauthorized: (res: Response, melding?: string) =>
        sendError(res, "auth_error", { melding }),

    // Autorisering (rolle/tilgang)
    forbidden: (res: Response, melding?: string) =>
        sendError(res, "forbidden", { melding: melding ?? "Manglende tilgang" }),

    // Validering
    badRequest: (res: Response, feil: string, detaljer?: unknown) =>
        sendError(res, "validation_error", { feil, detaljer }),

    // Ikke funnet
    notFound: (res: Response, ressurs = "Ressurs") =>
        sendError(res, "not_found", { feil: `${ressurs} ble ikke funnet` }),

    // Konflikt
    conflict: (res: Response, melding: string) =>
        sendError(res, "conflict", { melding }),

    // Rate limit
    rateLimited: (res: Response, melding?: string) =>
        sendError(res, "rate_limited", {
            melding: melding ?? "Vent litt og prøv igjen.",
        }),

    // Timeout
    timeout: (res: Response, melding?: string) =>
        sendError(res, "timeout", {
            melding: melding ?? "Prøv igjen.",
        }),

    // Service utilgjengelig
    serviceUnavailable: (res: Response, tjeneste?: string) =>
        sendError(res, "service_unavailable", {
            melding: tjeneste
                ? `${tjeneste} er midlertidig utilgjengelig. Prøv igjen senere.`
                : "Prøv igjen senere.",
        }),

    // Server error
    serverError: (res: Response) => sendError(res, "server_error"),
};

/**
 * Henter bruker-ID fra req.user, sender 401 hvis mangler.
 * Returnerer userId eller null (null betyr respons allerede sendt).
 */
export function requireUserId(req: Request, res: Response): string | null {
    const userId = req.user?.id;
    if (!userId) {
        apiError.unauthorized(res);
        return null;
    }
    return userId;
}
