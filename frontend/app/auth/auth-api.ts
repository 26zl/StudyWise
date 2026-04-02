/*
 * Auth API: Clerk-only. Hooks for /me, logout, Canvas token, preferences.
 */

import { useCallback, useMemo, useRef } from "react";
import { useClerk } from "@clerk/nextjs";
import { useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { AUTH_QUERY_OPTIONS } from "../lib/queryConfig";
import {
  CanvasTokenResponseSchema,
  MeResponseSchema,
  LogoutResponseSchema,
  AccountDeletionResponseSchema,
  ProfileUpdateResponseSchema,
  type CanvasTokenResponse,
  type MeResponse,
  type LogoutResponse,
  type AccountDeletionResponse,
  type ProfileUpdateResponse,
  type ProfileUpdateWithUsername,
  PreferencesResponseSchema,
  type CanvasContextPreferences,
  type VarslerState,
  type PreferencesResponse,
  type UIPreferences,
  type ManuellInnleveringState,
  type HiddenCourseIds,
  type SyncConflictType,
} from "common/auth";
import { type BrowserPushPreferences } from "common/notifications";
import { CanvasErrorCodeSchema } from "common/canvasErrors";
import { AppError, CanvasApiError, UsernameConflictError } from "../lib/errors";
import { fetchApi } from "../lib/apiClient";
import { broadcastLogout, clearClientAuthState } from "../hooks/use-auth-sync";
import { showToast } from "@/app/components/ui/Toaster";
import type { ZodType } from "zod";
import {
  createApiError,
  createAuthStatusError,
  erFatalUserDataFeilmelding,
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
      manuellInnleveringState:
        updated.manuellInnleveringState ?? current.user.manuellInnleveringState,
      browserPushPreferences:
        updated.browserPushPreferences ?? current.user.browserPushPreferences,
      uiPreferences: updated.uiPreferences ?? current.user.uiPreferences,
      hiddenCourseIds:
        updated.hiddenCourseIds ?? current.user.hiddenCourseIds,
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

// Alle autentiserte kall går via fetchAuthedJson for konsistent auth/CSRF/feilhåndtering.
async function requestAuthedJson<T>(
  url: string,
  schema: ZodType<T>,
  defaultErrorMessage: string,
  init: RequestInit = {},
): Promise<T> {
  const { fetchAuthedJson } = await import("../lib/apiClient");
  const { data } = await fetchAuthedJson(url, init, { defaultErrorMessage });
  return schema.parse(data);
}

// Timeout for /me – Professional dyno sover ikke, 10s er nok
const ME_REQUEST_TIMEOUT_MS = 10_000;

// Hent info om innlogget bruker (Clerk token i Authorization header).
// Signal fra React Query brukes; 25s timeout unngår evig venting ved kald backend i prod.
async function hentMeg(signal?: AbortSignal, options?: { forceSync?: boolean }): Promise<MeResponse> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), ME_REQUEST_TIMEOUT_MS);
  if (signal) {
    signal.addEventListener(
      "abort",
      () => {
        clearTimeout(timeoutId);
        controller.abort();
      },
      { once: true },
    );
  }
  try {
    const url = options?.forceSync ? "/api/user/me?forceSync=true" : "/api/user/me";
    const res = await fetchApi(url, {
      method: "GET",
      signal: controller.signal,
    });
    const json = await parseApiJson(res);
    clearTimeout(timeoutId);
    if (res.ok) {
      return MeResponseSchema.parse(json);
    }
    if (
      res.status === 403 &&
      json &&
      typeof json === "object" &&
      "error" in json &&
      json.error === "user_deleted"
    ) {
      // Slettet bruker: skal IKKE trigge auth-redirect (ville skapt en uendelig loop).
      // Frontend må logge ut fra Clerk og vise en tydelig melding.
      // Varsle andre faner slik at de også rydder opp.
      broadcastLogout();
      throw createApiError(
        json,
        "Denne kontoen er slettet. Opprett en ny konto for å fortsette.",
      );
    }
    if (res.status === 401 || res.status === 403) {
      throw createAuthStatusError(res.status, json, "Ikke autentisert");
    }
    if (res.status === 409) {
      const payload = json && typeof json === "object" ? json : {};
      const errorType =
        "error" in payload
          ? (payload as Record<string, unknown>).error
          : undefined;

      // Alle konflikter: logg ut og vis melding.
      broadcastLogout();

      if (errorType === "username_conflict") {
        const username =
          typeof (payload as Record<string, unknown>).username === "string"
            ? ((payload as Record<string, unknown>).username as string)
            : "";
        throw createApiError(
          json,
          `Brukernavnet «${username}» er allerede tatt. Velg et annet brukernavn og prøv igjen.`,
        );
      }
      if (
        errorType === "oauth_account_conflict" ||
        errorType === "oauth_metadata_missing"
      ) {
        throw createApiError(
          json,
          "Denne innloggingskontoen er allerede koblet til en annen StudyWise-bruker. " +
            "Den eksisterende kontoen må slettes først. Du blir logget ut.",
        );
      }
      throw createApiError(
        json,
        "Kontoen din har en innloggingskonflikt. Du blir logget ut. Prøv å logge inn med en annen metode.",
      );
    }
    throw createApiError(json, "Kunne ikke hente brukerdata");
  } catch (err) {
    clearTimeout(timeoutId);
    if (err instanceof Error && err.name === "AbortError") {
      throw createApiError(
        {
          melding:
            "Forespørselen tok for lang tid. Backend kan være kald – prøv igjen.",
        },
        "Kunne ikke hente brukerdata",
      );
    }
    throw err;
  }
}

