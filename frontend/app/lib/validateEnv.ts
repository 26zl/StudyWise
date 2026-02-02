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
    // Ingen validering nødvendig - frontend bruker relative paths
}
