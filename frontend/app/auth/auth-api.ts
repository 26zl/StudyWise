/*
 * Hooks og funksjoner for å kommunisere med auth-backend APIet
 * Inkluderer innlogging, registrering, utlogging, henting av brukerinfo og lagring av Canvas token
 */

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
  type PreferencesResponse,
} from "common/auth";
import { SessionExpiredError } from "../lib/errors";

let refreshPromise: Promise<RefreshResponse> | null = null;

export class CanvasTokenConflictError extends Error {
  readonly canvasKonflikt = true;
  readonly name = "CanvasTokenConflictError";

  constructor(message: string) {
    super(message);
  }
}

// Hent JSON fra response — returnerer tomt objekt kun hvis body er tomt (204 etc.)
const hentJson = async (res: Response) => {
  const text = await res.text();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    // Ikke-JSON respons (f.eks. HTML feilside) — kast med kontekst
    throw new Error(`Uventet respons fra server (${res.status}): ${text.slice(0, 100)}`);
  }
};
// Innlogging
async function loggInn(data: LoginRequest): Promise<LoginResponse> {
  const res = await fetch("/api/user/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(data),
  });
  const json = await hentJson(res);
  if (!res.ok) {
    throw new Error(json.melding || json.feil || "Innlogging feilet");
  }
  return LoginResponseSchema.parse(json);
}
// Registrering av ny bruker
async function registrer(data: RegisterRequest): Promise<RegisterResponse> {
  const res = await fetch("/api/user/register", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(data),
  });
  const json = await hentJson(res);
  if (!res.ok) {
    throw new Error(json.melding || json.feil || "Kunne ikke registrere bruker");
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
      throw new Error("Ikke autentisert");
    }
    // Refresh OK - prøv /me igjen
    const resRetry = await fetch("/api/user/me", {
      method: "GET",
      credentials: "include",
      cache: "no-store",
    });
    const jsonRetry = await hentJson(resRetry);
    if (!resRetry.ok) {
      throw new Error(jsonRetry.melding || jsonRetry.feil || "Ikke autentisert");
    }
    return MeResponseSchema.parse(jsonRetry);
  }
  throw new Error(json.melding || json.feil || "Ikke autentisert");
}
// Utlogging
async function loggUt(
  forsoktRefresh = false,
): Promise<LogoutResponse> {
  const res = await fetch("/api/user/logout", {
    method: "POST",
    credentials: "include",
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
      json.melding || json.feil || "Sesjonen er allerede utløpt.",
    );
  }
  if (!res.ok) {
    throw new Error(json.melding || json.feil || "Kunne ikke logge ut");
  }
  return LogoutResponseSchema.parse(json);
}
// Forny sesjon ved utløpt autentisering
export async function fornySesjon(): Promise<RefreshResponse> {
  if (refreshPromise) return refreshPromise;
  refreshPromise = (async () => {
    const res = await fetch("/api/user/refresh", {
      method: "POST",
      credentials: "include",
    });
    const json = await hentJson(res);
    if (!res.ok) {
      throw new Error(json.melding || json.feil || "Kunne ikke fornye sesjon");
    }
    return RefreshResponseSchema.parse(json);
  })();
  try {
    return await refreshPromise;
  } finally {
    refreshPromise = null;
  }
}
// Lagre Canvas token for innlogget bruker
interface SaveCanvasTokenInput {
  token: string;
  forceRelink?: boolean;
}

async function lagreCanvasToken({
  token,
  forceRelink = false,
}: SaveCanvasTokenInput): Promise<CanvasTokenResponse> {
  const url = forceRelink ? "/api/user/token?force=true" : "/api/user/token";
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ token }),
  });
  // Hent json uansett for bedre feilhåndtering
  const json = await hentJson(res);
  if (!res.ok) {
    if (json.canvasKonflikt) {
      throw new CanvasTokenConflictError(
        json.melding || json.feil || "Canvas-kontoen er allerede koblet til en annen bruker",
      );
    }
    throw new Error(json.melding || json.feil || "Kunne ikke lagre token");
  }
  return CanvasTokenResponseSchema.parse(json);
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
export function useMeg(options?: { initialData?: MeResponse }) {
  return useQuery({
    queryKey: ["auth", "me"],
    queryFn: hentMeg,
    retry: (failureCount, error) => {
      // Ikke prøv igjen ved ugyldig auth (401/403)
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
// Hook for lagring av Canvas token
export function useLagreCanvasToken() {
  return useMutation({
    mutationFn: lagreCanvasToken,
  });
}

// Slett Canvas token for innlogget bruker
async function slettCanvasToken(): Promise<CanvasTokenResponse> {
  const res = await fetch("/api/user/token", {
    method: "DELETE",
    credentials: "include",
  });
  const json = await hentJson(res);
  if (!res.ok) {
    throw new Error(json.melding || json.feil || "Kunne ikke slette token");
  }
  return CanvasTokenResponseSchema.parse(json);
}

// Hook for sletting av Canvas token
export function useSlettCanvasToken() {
  return useMutation({
    mutationFn: slettCanvasToken,
  });
}

// Oppdater Canvas-kontekst preferanser
async function oppdaterPreferanser(preferences: CanvasContextPreferences): Promise<PreferencesResponse> {
  const res = await fetch("/api/user/preferences", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ canvasContextPreferences: preferences }),
  });
  const json = await hentJson(res);
  if (!res.ok) {
    throw new Error(json.melding || json.feil || "Kunne ikke oppdatere preferanser");
  }
  return PreferencesResponseSchema.parse(json);
}

// Hook for oppdatering av Canvas-kontekst preferanser
export function useOppdaterPreferanser() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: oppdaterPreferanser,
    onSuccess: () => {
      // Oppdater cached brukerdata
      queryClient.invalidateQueries({ queryKey: ["auth", "me"] });
    },
  });
}
