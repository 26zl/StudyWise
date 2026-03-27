/*
 * Miljøvariabel-validering for frontend
 *
 * Clerk-nøkler er alltid påkrevd.
 * INTERNAL_API_URL er påkrevd for build/produksjon, men kan falle tilbake til
 * localhost i next dev via next.config.js.
 */

const ALWAYS_REQUIRED_FRONTEND_ENV_VARS = [
  "CLERK_SECRET_KEY",
  "NEXT_PUBLIC_CLERK_SIGN_IN_URL",
  "NEXT_PUBLIC_CLERK_SIGN_UP_URL",
  "NEXT_PUBLIC_CLERK_SIGN_IN_FALLBACK_REDIRECT_URL",
  "NEXT_PUBLIC_CLERK_SIGN_UP_FALLBACK_REDIRECT_URL"
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
 * I GitHub Actions hoppes valideringen over slik at repository-builden kan kjøre
 * uten prod-hemmeligheter. Vercel/runtime bruker fortsatt vanlig validering.
 */
export function validateFrontendEnv(options: ValidateFrontendEnvOptions = {}): void {
  if (process.env.GITHUB_ACTIONS === "true") {
    return;
  }

  const requireInternalApiUrl =
    options.requireInternalApiUrl === true ||
    process.env.NODE_ENV === "production";
  const requiredFrontendEnvVars = requireInternalApiUrl
    ? ([...ALWAYS_REQUIRED_FRONTEND_ENV_VARS, "INTERNAL_API_URL"] as const)
    : ALWAYS_REQUIRED_FRONTEND_ENV_VARS;
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

  if (process.env.NODE_ENV === "production") {
    if (!process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY?.trim()) {
      manglende.push("NEXT_PUBLIC_TURNSTILE_SITE_KEY (påkrevd i produksjon for spam-beskyttelse)");
    }
  }

  if (manglende.length > 0) {
    const liste = manglende.join(", ");
    throw new Error(
      `Påkrevde frontend-miljøvariabler mangler - appen kan ikke starte. Mangler: ${liste}`,
    );
  }
}
