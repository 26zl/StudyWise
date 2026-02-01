/*
* Henter brukeren server-side for å unngå layout shift
* Brukes i app/hjem/page.tsx for å sjekke om brukeren er innlogget
*/
import { cookies } from "next/headers";
import { MeResponseSchema, type MeResponse } from "common/auth";

// Cookie-navn må matche backend (JWT_COOKIE_NAVN i backend/src/middleware/auth.ts)
const AUTH_COOKIE_NAME = "studywise_auth";

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
 */
export async function getUserServer(): Promise<MeResponse | null> {
  const apiUrl = process.env.INTERNAL_API_URL || process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000";
  const cookieStore = await cookies();
  
  // Hent token fra cookies
  const tokenCookie = cookieStore.get(AUTH_COOKIE_NAME);
  if (!tokenCookie?.value) {
    return null;
  }

  // Gjør et fetch-kall til backend for å hente brukerinformasjon
  try {
    const res = await fetch(`${apiUrl}/api/user/me`, {
      method: "GET",
      headers: {
        Cookie: `${AUTH_COOKIE_NAME}=${tokenCookie.value}`,
      },
      cache: "no-store",
    });
    if (!res.ok) {
      return null;
    }
    const json = await res.json();
    return MeResponseSchema.parse(json);
  } catch {
    // Feil ved henting av bruker - returner null
    return null;
  }
}
