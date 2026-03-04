/*
 * Felles feilhåndtering og brukervennlige feilmeldinger
 * Samler all feilmeldingslogikk på ett sted for konsistens
 */

import {
  type CanvasErrorCode,
  getErrorMessage as getCanvasErrorMessage,
} from "common/canvasErrors";

// Interface for strukturerte Canvas-feil med feilkode
interface StructuredCanvasError extends Error {
  code?: CanvasErrorCode;
  httpStatus?: number;
}

// Feiltyper som kan identifiseres
export type FeilType =
  | "auth"
  | "token"
  | "rate_limit"
  | "timeout"
  | "network"
  | "not_found"
  | "forbidden"
  | "server"
  | "validation"
  | "unknown";

// Identifiser feiltype basert på feilmelding eller HTTP-status
export function identifiserFeiltype(
  error: Error | string | null,
  status?: number,
): FeilType {
  const msg = typeof error === "string" ? error : error?.message || "";
  const name = typeof error === "object" && error !== null ? error.name : "";

  // Sjekk error.name først (for spesialiserte feilklasser)
  if (name === "KIAuthError" || name === "CanvasTokenMissingError")
    return "auth";
  if (name === "KIRateLimitError") return "rate_limit";
  if (name === "KITimeoutError") return "timeout";
  if (name === "KIServiceError") return "server";

  // Sjekk HTTP status
  if (status === 401) return "auth";
  if (status === 403) return "forbidden";
  if (status === 404) return "not_found";
  if (status === 429) return "rate_limit";
  if (status === 504 || status === 408) return "timeout";
  if (status && status >= 500) return "server";

  // Sjekk feilmelding
  const lowerMsg = msg.toLowerCase();

  if (
    lowerMsg.includes("401") ||
    lowerMsg.includes("unauthorized") ||
    lowerMsg.includes("ugyldig")
  ) {
    return "auth";
  }
  if (
    lowerMsg.includes("403") ||
    lowerMsg.includes("forbidden") ||
    lowerMsg.includes("ingen tilgang")
  ) {
    return "forbidden";
  }
  if (
    lowerMsg.includes("404") ||
    lowerMsg.includes("not found") ||
    lowerMsg.includes("finnes ikke")
  ) {
    return "not_found";
  }
  if (
    lowerMsg.includes("429") ||
    lowerMsg.includes("rate") ||
    lowerMsg.includes("for mange")
  ) {
    return "rate_limit";
  }
  if (
    lowerMsg.includes("timeout") ||
    lowerMsg.includes("504") ||
    lowerMsg.includes("tok for lang")
  ) {
    return "timeout";
  }
  if (
    lowerMsg.includes("network") ||
    lowerMsg.includes("fetch") ||
    lowerMsg.includes("nettverksfeil")
  ) {
    return "network";
  }
  if (
    lowerMsg.includes("token") &&
    (lowerMsg.includes("mangler") || lowerMsg.includes("missing"))
  ) {
    return "token";
  }
  if (lowerMsg.includes("validering") || lowerMsg.includes("ugyldig format")) {
    return "validation";
  }

  return "unknown";
}

// Kontekst-spesifikke feilmeldinger
interface FeilmeldingKontekst {
  canvas?: boolean;
  ki?: boolean;
  auth?: boolean;
  kalender?: boolean;
}

