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
    "JWT_COOKIE_NAVN",
    "JWT_REFRESH_COOKIE_NAVN",
    "JWT_ACCESS_EXPIRES",
    "JWT_REFRESH_EXPIRES",
    "ENCRYPTION_KEY",
    "REDIS_URL",
    "NODE_ENV",
    "LOG_LEVEL",
    "ANTHROPIC_API_KEY",
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

    // Valider CANVAS_BASE_URL peker på USN Canvas (usn.instructure.com)
    const canvasBaseUrl = process.env.CANVAS_BASE_URL;
    if (canvasBaseUrl) {
        try {
            const parsed = new URL(canvasBaseUrl);
            const host = parsed.hostname.toLowerCase();
            if (host !== "usn.instructure.com") {
                console.error("\n[KRITISK FEIL] CANVAS_BASE_URL må peke på USN Canvas (usn.instructure.com)\n");
                manglende.push(`CANVAS_BASE_URL (forventet hostname usn.instructure.com, fikk: ${host})`);
            }
            if (parsed.protocol !== "https:") {
                manglende.push("CANVAS_BASE_URL (må bruke https)");
            }
        } catch {
            // URL ugyldig – allerede fanget av validateUrl over
        }
    }

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

    // Valider JWT Secrets lengde og entropi (som validateEnv.ts)
    const validateSecret = (key) => {
        const secret = process.env[key];
        if (secret && secret.length < 32) {
            manglende.push(`${key} (må være minst 32 tegn, er: ${secret.length})`);
        }
        if (secret && /^(.)\1+$/.test(secret)) {
            manglende.push(`${key} (for lav entropi — ser ut som et gjentatt tegn)`);
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

    // Valider REDIS_URL format - må peke til Redis Cloud kun i produksjon (som validateEnv.ts)
    const redisUrl = process.env.REDIS_URL;
    if (redisUrl && process.env.NODE_ENV === "production") {
        try {
            const parsedRedisUrl = new URL(redisUrl);
            if (!parsedRedisUrl.hostname.endsWith(".cloud.redislabs.com") &&
                parsedRedisUrl.hostname !== "cloud.redislabs.com") {
                console.error("\n[KRITISK FEIL] REDIS_URL peker ikke mot Redis Cloud - forventet '*.cloud.redislabs.com' hostname\n");
                manglende.push("REDIS_URL (hostname må slutte med '.cloud.redislabs.com')");
            }
        } catch {
            // URL ugyldig – allerede fanget av validateUrl over
        }
    }

    // Valider NODE_ENV er gyldig verdi
    const nodeEnv = process.env.NODE_ENV;
    if (nodeEnv && !["development", "production", "test"].includes(nodeEnv)) {
        manglende.push(`NODE_ENV (må være 'development', 'production' eller 'test', fikk: ${nodeEnv})`);
    }

    // Valider JWT cookie-navn (påkrevd, ikke tomme)
    const cookieNavn = process.env.JWT_COOKIE_NAVN;
    if (!cookieNavn || !String(cookieNavn).trim()) {
        manglende.push("JWT_COOKIE_NAVN (må være satt og ikke tom)");
    }
    const refreshCookieNavn = process.env.JWT_REFRESH_COOKIE_NAVN;
    if (!refreshCookieNavn || !String(refreshCookieNavn).trim()) {
        manglende.push("JWT_REFRESH_COOKIE_NAVN (må være satt og ikke tom)");
    }

    // Valider JWT expiry-format (påkrevd, tall + enhet: s/m/h/d)
    const validateExpiry = (key) => {
        const value = process.env[key];
        if (!value || !String(value).trim()) {
            manglende.push(`${key} (må være satt, f.eks. '30m', '14d')`);
        } else if (!/^\d+[smhd]$/.test(String(value).trim())) {
            manglende.push(`${key} (ugyldig format, forventet f.eks. '30m', '14d')`);
        }
    };
    validateExpiry("JWT_ACCESS_EXPIRES");
    validateExpiry("JWT_REFRESH_EXPIRES");

    // Valider LOG_LEVEL er gyldig Pino-nivå
    const logLevel = process.env.LOG_LEVEL;
    const gyldigeNivaer = ["trace", "debug", "info", "warn", "error", "fatal", "silent"];
    if (!logLevel || !String(logLevel).trim()) {
        manglende.push("LOG_LEVEL (må være satt)");
    } else if (!gyldigeNivaer.includes(logLevel)) {
        manglende.push(`LOG_LEVEL (må være en av: ${gyldigeNivaer.join(", ")})`);
    }

    // Valider ANTHROPIC_API_KEY format
    const anthropicKey = process.env.ANTHROPIC_API_KEY;
    if (anthropicKey && !anthropicKey.startsWith("sk-ant-")) {
        manglende.push("ANTHROPIC_API_KEY (må starte med 'sk-ant-')");
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
