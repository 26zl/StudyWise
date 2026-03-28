/*
 * Felles feilhåndtering og brukervennlige feilmeldinger
 * Samler all feilmeldingslogikk på ett sted for konsistens
 */

import {
  type CanvasErrorCode,
  type CanvasValidationIssue,
  getErrorMessage as getCanvasErrorMessage,
} from "common/canvasErrors";
import type { Translator } from "@/app/i18n/types";
import { ForbiddenError, SessionExpiredError } from "./errors";

// Interface for strukturerte Canvas-feil med feilkode
interface StructuredCanvasError extends Error {
  code?: CanvasErrorCode;
  httpStatus?: number;
}

export interface ApiErrorPayload {
  feil?: string;
  melding?: string;
  kode?: string;
  detaljer?: unknown;
  canvasKonflikt?: boolean;
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
  | "conflict"
  | "unknown";

/** Sjekk om en feilmelding indikerer et ugyldig/manglende/utløpt token. */
export function erTokenFeilmelding(msg: string): boolean {
  const lower = msg.toLowerCase();
  return (
    lower.includes("token") &&
    (lower.includes("ugyldig") ||
      lower.includes("mangler") ||
      lower.includes("utløpt"))
  );
}

export function identifiserFeiltype(
  error: Error | string | null,
  status?: number,
): FeilType {
  const msg = typeof error === "string" ? error : error?.message || "";
  const name = typeof error === "object" && error !== null ? error.name : "";

  // Sjekk error.name først (for spesialiserte feilklasser)
  if (
    name === "KIAuthError" ||
    name === "CanvasTokenMissingError" ||
    name === "CanvasTokenInvalidError" ||
    name === "SessionExpiredError" ||
    name === "AuthError"
  )
    return "auth";
  if (name === "KIRateLimitError") return "rate_limit";
  if (name === "KITimeoutError") return "timeout";
  if (name === "KIServiceError") return "server";

  // Sjekk HTTP status
  if (status === 401) return "auth";
  if (status === 403) return "forbidden";
  if (status === 404) return "not_found";
  if (status === 409) return "conflict";
  if (status === 429) return "rate_limit";
  if (status === 504 || status === 408) return "timeout";
  if (status && status >= 500) return "server";

  // Sjekk feilmelding
  const lowerMsg = msg.toLowerCase();

  if (
    lowerMsg.includes("401") ||
    lowerMsg.includes("unauthorized") ||
    lowerMsg.includes("ikke autentisert") ||
    erTokenFeilmelding(msg)
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
    lowerMsg.includes("for mange") ||
    lowerMsg.includes("grensen for forespørsler") ||
    lowerMsg.includes("vennligst prøv igjen senere")
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
  if (
    lowerMsg.includes("validering") ||
    lowerMsg.includes("ugyldig format") ||
    lowerMsg.includes("canvas-url") ||
    lowerMsg.includes("canvas url") ||
    lowerMsg.includes("canvas-instans") ||
    lowerMsg.includes("institusjon") ||
    lowerMsg.includes("må være en canvas-instans")
  ) {
    return "validation";
  }
  if (
    lowerMsg.includes("409") ||
    (lowerMsg.includes("eksisterer") && lowerMsg.includes("allerede")) ||
    lowerMsg.includes("finnes allerede")
  ) {
    return "conflict";
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

/** Fallback for feil ved lasting av brukerdata (/me). Én kilde for DashboardView og oversikt. */
const BRUKERDATA_FEIL_FALLBACK = "Kunne ikke laste brukerdata. Sjekk internettforbindelsen og prøv igjen.";

function hentTekst(
  t: Translator | undefined,
  key: Parameters<Translator>[0],
  fallback: string,
): string {
  return t ? t(key) : fallback;
}

/** Brukervennlig feilmelding for feil ved henting av brukerdata (auth-kontekst, inkl. 429 rate limit). */
export function getBrukerdataFeilmelding(
  error: Error | string | null | undefined,
  t?: Translator,
): string {
  const msg = typeof error === "string" ? error : error?.message || "";
  if (/sesjon|logg inn på nytt|ikke autentisert/i.test(msg)) {
    return hentTekst(t, "errors.userData.sessionExpired", "Sesjonen har utløpt. Logg inn på nytt.");
  }
  return lagBrukervennligFeilmelding(
    error ?? null,
    { auth: true },
    t ? t("errors.userData.generic") : BRUKERDATA_FEIL_FALLBACK,
    t,
  );
}

// Hent brukervennlig feilmelding basert på feiltype og kontekst
export function lagBrukervennligFeilmelding(
  error: Error | string | null,
  kontekst: FeilmeldingKontekst = {},
  fallback = "Noe gikk galt. Prøv igjen.",
  t?: Translator,
): string {
  // Sjekk for strukturert Canvas-feilkode først (høyeste prioritet)
  if (kontekst.canvas && error && typeof error === "object") {
    const structuredError = error as StructuredCanvasError;
    if (structuredError.code) {
      if (
        structuredError.code === "validation_error" ||
        structuredError.code === "unknown"
      ) {
        const directMessage = structuredError.message?.trim();
        if (directMessage) {
          return directMessage;
        }
      }
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
        return hentTekst(
          t,
          "errors.canvas.tokenInvalid",
          "Canvas-tokenet ditt er ugyldig eller utløpt. Oppdater tokenet i innstillinger.",
        );
      case "forbidden":
        return hentTekst(t, "errors.canvas.permissionDenied", "Du har ikke tilgang til denne ressursen i Canvas.");
      case "rate_limit":
        return hentTekst(
          t,
          "errors.canvas.rateLimit",
          "For mange forespørsler til Canvas. Vent noen sekunder og prøv igjen.",
        );
      case "timeout":
        return hentTekst(t, "errors.canvas.timeout", "Henting av Canvas-data tok for lang tid. Prøv igjen.");
      case "not_found":
        return hentTekst(t, "errors.canvas.notFound", "Ressursen ble ikke funnet i Canvas.");
      case "validation": {
        const msg = typeof error === "string" ? error : error?.message;
        if (msg) {
          return msg.length <= 300 ? msg : `${msg.slice(0, 297)}…`;
        }
        return hentTekst(
          t,
          "errors.canvas.validation",
          "Sjekk at Canvas-institusjon og URL er riktig, og prøv igjen.",
        );
      }
      case "network":
        return hentTekst(t, "errors.canvas.network", "Kunne ikke koble til Canvas. Sjekk internettforbindelsen din.");
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

  // Auth-spesifikke meldinger (innlogging/registrering)
  if (kontekst.auth) {
    switch (feiltype) {
      case "auth": {
        const msg = typeof error === "string" ? error : error?.message || "";
        if (/sesjon|logg inn på nytt|ikke autentisert/i.test(msg)) {
          return hentTekst(t, "errors.userData.sessionExpired", "Sesjonen har utløpt. Logg inn på nytt.");
        }
        return hentTekst(t, "errors.generic.default", "Kunne ikke verifisere innlogging. Prøv igjen.");
      }
      case "forbidden":
        return hentTekst(t, "errors.generic.forbidden", "Du har ikke tilgang til denne handlingen.");
      case "not_found":
        return hentTekst(t, "errors.generic.notFound", "Ingen bruker med denne e-postadressen. Opprett en konto under «Registrer» først.");
      case "conflict":
        return hentTekst(t, "errors.generic.conflict", "En bruker med denne e-postadressen finnes allerede. Logg inn i stedet, eller bruk en annen e-post.");
      case "rate_limit":
        return hentTekst(t, "errors.generic.rateLimit", "For mange forsøk. Vent noen minutter og prøv igjen.");
      case "validation":
        return hentTekst(t, "errors.generic.validation", "Ugyldig e-postadresse eller passord. Sjekk at formatet er riktig.");
      case "network":
        return hentTekst(t, "errors.generic.network", "Kunne ikke koble til serveren. Sjekk internettforbindelsen din og prøv igjen.");
      case "server":
        return hentTekst(t, "errors.generic.server", "Noe gikk galt på serveren. Prøv igjen om litt.");
    }
  }

  // Kalender-spesifikke meldinger
  if (kontekst.kalender) {
    switch (feiltype) {
      case "auth":
      case "token":
        return hentTekst(
          t,
          "errors.canvas.tokenInvalid",
          "Canvas API-tokenet ditt er ugyldig, utløpt eller slettet i Canvas. Gå til Innstillinger for å legge til et nytt token.",
        );
      case "validation": {
        // Vis den faktiske feilmeldingen fra backend (f.eks. "Canvas-institusjon mangler")
        const msg = typeof error === "string" ? error : error?.message;
        if (msg && msg.length < 200) return msg;
        return "Sjekk Canvas-innstillingene dine og prøv igjen.";
      }
      case "forbidden":
        return "Du har ikke tilgang til denne ressursen i Canvas.";
      case "rate_limit":
        return "For mange forespørsler. Vent noen sekunder og prøv igjen.";
      case "timeout":
        return "Henting av kalenderdata tok for lang tid. Prøv igjen.";
      case "network":
        return "Kunne ikke koble til Canvas. Sjekk internettforbindelsen din.";
      case "server":
        return "Serverfeil ved henting av kalenderdata. Prøv igjen om litt.";
      case "not_found":
        return "Kalenderdata ble ikke funnet i Canvas.";
    }
  }

// Generiske meldinger
  switch (feiltype) {
    case "auth":
      return hentTekst(t, "errors.generic.auth", "Du må logge inn på nytt.");
    case "forbidden":
      return hentTekst(t, "errors.generic.forbidden", "Du har ikke tilgang til denne ressursen.");
    case "conflict":
      return hentTekst(t, "errors.generic.conflict", "Ressursen finnes allerede.");
    case "rate_limit":
      return hentTekst(t, "errors.generic.rateLimit", "For mange forespørsler. Vent litt og prøv igjen.");
    case "timeout":
      return hentTekst(t, "errors.generic.timeout", "Forespørselen tok for lang tid. Prøv igjen.");
    case "network":
      return hentTekst(t, "errors.generic.network", "Nettverksfeil. Sjekk internettforbindelsen din.");
    case "not_found":
      return hentTekst(t, "errors.generic.notFound", "Ressursen ble ikke funnet.");
    case "server":
      return hentTekst(t, "errors.generic.server", "Serverfeil. Prøv igjen om litt.");
    case "validation":
      return hentTekst(t, "errors.generic.validation", "Ugyldig data. Sjekk at alle felt er fylt ut riktig.");
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

function isApiErrorPayload(value: unknown): value is ApiErrorPayload {
  return typeof value === "object" && value !== null;
}

function hentValideringsdetalj(detaljer: unknown): string | null {
  if (typeof detaljer === "string" && detaljer.trim().length > 0) {
    return detaljer;
  }
  if (!Array.isArray(detaljer) || detaljer.length === 0) {
    return null;
  }
  const førsteFeil = detaljer[0] as Partial<CanvasValidationIssue> | undefined;
  return typeof førsteFeil?.feil === "string" && førsteFeil.feil.trim().length > 0
    ? førsteFeil.feil
    : null;
}

export function extractApiErrorMessage(
  payload: unknown,
  fallback = "API feil",
): string {
  if (!isApiErrorPayload(payload)) {
    return fallback;
  }

  const validationMessage = hentValideringsdetalj(payload.detaljer);
  if (typeof payload.melding === "string" && payload.melding.trim().length > 0) {
    return payload.melding;
  }
  if (validationMessage) {
    return validationMessage;
  }
  if (typeof payload.feil === "string" && payload.feil.trim().length > 0) {
    return payload.feil;
  }

  return fallback;
}

export function extractApiErrorPayload(payload: unknown): ApiErrorPayload | null {
  if (!isApiErrorPayload(payload)) {
    return null;
  }
  return payload;
}

export async function parseApiJson(res: Response): Promise<unknown> {
  const text = await res.text();
  if (!text) return {};

  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`Uventet respons fra server (${res.status}): ${text.slice(0, 100)}`);
  }
}

export function createApiError(
  payload: unknown,
  fallback = "API feil",
): Error {
  return new Error(extractApiErrorMessage(payload, fallback));
}

export function createAuthStatusError(
  status: number,
  payload: unknown,
  fallback = "Ikke autentisert",
): Error {
  const melding = extractApiErrorMessage(payload, fallback);

  if (status === 401) {
    return new SessionExpiredError(melding);
  }

  if (status === 403) {
    return new ForbiddenError(melding);
  }

  return new Error(melding);
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
  if (!errorText) return fallback;
  try {
    const error = JSON.parse(errorText);
    return extractApiErrorMessage(error, fallback);
  } catch {
    return errorText;
  }
}

/**
 * Parser feilrespons-body og returnerer melding + kode + rå payload.
 * Brukes av canvas-api, ki-api og auth-api for konsekvent feilhåndtering.
 */
export async function parseApiErrorBody(
  res: Response,
  defaultMessage: string,
  defaultCode?: string,
): Promise<{ errorMessage: string; errorCode: string | undefined; payload: ApiErrorPayload | null }> {
  const errorText = await res.text();
  let errorMessage = defaultMessage;
  let errorCode = defaultCode;
  let payload: ApiErrorPayload | null = null;
  try {
    const json = JSON.parse(errorText);
    payload = isApiErrorPayload(json) ? json : null;
    errorMessage = extractApiErrorMessage(json, defaultMessage);
    if (payload?.kode) errorCode = payload.kode;
  } catch {
    if (errorText) errorMessage = errorText;
  }
  return { errorMessage, errorCode, payload };
}
