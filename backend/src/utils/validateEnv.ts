/*
 * Miljøvariabel-validering
 * Validerer alle kritiske miljøvariabler ved oppstart.
 * Hvis noe mangler, avsluttes prosessen med en tydelig feilmelding.
 */

import { logger } from "./logger.js";

// Definerer forventede miljøvariabler og deres typer
interface EnvConfig {
    PORT: string;
    WEB_ORIGIN: string;
    MONGO_URI: string;
    JWT_ACCESS_SECRET: string;
    JWT_REFRESH_SECRET: string;
    ENCRYPTION_KEY: string;
    REDIS_URL: string;
    NODE_ENV: string;
}

// Liste over påkrevde og valgfrie miljøvariabler
const requiredEnvVars: (keyof EnvConfig)[] = [
    "PORT",
    "WEB_ORIGIN",
    "MONGO_URI",
    "JWT_ACCESS_SECRET",
    "JWT_REFRESH_SECRET",
    "ENCRYPTION_KEY",
];

// REDIS_URL og NODE_ENV er valgfrie
const optionalEnvVars: (keyof EnvConfig)[] = [
    "REDIS_URL",
    "NODE_ENV",
];

/**
 * Validerer at alle kritiske miljøvariabler er satt.
 * Kaller process.exit(1) hvis noe mangler.
 */
export const validateEnv = (): void => {
    const manglende: string[] = [];
    const advarsler: string[] = [];

    // Sjekk påkrevde variabler
    for (const key of requiredEnvVars) {
        if (!process.env[key]) {
            manglende.push(key);
        }
    }

    // Spesiell validering for ENCRYPTION_KEY format
    const encryptionKey = process.env.ENCRYPTION_KEY;
    if (encryptionKey) {
        if (encryptionKey.length !== 64) {
            manglende.push("ENCRYPTION_KEY (må være 64 hex-tegn / 32 bytes)");
        } else if (!/^[a-fA-F0-9]+$/.test(encryptionKey)) {
            manglende.push("ENCRYPTION_KEY (må være gyldig hex-streng)");
        }
    }

    // Sjekk valgfrie variabler og gi advarsler
    for (const key of optionalEnvVars) {
        if (!process.env[key]) {
            advarsler.push(key);
        }
    }

    // Spesiell advarsel for Redis i produksjon
    const isProd = process.env.NODE_ENV === "production";
    if (isProd && !process.env.REDIS_URL) {
        logger.warn(
            "REDIS_URL mangler i produksjon - rate limiting vil ikke fungere på tvers av instanser"
        );
    }

    // Hvis NODE_ENV ikke er satt, sett til development
    if (!process.env.NODE_ENV) {
        process.env.NODE_ENV = "development";
    }

    // Log advarsler for valgfrie variabler
    if (advarsler.length > 0) {
        logger.warn(
            { manglende: advarsler },
            "Valgfrie miljøvariabler mangler (appen vil fortsatt kjøre)"
        );
    }

    // Avslutt hvis påkrevde variabler mangler
    if (manglende.length > 0) {
        logger.fatal(
            { manglende },
            "Kritiske miljøvariabler mangler - serveren kan ikke starte"
        );
        process.exit(1);
    }
    logger.info("Alle kritiske miljøvariabler er validert");
};
