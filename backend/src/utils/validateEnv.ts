/*
 * Miljøvariabel-validering
 * Validerer alle påkrevde miljøvariabler ved oppstart.
 * Hvis noe mangler, avsluttes prosessen med en tydelig feilmelding.
 */

import { logger } from "./logger.js";
import { getConfiguredWebOrigins, getInvalidConfiguredWebOrigins } from "./webOrigins.js";

// Definerer forventede miljøvariabler og deres typer (Clerk-only auth)
interface EnvConfig {
  PORT: string;
  WEB_ORIGINS: string;
  MONGO_URI: string;
  REDIS_URL: string;
  CLERK_SECRET_KEY: string;
  ENCRYPTION_KEY: string;
  LOG_LEVEL: string;
  NODE_ENV: string;
  ANTHROPIC_API_KEY: string;
  PINECONE_API_KEY: string;
  PINECONE_INDEX_NAME: string;
  COHERE_API_KEY: string;
}

const requiredEnvVars: (keyof EnvConfig)[] = [
  "PORT",
  "WEB_ORIGINS",
  "MONGO_URI",
  "REDIS_URL",
  "CLERK_SECRET_KEY",
  "ENCRYPTION_KEY",
  "LOG_LEVEL",
  "NODE_ENV",
  "ANTHROPIC_API_KEY",
  "PINECONE_API_KEY",
  "PINECONE_INDEX_NAME",
  "COHERE_API_KEY",
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

  // Spesiell validering for ENCRYPTION_KEY format og styrke
  const encryptionKey = process.env.ENCRYPTION_KEY;
  if (encryptionKey) {
    if (encryptionKey.length !== 64) {
      manglende.push("ENCRYPTION_KEY (må være 64 hex-tegn / 32 bytes)");
    } else if (!/^[a-fA-F0-9]+$/.test(encryptionKey)) {
      manglende.push("ENCRYPTION_KEY (må være gyldig hex-streng)");
    } else if (/^[0f]+$/i.test(encryptionKey)) {
      manglende.push(
        "ENCRYPTION_KEY (for svak: ikke bruk placeholder; generer med crypto.randomBytes(32).toString('hex'))",
      );
    }
  }

  // Valider PORT er et tall
  if (process.env.PORT && isNaN(Number(process.env.PORT))) {
    manglende.push(`PORT (må være et tall, fikk: ${process.env.PORT})`);
  }

  // WEB_ORIGINS brukes av CORS, CSRF og Clerk authorizedParties.
  const webOrigins = getConfiguredWebOrigins();
  const invalidWebOrigins = getInvalidConfiguredWebOrigins();
  if (webOrigins.length === 0) {
    manglende.push("WEB_ORIGINS (må inneholde minst én gyldig origin)");
  }
  for (const origin of invalidWebOrigins) {
    manglende.push(`WEB_ORIGINS (ugyldig origin i listen: ${origin})`);
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
  validateUrl("REDIS_URL");

  for (const origin of webOrigins) {
    try {
      new URL(origin);
    } catch {
      manglende.push(`WEB_ORIGINS (ugyldig URL i listen: ${origin})`);
    }
  }

  // CLERK_SECRET_KEY (Clerk-only auth)
  const clerkSecret = process.env.CLERK_SECRET_KEY;
  if (clerkSecret && clerkSecret.length < 32) {
    manglende.push("CLERK_SECRET_KEY (må være minst 32 tegn)");
  }

  // Spesiell validering for MONGO_URI format
  // Må inneholde /studywise for å unngå å skrive til test-database
  const mongoUri = process.env.MONGO_URI;
  if (mongoUri && !mongoUri.match(/\/studywise(\?|$)/)) {
    logger.error(
      "MONGO_URI peker ikke på 'studywise'-databasen - risikerer å skrive til 'test'-databasen",
    );
    manglende.push("MONGO_URI (må inneholde '/studywise')");
  }

  // Valider REDIS_URL format - må peke til Redis Cloud i produksjon
  const redisUrl = process.env.REDIS_URL;
  if (redisUrl && process.env.NODE_ENV === "production") {
    try {
      const parsedRedisUrl = new URL(redisUrl);
      // Sikker hostname-validering - må være eksakt match eller subdomain
      if (
        !parsedRedisUrl.hostname.endsWith(".cloud.redislabs.com") &&
        parsedRedisUrl.hostname !== "cloud.redislabs.com"
      ) {
        logger.error(
          "REDIS_URL peker ikke mot Redis Cloud - forventet '*.cloud.redislabs.com' hostname",
        );
        manglende.push(
          "REDIS_URL (hostname må slutte med '.cloud.redislabs.com')",
        );
      }
    } catch {
      // URL parsing feilet - allerede håndtert av validateUrl() over
    }
  }

  // Valider NODE_ENV er gyldig verdi
  const nodeEnv = process.env.NODE_ENV;
  if (nodeEnv && !["development", "production", "test"].includes(nodeEnv)) {
    manglende.push(
      `NODE_ENV (må være 'development', 'production' eller 'test', fikk: ${nodeEnv})`,
    );
  }

  // Valider ANTHROPIC_API_KEY format
  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  if (anthropicKey && !anthropicKey.startsWith("sk-ant-")) {
    manglende.push("ANTHROPIC_API_KEY (må starte med 'sk-ant-')");
  }

  // Valider LOG_LEVEL er gyldig Pino-nivå (påkrevd)
  const logLevel = process.env.LOG_LEVEL;
  const gyldigeNivaer = [
    "trace",
    "debug",
    "info",
    "warn",
    "error",
    "fatal",
    "silent",
  ];
  if (!logLevel || !logLevel.trim()) {
    manglende.push("LOG_LEVEL (må være satt)");
  } else if (!gyldigeNivaer.includes(logLevel)) {
    manglende.push(
      `LOG_LEVEL (må være en av: ${gyldigeNivaer.join(", ")}, fikk: ${logLevel})`,
    );
  }

  // Valider Pinecone (påkrevd for vektor-søk og embeddings)
  const pineconeKey = process.env.PINECONE_API_KEY;
  if (!pineconeKey || !pineconeKey.trim()) {
    manglende.push("PINECONE_API_KEY (påkrevd for Pinecone vector store)");
  }
  const pineconeIndex = process.env.PINECONE_INDEX_NAME;
  if (!pineconeIndex || !pineconeIndex.trim()) {
    manglende.push("PINECONE_INDEX_NAME (påkrevd, f.eks. 'studywise')");
  }

  // Valider Cohere (påkrevd for hybrid søk-reranking)
  const cohereKey = process.env.COHERE_API_KEY;
  if (!cohereKey || !cohereKey.trim()) {
    manglende.push("COHERE_API_KEY (påkrevd for Cohere rerank)");
  }

  // Valider Datadog-variabler kun i produksjon (påkrevd for monitorering i dette miljøet)
  if (nodeEnv === "production") {
    const ddRequired = [
      "DD_API_KEY",
      "DD_SITE",
      "DD_ENV",
      "DD_APPSEC_ENABLED",
      "DD_APPSEC_SCA_ENABLED",
      "DD_IAST_ENABLED",
      "DD_LOGS_INJECTION",
      "DD_PROFILING_ENABLED",
      "DD_TRACE_SAMPLE_RATE",
      "DD_GIT_REPOSITORY_URL",
    ] as const;
    for (const key of ddRequired) {
      if (!process.env[key]?.trim()) {
        manglende.push(`${key} (påkrevd i produksjon for Datadog APM)`);
      }
    }
    // DD_SITE må peke til riktig Datadog-region (us5)
    const ddSite = process.env.DD_SITE;
    if (ddSite && ddSite !== "us5.datadoghq.com") {
      manglende.push(`DD_SITE (må være 'us5.datadoghq.com', fikk: ${ddSite})`);
    }
    // DD_TRACE_SAMPLE_RATE må være et tall mellom 0 og 1
    const sampleRate = process.env.DD_TRACE_SAMPLE_RATE;
    if (sampleRate) {
      const rate = Number(sampleRate);
      if (isNaN(rate) || rate < 0 || rate > 1) {
        manglende.push(
          `DD_TRACE_SAMPLE_RATE (må være mellom 0 og 1, fikk: ${sampleRate})`,
        );
      }
    }
  }

  // Avslutt hvis påkrevde variabler mangler
  if (manglende.length > 0) {
    const liste = manglende.join(", ");
    logger.fatal(
      { manglende },
      `Påkrevde miljøvariabler mangler eller er ugyldige - serveren kan ikke starte. Mangler/ugyldige: ${liste}`,
    );
    process.exit(1);
  }

  logger.info("Alle påkrevde miljøvariabler er validert");
};
