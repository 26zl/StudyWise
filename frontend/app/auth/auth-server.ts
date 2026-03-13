/**
 * Server-side auth-hjelpere for App Router.
 * Brukes av forsiden (page.tsx) for å hente innlogget bruker som initialData til LandingHeroActions.
 */
import { auth } from "@clerk/nextjs/server";
import { MeResponseSchema, type MeResponse } from "common/auth";

const API_BASE =
  process.env.NEXT_PUBLIC_APP_URL ??
  (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "http://localhost:3000");

/**
 * Henter /me fra backend i server context. Returnerer null hvis bruker ikke er innlogget
 * eller backend svarer med feil (f.eks. 401). Brukes som initialUser på forsiden.
 * Bruker Clerk auth() + getToken() (default session token) – backend verifiserer med verifyToken().
 */
export async function getUserServerSafe(): Promise<MeResponse | null> {
  const { userId, getToken } = await auth();
  if (!userId) return null;
  const token = await getToken();
  if (!token) return null;
  try {
    const res = await fetch(`${API_BASE}/api/user/me`, {
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
    });
    if (!res.ok) return null;
    const json = await res.json();
    return MeResponseSchema.parse(json);
  } catch {
    return null;
  }
}
