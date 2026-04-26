import {
  AuthTurnstileVerifyResponseSchema,
  type AuthTurnstileVerifyResponse,
} from "common/auth";
import { fetchApi } from "@/app/lib/apiClient";
import { createApiError, parseApiJson } from "@/app/lib/errorUtils";
import { turnstileEnabled } from "@/app/lib/validateEnv";

/**
 * Pre-flight sjekk av Turnstile-cookie. Returnerer true hvis gyldig.
 * Brukes av forgot-password-flyten for å sikre at human-check er bestått
 * før klient-side auth-operasjoner sendes til Clerk.
 *
 * Når Turnstile er deaktivert globalt: returner true uten nettverkskall.
 */
export async function checkAuthTurnstileGate(): Promise<boolean> {
  if (!turnstileEnabled) return true;

  try {
    const res = await fetchApi(
      "/api/auth-turnstile/gate",
      { method: "GET" },
      { auth: false },
    );
    return res.ok;
  } catch {
    return false;
  }
}

export async function verifyAuthTurnstile(
  turnstileToken: string,
): Promise<AuthTurnstileVerifyResponse> {
  const res = await fetchApi(
    "/api/auth-turnstile/verify",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ turnstileToken }),
    },
    { auth: false },
  );
  const json = await parseApiJson(res);

  if (!res.ok) {
    throw createApiError(json, "Kunne ikke verifisere Cloudflare Turnstile");
  }

  return AuthTurnstileVerifyResponseSchema.parse(json);
}
