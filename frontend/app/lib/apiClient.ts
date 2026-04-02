/**
 * Felles API-klient for kall mot backend (/api/*).
 * Legger til Clerk Bearer-token og CSRF-header via buildApiRequestInit / fetchApi.
 */
import { getClerkAuthHeaders } from "./clerkTokenForApi";
import { withCsrfProtection } from "./csrf";

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
  const {
    auth = true,
    credentials = "include",
    cache = "no-store",
  } = options;

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
export async function fetchAuthedJson(
  input: RequestInfo,
  init?: RequestInit,
  options?: { defaultErrorMessage?: string },
): Promise<{ data: unknown; status: number }> {
  // Lazy import for å unngå sirkulær avhengighet (apiClient → errorUtils → errors)
  const { parseApiJson, createAuthStatusError, createApiError } = await import("./errorUtils");
  const res = await fetchApi(input, init ?? {});
  if (res.status === 204) {
    return { data: undefined, status: 204 };
  }
  const data = await parseApiJson(res);
  if (res.status === 401 || res.status === 403) {
    throw createAuthStatusError(res.status, data, "Ikke autentisert");
  }
  if (!res.ok) {
    throw createApiError(data, options?.defaultErrorMessage ?? "Uventet feil");
  }
  return { data, status: res.status };
}
