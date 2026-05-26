/*
 * Canvas API Error Utilities - Backend-spesifikk feilhåndtering
 * Bruker delte typer fra common/canvasErrors
 */

// Re-eksporter brukte symboler fra common
export {
  type CanvasErrorCode,
  type CanvasErrorResponse,
  isRecoverableError,
  classifyHttpStatus,
  getErrorMessage,
  getHttpStatusForCode,
} from "common/canvasErrors";

import { type CanvasErrorCode, getErrorMessage, isRecoverableError } from "common/canvasErrors";

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
  },
): CanvasApiError {
  const error = new Error(message) as CanvasApiError;
  error.name = "CanvasApiError";
  error.code = code;
  error.httpStatus = options?.httpStatus;
  error.endpoint = options?.endpoint;
  error.details = options?.details;
  error.retryAfter = options?.retryAfter;
  error.recoverable = isRecoverableError(code);
  return error;
}

// Korte feil-labels for API-respons (brukes i `feil`-feltet)
const ERROR_LABELS: Record<CanvasErrorCode, string> = {
  token_invalid: "Ugyldig Canvas-token",
  token_missing: "Canvas-token mangler",
  permission_denied: "Ingen tilgang",
  resource_disabled: "Ressurs deaktivert",
  resource_not_found: "Ikke funnet",
  rate_limited: "For mange forespørsler",
  timeout: "Tidsavbrudd",
  server_error: "Serverfeil",
  network_error: "Nettverksfeil",
  validation_error: "Validering feilet",
  unknown: "Ukjent feil",
};

/**
 * Generer strukturert API feilrespons.
 * Bruker getErrorMessage() fra common for konsistente brukervenlige meldinger.
 */
export function getErrorResponse(
  code: CanvasErrorCode,
  details?: string,
): {
  feil: string;
  melding: string;
  kode: CanvasErrorCode;
  detaljer?: string;
} {
  return {
    feil: ERROR_LABELS[code] || ERROR_LABELS.unknown,
    melding: getErrorMessage(code),
    kode: code,
    detaljer: details,
  };
}
