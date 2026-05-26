/**
 * Felles API-klient for kall mot backend (/api/*).
 * Legger til Clerk Bearer-token og CSRF-header via buildApiRequestInit / fetchApi.
 */
import { getClerkAuthHeaders } from "./clerkTokenForApi";
import { withCsrfProtection } from "./csrf";

/** sessionStorage-nøkkel for sist observerte X-Request-ID fra en feilet API-respons. */
// deepcode ignore HardcodedNonCryptoSecret: ikke en hemmelighet — kun en sessionStorage-nøkkel for klient-state.
const LAST_API_ERROR_REQUEST_ID_KEY = "studywise:lastApiErrorRequestId";

/**
 * Lagrer X-Request-ID for den siste feilede API-responsen i sessionStorage.
 * Kontakt-skjemaet leser denne for å hjelpe brukeren rapportere siste API-feil.
 */
function rememberLastApiErrorRequestId(requestId: string | null): void {
  if (typeof window === "undefined") return;
  try {
    if (requestId) {
      window.sessionStorage.setItem(LAST_API_ERROR_REQUEST_ID_KEY, requestId);
    }
  } catch {
    // sessionStorage kan være utilgjengelig (SSR, privat modus) — ignorer.
  }
}

/**
 * Leser sist observerte X-Request-ID fra en feilet API-respons.
 * Brukes av kontakt-skjemaet for å hjelpe brukere rapportere feil.
 */
export function getLastApiErrorRequestId(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.sessionStorage.getItem(LAST_API_ERROR_REQUEST_ID_KEY);
  } catch {
    return null;
  }
}

/** Fjerner sist lagrede feil-ID — kalles etter at brukeren har rapportert. */
export function clearLastApiErrorRequestId(): void {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.removeItem(LAST_API_ERROR_REQUEST_ID_KEY);
  } catch {
    // ignorer
  }
}

/**
 * Lagrer en feil-ID som kontaktskjemaet skal forhåndsfylle med.
 * Brukes av app/error.tsx slik at vi slipper å sende ID-en via URL-query —
 * det forhindrer at PostHog/Datadog/andre pageview-loggere fanger ID-en
 * som en del av nettleseradressen før kontakt-siden får rydde den vekk.
 *
 * No-op hvis id er falsy, slik at en eksisterende ID ikke blir overskrevet
 * av en feil uten kjent ID.
 */
export function rememberReportableErrorId(id: string | null | undefined): void {
  if (typeof window === "undefined") return;
  if (!id) return;
  try {
    window.sessionStorage.setItem(LAST_API_ERROR_REQUEST_ID_KEY, id);
  } catch {
    // ignorer
  }
}

type ApiRequestOptions = {
  auth?: boolean;
  credentials?: RequestCredentials;
  cache?: RequestCache;
};

function mergeHeaders(...headerSets: Array<HeadersInit | undefined>): Headers {
  const headers = new Headers();

  for (const headerSet of headerSets) {
    if (!headerSet) continue;

    const currentHeaders = new Headers(headerSet);
    currentHeaders.forEach((value, key) => {
      headers.set(key, value);
    });
  }

  return headers;
}

async function buildApiRequestInit(
  init: RequestInit = {},
  options: ApiRequestOptions = {},
): Promise<RequestInit> {
  const { auth = true, credentials = "include", cache = "no-store" } = options;

  const protectedInit = withCsrfProtection(init);
  const authHeaders = auth ? await getClerkAuthHeaders() : undefined;

  return {
    credentials,
    cache,
    ...protectedInit,
    headers: mergeHeaders(authHeaders, protectedInit.headers),
  };
}

export async function fetchApi(
  input: RequestInfo | URL,
  init: RequestInit = {},
  options: ApiRequestOptions = {},
): Promise<Response> {
  return fetch(input, await buildApiRequestInit(init, options));
}

/**
 * Autentisert JSON-fetch med felles feilhåndtering.
 * Håndterer 204, JSON-parsing, 401/403 (auth-feil) og !ok (API-feil).
 * Brukes av auth-api og useChatHistory for å unngå duplisert logikk.
 */
