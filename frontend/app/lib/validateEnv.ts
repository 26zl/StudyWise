/*
 * Miljøvariabel-validering for frontend
 *
 * Frontend bruker relative paths (/api/...) som Next.js rewriter til backend.
 * Server-side kode bruker INTERNAL_API_URL (settes i Docker/Cloud Run).
 * Lokal utvikling trenger ingen env-variabler - default er localhost:4000.
 */

/** Påkrevde frontend env-variabler (tom ved lokal dev; legg til ved behov for prod). */
const requiredFrontendEnvVars: string[] = [];

/**
 * Validerer frontend miljøvariabler.
 * Ved feil kastes en feil med tydelig liste over manglende/ugyldige variabler.
 */
export function validateFrontendEnv(): void {
    const manglende: string[] = [];
    for (const key of requiredFrontendEnvVars) {
        const value = typeof process.env[key] !== "undefined" ? process.env[key] : "";
        if (!value || String(value).trim() === "") {
            manglende.push(key);
        }
    }
    if (manglende.length > 0) {
        const liste = manglende.join(", ");
        throw new Error(
            `Påkrevde frontend-miljøvariabler mangler - appen kan ikke starte. Mangler: ${liste}`
        );
    }
}