/** Prefetch /me for raskere dashboard – kalles fra app-shell når bruker er innlogget. */
export function prefetchMe(queryClient: QueryClient): void {
  void queryClient.prefetchQuery({
    queryKey: AUTH_ME_QUERY_KEY,
    queryFn: ({ signal }) => hentMeg(signal),
  });
}

/** Tving en full profilsynk fra Clerk til MongoDB og oppdater /me-cache. */
export async function forceSyncMe(queryClient: QueryClient): Promise<void> {
  const data = await hentMeg(undefined, { forceSync: true });
  queryClient.setQueryData(AUTH_ME_QUERY_KEY, data);
}

/** Avvis en synkroniseringskonflikt (bruker har sett og bekreftet). */
export async function dismissSyncConflict(
  type: SyncConflictType,
): Promise<void> {
  const res = await fetchApi("/api/user/sync-conflicts/dismiss", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ type }),
  });
  if (!res.ok) {
    throw new Error("Kunne ikke fjerne synkroniseringskonflikten");
  }
}

// Utlogging rydder backend-state; Clerk-session avsluttes i useLoggUtWithRedirect.
async function loggUt(): Promise<LogoutResponse> {
  const res = await fetchApi("/api/user/logout", { method: "POST" });
  const json = await parseApiJson(res);
  if (res.status === 401 || res.status === 403) {
    throw createAuthStatusError(
      res.status,
      json,
      "Sesjonen er allerede utløpt.",
    );
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

async function lagreCanvasToken(
  input: SaveCanvasTokenInput,
): Promise<CanvasTokenResponse> {
  const url = input.forceRelink
    ? "/api/user/token?force=true"
    : "/api/user/token";
  const res = await fetchApi(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      token: input.token,
      canvasBaseUrl: input.canvasBaseUrl,
    }),
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
export function useMeg(options?: {
  initialData?: MeResponse;
  enabled?: boolean;
}) {
  return useQuery({
    queryKey: AUTH_ME_QUERY_KEY,
    queryFn: ({ signal }) => hentMeg(signal),
    enabled: options?.enabled,
    retry: (failureCount, error) => {
      const isAuthError = erReauthFeil(error);
      // Etter Clerk-innlogging kan første /me feile pga. timing – tillat én retry med kort delay
      if (isAuthError) {
        return failureCount < 1;
      }
      // Konto-konflikt (409) og slettet bruker (403) er deterministiske — retry hjelper ikke
      const msg = error instanceof Error ? error.message : "";
      if (erFatalUserDataFeilmelding(msg)) {
        return false;
      }
      if (
        msg.includes("kontoen er slettet") ||
        msg.includes("Denne kontoen er slettet")
      )
        return false;
      // Maks 2 retries ved nettverksfeil — unngår lang ventetid
      return failureCount < 2;
    },
    retryDelay: (attemptIndex, error) => {
      const isAuthError = erReauthFeil(error);
      if (isAuthError && attemptIndex === 0) return 200;
      return Math.min(1000 * 2 ** attemptIndex, 4000);
    },
    ...AUTH_QUERY_OPTIONS,
    initialData: options?.initialData,
  });
}
// Oppdater brukerprofil (fornavn, etternavn, brukernavn)
async function oppdaterProfil(
  data: ProfileUpdateWithUsername,
): Promise<ProfileUpdateResponse> {
  const res = await fetchApi("/api/user/profile", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  const json = await parseApiJson(res);

  if (res.status === 401 || res.status === 403) {
    throw createAuthStatusError(res.status, json, "Ikke autentisert");
  }

  // Strukturert håndtering av brukernavn-konflikt (409)
  if (res.status === 409) {
    const payload = json && typeof json === "object" ? json : {};
    const errorType =
      "error" in payload
        ? (payload as Record<string, unknown>).error
        : undefined;
    if (errorType === "username_conflict") {
      const username =
        typeof (payload as Record<string, unknown>).username === "string"
          ? ((payload as Record<string, unknown>).username as string)
          : (data.username ?? "");
      throw new UsernameConflictError(username);
    }
    throw createApiError(json, "Kunne ikke oppdatere profil");
  }

  if (!res.ok) {
    throw createApiError(json, "Kunne ikke oppdatere profil");
  }

  return ProfileUpdateResponseSchema.parse(json);
}

// Hook for oppdatering av brukerprofil
export function useOppdaterProfil() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: oppdaterProfil,
    onMutate: async (updates) => {
      await queryClient.cancelQueries({ queryKey: AUTH_ME_QUERY_KEY });
      const previous = queryClient.getQueryData<MeResponse | undefined>(
        AUTH_ME_QUERY_KEY,
      );

      queryClient.setQueryData<MeResponse | undefined>(
        AUTH_ME_QUERY_KEY,
        (current) => {
          if (!current) return current;

          const nextUser = {
            ...current.user,
            ...(updates.firstName !== undefined
              ? { firstName: updates.firstName || undefined }
              : {}),
            ...(updates.lastName !== undefined
              ? { lastName: updates.lastName || undefined }
              : {}),
            ...("username" in updates && updates.username !== undefined
              ? { username: updates.username || undefined }
              : {}),
          };

          return MeResponseSchema.parse({
            user: nextUser,
          });
        },
      );

      return { previous };
    },
    onError: (_error, _updates, context) => {
      if (context?.previous) {
        queryClient.setQueryData(AUTH_ME_QUERY_KEY, context.previous);
      }
    },
    onSuccess: (data) => {
      // Oppdater cached /me-data med ny profilinfo
      queryClient.setQueryData<MeResponse | undefined>(
        AUTH_ME_QUERY_KEY,
        (current) => {
          if (!current) return current;
          return MeResponseSchema.parse({
            user: { ...current.user, ...data.user },
          });
        },
      );
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: AUTH_ME_QUERY_KEY });
    },
  });
}