/**
 * Laster ned en autentisert fil via /api/* og åpner den i ny fane.
 * Top-level navigasjon (<a href> / window.open) sender ikke Bearer-header,
 * så filer må hentes som blob med fetchApi før de presenteres for brukeren.
 */
export async function downloadAuthedFile(url: string, filnavn?: string): Promise<void> {
  // Sikkerhetsguard: kun relative /api/-URL-er tillates — forhindrer open redirect
  // og at vilkårlig ekstern URL kan flyte inn i window.open / <a href>.
  if (typeof url !== "string" || !url.startsWith("/api/")) {
    throw new Error("Ugyldig nedlastings-URL");
  }
  const res = await fetchApi(url, { method: "GET" });
  if (!res.ok) {
    throw new Error(`Nedlasting feilet (${res.status})`);
  }
  const blob = await res.blob();
  const rawBlobUrl = URL.createObjectURL(blob);
  // Ekstra forsvar: createObjectURL skal alltid returnere "blob:"-prefiks.
  // Vi parser via URL-konstruktøren og rekonstruerer strengen for å bryte
  // taint-sporing fra fetch-responsen (blob:-URL er lokal og trygg).
  let trygBlobUrl: string;
  try {
    const parsed = new URL(rawBlobUrl);
    if (parsed.protocol !== "blob:") {
      throw new Error("Uventet blob-URL");
    }
    trygBlobUrl = parsed.toString();
  } catch {
    URL.revokeObjectURL(rawBlobUrl);
    throw new Error("Uventet blob-URL");
  }
  // Saniter filnavn: fjern path-separatorer og kontrolltegn for å unngå
  // path-traversal i Save-As-dialogen.
  const trygtFilnavn = filnavn
    ? // eslint-disable-next-line no-control-regex -- bevisst fjerning av kontrolltegn
      filnavn.replace(/[\\/\x00-\x1f]/g, "_").slice(0, 255)
    : undefined;
  try {
    // Bruker alltid <a>-element (aldri window.open) for å unngå open-redirect-mistanker.
    const a = document.createElement("a");
    a.href = trygBlobUrl;
    if (trygtFilnavn) {
      a.download = trygtFilnavn;
    } else {
      a.target = "_blank";
    }
    a.rel = "noopener noreferrer";
    // deepcode ignore DOMXSS: href er en lokal blob:-URL validert via URL-konstruktør, filnavn sanitert mot path-traversal/kontrolltegn.
    document.body.appendChild(a);
    a.click();
    a.remove();
  } finally {
    // Frigi blob-URL etter at nettleseren har rukket å starte nedlastingen
    setTimeout(() => URL.revokeObjectURL(rawBlobUrl), 60_000);
  }
}

export async function fetchAuthedJson(
  input: RequestInfo,
  init?: RequestInit,
  options?: { defaultErrorMessage?: string },
): Promise<{ data: unknown; status: number }> {
  // Lazy import for å unngå sirkulær avhengighet (apiClient → errorUtils → errors)
  const { parseApiJson, createAuthStatusError, createApiError } = await import("./errorUtils");
  const res = await fetchApi(input, init ?? {});
  // Backend ekko-er alltid X-Request-ID-header — fanger den tidlig så vi kan merke feilen
  // med samme ID som lagres i Pino-logger og AuditLog.
  const requestId = res.headers.get("x-request-id") ?? undefined;
  if (res.status === 204) {
    return { data: undefined, status: 204 };
  }
  const data = await parseApiJson(res);
  if (res.status === 401 || res.status === 403) {
    if (requestId) rememberLastApiErrorRequestId(requestId);
    throw createAuthStatusError(res.status, data, "Ikke autentisert", { apiRequestId: requestId });
  }
  if (!res.ok) {
    if (requestId) rememberLastApiErrorRequestId(requestId);
    throw createApiError(data, options?.defaultErrorMessage ?? "Uventet feil", {
      apiRequestId: requestId,
      apiStatus: res.status,
    });
  }
  return { data, status: res.status };
}
