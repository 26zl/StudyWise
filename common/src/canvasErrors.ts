/*
 * Canvas API Error Types - Delte feiltyper for frontend og backend
 * Strukturert feilhåndtering for Canvas API-kall
 */
import { z } from "zod";

// Stabile feilkoder som brukes på tvers av frontend og backend
export const CanvasErrorCodeSchema = z.enum([
  "token_invalid", // 401 - Token ugyldig/utløpt, krever re-autentisering
  "token_missing", // 403 fra vår backend - ingen token lagret
  "permission_denied", // 403 fra Canvas - bruker har ikke tilgang til ressursen
  "resource_disabled", // 404 - Ressursen er deaktivert i kurset (f.eks. Pages)
  "resource_not_found", // 404 - Ressursen finnes ikke
  "rate_limited", // 429 - For mange forespørsler
  "timeout", // Tidsavbrudd
  "server_error", // 5xx - Canvas/server-feil
  "network_error", // Nettverksfeil
  "validation_error", // Zod validering feilet
  "unknown", // Ukjent feil
]);

export type CanvasErrorCode = z.infer<typeof CanvasErrorCodeSchema>;

export const CanvasValidationIssueSchema = z.object({
  felt: z.string(),
  feil: z.string(),
});

export const CanvasErrorDetailsSchema = z
  .union([z.string(), z.array(CanvasValidationIssueSchema)])
  .optional();

// API feilrespons med strukturert feilkode
export const CanvasErrorResponseSchema = z.object({
  feil: z.string(),
  melding: z.string(),
  kode: CanvasErrorCodeSchema,
  detaljer: CanvasErrorDetailsSchema,
});

export type CanvasErrorResponse = z.infer<typeof CanvasErrorResponseSchema>;
export type CanvasValidationIssue = z.infer<typeof CanvasValidationIssueSchema>;
export type CanvasErrorDetails = z.infer<typeof CanvasErrorDetailsSchema>;

// Hjelpefunksjoner for feilklassifisering

/**
 * Sjekk om feilkode krever re-autentisering (nytt token)
 */
export function requiresReauth(code: CanvasErrorCode): boolean {
  return code === "token_invalid" || code === "token_missing";
}

/**
 * Sjekk om feil er gjenopprettbar (kan prøves igjen)
 */
export function isRecoverableError(code: CanvasErrorCode): boolean {
  return ["rate_limited", "timeout", "server_error", "network_error"].includes(
    code,
  );
}

/**
 * Klassifiser HTTP-status til feilkode
 */
export function classifyHttpStatus(
  status: number,
  errorBody?: string,
): CanvasErrorCode {
  const lowerBody = errorBody?.toLowerCase() || "";

  switch (status) {
    case 401:
      return "token_invalid";

    case 403:
      // Skille mellom "token mangler" (vår feil) og "permission denied" (Canvas)
      if (
        lowerBody.includes("unauthorized") ||
        lowerBody.includes("ikke autorisert")
      ) {
        return "permission_denied";
      }
      if (lowerBody.includes("token") && lowerBody.includes("mangler")) {
        return "token_missing";
      }
      return "permission_denied";

    case 404:
      // Skille mellom "deaktivert" og "finnes ikke"
      if (lowerBody.includes("deaktivert") || lowerBody.includes("disabled")) {
        return "resource_disabled";
      }
      return "resource_not_found";

    case 429:
      return "rate_limited";

    case 408:
    case 504:
      return "timeout";

    default:
      if (status >= 500) return "server_error";
      return "unknown";
  }
}

/**
 * Brukervenlige feilmeldinger basert på feilkode
 */
export function getErrorMessage(
  code: CanvasErrorCode,
  resource?: string,
): string {
  const resourceName = resource
    ? getResourceDisplayName(resource)
    : "ressursen";

  switch (code) {
    case "token_invalid":
      return "Canvas-tokenet ditt er ugyldig eller utløpt. Oppdater tokenet i innstillinger.";
    case "token_missing":
      return "Canvas-token mangler. Legg til tokenet i innstillinger.";
    case "permission_denied":
      return `Du har ikke tilgang til ${resourceName} i Canvas.`;
    case "resource_disabled":
      return `${capitalizeFirst(resourceName)} er deaktivert for dette emnet.`;
    case "resource_not_found":
      return `${capitalizeFirst(resourceName)} ble ikke funnet i Canvas.`;
    case "rate_limited":
      return "For mange forespørsler til Canvas. Vent noen sekunder og prøv igjen.";
    case "timeout":
      return "Forespørselen tok for lang tid. Prøv igjen.";
    case "server_error":
      return "Canvas-serveren opplever problemer. Prøv igjen senere.";
    case "network_error":
      return "Nettverksfeil. Sjekk internettforbindelsen din.";
    case "validation_error":
      return "Canvas returnerte uventet data-format.";
    default:
      return "En uventet feil oppstod.";
  }
}

/**
 * HTTP-statuskode for en gitt feilkode
 */
export function getHttpStatusForCode(code: CanvasErrorCode): number {
  switch (code) {
    case "token_invalid":
      return 401;
    case "token_missing":
    case "permission_denied":
      return 403;
    case "resource_disabled":
    case "resource_not_found":
      return 404;
    case "rate_limited":
      return 429;
    case "timeout":
      return 504;
    case "network_error":
      return 502;
    case "server_error":
      return 502;
    case "validation_error":
      return 500;
    default:
      return 500;
  }
}

// Hjelpefunksjoner (private)

function getResourceDisplayName(resource: string): string {
  const names: Record<string, string> = {
    files: "filer",
    pages: "sider",
    modules: "moduler",
    assignments: "oppgaver",
    announcements: "kunngjøringer",
    discussions: "diskusjoner",
    frontpage: "forsiden",
    calendar: "kalenderen",
    todo: "gjøremålslisten",
  };
  return names[resource] || resource;
}
// Stor bokstav først
function capitalizeFirst(str: string): string {
  return str.charAt(0).toUpperCase() + str.slice(1);
}
