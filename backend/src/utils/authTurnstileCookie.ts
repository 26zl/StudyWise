import crypto from "crypto";
import type { Response, CookieOptions } from "express";
import { AUTH_TURNSTILE_COOKIE_NAME } from "common/auth";
import { isProd } from "./env.js";

const AUTH_TURNSTILE_COOKIE_VERSION = "v1";
const AUTH_TURNSTILE_COOKIE_PATH = "/auth";
const AUTH_TURNSTILE_COOKIE_TTL_MS = 5 * 60 * 1000;

function getAuthTurnstileGateSecret(): string {
  const secret = process.env.AUTH_TURNSTILE_GATE_SECRET?.trim();
  if (!secret) {
    throw new Error("AUTH_TURNSTILE_GATE_SECRET mangler");
  }

  return secret;
}

function createCookieSignature(expiresAt: number): string {
  return crypto
    .createHmac("sha256", getAuthTurnstileGateSecret())
    .update(`${AUTH_TURNSTILE_COOKIE_VERSION}:${expiresAt}`)
    .digest("hex");
}

export function createAuthTurnstileCookieValue(now = Date.now()): string {
  const expiresAt = now + AUTH_TURNSTILE_COOKIE_TTL_MS;
  const signature = createCookieSignature(expiresAt);
  return `${AUTH_TURNSTILE_COOKIE_VERSION}.${expiresAt}.${signature}`;
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
