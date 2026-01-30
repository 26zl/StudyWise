/*
 * Hooks og funksjoner for å kommunisere med auth-backend APIet
 * Inkluderer innlogging, registrering, utlogging, henting av brukerinfo og lagring av Canvas token
 */

import { useMutation, useQuery } from "@tanstack/react-query";
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
  type LoginRequest,
  type RegisterRequest,
} from "common";

let refreshPromise: Promise<RefreshResponse> | null = null;

// Hent json uansett for bedre feilhåndtering
const hentJson = async (res: Response) => {
  try {
    return await res.json();
  } catch {
    return {};
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
async function loggUt(): Promise<LogoutResponse> {
  const res = await fetch("/api/user/logout", {
    method: "POST",
    credentials: "include",
  });
  const json = await hentJson(res);
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
async function lagreCanvasToken(token: string): Promise<CanvasTokenResponse> {
  const res = await fetch("/api/user/token", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ token }),
  });
  // Hent json uansett for bedre feilhåndtering
  const json = await hentJson(res);
  if (!res.ok) {
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
export function useMeg() {
  return useQuery({
    queryKey: ["auth", "me"],
    queryFn: hentMeg,
    retry: false, // Ikke retry auth-feil - brukeren er enten logget inn eller ikke
    staleTime: 1000 * 60 * 5, // Cache i 5 minutter - unngår unødvendige requests
    refetchOnWindowFocus: false, // Ikke refetch ved window focus
  });
}
// Hook for utlogging
export function useLoggUt() {
  return useMutation({
    mutationFn: loggUt,
  });
}
// Hook for lagring av Canvas token
export function useLagreCanvasToken() {
  return useMutation({
    mutationFn: lagreCanvasToken,
  });
}