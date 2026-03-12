/*
 * Hooks og funksjoner for å kommunisere med auth-backend APIet
 * Inkluderer innlogging, registrering, utlogging, henting av brukerinfo og lagring av Canvas token
 */

import { useCallback } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  CanvasTokenResponseSchema,
  LoginResponseSchema,
  RegisterResponseSchema,
  MeResponseSchema,
  LogoutResponseSchema,
  RefreshResponseSchema,
  type CanvasTokenResponse,
  type LoginResponse,
  type RegisterResponse,
  type MeResponse,
  type LogoutResponse,
  type RefreshResponse,
  PreferencesResponseSchema,
  type LoginRequest,
  type RegisterRequest,
  type CanvasContextPreferences,
  type VarslerState,
  type PreferencesResponse,
} from "common/auth";
import { CanvasErrorCodeSchema } from "common/canvasErrors";
import { SessionExpiredError, AppError, CanvasApiError } from "../lib/errors";
import { withCsrfProtection } from "../lib/csrf";
import { broadcastLogout } from "../hooks/use-auth-sync";
import { clearDatadogUser } from "../components/DatadogRum";
import { useUIStore } from "../store/uiStore";
import { showToast } from "../components/Toaster";
import type { ZodType } from "zod";
import {
  extractApiErrorMessage,
  extractApiErrorPayload,
} from "../lib/errorUtils";

// For å unngå flere samtidige refresh-forsøk ved utløpt sesjon, holder vi en global promise for pågående refresh. Alle kall som oppdager utløpt sesjon kan vente på denne promise i stedet for å starte sin egen refresh.
let refreshPromise: Promise<RefreshResponse> | null = null;
const AUTH_ME_QUERY_KEY = ["auth", "me"] as const;

// Egendefinert error for Canvas token-konflikt, som backend kan indikere ved lagring av token. Frontend kan fange denne spesifikt for å vise en tilpasset melding.
export class CanvasTokenConflictError extends Error {
  readonly canvasKonflikt = true;
  readonly name = "CanvasTokenConflictError";

  constructor(message: string) {
    super(message);
  }
}

// Hjelpefunksjon for å bygge Cookie-header basert på tilgjengelige cookies. Brukes i SSR for å sende cookies videre til backend ved autentiserte kall.
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

// Hent JSON fra response — returnerer tomt objekt kun hvis body er tomt (204 etc.)
const hentJson = async (res: Response) => {
  const text = await res.text();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    // Ikke-JSON respons (f.eks. HTML feilside) — kast med kontekst
    throw new Error(
      `Uventet respons fra server (${res.status}): ${text.slice(0, 100)}`,
    );
  }
};

