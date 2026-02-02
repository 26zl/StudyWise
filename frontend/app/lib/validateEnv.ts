/*
 * Miljøvariabel-validering for frontend
 *
 * Frontend bruker relative paths (/api/...) som Next.js rewriter til backend.
 * Server-side kode bruker INTERNAL_API_URL (settes i Docker/Cloud Run).
 * Lokal utvikling trenger ingen env-variabler - default er localhost:4000.
 */

/**
 * Validerer frontend miljøvariabler.
 * Foreløpig ingen påkrevde variabler siden vi bruker Next.js rewrites.
 */
export function validateFrontendEnv(): void {
    // Hopp over i CI-miljø
    if (process.env.CI === "true") {
        console.log("[validateEnv] CI-miljø oppdaget, hopper over miljøvalidering");
        return;
    }

    // Informativ logging i development
    if (process.env.NODE_ENV === "development") {
        const apiUrl = process.env.INTERNAL_API_URL || "http://localhost:4000";
        console.log(`[validateEnv] API URL: ${apiUrl}`);
    }
}
