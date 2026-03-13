/**
 * Gir backend API-tilgang til Clerk session token.
 * En komponent under ClerkProvider setter getToken; auth-api bruker det ved kall til /api/*.
 * Dermed kan brukere som er logget inn med Clerk få verifisert seg mot Express-backend.
 */
let clerkGetToken: (() => Promise<string | null>) | null = null;

export function setClerkGetToken(fn: (() => Promise<string | null>) | null): void {
  clerkGetToken = fn;
}

export async function getClerkTokenForRequest(): Promise<string | null> {
  if (!clerkGetToken) return null;
  try {
    return await clerkGetToken();
  } catch {
    return null;
  }
}

/** Headers å legge til på kall til backend når bruker er innlogget med Clerk. */
export async function getClerkAuthHeaders(): Promise<HeadersInit> {
  const token = await getClerkTokenForRequest();
  if (!token) return {};
  return { Authorization: `Bearer ${token}` };
}
