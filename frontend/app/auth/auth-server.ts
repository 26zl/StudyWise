/*
* Henter brukeren server-side for å unngå layout shift
* Brukes i app/hjem/page.tsx for å sjekke om brukeren er innlogget
*/
import { cookies } from "next/headers";
import { MeResponseSchema, type MeResponse } from "common/auth";

// Henter brukeren fra backend API-et ved å sende med cookies
export async function getUserServer(): Promise<MeResponse | null> {
  const apiUrl = process.env.INTERNAL_API_URL || process.env.NEXT_PUBLIC_API_URL || "http://backend:4000";
  const cookieStore = await cookies();
  const cookieHeader = cookieStore.toString();

  // Gjør et fetch-kall til backend for å hente brukerinformasjon
  try {
    const res = await fetch(`${apiUrl}/api/user/me`, {
      method: "GET",
      headers: {
        Cookie: cookieHeader,
      },
      cache: "no-store",
    });
    if (!res.ok) {
      return null;
    }
    const json = await res.json();
    return MeResponseSchema.parse(json);
  } catch {
    // Feil ved henting av bruker ignoreres - bruker er ikke innlogget
    return null;
  }
}
