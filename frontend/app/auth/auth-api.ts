/*
 * Auth API: Clerk-only. Hooks for /me, logout, Canvas token, preferences.
 */

import { useCallback } from "react";
import { useClerk } from "@clerk/nextjs";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  CanvasTokenResponseSchema,
  MeResponseSchema,
  LogoutResponseSchema,
  AccountDeletionResponseSchema,
  type CanvasTokenResponse,
  type MeResponse,
  type LogoutResponse,
  type AccountDeletionResponse,
  PreferencesResponseSchema,
  type CanvasContextPreferences,
  type VarslerState,
  type PreferencesResponse,
} from "common/auth";
import { CanvasErrorCodeSchema } from "common/canvasErrors";
import { AppError, CanvasApiError } from "../lib/errors";
import { fetchApi } from "../lib/apiClient";
import { broadcastLogout, clearClientAuthState } from "../hooks/use-auth-sync";
import { showToast } from "@/app/components/ui/Toaster";
import type { ZodType } from "zod";
import {
  createApiError,
  createAuthStatusError,
  extractApiErrorMessage,
  extractApiErrorPayload,
  parseApiJson,
} from "../lib/errorUtils";

/** Query key for /me – bruk samme nøkkel ved invalidateQueries og getQueryData. */
export const AUTH_ME_QUERY_KEY = ["auth", "me"] as const;

// Egendefinert error for Canvas token-konflikt, som backend kan indikere ved lagring av token. Frontend kan fange denne spesifikt for å vise en tilpasset melding.
export class CanvasTokenConflictError extends Error {
  readonly canvasKonflikt = true;
  readonly name = "CanvasTokenConflictError";

  constructor(message: string) {
    super(message);
  }
}

// Slår sammen oppdaterte preferanser med cached /me-data (f.eks. etter PUT /preferences).
function mergeCachedUserPreferences(
  current: MeResponse | undefined,
  updated: PreferencesResponse,
): MeResponse | undefined {
  if (!current) return current;
  return MeResponseSchema.parse({
    user: {
      ...current.user,
      canvasContextPreferences:
        updated.canvasContextPreferences ??
        current.user.canvasContextPreferences,
      varslerState: updated.varslerState ?? current.user.varslerState,
    },
  });
}

function erReauthFeil(error: unknown): boolean {
  if (AppError.isAppError(error)) {
    return error.requiresReauth();
  }
  const message = error instanceof Error ? error.message : String(error);
  return message.includes("401") || message.includes("Ikke autentisert");
}

function lagCanvasTokenFeil(
  json: unknown,
  status: number,
  fallback: string,
): Error {
  const payload = extractApiErrorPayload(json);
  const melding = extractApiErrorMessage(json, fallback);

  if (payload?.canvasKonflikt) {
    return new CanvasTokenConflictError(melding);
  }

  const kode = CanvasErrorCodeSchema.safeParse(payload?.kode);
  if (kode.success) {
    return new CanvasApiError(kode.data, melding, status);
  }

  return new Error(melding);
}

// Alle autentiserte kall går via fetchApi slik at Clerk-header og CSRF er konsistent på tvers av klientene.
async function requestAuthedJson<T>(
  url: string,
  schema: ZodType<T>,
  defaultErrorMessage: string,
  init: RequestInit = {},
): Promise<T> {
  const res = await fetchApi(url, init);
  const json = await parseApiJson(res);

  if (res.status === 401 || res.status === 403) {
    throw createAuthStatusError(res.status, json, "Ikke autentisert");
  }

  if (!res.ok) {
    throw createApiError(json, defaultErrorMessage);
  }

  return schema.parse(json);
}

// Hent info om innlogget bruker (Clerk token i Authorization header)
async function hentMeg(): Promise<MeResponse> {
  const res = await fetchApi("/api/user/me", { method: "GET" });
  const json = await parseApiJson(res);
  if (res.ok) {
    return MeResponseSchema.parse(json);
  }
  if (res.status === 401 || res.status === 403) {
    throw createAuthStatusError(res.status, json, "Ikke autentisert");
  }
  throw createApiError(json, "Kunne ikke hente brukerdata");
}
// Utlogging rydder backend-state; Clerk-session avsluttes i useLoggUtWithRedirect.
async function loggUt(): Promise<LogoutResponse> {
  const res = await fetchApi("/api/user/logout", { method: "POST" });
  const json = await parseApiJson(res);
  if (res.status === 401 || res.status === 403) {
    throw createAuthStatusError(res.status, json, "Sesjonen er allerede utløpt.");
  }
  if (!res.ok) {
    throw createApiError(json, "Kunne ikke logge ut");
  }
  return LogoutResponseSchema.parse(json);
}

// Lagre Canvas token for innlogget bruker (multi-tenant: eksplisitt Canvas-instans-URL)
interface SaveCanvasTokenInput {
  token: string;
  forceRelink?: boolean;
  /** Canvas base URL for brukerens institusjon (f.eks. https://ntnu.instructure.com). */
  canvasBaseUrl: string;
}

