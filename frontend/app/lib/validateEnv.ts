/*
 * Miljøvariabel-validering for frontend
 * Validerer at alle påkrevde miljøvariabler er satt ved oppstart.
 * Kjøres ved build-time og runtime for å sikre korrekt konfigurasjon.
 */

// Definerer forventede miljøvariabler
interface FrontendEnvConfig {
    NEXT_PUBLIC_API_URL: string;
}

// Alle påkrevde miljøvariabler
const requiredEnvVars: (keyof FrontendEnvConfig)[] = [
    "NEXT_PUBLIC_API_URL",
];

/**
 * Validerer at alle påkrevde miljøvariabler er satt.
 * Kaster Error hvis noe mangler, som stopper build/start.
 */
export function validateFrontendEnv(): void {
    const manglende: string[] = [];

    // Sjekk påkrevde variabler
    for (const key of requiredEnvVars) {
        if (!process.env[key]) {
            manglende.push(key);
        }
    }

    // Valider at NEXT_PUBLIC_API_URL er en gyldig URL
    const apiUrl = process.env.NEXT_PUBLIC_API_URL;
    if (apiUrl) {
        try {
            new URL(apiUrl);
        } catch {
            manglende.push(`NEXT_PUBLIC_API_URL (må være en gyldig URL, fikk: ${apiUrl})`);
        }
    }

    // Kast feil hvis påkrevde variabler mangler
    if (manglende.length > 0) {
        const errorMessage = `\n[KRITISK FEIL] Påkrevde miljøvariabler mangler - frontend kan ikke starte:\n  - ${manglende.join("\n  - ")}\n\nSjekk at .env filen inneholder alle nødvendige variabler.`;
        console.error(errorMessage);
        throw new Error(errorMessage);
    }

    console.log("[validateEnv] Alle påkrevde frontend-miljøvariabler er validert");
}

// Eksporter også en versjon som kan brukes i klient-komponenter
export function getValidatedEnv() {
    return {
        apiUrl: process.env.NEXT_PUBLIC_API_URL!,
    };
}
