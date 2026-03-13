/**
 * Felles API-klient for kall mot backend (/api/*).
 * Legger til Clerk Bearer-token og CSRF-header via buildApiRequestInit / fetchApi.
 */
import { getClerkAuthHeaders } from "./clerkTokenForApi";
import { withCsrfProtection } from "./csrf";

type ApiRequestOptions = {
  auth?: boolean;
  csrf?: boolean;
  credentials?: RequestCredentials;
  cache?: RequestCache;
};

export function mergeHeaders(...headerSets: Array<HeadersInit | undefined>): Headers {
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

export async function buildApiRequestInit(
  init: RequestInit = {},
  options: ApiRequestOptions = {},
): Promise<RequestInit> {
  const {
    auth = true,
    csrf = true,
    credentials = "include",
    cache = "no-store",
  } = options;

  const protectedInit = csrf ? withCsrfProtection(init) : init;
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
