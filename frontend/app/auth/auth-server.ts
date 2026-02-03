/*
* Henter brukeren server-side for å unngå layout shift
* Brukes i app/hjem/page.tsx for å sjekke om brukeren er innlogget
*/
import { cookies } from "next/headers";
import { MeResponseSchema, type MeResponse, AUTH_COOKIE_NAME, AUTH_REFRESH_COOKIE_NAME } from "common/auth";

/**
 * Rask sjekk om bruker har token (uten å kalle backend)
 * Brukes på hjemmesiden for å vise riktig CTA-knapp
 * Returnerer true hvis token cookie finnes
 */
export async function hasTokenServer(): Promise<boolean> {
  const cookieStore = await cookies();
  const tokenCookie = cookieStore.get(AUTH_COOKIE_NAME);
  return Boolean(tokenCookie?.value);
}

/**
 * Henter brukeren fra backend API-et ved å sende med cookies
 * Bruker retry-logikk for å håndtere at backend kanskje ikke er klar
 * Prøver også refresh hvis access token er utløpt
 */
export async function getUserServer(): Promise<MeResponse | null> {
  const apiUrl = process.env.INTERNAL_API_URL || "http://localhost:4000";
  const cookieStore = await cookies();

  // Hent tokens fra cookies
  const tokenCookie = cookieStore.get(AUTH_COOKIE_NAME);
  const refreshCookie = cookieStore.get(AUTH_REFRESH_COOKIE_NAME);

  if (!tokenCookie?.value && !refreshCookie?.value) {
    return null;
  }

  // Bygg cookie-header med alle relevante cookies
  const cookieHeader = [
    tokenCookie?.value ? `${AUTH_COOKIE_NAME}=${tokenCookie.value}` : null,
    refreshCookie?.value ? `studywise_refresh=${refreshCookie.value}` : null,
  ].filter(Boolean).join("; ");

  // Hjelpefunksjon for å hente /me
  const fetchMe = async (): Promise<Response> => {
    return fetch(`${apiUrl}/api/user/me`, {
      method: "GET",
      headers: { Cookie: cookieHeader },
      cache: "no-store",
    });
  };

  // Gjør et fetch-kall til backend for å hente brukerinformasjon
  try {
    let res = await fetchMe();

    // Hvis 401/403 og vi har refresh token, prøv å fornye
    if ((res.status === 401 || res.status === 403) && refreshCookie?.value) {
      const refreshRes = await fetch(`${apiUrl}/api/user/refresh`, {
        method: "POST",
        headers: { Cookie: cookieHeader },
        cache: "no-store",
      });

      if (refreshRes.ok) {
        // Refresh OK - prøv /me igjen
        // Merk: Vi kan ikke lese nye cookies her, så vi stoler på at
        // client-side query vil ha de oppdaterte cookies
        res = await fetchMe();
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
}
