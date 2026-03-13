"use client";

/**
 * Hjelpefunksjoner for auth-omdirigering og visning av innloggingsstatus.
 * Brukes av DashboardView og oversikt for å redirecte til /auth/sign-in ved auth-feil
 * og for å unngå rød feilmelding i et splitt sekund mens redirect skjer.
 */
import { useEffect } from "react";
import { useRouter } from "next/navigation";
import type { UseQueryResult } from "@tanstack/react-query";
import type { MeResponse } from "common/auth";
import { AppError } from "../lib/errors";

/** MeResponse ved innlogget, undefined før første svar eller når bruker ikke er autentisert. */
export type MegQueryResult = UseQueryResult<MeResponse, Error>;

function erAuthFeil(error: unknown): boolean {
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