async function lagreCanvasToken(input: SaveCanvasTokenInput): Promise<CanvasTokenResponse> {
  const url = input.forceRelink ? "/api/user/token?force=true" : "/api/user/token";
  const res = await fetchApi(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token: input.token, canvasBaseUrl: input.canvasBaseUrl }),
  });
  const json = await parseApiJson(res);
  if (res.status === 401 || res.status === 403) {
    throw createAuthStatusError(res.status, json, "Ikke autentisert");
  }
  if (!res.ok) {
    throw lagCanvasTokenFeil(json, res.status, "Kunne ikke lagre token");
  }
  return CanvasTokenResponseSchema.parse(json);
}

// Hook for å hente info om innlogget bruker
// initialData: kun MeResponse ved bekrevet innlogget – aldri null (unngår at SSR-feil caches som "gjest" i 5 min)
export function useMeg(options?: { initialData?: MeResponse; enabled?: boolean }) {
  return useQuery({
    queryKey: AUTH_ME_QUERY_KEY,
    queryFn: hentMeg,
    enabled: options?.enabled,
    retry: (failureCount, error) => {
      const isAuthError = erReauthFeil(error);
      // Etter Clerk-innlogging kan første /me feile pga. timing – tillat én retry med kort delay
      if (isAuthError) {
        return failureCount < 1;
      }
      // Prøv opptil 5 ganger ved nettverksfeil (ECONNREFUSED ved oppstart)
      return failureCount < 5;
    },
    retryDelay: (attemptIndex, error) => {
      const isAuthError = erReauthFeil(error);
      if (isAuthError && attemptIndex === 0) return 800;
      return Math.min(1000 * 2 ** attemptIndex, 8000);
    },
    staleTime: 1000 * 60 * 5, // Cache i 5 minutter - unngår unødvendige requests
    refetchOnWindowFocus: false, // Ikke refetch ved window focus
    initialData: options?.initialData,
  });
}
// Hook for utlogging
export function useLoggUt() {
  return useMutation({
    mutationFn: () => loggUt(),
  });
}

/** Felles logout-flyt: kaller API, varsler andre faner, rydder cache og UI, redirect til /. */
export function useLoggUtWithRedirect() {
  const loggUt = useLoggUt();
  const clerk = useClerk();
  const queryClient = useQueryClient();
  return useCallback(async () => {
    try {
      await loggUt.mutateAsync();
    } catch (error) {
      if (!AppError.isAppError(error) || !error.requiresReauth()) {
        showToast.warning(
          "Lokal opprydding feilet",
          "Vi fortsetter med utlogging av innloggingssesjonen.",
        );
      }
    }

    try {
      await clerk.signOut();
    } catch {
      showToast.error("Kunne ikke logge ut", "Innloggingssesjonen kunne ikke avsluttes. Prøv igjen.");
      return;
    }

    broadcastLogout();
    clearClientAuthState(queryClient);
    window.location.assign("/");
  }, [clerk, loggUt, queryClient]);
}
// Hook for lagring av Canvas token
export function useLagreCanvasToken() {
  return useMutation({
    mutationFn: lagreCanvasToken,
  });
}

// Slett Canvas token for innlogget bruker
async function slettCanvasToken(): Promise<CanvasTokenResponse> {
  return requestAuthedJson(
    "/api/user/token",
    CanvasTokenResponseSchema,
    "Kunne ikke slette token",
    {
      method: "DELETE",
    },
  );
}

// Hook for sletting av Canvas token
export function useSlettCanvasToken() {
  return useMutation({
    mutationFn: slettCanvasToken,
  });
}

// Oppdater brukerpreferanser (Canvas-kontekst og varsler)
type UserPreferencesUpdate = {
  canvasContextPreferences?: CanvasContextPreferences;
  varslerState?: VarslerState;
};

// Hjelpefunksjon for å oppdatere brukerpreferanser. Returnerer oppdatert preferanse-objekt.
async function oppdaterBrukerPreferanser(
  preferences: UserPreferencesUpdate,
): Promise<PreferencesResponse> {
  return requestAuthedJson(
    "/api/user/preferences",
    PreferencesResponseSchema,
    "Kunne ikke oppdatere preferanser",
    {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(preferences),
    },
  );
}

// Generisk hook for oppdatering av brukerpreferanser. Tar en funksjon som mapper input til UserPreferencesUpdate, og håndterer cache-oppdatering av /me data ved suksess.
function useOppdaterBrukerPreferanser<TValue>(
  toUpdate: (value: TValue) => UserPreferencesUpdate,
) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (value: TValue) => oppdaterBrukerPreferanser(toUpdate(value)),
    onSuccess: (data) => {
      queryClient.setQueryData<MeResponse | undefined>(
        AUTH_ME_QUERY_KEY,
        (current) => mergeCachedUserPreferences(current, data),
      );
    },
  });
}

// Hook for oppdatering av Canvas-kontekst preferanser
export function useOppdaterPreferanser() {
  return useOppdaterBrukerPreferanser((canvasContextPreferences: CanvasContextPreferences) => ({
    canvasContextPreferences,
  }));
}

// Hook for oppdatering av varslingspreferanser
export function useOppdaterVarslerState() {
  return useOppdaterBrukerPreferanser((varslerState: VarslerState) => ({
    varslerState,
  }));
}

async function slettKonto(): Promise<AccountDeletionResponse> {
  return requestAuthedJson(
    "/api/user/account",
    AccountDeletionResponseSchema,
    "Kunne ikke slette konto",
    {
      method: "DELETE",
    },
  );
}

export function useSlettKonto() {
  return useMutation({
    mutationFn: slettKonto,
  });
}