// Hook for utlogging
function useLoggUt() {
  return useMutation({
    mutationFn: () => loggUt(),
  });
}

/** Felles logout-flyt: kaller API, varsler andre faner, rydder cache og UI, redirect til /. */
export function useLoggUtWithRedirect() {
  const loggUt = useLoggUt();
  const clerk = useClerk();
  const queryClient = useQueryClient();
  const logoutInFlightRef = useRef(false);
  return useCallback(async () => {
    if (logoutInFlightRef.current || loggUt.isPending) {
      return;
    }
    logoutInFlightRef.current = true;

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
      showToast.error(
        "Kunne ikke logge ut",
        "Innloggingssesjonen kunne ikke avsluttes. Prøv igjen.",
      );
      logoutInFlightRef.current = false;
      return;
    }

    // Når Clerk-signout er bekreftet, rydd lokal state og varsle andre faner.
    // Dette unngår race der samme fane redirectes av auth-sync før signOut er fullført.
    clearClientAuthState(queryClient);
    broadcastLogout();

    window.location.replace("/");
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
  manuellInnleveringState?: ManuellInnleveringState;
  browserPushPreferences?: BrowserPushPreferences;
  uiPreferences?: UIPreferences;
  hiddenCourseIds?: HiddenCourseIds;
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
      keepalive: true,
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
function useOppdaterPreferanser() {
  return useOppdaterBrukerPreferanser(
    (canvasContextPreferences: CanvasContextPreferences) => ({
      canvasContextPreferences,
    }),
  );
}

// Hook for oppdatering av varslingspreferanser
export function useOppdaterVarslerState() {
  return useOppdaterBrukerPreferanser((varslerState: VarslerState) => ({
    varslerState,
  }));
}

// Hook for oppdatering av manuell innlevering (database er autoritativ)
export function useOppdaterManuellInnleveringState() {
  return useOppdaterBrukerPreferanser(
    (manuellInnleveringState: ManuellInnleveringState) => ({
      manuellInnleveringState,
    }),
  );
}

export function useOppdaterBrowserPushPreferanser() {
  return useOppdaterBrukerPreferanser(
    (browserPushPreferences: BrowserPushPreferences) => ({
      browserPushPreferences,
    }),
  );
}

// Hook for oppdatering av UI-preferanser (språk, tema, cookie-samtykke)
export function useOppdaterUIPreferanser() {
  return useOppdaterBrukerPreferanser((uiPreferences: UIPreferences) => ({
    uiPreferences,
  }));
}

// Hook for oppdatering av skjulte emner
export function useOppdaterHiddenCourses() {
  return useOppdaterBrukerPreferanser((hiddenCourseIds: HiddenCourseIds) => ({
    hiddenCourseIds,
  }));
}

/** Set av skjulte emne-IDer fra /me-data. Brukes for å filtrere Canvas-data overalt. */
export function useHiddenCourseIds(): Set<number> {
  const megQuery = useMeg();
  const hiddenIds = megQuery.data?.user?.hiddenCourseIds?.courseIds ?? [];
  return useMemo(() => new Set(hiddenIds), [hiddenIds]);
}

/** Debounce-intervall før preferanseoppdatering sendes til backend (ms). */
const PREFERENCES_DEBOUNCE_MS = 500;

/**
 * Debounced oppdatering av Canvas-kontekst preferanser.
 * Samler flere endringer og sender én PUT etter PREFERENCES_DEBOUNCE_MS uten nye endringer.
 */
export function useDebouncedPreferanseOppdater() {
  const queryClient = useQueryClient();
  const { mutateAsync, isPending } = useOppdaterPreferanser();
  const pendingRef = useRef<CanvasContextPreferences | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const flushRef = useRef<() => void>(() => {});

  const flush = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    const p = pendingRef.current;
    pendingRef.current = null;
    if (p) {
      mutateAsync(p).catch(() => {
        queryClient.invalidateQueries({ queryKey: AUTH_ME_QUERY_KEY });
        showToast.error("Kunne ikke oppdatere AI-kontekst", "Prøv igjen.");
      });
    }
  }, [mutateAsync, queryClient]);

  flushRef.current = flush;

  const mutate = useCallback((value: CanvasContextPreferences) => {
    pendingRef.current = value;
    if (timerRef.current) clearTimeout(timerRef.current);
    // Kaller via ref slik at ingen brukerdata flyter inn i setTimeout-callback (Snyk code-injection).
    timerRef.current = setTimeout(() => {
      flushRef.current();
    }, PREFERENCES_DEBOUNCE_MS);
  }, []);

  return { mutate, isPending, flush };
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

// Re-eksporter typer fra common for enkel import
export type { ProfileUpdateWithUsername };