function lagApiFeil(json: unknown, fallback: string): Error {
  return new Error(extractApiErrorMessage(json, fallback));
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

// Alle autentiserte kall (inkl. POST/PUT/DELETE) får CSRF-header via withCsrfProtection — påkrevd av backend.
async function requestAuthedJson<T>(
  url: string,
  schema: ZodType<T>,
  defaultErrorMessage: string,
  init: RequestInit = {},
  forsoktRefresh = false,
): Promise<T> {
  const protectedInit = withCsrfProtection(init);
  const res = await fetch(url, {
    credentials: "include",
    cache: "no-store",
    ...protectedInit,
  });
  const json = await hentJson(res);

  if ((res.status === 401 || res.status === 403) && !forsoktRefresh) {
    try {
      await fornySesjon();
    } catch {
      throw new SessionExpiredError(
        extractApiErrorMessage(json, "Ikke autentisert"),
      );
    }
    return requestAuthedJson(url, schema, defaultErrorMessage, init, true);
  }

  if (!res.ok) {
    throw lagApiFeil(json, defaultErrorMessage);
  }

  return schema.parse(json);
}

// Innlogging
async function loggInn(data: LoginRequest): Promise<LoginResponse> {
  const res = await fetch("/api/user/login", {
    credentials: "include",
    ...withCsrfProtection({
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    }),
  });
  const json = await hentJson(res);
  if (!res.ok) {
    throw lagApiFeil(json, "Innlogging feilet");
  }
  return LoginResponseSchema.parse(json);
}
// Registrering av ny bruker
async function registrer(data: RegisterRequest): Promise<RegisterResponse> {
  const res = await fetch("/api/user/register", {
    credentials: "include",
    ...withCsrfProtection({
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    }),
  });
  const json = await hentJson(res);
  if (!res.ok) {
    throw lagApiFeil(json, "Kunne ikke registrere bruker");
  }
  return RegisterResponseSchema.parse(json);
}
// Hent info om innlogget bruker
async function hentMeg(): Promise<MeResponse> {
  const res = await fetch("/api/user/me", {
    method: "GET",
    credentials: "include",
    cache: "no-store",
  });
  const json = await hentJson(res);
  if (res.ok) {
    return MeResponseSchema.parse(json);
  }
  // Ved 401/403: Prøv å fornye sesjon én gang
  if (res.status === 401 || res.status === 403) {
    try {
      await fornySesjon();
    } catch {
      // Refresh feilet - brukeren er ikke logget inn
      throw new SessionExpiredError("Ikke autentisert");
    }
    // Refresh OK - prøv /me igjen
    const resRetry = await fetch("/api/user/me", {
      method: "GET",
      credentials: "include",
      cache: "no-store",
    });
    const jsonRetry = await hentJson(resRetry);
    if (!resRetry.ok) {
      if (resRetry.status === 401 || resRetry.status === 403) {
        throw new SessionExpiredError(
          extractApiErrorMessage(jsonRetry, "Ikke autentisert"),
        );
      }
      throw lagApiFeil(jsonRetry, "Kunne ikke hente brukerdata");
    }
    return MeResponseSchema.parse(jsonRetry);
  }
  throw lagApiFeil(json, "Kunne ikke hente brukerdata");
}
// Utlogging
async function loggUt(forsoktRefresh = false): Promise<LogoutResponse> {
  const res = await fetch("/api/user/logout", {
    credentials: "include",
    ...withCsrfProtection({
      method: "POST",
    }),
  });
  const json = await hentJson(res);
  if ((res.status === 401 || res.status === 403) && !forsoktRefresh) {
    try {
      await fornySesjon();
    } catch {
      throw new SessionExpiredError("Sesjonen er allerede utløpt.");
    }
    return loggUt(true);
  }
  if (res.status === 401 || res.status === 403) {
    throw new SessionExpiredError(
      extractApiErrorMessage(json, "Sesjonen er allerede utløpt."),
    );
  }
  if (!res.ok) {
    throw lagApiFeil(json, "Kunne ikke logge ut");
  }
  return LogoutResponseSchema.parse(json);
}
// Forny sesjon ved utløpt autentisering
export async function fornySesjon(): Promise<RefreshResponse> {
  if (refreshPromise) return refreshPromise;
  refreshPromise = (async () => {
    const res = await fetch("/api/user/refresh", {
      credentials: "include",
      ...withCsrfProtection({
        method: "POST",
      }),
    });
    const json = await hentJson(res);
    if (!res.ok) {
      throw new SessionExpiredError(
        extractApiErrorMessage(json, "Kunne ikke fornye sesjon"),
      );
    }
    return RefreshResponseSchema.parse(json);
  })();
  try {
    return await refreshPromise;
  } finally {
    refreshPromise = null;
  }
}
// Lagre Canvas token for innlogget bruker (multi-tenant: eksplisitt Canvas-instans-URL)
interface SaveCanvasTokenInput {
  token: string;
  forceRelink?: boolean;
  /** Canvas base URL for brukerens institusjon (f.eks. https://ntnu.instructure.com). */
  canvasBaseUrl: string;
}

async function lagreCanvasTokenRequest(
  { token, forceRelink = false, canvasBaseUrl }: SaveCanvasTokenInput,
  forsoktRefresh = false,
): Promise<CanvasTokenResponse> {
  const url = forceRelink ? "/api/user/token?force=true" : "/api/user/token";
  const res = await fetch(url, {
    credentials: "include",
    cache: "no-store",
    ...withCsrfProtection({
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token, canvasBaseUrl }),
    }),
  });
  const json = await hentJson(res);
  if ((res.status === 401 || res.status === 403) && !forsoktRefresh) {
    await fornySesjon();
    return lagreCanvasTokenRequest({ token, forceRelink, canvasBaseUrl }, true);
  }
  if (!res.ok) {
    throw lagCanvasTokenFeil(json, res.status, "Kunne ikke lagre token");
  }
  return CanvasTokenResponseSchema.parse(json);
}

async function lagreCanvasToken(input: SaveCanvasTokenInput): Promise<CanvasTokenResponse> {
  return lagreCanvasTokenRequest(input);
}
// Hook for innlogging
export function useLoggInn() {
  return useMutation({
    mutationFn: loggInn,
  });
}
// Hook for registrering av ny bruker
export function useRegistrer() {
  return useMutation({
    mutationFn: registrer,
  });
}
// Hook for å hente info om innlogget bruker
// initialData: kun MeResponse ved bekrevet innlogget – aldri null (unngår at SSR-feil caches som "gjest" i 5 min)
export function useMeg(options?: { initialData?: MeResponse }) {
  return useQuery({
    queryKey: AUTH_ME_QUERY_KEY,
    queryFn: hentMeg,
    retry: (failureCount, error) => {
      // Ikke prøv igjen ved ugyldig auth (401/403)
      if (AppError.isAppError(error) && error.requiresReauth()) {
        return false;
      }
      const message = error instanceof Error ? error.message : String(error);
      if (message.includes("401") || message.includes("403") || message.includes("Ikke autentisert")) {
        return false;
      }
      // Prøv opptil 5 ganger ved nettverksfeil (ECONNREFUSED ved oppstart)
      return failureCount < 5;
    },
    retryDelay: (attemptIndex) => Math.min(1000 * 2 ** attemptIndex, 8000), // 1s, 2s, 4s, 8s
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
  const queryClient = useQueryClient();
  return useCallback(async () => {
    try {
      await loggUt.mutateAsync();
    } catch (error) {
      if (!AppError.isAppError(error) || !error.requiresReauth()) {
        showToast.error("Kunne ikke logge ut", "Prøv igjen.");
        return;
      }
    }
    broadcastLogout();
    clearDatadogUser();
    queryClient.clear();
    useUIStore.getState().reset();
    window.location.href = "/";
  }, [loggUt, queryClient]);
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
