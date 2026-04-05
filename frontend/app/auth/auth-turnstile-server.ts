import { cookies } from "next/headers";
import {
  AUTH_TURNSTILE_COOKIE_NAME,
  validateAuthTurnstileCookieValue,
} from "common/auth";

export async function hasValidAuthTurnstileCookie(): Promise<boolean> {
  const secret = process.env.AUTH_TURNSTILE_GATE_SECRET?.trim();
  if (!secret) return false;

  const cookieStore = await cookies();
  const rawValue = cookieStore.get(AUTH_TURNSTILE_COOKIE_NAME)?.value;
  return validateAuthTurnstileCookieValue(rawValue, secret);
}
