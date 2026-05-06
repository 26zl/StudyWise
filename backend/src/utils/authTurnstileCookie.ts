/**
 * Cookie- og nonce-håndtering for auth-Turnstile (sign-up/sign-in-gate).
 * Bruker Redis (med in-memory fallback) for å hindre gjenbruk av samme nonce.
 */

import crypto from "crypto";
import type { Response, CookieOptions } from "express";
import {
  AUTH_TURNSTILE_COOKIE_NAME,
  AUTH_TURNSTILE_COOKIE_VERSION,
  parseAuthTurnstileCookie,
} from "common/auth";
import { isProd } from "./env.js";
import { setCacheNX, isRedisReady } from "../cache/redis.js";
import { logger } from "./logger.js";

// Path "/" slik at cookien sendes til alle backend-ruter (brukes for server-side Turnstile-gate ved brukeropprettelse)
const AUTH_TURNSTILE_COOKIE_PATH = "/";
const AUTH_TURNSTILE_COOKIE_TTL_MS = 5 * 60 * 1000;

/**
 * Redis-prefix for forbrukte Turnstile-nonce-er.
 * Atomisk single-use via SET NX: kun første sesjon som konsumerer noncen får den.
 * Andre sesjoner får turnstile_required og håndteres av TurnstileReChallenge
 * (Cloudflare auto-passer nylig verifiserte nettlesere, så re-challenge er usynlig/instant).
 */
const TURNSTILE_NONCE_PREFIX = "auth:turnstile-nonce:";
/** TTL for forbrukte nonce-er — matcher cookie-TTL + litt margin. */
const TURNSTILE_NONCE_TTL_S = Math.ceil(AUTH_TURNSTILE_COOKIE_TTL_MS / 1000) + 60;

// In-memory fallback for nonce-dedupe når Redis er nede
const localNonceCache = new Map<string, number>();
const LOCAL_NONCE_MAX_SIZE = 500;

function cleanupLocalNonceCache(): void {
  if (localNonceCache.size <= LOCAL_NONCE_MAX_SIZE) return;
  const now = Date.now();
  for (const [key, ts] of localNonceCache) {
    if (now - ts > TURNSTILE_NONCE_TTL_S * 1000) localNonceCache.delete(key);
  }
}

function getAuthTurnstileGateSecret(): string {
  const secret = process.env.AUTH_TURNSTILE_GATE_SECRET?.trim();
  if (!secret) {
    throw new Error("AUTH_TURNSTILE_GATE_SECRET mangler");
  }

  return secret;
}

function createCookieSignature(nonce: string, expiresAt: number): string {
  return crypto
    .createHmac("sha256", getAuthTurnstileGateSecret())
    .update(`${AUTH_TURNSTILE_COOKIE_VERSION}:${nonce}:${expiresAt}`)
    .digest("hex");
}

export function createAuthTurnstileCookieValue(now = Date.now()): string {
  const expiresAt = now + AUTH_TURNSTILE_COOKIE_TTL_MS;
  const nonce = crypto.randomBytes(16).toString("hex"); // 32 hex chars
  const signature = createCookieSignature(nonce, expiresAt);
  return `${AUTH_TURNSTILE_COOKIE_VERSION}.${nonce}.${expiresAt}.${signature}`;
}

export function getAuthTurnstileCookieOptions(): CookieOptions {
  return {
    httpOnly: true,
    secure: isProd,
    sameSite: "lax",
    path: AUTH_TURNSTILE_COOKIE_PATH,
    maxAge: AUTH_TURNSTILE_COOKIE_TTL_MS,
  };
}

export function clearAuthTurnstileCookie(res: Response): void {
  res.clearCookie(AUTH_TURNSTILE_COOKIE_NAME, {
    ...getAuthTurnstileCookieOptions(),
    maxAge: undefined,
  });
}

/**
 * Validerer en rå Turnstile-cookie-verdi (server-side gate).
 * Sjekker HMAC-signatur og utløp via common/auth, og håndhever atomisk
 * single-use via Redis SET NX.
 *
 * Cookien opprettes pre-auth (før Clerk-sesjon finnes) og kan derfor ikke
 * bindes til en bestemt sesjon ved utstedelse. Sesjons-binding skjer etter
 * konsumering via markSessionTurnstileVerified(sid).
 *
 * Designvalg — én cookie = én sesjon:
 * - Noncen konsumeres atomisk (SET NX) — kun første sesjon vinner.
 * - Cookien slettes fra nettleseren etter konsumering.
 * - Andre sesjoner i samme nettleser får turnstile_required og håndteres
 *   av TurnstileReChallenge (inline re-verifisering).
 * - Cloudflare auto-passer nylig verifiserte nettlesere, så re-challenge
 *   er typisk usynlig/instant for ekte brukere.
 */
export async function isValidAuthTurnstileCookieValue(
  rawValue: string | undefined,
): Promise<boolean> {
  const secret = process.env.AUTH_TURNSTILE_GATE_SECRET?.trim();
  if (!secret) return false;

  const { valid, nonce } = await parseAuthTurnstileCookie(rawValue, secret);
  if (!valid || !nonce) return false;

  // Atomisk single-use via SET NX: kun den første forespørselen får sette nøkkelen.
  const redisKey = `${TURNSTILE_NONCE_PREFIX}${nonce}`;

  if (isRedisReady()) {
    const wasSet = await setCacheNX(redisKey, "1", TURNSTILE_NONCE_TTL_S);
    if (!wasSet) {
      logger.warn({ nonce: nonce.slice(0, 8) }, "Turnstile-cookie nonce allerede forbrukt");
      return false;
    }
    localNonceCache.set(nonce, Date.now());
    cleanupLocalNonceCache();
  } else {
    // Redis nede — bruk in-memory fallback (per dyno)
    const localTs = localNonceCache.get(nonce);
    if (localTs && Date.now() - localTs < TURNSTILE_NONCE_TTL_S * 1000) {
      logger.warn({ nonce: nonce.slice(0, 8) }, "Turnstile-cookie nonce allerede forbrukt (lokal fallback)");
      return false;
    }
    localNonceCache.set(nonce, Date.now());
    cleanupLocalNonceCache();
  }

  return true;
}
