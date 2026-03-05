#!/usr/bin/env node
/* eslint-env node */
/*
 * Pre-build script for backend
 * Validerer at alle påkrevde miljøvariabler er satt før build.
 * Kjøres automatisk før `tsc` ved `pnpm build`.
 * Hopper over validering i CI-miljø (GitHub Actions setter CI=true).
 */

// Hopp over validering i CI-miljø - der trenger vi bare typecheck/lint/build
if (process.env.CI === "true") {
    console.log("[validateEnv] CI-miljø oppdaget, hopper over miljøvalidering");
    process.exit(0);
}

import "dotenv/config";

// Definerer forventede miljøvariabler og deres typer
const requiredEnvVars = [
    "PORT",
    "MONGO_URI",
    "CANVAS_BASE_URL",
    "JWT_ACCESS_SECRET",
    "JWT_REFRESH_SECRET",
    "ENCRYPTION_KEY",
    "REDIS_URL",
    "NODE_ENV",
];

/**
 * Validerer at alle påkrevde miljøvariabler er satt.
 * Avslutter med exit code 1 hvis noe mangler.
 */
function validateEnvForBuild() {
    const manglende = [];

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
    const validateUrl = (key) => {
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
    const validateSecret = (key) => {
        const secret = process.env[key];
        if (secret && secret.length < 32) {
            manglende.push(`${key} (må være minst 32 tegn, er: ${secret.length})`);
        }
    };
    validateSecret("JWT_ACCESS_SECRET");
    validateSecret("JWT_REFRESH_SECRET");

    // Spesiell validering for MONGO_URI format
    const mongoUri = process.env.MONGO_URI;
    if (mongoUri && !mongoUri.match(/\/studywise(\?|$)/)) {
        console.error("\n[KRITISK FEIL] MONGO_URI peker ikke på 'studywise'-databasen!\n");
        manglende.push(`MONGO_URI (må inneholde '/studywise')`);
    }

    // Valider REDIS_URL format - må peke til Redis Cloud
    const redisUrl = process.env.REDIS_URL;
    if (redisUrl && !redisUrl.includes("cloud.redislabs.com")) {
        console.error("\n[KRITISK FEIL] REDIS_URL peker ikke mot Redis Cloud!\n");
        manglende.push("REDIS_URL (må inneholde 'cloud.redislabs.com')");
    }

    // Valider NODE_ENV er gyldig verdi
    const nodeEnv = process.env.NODE_ENV;
    if (nodeEnv && !["development", "production", "test"].includes(nodeEnv)) {
        manglende.push(`NODE_ENV (må være 'development', 'production' eller 'test', fikk: ${nodeEnv})`);
    }

    // Avslutt hvis påkrevde variabler mangler
    if (manglende.length > 0) {
        console.error("\n========================================");
        console.error("[BUILD FEIL] Påkrevde miljøvariabler mangler:");
        console.error("========================================");
        for (const m of manglende) {
            console.error(`  - ${m}`);
        }
        console.error("\nSjekk at backend/.env filen inneholder alle nødvendige variabler.");
        console.error("========================================\n");
        process.exit(1);
    }

    console.log("[validateEnv] Alle påkrevde backend-miljøvariabler er validert for build");
}

validateEnvForBuild();
