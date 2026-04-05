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

/** Redis-prefix for forbrukte Turnstile-nonce-er (atomisk single-use). */
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
 * Sjekker HMAC-signatur via felles implementasjon i common/auth,
 * og håndhever atomisk single-use via Redis nonce-dedupe.
 * En cookie kan kun brukes én gang — parallelle auth-forsøk blokkeres.
 */
export async function isValidAuthTurnstileCookieValue(rawValue: string | undefined): Promise<boolean> {
  const secret = process.env.AUTH_TURNSTILE_GATE_SECRET?.trim();
  if (!secret) return false;

  const { valid, nonce } = await parseAuthTurnstileCookie(rawValue, secret);
  if (!valid || !nonce) return false;

  // Atomisk single-use via SET NX: kun den første forespørselen får sette nøkkelen.
  // Parallelle kall med samme nonce vil få false tilbake fra setCacheNX.
  const redisKey = `${TURNSTILE_NONCE_PREFIX}${nonce}`;

  if (isRedisReady()) {
    const wasSet = await setCacheNX(redisKey, "1", TURNSTILE_NONCE_TTL_S);
    if (!wasSet) {
      // Nøkkelen fantes allerede — nonce er forbrukt (eller setCacheNX feilet)
      logger.warn({ nonce: nonce.slice(0, 8) }, "Turnstile-cookie nonce allerede forbrukt (Redis NX)");
      return false;
    }
    // Oppdater lokal cache også for raskere avvisning ved gjentatte forsøk
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
