/**
 * Auth – server-only utilities som krever Node.js `crypto`.
 *
 * Disse må IKKE importeres fra klient-React. De brukes kun fra:
 *   - backend (Express)
 *   - Next.js server-side helpers (proxy, middleware, server components, route handlers)
 *
 * Splittet ut fra `common/auth` slik at klient-bundlere (Webpack uten special-config,
 * esbuild for browser, Vite) ikke prøver å resolve `node:crypto` når de bygger
 * klient-bundlen. Tidligere lå disse i `common/auth` med dynamisk `await import`,
 * men selv da ble Webpack tvunget til å analysere stringen og kastet
 * `UnhandledSchemeError`. Splittingen gjør at klient-koden kun importerer
 * skjemaer/konstanter fra `common/auth`, mens server-koden henter HMAC-validatorene
 * herfra.
 */

import { AUTH_TURNSTILE_COOKIE_VERSION } from "./auth.js";

/**
 * Validerer en rå Turnstile-cookie-verdi mot en HMAC-signatur.
 * Format: v1.<nonce>.<expiresAt>.<signature>
 * HMAC dekker versjon, nonce og utløpstid for å binde cookien til en unik challenge.
 */
export async function validateAuthTurnstileCookieValue(
  rawValue: string | undefined,
  secret: string,
): Promise<boolean> {
  const result = await parseAuthTurnstileCookie(rawValue, secret);
  return result.valid;
}

/**
 * Parser og validerer Turnstile-cookien. Returnerer { valid, nonce } slik at
 * backend kan håndheve server-side single-use via Redis.
 */
export async function parseAuthTurnstileCookie(
  rawValue: string | undefined,
  secret: string,
): Promise<{ valid: boolean; nonce: string | null }> {
  if (!rawValue || !secret) return { valid: false, nonce: null };

  const parts = rawValue.split(".");
  if (parts.length !== 4) return { valid: false, nonce: null };

  const [version, nonce, expiresAt, signature] = parts;
  if (version !== AUTH_TURNSTILE_COOKIE_VERSION || !nonce || !expiresAt || !signature) {
    return { valid: false, nonce: null };
  }

  if (!/^[a-f0-9]{32}$/i.test(nonce) || !/^\d+$/.test(expiresAt) || !/^[a-f0-9]{64}$/i.test(signature)) {
    return { valid: false, nonce: null };
  }

  const crypto = await import("node:crypto");
  const expected = crypto
    .createHmac("sha256", secret)
    .update(`${AUTH_TURNSTILE_COOKIE_VERSION}:${nonce}:${expiresAt}`)
    .digest("hex");

  const isValid = crypto.timingSafeEqual(
    Buffer.from(signature, "hex"),
    Buffer.from(expected, "hex"),
  );

  if (!isValid || Number(expiresAt) <= Date.now()) {
    return { valid: false, nonce: null };
  }

  return { valid: true, nonce };
}
