"use client";

/**
 * Hjelpefunksjoner for auth-omdirigering og visning av innloggingsstatus.
 * Brukes av DashboardView og oversikt for å redirecte til /auth/sign-in ved auth-feil
 * og for å unngå rød feilmelding i et splitt sekund mens redirect skjer.
 */
import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useClerk } from "@clerk/nextjs";
import type { UseQueryResult } from "@tanstack/react-query";
import type { MeResponse } from "common/auth";
import { AppError } from "../lib/errors";
import { erFatalUserDataFeil } from "../lib/errorUtils";

type MegQueryResult = UseQueryResult<MeResponse, Error>;

function erAuthFeil(error: unknown): boolean {
  // Slettet bruker og kontokonflikter skal IKKE trigge redirect — de trenger spesialhåndtering
  if (erFatalUserDataFeil(error)) {
    return false;
  }
  if (AppError.isAppError(error) && error.requiresReauth()) return true;
  const message = error instanceof Error ? error.message : String(error);
  return message.includes("401") || message.includes("Ikke autentisert");
}

/**
 * Ved auth-feil (401 eller requiresReauth) redirecter til /auth/sign-in,
 * slik at brukeren ikke sendes til /auth mens sesjonen kan være gyldig.
 */
export function useAuthRedirect(megQuery: MegQueryResult): void {
  const router = useRouter();
  useEffect(() => {
    if (!megQuery.isError || !erAuthFeil(megQuery.error)) return;
    router.replace("/auth/sign-in");
  }, [megQuery.isError, megQuery.error, router]);
}

/**
 * Returnerer true når vi skal vise lastespinner i stedet for innhold (redirect til /auth/sign-in).
 * Brukes slik at bruker ikke ser rød feilmelding i et splitt sekund før redirect.
 */
export function skalRedirecteTilAuth(megQuery: MegQueryResult): boolean {
  if (megQuery.isError && erAuthFeil(megQuery.error)) return true;
  if (megQuery.isSuccess && !megQuery.data?.user) return true;
  return false;
}

/**
 * Fatale auth-feil (OAuth-konflikt, slettet konto osv.): logger ut automatisk via Clerk.
 * Returnerer true mens utlogging pågår, slik at komponenten kan vise lastespinner.
 */
export function useFatalAuthSignOut(megQuery: MegQueryResult): boolean {
  const clerk = useClerk();
  const erFatal = megQuery.isError && erFatalUserDataFeil(megQuery.error);

  useEffect(() => {
    if (!erFatal) return;
    void clerk.signOut({ redirectUrl: "/auth/sign-in" });
  }, [erFatal, clerk]);

  return erFatal;
}
