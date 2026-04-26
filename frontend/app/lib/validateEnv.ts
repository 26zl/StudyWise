/*
 * Miljøvariabel-validering for frontend
 *
 * Clerk-variabler er alltid påkrevd. Turnstile-variabler er kun påkrevd
 * når NEXT_PUBLIC_TURNSTILE_ENABLED=true.
 * INTERNAL_API_URL er påkrevd for build/produksjon, men kan falle tilbake til
 * localhost i next dev via next.config.js.
 */

/**
 * Master feature-flag for Cloudflare Turnstile (frontend).
 *
 * Når `false` (default) skipper hele frontend Turnstile:
 *   - AuthTurnstileInline rendrer ingenting (kaller onVerified() umiddelbart)
 *   - TurnstileReChallenge vises aldri
 *   - ContactForm sender ingen turnstileToken
 *
 * For å reaktivere: sett NEXT_PUBLIC_TURNSTILE_ENABLED=true i Vercel og
 * sørg for at NEXT_PUBLIC_TURNSTILE_SITE_KEY, NEXT_PUBLIC_AUTH_TURNSTILE_SITE_KEY
 * og AUTH_TURNSTILE_GATE_SECRET er satt. Backend må også få TURNSTILE_ENABLED=true.
 */
export const turnstileEnabled =
  process.env.NEXT_PUBLIC_TURNSTILE_ENABLED?.toLowerCase() === "true";

// CLERK_SECRET_KEY brukes server-side av Clerk Next.js middleware (clerkMiddleware i proxy.ts)
// og er aldri eksponert til klienten.
const ALWAYS_REQUIRED_FRONTEND_ENV_VARS = [
  "CLERK_SECRET_KEY",
  "NEXT_PUBLIC_CLERK_SIGN_IN_URL",
  "NEXT_PUBLIC_CLERK_SIGN_UP_URL",
  "NEXT_PUBLIC_CLERK_SIGN_IN_FALLBACK_REDIRECT_URL",
  "NEXT_PUBLIC_CLERK_SIGN_UP_FALLBACK_REDIRECT_URL"
] as const;

// Påkrevd kun når Turnstile er aktivert. AUTH_TURNSTILE_GATE_SECRET brukes i auth-turnstile-server.ts.
const TURNSTILE_REQUIRED_FRONTEND_ENV_VARS = [
  "AUTH_TURNSTILE_GATE_SECRET",
  "NEXT_PUBLIC_TURNSTILE_SITE_KEY",
  "NEXT_PUBLIC_AUTH_TURNSTILE_SITE_KEY",
] as const;

interface ValidateFrontendEnvOptions {
  requireInternalApiUrl?: boolean;
}

// Hent Clerk publishable key, med fallback mellom NEXT_PUBLIC_ og CLERK_-prefikser
export function getFrontendClerkPublishableKey(): string | null {
  const nextPublicKey = process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY?.trim();
  if (nextPublicKey) {
    return nextPublicKey;
  }

  const serverPublishableKey = process.env.CLERK_PUBLISHABLE_KEY?.trim();
  if (serverPublishableKey) {
    return serverPublishableKey;
  }

  return null;
}

/**
 * Validerer frontend miljøvariabler.
 * Ved feil kastes en feil med tydelig liste over manglende/ugyldige variabler.
 */
export function validateFrontendEnv(options: ValidateFrontendEnvOptions = {}): void {
  if (process.env.CI === "true") {
    return;
  }

  const requireInternalApiUrl =
    options.requireInternalApiUrl === true ||
    process.env.NODE_ENV === "production";
  const baseRequired = requireInternalApiUrl
    ? ([...ALWAYS_REQUIRED_FRONTEND_ENV_VARS, "INTERNAL_API_URL"] as const)
    : ALWAYS_REQUIRED_FRONTEND_ENV_VARS;
  const requiredFrontendEnvVars: readonly string[] = turnstileEnabled
    ? [...baseRequired, ...TURNSTILE_REQUIRED_FRONTEND_ENV_VARS]
    : baseRequired;
  const manglende: string[] = [];

  if (!getFrontendClerkPublishableKey()) {
    manglende.push(
      "NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY (eller CLERK_PUBLISHABLE_KEY)",
    );
  }

  for (const key of requiredFrontendEnvVars) {
    const value =
      typeof process.env[key] !== "undefined" ? process.env[key] : "";
    if (!value || String(value).trim() === "") {
      manglende.push(key);
    }
  }

  const internalApiUrl = process.env.INTERNAL_API_URL?.trim();
  if (internalApiUrl) {
    try {
      new URL(internalApiUrl);
    } catch {
      manglende.push(
        `INTERNAL_API_URL (må være en gyldig URL, fikk: ${internalApiUrl})`,
      );
    }
  }

  if (manglende.length > 0) {
    const liste = manglende.join(", ");
    throw new Error(
      `Påkrevde frontend-miljøvariabler mangler - appen kan ikke starte. Mangler: ${liste}`,
    );
  }
}