// Hent brukervennlig feilmelding basert på feiltype og kontekst
export function lagBrukervennligFeilmelding(
  error: Error | string | null,
  kontekst: FeilmeldingKontekst = {},
  fallback = "Noe gikk galt. Prøv igjen.",
): string {
  // Sjekk for strukturert Canvas-feilkode først (høyeste prioritet)
  if (kontekst.canvas && error && typeof error === "object") {
    const structuredError = error as StructuredCanvasError;
    if (structuredError.code) {
      return getCanvasErrorMessage(structuredError.code);
    }
  }

  // Identifiser feiltype
  const feiltype = identifiserFeiltype(error);

  // Canvas-spesifikke meldinger
  if (kontekst.canvas) {
    switch (feiltype) {
      case "auth":
      case "token":
        return "Canvas-tokenet ditt er ugyldig eller utløpt. Oppdater tokenet i innstillinger.";
      case "forbidden":
        return "Du har ikke tilgang til denne ressursen i Canvas.";
      case "rate_limit":
        return "For mange forespørsler til Canvas. Vent noen sekunder og prøv igjen.";
      case "timeout":
        return "Henting av Canvas-data tok for lang tid. Prøv igjen.";
      case "not_found":
        return "Ressursen ble ikke funnet i Canvas.";
      case "network":
        return "Kunne ikke koble til Canvas. Sjekk internettforbindelsen din.";
    }
  }

  // KI-spesifikke meldinger
  if (kontekst.ki) {
    switch (feiltype) {
      case "auth":
        return "Du må logge inn på nytt for å bruke KI-assistenten.";
      case "rate_limit":
        return "For mange forespørsler. Vent noen sekunder og prøv igjen.";
      case "timeout":
        return "Forespørselen tok for lang tid. Prøv å forenkle spørsmålet ditt.";
      case "server":
        return "KI-tjenesten er midlertidig utilgjengelig. Prøv igjen om noen minutter.";
      case "network":
        return "Kunne ikke koble til KI-tjenesten. Sjekk internettforbindelsen din.";
    }
  }

  // Auth-spesifikke meldinger
  if (kontekst.auth) {
    switch (feiltype) {
      case "auth":
        return "Feil e-post eller passord. Sjekk at du har skrevet riktig.";
      case "not_found":
        return "Ingen bruker med denne e-postadressen. Opprett en konto først.";
      case "rate_limit":
        return "For mange forsøk. Vent noen minutter og prøv igjen.";
      case "validation":
        return "Ugyldig e-postadresse eller passord. Sjekk at formatet er riktig.";
    }
  }

  // Kalender-spesifikke meldinger
  if (kontekst.kalender) {
    switch (feiltype) {
      case "auth":
      case "token":
        return "Canvas-token mangler eller er ugyldig. Legg til tokenet i innstillinger.";
      case "rate_limit":
        return "For mange forespørsler. Vent noen sekunder og prøv igjen.";
      case "timeout":
        return "Henting av kalenderdata tok for lang tid. Prøv igjen.";
    }
  }

// Generiske meldinger
  switch (feiltype) {
    case "auth":
      return "Du må logge inn på nytt.";
    case "forbidden":
      return "Du har ikke tilgang til denne ressursen.";
    case "rate_limit":
      return "For mange forespørsler. Vent litt og prøv igjen.";
    case "timeout":
      return "Forespørselen tok for lang tid. Prøv igjen.";
    case "network":
      return "Nettverksfeil. Sjekk internettforbindelsen din.";
    case "not_found":
      return "Ressursen ble ikke funnet.";
    case "server":
      return "Serverfeil. Prøv igjen om litt.";
    case "validation":
      return "Ugyldig data. Sjekk at alle felt er fylt ut riktig.";
    default: {
      // Hvis vi har en feilmelding, bruk den (men oversett vanlige engelske)
      const msg = typeof error === "string" ? error : error?.message;
      if (msg && msg.length < 200) {
        return msg;
      }
      return fallback;
    }
  }
}

/**
 * Parser en feilrespons fra backend.
 * Prøver å tolke JSON-body med { melding, feil } felter,
 * faller tilbake til ren tekst eller en standardmelding.
 */
export async function parseApiError(
  res: Response,
  fallback = "API feil",
): Promise<string> {
  const errorText = await res.text();
  try {
    const error = JSON.parse(errorText);
    return error.melding || error.feil || fallback;
  } catch {
    return errorText || fallback;
  }
}
