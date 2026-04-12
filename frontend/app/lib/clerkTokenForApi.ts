/**
 * Gir backend API-tilgang til Clerk session token.
 * En komponent under ClerkProvider setter getToken; auth-api bruker det ved kall til /api/*.
 * Dermed kan brukere som er logget inn med Clerk få verifisert seg mot Express-backend.
 */
let clerkGetToken: (() => Promise<string | null>) | null = null;
let clerkSessionReload: (() => Promise<void>) | null = null;

export function setClerkGetToken(fn: (() => Promise<string | null>) | null): void {
  clerkGetToken = fn;
}

/**
 * Registrerer Clerk session reload-funksjonen. Kalles fra ClerkTokenSync i providers.tsx
 * med `() => clerk.session?.reload()`. Brukes av forceRefreshClerkToken() som defensiv
 * retry når /me returnerer 401 — håndterer transient token-refresh-feil i prod og
 * race conditions ved app-boot i dev.
 */
export function setClerkSessionReload(fn: (() => Promise<void>) | null): void {
  clerkSessionReload = fn;
}

export async function getClerkTokenForRequest(): Promise<string | null> {
  if (!clerkGetToken) return null;
  try {
    return await clerkGetToken();
  } catch {
    return null;
  }
}

/**
 * Tvinger Clerk til å reloade sesjonen og hente et nytt token.
 * Best-effort — returnerer stille hvis Clerk ikke er lastet eller reload feiler.
 * Brukes som ett-gangs retry når /me returnerer 401.
 */
export async function forceRefreshClerkToken(): Promise<void> {
  if (!clerkSessionReload) return;
  try {
    await clerkSessionReload();
  } catch {
    // Best-effort — reload kan feile ved nettverksbrudd eller utløpt sesjon.
    // Kalleren vil prøve en ny fetch og håndtere resultatet uansett.
  }
}

/** Headers å legge til på kall til backend når bruker er innlogget med Clerk. */
export async function getClerkAuthHeaders(): Promise<HeadersInit> {
  const token = await getClerkTokenForRequest();
  if (!token) return {};
  return { Authorization: `Bearer ${token}` };
}
