import crypto from "crypto";
import { cookies } from "next/headers";
import { AUTH_TURNSTILE_COOKIE_NAME } from "common/auth";

const AUTH_TURNSTILE_COOKIE_VERSION = "v1";

function getAuthTurnstileGateSecret(): string {
  const secret = process.env.AUTH_TURNSTILE_GATE_SECRET?.trim();
  if (!secret) {
    throw new Error("AUTH_TURNSTILE_GATE_SECRET mangler");
  }

  return secret;
}

function isValidSignature(expiresAt: string, signature: string): boolean {
  if (!/^\d+$/.test(expiresAt) || !/^[a-f0-9]{64}$/i.test(signature)) {
    return false;
  }

  const expected = crypto
    .createHmac("sha256", getAuthTurnstileGateSecret())
    .update(`${AUTH_TURNSTILE_COOKIE_VERSION}:${expiresAt}`)
    .digest("hex");

  return crypto.timingSafeEqual(
    Buffer.from(signature, "hex"),
    Buffer.from(expected, "hex"),
  );
}

export async function hasValidAuthTurnstileCookie(): Promise<boolean> {
  const cookieStore = await cookies();
  const rawValue = cookieStore.get(AUTH_TURNSTILE_COOKIE_NAME)?.value;
  if (!rawValue) {
    return false;
  }

  const [version, expiresAt, signature] = rawValue.split(".");
  if (version !== AUTH_TURNSTILE_COOKIE_VERSION || !expiresAt || !signature) {
    return false;
  }

  if (!isValidSignature(expiresAt, signature)) {
    return false;
  }

  return Number(expiresAt) > Date.now();
}
