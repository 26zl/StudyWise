/*
* Henter brukeren server-side for å unngå layout shift
* Brukes i app/page.tsx for å sjekke om brukeren er innlogget
*/
import { cache } from "react";
import { cookies } from "next/headers";
import { MeResponseSchema, type MeResponse, AUTH_COOKIE_NAME, AUTH_REFRESH_COOKIE_NAME } from "common/auth";
import { withCsrfProtection } from "../lib/csrf";


// Fallback-parser for kombinert Set-Cookie-header.
// Vi foretrekker alltid getSetCookie() når den finnes, men denne håndterer
// vanlige edge-cases som Expires-attributtet og quoted values.
function splitSetCookieHeader(header: string): string[] {
  const cookies: string[] = [];
  let current = "";
  let inQuotes = false;
  let inExpires = false;

  for (let i = 0; i < header.length; i++) {
    const char = header[i];
    current += char;

    if (char === "\"") {
      inQuotes = !inQuotes;
      continue;
    }

    if (inQuotes) continue;

    if (!inExpires && current.toLowerCase().endsWith("expires=")) {
      inExpires = true;
      continue;
    }

    if (inExpires && char === ";") {
      inExpires = false;
      continue;
    }

    if (char !== "," || inExpires) continue;

    const remainder = header.slice(i + 1);
    if (/^\s*[A-Za-z0-9!#$%&'*+.^_`|~-]+=/.test(remainder)) {
      cookies.push(current.slice(0, -1).trim());
      current = "";
    }
  }

  cookies.push(current.trim());
  return cookies.filter(Boolean);
}

// Hjelpefunksjon for å gjøre fetch-kall og håndtere errors
function getSetCookieValues(headers: Headers): string[] {
  const withGetSetCookie = headers as Headers & {
    getSetCookie?: () => string[];
  };
  const setCookies = withGetSetCookie.getSetCookie?.();
  if (Array.isArray(setCookies) && setCookies.length > 0) {
    return setCookies;
  }

  const raw = headers.get("set-cookie");
  return raw ? splitSetCookieHeader(raw) : [];
}

// Hjelpefunksjon for å hente ut cookie-verdi fra set-cookie header
function extractCookieValue(
  setCookies: string[],
  cookieName: string,
): string | null {
  const prefix = `${cookieName}=`;

  for (const cookie of setCookies) {
    const firstPart = cookie.split(";")[0]?.trim();
    if (firstPart?.startsWith(prefix)) {
      return firstPart.slice(prefix.length);
    }
  }

  return null;
}

function buildCookieHeader(
  values: Partial<Record<typeof AUTH_COOKIE_NAME | typeof AUTH_REFRESH_COOKIE_NAME, string | undefined>>,
): string {
  return ([AUTH_COOKIE_NAME, AUTH_REFRESH_COOKIE_NAME] as const).map(
    (cookieName: typeof AUTH_COOKIE_NAME | typeof AUTH_REFRESH_COOKIE_NAME) => {
      const value = values[cookieName];
      return value ? `${cookieName}=${value}` : null;
    },
  )
    .filter(Boolean)
    .join("; ");
}

/**
 * Henter brukeren fra backend API-et ved å sende med cookies
 * Bruker retry-logikk for å håndtere at backend kanskje ikke er klar
 * Prøver også refresh hvis access token er utløpt
 */
export const getUserServer = cache(async (): Promise<MeResponse | null> => {
  const apiUrl = process.env.INTERNAL_API_URL || "http://localhost:4000";
  const cookieStore = await cookies();

  // Hent tokens fra cookies
  const tokenCookie = cookieStore.get(AUTH_COOKIE_NAME);
  const refreshCookie = cookieStore.get(AUTH_REFRESH_COOKIE_NAME);

  if (!tokenCookie?.value && !refreshCookie?.value) {
    return null;
  }

  // Bygg cookie-header med alle relevante cookies
  const cookieHeader = buildCookieHeader({
    [AUTH_COOKIE_NAME]: tokenCookie?.value,
    [AUTH_REFRESH_COOKIE_NAME]: refreshCookie?.value,
  });

  // Hjelpefunksjon for å hente /me
  const fetchMe = async (cookieValue: string): Promise<Response> => {
    return fetch(`${apiUrl}/api/user/me`, {
      method: "GET",
      headers: { Cookie: cookieValue },
      cache: "no-store",
    });
  };

  // Gjør et fetch-kall til backend for å hente brukerinformasjon
  try {
    let res = await fetchMe(cookieHeader);

    // Hvis 401/403 og vi har refresh token, prøv å fornye
    if ((res.status === 401 || res.status === 403) && refreshCookie?.value) {
      const refreshRes = await fetch(`${apiUrl}/api/user/refresh`, {
        cache: "no-store",
        ...withCsrfProtection({
          method: "POST",
          headers: {
            Cookie: cookieHeader,
            "x-studywise-ssr-refresh": "1",
          },
        }),
      });

      if (refreshRes.ok) {
        const setCookies = getSetCookieValues(refreshRes.headers);
        const refreshedCookieHeader = buildCookieHeader({
          [AUTH_COOKIE_NAME]:
            extractCookieValue(setCookies, AUTH_COOKIE_NAME) ?? tokenCookie?.value,
          // SSR-refresh roterer bevisst ikke refresh-token, så vi beholder eksisterende cookie
          // når backend ikke sender en ny refresh-cookie tilbake.
          [AUTH_REFRESH_COOKIE_NAME]:
            extractCookieValue(setCookies, AUTH_REFRESH_COOKIE_NAME) ?? refreshCookie.value,
        });

        res = await fetchMe(refreshedCookieHeader || cookieHeader);
      }
    }

    if (!res.ok) {
      return null;
    }
    const json = await res.json();
    return MeResponseSchema.parse(json);
  } catch {
    // Feil ved henting av bruker (f.eks. backend ikke klar) - returner null
    // Client-side vil prøve igjen med retry-logikk
    return null;
  }
});
