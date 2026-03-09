import { useEffect } from "react";
import { useRouter } from "next/navigation";
import type { MeResponse } from "common/auth";
import { useMeg } from "./auth-api";

export type AuthStatusSnapshot = {
  isError: boolean;
  isFetched: boolean;
  isLoading: boolean;
  data?: MeResponse;
  error?: unknown;
};

/** Sjekker om feilen er auth-relatert (401/403), ikke nettverks-/oppstartsfeil. */
export function isAuthError(error: unknown): boolean {
  if (error == null) return false;
  const msg = error instanceof Error ? error.message : String(error);
  return (
    msg.includes("401") ||
    msg.includes("403") ||
    msg.includes("Ikke autentisert") ||
    msg.toLowerCase().includes("unauthorized")
  );
}

/**
 * Returnerer true bare når bruker definitivt ikke er innlogget.
 * Ved nettverksfeil (etter at useMeg har brukt opp retries) returnerer vi false
 * slik at brukeren ikke sendes til /auth mens sesjonen kan være gyldig.
 */
export function skalRedirecteTilAuth(auth: AuthStatusSnapshot): boolean {
  if (!auth.isFetched || auth.isLoading) return false;
  if (auth.data?.user) return false;
  if (auth.isError && !isAuthError(auth.error)) return false;
  return true;
}

/** Felles redirect-effekt: bruk i beskyttede sider (dashboard, oversikt). */
export function useAuthRedirect(): void {
  const router = useRouter();
  const megQuery = useMeg();
  useEffect(() => {
    if (skalRedirecteTilAuth({ ...megQuery, error: megQuery.error })) {
      router.replace("/auth");
    }
  }, [megQuery.isError, megQuery.isFetched, megQuery.isLoading, megQuery.data?.user, megQuery.error, router]);
}
