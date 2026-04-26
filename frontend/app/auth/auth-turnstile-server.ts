import { cookies } from "next/headers";
import {
  AUTH_TURNSTILE_COOKIE_NAME,
  validateAuthTurnstileCookieValue,
} from "common/auth";
import { turnstileEnabled } from "@/app/lib/validateEnv";

export async function hasValidAuthTurnstileCookie(): Promise<boolean> {
  // Når Turnstile er deaktivert globalt: returner true så alle ned-strøms-flows
  // (forgot-password osv.) hopper rett til innhold uten gate-sjekk.
  if (!turnstileEnabled) return true;

  const secret = process.env.AUTH_TURNSTILE_GATE_SECRET?.trim();
  if (!secret) return false;

  const cookieStore = await cookies();
  const rawValue = cookieStore.get(AUTH_TURNSTILE_COOKIE_NAME)?.value;
  return validateAuthTurnstileCookieValue(rawValue, secret);
}
