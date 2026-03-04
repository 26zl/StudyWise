/*
 * Miljøvariabel-validering
 * Validerer alle påkrevde miljøvariabler ved oppstart.
 * Hvis noe mangler, avsluttes prosessen med en tydelig feilmelding.
 */

import { logger } from "./logger.js";

// Definerer forventede miljøvariabler og deres typer
interface EnvConfig {
    PORT: string;
    WEB_ORIGIN: string;
    WEB_ORIGINS: string;
    CANVAS_BASE_URL: string;
    MONGO_URI: string;
    JWT_ACCESS_SECRET: string;
    JWT_REFRESH_SECRET: string;
    ENCRYPTION_KEY: string;
    REDIS_URL: string;
    NODE_ENV: string;
    HUGGINGFACE_API_KEY: string;
    ANTHROPIC_API_KEY: string;
}

// Alle miljøvariabler er påkrevde (WEB_ORIGIN/WEB_ORIGINS sjekkes separat)
const requiredEnvVars: (keyof EnvConfig)[] = [
    "PORT",
    "MONGO_URI",
    "CANVAS_BASE_URL",
    "JWT_ACCESS_SECRET",
    "JWT_REFRESH_SECRET",
    "ENCRYPTION_KEY",
    "REDIS_URL",
    "NODE_ENV",
    "HUGGINGFACE_API_KEY",
];

/**
 * Validerer at alle påkrevde miljøvariabler er satt.
 * Kaller process.exit(1) hvis noe mangler.
 */
export const validateEnv = (): void => {
    const manglende: string[] = [];

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

    // Valider PORT er et tall
    if (process.env.PORT && isNaN(Number(process.env.PORT))) {
        manglende.push(`PORT (må være et tall, fikk: ${process.env.PORT})`);
    }

    // Valider at minst én av WEB_ORIGIN eller WEB_ORIGINS er satt
    if (!process.env.WEB_ORIGIN && !process.env.WEB_ORIGINS) {
        manglende.push("WEB_ORIGIN eller WEB_ORIGINS (minst én må være satt)");
    }

    // Valider URLer
    const validateUrl = (key: keyof EnvConfig) => {
        const url = process.env[key];
        if (url) {
            try {
                new URL(url);
            } catch {
                manglende.push(`${key} (må være en gyldig URL, fikk: ${url})`);
            }
        }
    };
    validateUrl("WEB_ORIGIN");
    validateUrl("CANVAS_BASE_URL");
    validateUrl("REDIS_URL");

    // Valider alle origins i WEB_ORIGINS (kommaseparert liste)
    const webOrigins = process.env.WEB_ORIGINS;
    if (webOrigins) {
        const origins = webOrigins.split(",").map(s => s.trim()).filter(Boolean);
        for (const origin of origins) {
            try {
                new URL(origin);
            } catch {
                manglende.push(`WEB_ORIGINS (ugyldig URL i listen: ${origin})`);
            }
        }
    }

    // Valider JWT Secrets lengde
    const validateSecret = (key: keyof EnvConfig) => {
        const secret = process.env[key];
        if (secret && secret.length < 32) {
            manglende.push(`${key} (må være minst 32 tegn, er: ${secret.length})`);
        }
    };
    validateSecret("JWT_ACCESS_SECRET");
    validateSecret("JWT_REFRESH_SECRET");

    // Spesiell validering for MONGO_URI format
    // Må inneholde /studywise for å unngå å skrive til test-database
    const mongoUri = process.env.MONGO_URI;
    if (mongoUri && !mongoUri.match(/\/studywise(\?|$)/)) {
        logger.error("MONGO_URI peker ikke på 'studywise'-databasen - risikerer å skrive til 'test'-databasen");
        manglende.push(`MONGO_URI (må inneholde '/studywise', fikk: ...${mongoUri.slice(-15)})`);
    }

    // Valider REDIS_URL format - må peke til Redis Cloud (sikker hostname-validering)
    const redisUrl = process.env.REDIS_URL;
    if (redisUrl) {
        try {
            const parsedRedisUrl = new URL(redisUrl);
            // Sikker hostname-validering - må være eksakt match eller subdomain
            if (!parsedRedisUrl.hostname.endsWith(".cloud.redislabs.com") &&
                parsedRedisUrl.hostname !== "cloud.redislabs.com") {
                logger.error("REDIS_URL peker ikke mot Redis Cloud - forventet '*.cloud.redislabs.com' hostname");
                manglende.push("REDIS_URL (hostname må slutte med '.cloud.redislabs.com')");
            }
        } catch {
            // URL parsing feilet - allerede håndtert av validateUrl() over
        }
    }

    // Valider NODE_ENV er gyldig verdi
    const nodeEnv = process.env.NODE_ENV;
    if (nodeEnv && !["development", "production", "test"].includes(nodeEnv)) {
        manglende.push(`NODE_ENV (må være 'development', 'production' eller 'test', fikk: ${nodeEnv})`);
    }

    // Avslutt hvis påkrevde variabler mangler
    if (manglende.length > 0) {
        logger.fatal(
            { manglende },
            "Påkrevde miljøvariabler mangler - serveren kan ikke starte"
        );
        process.exit(1);
    }

    // Valgfrie variabler — logg advarsel hvis de mangler
    if (!process.env.ANTHROPIC_API_KEY) {
        logger.warn("ANTHROPIC_API_KEY er ikke satt — Claude-modeller vil ikke være tilgjengelige");
    }

    logger.info("Alle påkrevde miljøvariabler er validert");
};
