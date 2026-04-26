/*
 * Delte miljøkonstanter for backend
 */

/** True dersom NODE_ENV === "production" */
export const isProd = process.env.NODE_ENV === "production";

/**
 * Master feature-flag for Cloudflare Turnstile.
 *
 * Når `false` (default) er ALL Turnstile-håndhevelse skrudd av:
 *   - /api/auth-turnstile/verify og /gate svarer "no-op" (200 OK)
 *   - /api/kontakt krever ikke turnstile-token
 *   - findOrCreateUserByClerkId skipper sesjons-/registrerings-gate
 *   - Frontend rendrer ingen widgets (egen flagg-sjekk i frontend/validateEnv)
 *   - Ingen feilmeldinger til brukeren
 *
 * For å reaktivere: sett TURNSTILE_ENABLED=true i Heroku + tilsvarende
 * NEXT_PUBLIC_TURNSTILE_ENABLED=true i Vercel. Sørg for at TURNSTILE_SECRET_KEY,
 * AUTH_TURNSTILE_SECRET_KEY og AUTH_TURNSTILE_GATE_SECRET er satt.
 */
export const turnstileEnabled = process.env.TURNSTILE_ENABLED?.toLowerCase() === "true";
