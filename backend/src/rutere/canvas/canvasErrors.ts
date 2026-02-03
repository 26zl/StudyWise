/*
 * Canvas API Error Utilities - Backend-spesifikk feilhåndtering
 * Bruker delte typer fra common/canvasErrors
 */

// Re-eksporter alt fra common for enkel import
export {
  CanvasErrorCodeSchema,
  CanvasWarningSchema,
  CanvasErrorResponseSchema,
  type CanvasErrorCode,
  type CanvasWarning,
  type CanvasErrorResponse,
  requiresReauth,
  isRecoverableError,
  classifyHttpStatus,
  getErrorMessage,
  getHttpStatusForCode,
} from "common/canvasErrors";

import {
  type CanvasErrorCode,
  type CanvasWarning,
  getErrorMessage,
  classifyHttpStatus,
} from "common/canvasErrors";

// Backend-spesifikk: Strukturert Canvas-feil med all nødvendig info
export interface CanvasApiError extends Error {
  code: CanvasErrorCode;
  httpStatus?: number;
  endpoint?: string;
  details?: string;
  retryAfter?: number;
  recoverable: boolean;
}

/**
 * Opprett strukturert Canvas API-feil (backend)
 */
export function createCanvasError(
  code: CanvasErrorCode,
  message: string,
  options?: {
    httpStatus?: number;
    endpoint?: string;
    details?: string;
    retryAfter?: number;
  }
): CanvasApiError {
  const error = new Error(message) as CanvasApiError;
  error.name = "CanvasApiError";
  error.code = code;
  error.httpStatus = options?.httpStatus;
  error.endpoint = options?.endpoint;
  error.details = options?.details;
  error.retryAfter = options?.retryAfter;
  error.recoverable = ["rate_limited", "timeout", "server_error", "network_error"].includes(code);
  return error;
}

/**
 * Opprett advarsel fra feil (for delvis suksess i aggregerte endepunkter)
 */
export function createWarningFromError(
  error: unknown,
  resource: string,
  courseId?: number
): CanvasWarning {
  const canvasError = error as CanvasApiError;
  const code = canvasError.code || classifyHttpStatus(canvasError.httpStatus || 500);

  return {
    scope: courseId ? "course" : "global",
    resource,
    code,
    httpStatus: canvasError.httpStatus,
    message: getErrorMessage(code, resource),
    courseId,
  };
}

/**
 * Generer strukturert API feilrespons
 */
export function getErrorResponse(code: CanvasErrorCode, details?: string): {
  feil: string;
  melding: string;
  kode: CanvasErrorCode;
  detaljer?: string;
} {
  const baseMessages: Record<CanvasErrorCode, { feil: string; melding: string }> = {
    token_invalid: {
      feil: "Ugyldig Canvas-token",
      melding: "Canvas-tokenet ditt er ugyldig eller utløpt. Oppdater tokenet i innstillinger.",
    },
    token_missing: {
      feil: "Canvas-token mangler",
      melding: "Koble brukeren til Canvas før du bruker disse funksjonene.",
    },
    permission_denied: {
      feil: "Ingen tilgang",
      melding: "Du har ikke tilgang til denne ressursen i Canvas.",
    },
    resource_disabled: {
      feil: "Ressurs deaktivert",
      melding: "Denne funksjonen er deaktivert for dette emnet.",
    },
    resource_not_found: {
      feil: "Ikke funnet",
      melding: "Ressursen ble ikke funnet i Canvas.",
    },
    rate_limited: {
      feil: "For mange forespørsler",
      melding: "Canvas API er overbelastet. Vent noen sekunder og prøv igjen.",
    },
    timeout: {
      feil: "Tidsavbrudd",
      melding: "Forespørselen tok for lang tid. Prøv igjen.",
    },
    server_error: {
      feil: "Serverfeil",
      melding: "Canvas eller serveren opplever problemer. Prøv igjen senere.",
    },
    network_error: {
      feil: "Nettverksfeil",
      melding: "Kunne ikke nå Canvas. Sjekk nettverksforbindelsen.",
    },
    validation_error: {
      feil: "Validering feilet",
      melding: "Canvas returnerte uventet data-format.",
    },
    unknown: {
      feil: "Ukjent feil",
      melding: "En uventet feil oppstod.",
    },
  };

  const base = baseMessages[code] || baseMessages.unknown;
  return {
    ...base,
    kode: code,
    detaljer: details,
  };
}
