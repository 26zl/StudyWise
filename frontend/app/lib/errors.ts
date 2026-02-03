/*
 * Felles base-klasse for alle frontend feil.
 * Gir konsistent feilstruktur på tvers av moduler (KI, Canvas, Auth, etc.)
 */

import { type CanvasErrorCode } from "common/canvasErrors";

// Re-eksporter CanvasErrorCode for enkel tilgang
export type { CanvasErrorCode } from "common/canvasErrors";

// KI-spesifikke feilkoder
export type KIErrorCode =
    | "ki_auth"
    | "ki_rate_limit"
    | "ki_service"
    | "ki_timeout";

// Auth-spesifikke feilkoder
export type AuthErrorCode =
    | "auth_error"
    | "auth_expired";

// Alle feilkoder kombinert
export type AppErrorCode = CanvasErrorCode | KIErrorCode | AuthErrorCode;

/**
 * Base-klasse for alle applikasjonsfeil.
 * Alle spesifikke feilklasser bør arve fra denne.
 */
export abstract class AppError extends Error {
    /** Feilkode for programmatisk identifikasjon */
    abstract readonly code: AppErrorCode;

    /** HTTP status-kode (hvis relevant) */
    readonly httpStatus?: number;

    /** Om feilen er midlertidig og kan prøves på nytt */
    readonly retryable: boolean;

    constructor(
        message: string,
        options?: {
            httpStatus?: number;
            retryable?: boolean;
            cause?: Error;
        }
    ) {
        super(message, { cause: options?.cause });
        this.httpStatus = options?.httpStatus;
        this.retryable = options?.retryable ?? false;
    }

    /**
     * Sjekker om en ukjent feil er en AppError
     */
    static isAppError(error: unknown): error is AppError {
        return error instanceof AppError;
    }

    /**
     * Sjekker om feilen krever re-autentisering
     */
    requiresReauth(): boolean {
        return this.code === "auth_error" ||
               this.code === "auth_expired" ||
               this.code === "ki_auth" ||
               this.code === "token_invalid";
    }

    /**
     * Sjekker om feilen er en rate limit
     */
    isRateLimited(): boolean {
        return this.code === "ki_rate_limit" || this.code === "rate_limited";
    }
}

// ==================== KI Error Classes ====================

/**
 * KI autentiseringsfeil - bruker må logge inn på nytt
 */
export class KIAuthError extends AppError {
    readonly code = "ki_auth" as const;
    readonly name = "KIAuthError";

    constructor(message = "Ikke autentisert") {
        super(message, { httpStatus: 401 });
    }
}

/**
 * KI rate limit - for mange forespørsler
 */
export class KIRateLimitError extends AppError {
    readonly code = "ki_rate_limit" as const;
    readonly name = "KIRateLimitError";

    constructor(message = "For mange forespørsler") {
        super(message, { httpStatus: 429, retryable: true });
    }
}

/**
 * KI tjeneste utilgjengelig
 */
export class KIServiceError extends AppError {
    readonly code = "ki_service" as const;
    readonly name = "KIServiceError";

    constructor(message = "KI-tjenesten er utilgjengelig") {
        super(message, { httpStatus: 503, retryable: true });
    }
}

/**
 * KI timeout - forespørselen tok for lang tid
 */
export class KITimeoutError extends AppError {
    readonly code = "ki_timeout" as const;
    readonly name = "KITimeoutError";

    constructor(message = "Forespørselen tok for lang tid") {
        super(message, { httpStatus: 504, retryable: true });
    }
}

// ==================== Canvas Error Classes ====================

/**
 * Canvas token mangler
 */
export class CanvasTokenMissingError extends AppError {
    readonly code: CanvasErrorCode = "token_missing";
    readonly name = "CanvasTokenMissingError";

    constructor(message = "Canvas-token mangler") {
        super(message, { httpStatus: 403 });
    }
}

/**
 * Canvas token er ugyldig eller utløpt
 */
export class CanvasTokenInvalidError extends AppError {
    readonly code: CanvasErrorCode = "token_invalid";
    readonly name = "CanvasTokenInvalidError";

    constructor(message = "Canvas-token er ugyldig eller utløpt") {
        super(message, { httpStatus: 401 });
    }
}

/**
 * Canvas tilgangsfeil - brukeren har ikke tilgang til ressursen
 */
export class CanvasPermissionError extends AppError {
    readonly code: CanvasErrorCode = "permission_denied";
    readonly name = "CanvasPermissionError";

    constructor(message = "Du har ikke tilgang til denne ressursen") {
        super(message, { httpStatus: 403 });
    }
}

/**
 * Canvas ressurs deaktivert eller ikke funnet
 */
export class CanvasResourceError extends AppError {
    readonly code: CanvasErrorCode;
    readonly name = "CanvasResourceError";

    constructor(
        code: "resource_disabled" | "resource_not_found",
        message: string
    ) {
        super(message, { httpStatus: 404 });
        this.code = code;
    }
}

/**
 * Generisk Canvas API-feil
 */
export class CanvasApiError extends AppError {
    readonly code: CanvasErrorCode;
    readonly name = "CanvasApiError";

    constructor(
        code: CanvasErrorCode,
        message: string,
        httpStatus?: number
    ) {
        super(message, { httpStatus, retryable: code === "rate_limited" || code === "timeout" });
        this.code = code;
    }
}

// ==================== Auth Error Classes ====================

/**
 * Generisk autentiseringsfeil
 */
export class AuthError extends AppError {
    readonly code = "auth_error" as const;
    readonly name = "AuthError";

    constructor(message = "Autentisering feilet") {
        super(message, { httpStatus: 401 });
    }
}

/**
 * Sesjon utløpt - bruker må logge inn på nytt
 */
export class SessionExpiredError extends AppError {
    readonly code = "auth_expired" as const;
    readonly name = "SessionExpiredError";

    constructor(message = "Sesjonen har utløpt. Logg inn på nytt.") {
        super(message, { httpStatus: 401 });
    }
}
