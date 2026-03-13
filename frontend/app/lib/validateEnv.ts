/*
 * Miljøvariabel-validering for frontend
 *
 * Clerk-nøkler er alltid påkrevd.
 * INTERNAL_API_URL er påkrevd for build/produksjon, men kan falle tilbake til
 * localhost i next dev via next.config.js.
 */

const ALWAYS_REQUIRED_FRONTEND_ENV_VARS = [
  "NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY",
  "CLERK_SECRET_KEY",
] as const;

interface ValidateFrontendEnvOptions {
  requireInternalApiUrl?: boolean;
}

/**
 * Validerer frontend miljøvariabler.
 * Ved feil kastes en feil med tydelig liste over manglende/ugyldige variabler.
 * I CI hoppes valideringen over slik at build kan kjøre uten hemmelige nøkler.
 */
export function validateFrontendEnv(options: ValidateFrontendEnvOptions = {}): void {
    if (process.env.CI === "true") return;

    const requireInternalApiUrl =
        options.requireInternalApiUrl === true || process.env.NODE_ENV === "production";
    const requiredFrontendEnvVars = requireInternalApiUrl
        ? [...ALWAYS_REQUIRED_FRONTEND_ENV_VARS, "INTERNAL_API_URL"] as const
        : ALWAYS_REQUIRED_FRONTEND_ENV_VARS;
    const manglende: string[] = [];
    for (const key of requiredFrontendEnvVars) {
        const value = typeof process.env[key] !== "undefined" ? process.env[key] : "";
        if (!value || String(value).trim() === "") {
            manglende.push(key);
        }
    }
    const internalApiUrl = process.env.INTERNAL_API_URL?.trim();
    if (internalApiUrl) {
        try {
            new URL(internalApiUrl);
        } catch {
            manglende.push(`INTERNAL_API_URL (må være en gyldig URL, fikk: ${internalApiUrl})`);
        }
    }
    if (manglende.length > 0) {
        const liste = manglende.join(", ");
        throw new Error(
            `Påkrevde frontend-miljøvariabler mangler - appen kan ikke starte. Mangler: ${liste}`
        );
    }
}
