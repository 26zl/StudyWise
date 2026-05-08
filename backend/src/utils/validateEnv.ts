/*
 * Miljøvariabel-validering
 * Validerer alle påkrevde miljøvariabler ved oppstart.
 * Hvis noe mangler, avsluttes prosessen med en tydelig feilmelding.
 */

import { isIP } from "node:net";
import { logger } from "./logger.js";
import { getConfiguredWebOrigins, getInvalidConfiguredWebOrigins } from "./webOrigins.js";

// Definerer forventede miljøvariabler og deres typer (Clerk-only auth)
interface EnvConfig {
  PORT: string;
  WEB_ORIGINS: string;
  API_HOST?: string;
  INTERNAL_HOSTS?: string;
  TRUST_PROXY_HOPS?: string;
  NODE_DNS_SERVERS?: string;
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
  WEB_PUSH_VAPID_PUBLIC_KEY?: string;
  WEB_PUSH_VAPID_PRIVATE_KEY?: string;
  WEB_PUSH_SUBJECT?: string;
  LANGCHAIN_TRACING_V2?: string;
  LANGCHAIN_ENDPOINT?: string;
  LANGCHAIN_API_KEY?: string;
  LANGCHAIN_PROJECT?: string;
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

function isValidHostname(value: string): boolean {
  if (value.length < 1 || value.length > 253) {
    return false;
  }

  const labels = value.split(".");
  if (labels.length < 2) {
    return false;
  }

  return labels.every((label) => {
    if (label.length < 1 || label.length > 63) {
      return false;
    }

    if (label.startsWith("-") || label.endsWith("-")) {
      return false;
    }

    return /^[a-z0-9-]+$/i.test(label);
  });
}

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
  validateUrl("LANGCHAIN_ENDPOINT");

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
  } else if (
    clerkSecret &&
    !clerkSecret.startsWith("sk_test_") &&
    !clerkSecret.startsWith("sk_live_")
  ) {
    manglende.push("CLERK_SECRET_KEY (må starte med 'sk_test_' eller 'sk_live_')");
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

  // NODE_DNS_SERVERS er HELT valgfri — brukes kun lokalt når mongodb+srv-oppslag
  // feiler mot en stoppet systemresolver. Vi validerer KUN hvis utvikleren
  // faktisk har satt variabelen, slik at fail-fast oppstart erstatter en stille
  // runtime-warn fra dns.setServers().
  const dnsServersRaw = process.env.NODE_DNS_SERVERS?.trim();
  if (dnsServersRaw) {
    const servers = dnsServersRaw
      .split(",")
      .map((server) => server.trim())
      .filter(Boolean);

    if (servers.length === 0) {
      manglende.push("NODE_DNS_SERVERS (satt men inneholder ingen verdier)");
    }

    for (const server of servers) {
      // dns.setServers() godtar "8.8.8.8", "8.8.8.8:53", "::1" og "[2001:db8::1]:53".
      // Strategi: prøv først å valider som-er (dekker rå IPv4 og IPv6 uten port).
      // Hvis det feiler, prøv å strippe port for de to støttede port-formatene.
      // Vi kan IKKE bare regex-strippe ":\d+$" fra alle entries, fordi siste
      // segment i en bare IPv6-adresse (f.eks. "::1") også matcher det mønsteret.
      let valid = false;
      if (isIP(server)) {
        valid = true;
      } else if (server.startsWith("[")) {
        // Bracketed IPv6 med port: "[2001:db8::1]:53"
        const closeBracket = server.indexOf("]");
        if (closeBracket > 0) {
          valid = isIP(server.slice(1, closeBracket)) !== 0;
        }
      } else if (server.split(":").length === 2) {
        // IPv4 med port: "8.8.8.8:53" — én enkelt kolon skiller IP og port.
        // Bare IPv6 har alltid ≥2 kolons og er allerede dekket av isIP(server).
        valid = isIP(server.replace(/:\d+$/, "")) !== 0;
      }

      if (!valid) {
        manglende.push(`NODE_DNS_SERVERS (ugyldig IP i listen: ${server})`);
      }
    }
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

  const apiHost = process.env.API_HOST?.trim().toLowerCase();
  if (nodeEnv === "production" && !apiHost) {
    manglende.push("API_HOST (påkrevd i produksjon for å blokkere direkte tilgang til backend-origin)");
  } else if (apiHost && !isValidHostname(apiHost)) {
    manglende.push(`API_HOST (må være et gyldig hostname uten protokoll, fikk: ${apiHost})`);
  }

  const internalHostsRaw = process.env.INTERNAL_HOSTS ?? "";
  const internalHosts = internalHostsRaw
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
  for (const host of internalHosts) {
    if (!isValidHostname(host)) {
      manglende.push(`INTERNAL_HOSTS (ugyldig hostname i listen: ${host})`);
    }
  }

  const trustProxyHopsRaw = process.env.TRUST_PROXY_HOPS?.trim();
  if (nodeEnv === "production" && !trustProxyHopsRaw) {
    manglende.push("TRUST_PROXY_HOPS (påkrevd i produksjon for korrekt klient-IP bak proxy-kjede)");
  } else if (trustProxyHopsRaw) {
    const trustProxyHops = Number.parseInt(trustProxyHopsRaw, 10);
    if (!Number.isInteger(trustProxyHops) || trustProxyHops < 1) {
      manglende.push(
        `TRUST_PROXY_HOPS (må være et heltall >= 1, fikk: ${trustProxyHopsRaw})`,
      );
    }
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

  const webPushPublicKey = process.env.WEB_PUSH_VAPID_PUBLIC_KEY?.trim();
  const webPushPrivateKey = process.env.WEB_PUSH_VAPID_PRIVATE_KEY?.trim();
  const webPushSubject = process.env.WEB_PUSH_SUBJECT?.trim();
  const hasAnyWebPushConfig =
    Boolean(webPushPublicKey) || Boolean(webPushPrivateKey) || Boolean(webPushSubject);

  if (hasAnyWebPushConfig) {
    if (!webPushPublicKey) {
      manglende.push("WEB_PUSH_VAPID_PUBLIC_KEY (påkrevd når web-push brukes)");
    }
    if (!webPushPrivateKey) {
      manglende.push("WEB_PUSH_VAPID_PRIVATE_KEY (påkrevd når web-push brukes)");
    }
    if (webPushSubject && !/^mailto:|^https?:\/\//i.test(webPushSubject)) {
      manglende.push("WEB_PUSH_SUBJECT (må starte med mailto: eller https://)");
    }
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

  // Valider Turnstile-variabler KUN når flagget er på.
  // Når TURNSTILE_ENABLED!=true er Turnstile helt skrudd av — ingen env-vars trengs.
  if (process.env.TURNSTILE_ENABLED?.toLowerCase() === "true") {
    if (!process.env.TURNSTILE_SECRET_KEY?.trim()) {
      manglende.push("TURNSTILE_SECRET_KEY (påkrevd når TURNSTILE_ENABLED=true)");
    }
    if (!process.env.AUTH_TURNSTILE_SECRET_KEY?.trim()) {
      manglende.push("AUTH_TURNSTILE_SECRET_KEY (påkrevd når TURNSTILE_ENABLED=true)");
    }
    const gateSecret = process.env.AUTH_TURNSTILE_GATE_SECRET?.trim();
    if (!gateSecret) {
      manglende.push("AUTH_TURNSTILE_GATE_SECRET (påkrevd når TURNSTILE_ENABLED=true)");
    } else if (gateSecret.length < 32) {
      manglende.push(
        "AUTH_TURNSTILE_GATE_SECRET må være minst 32 tegn (brukes til HMAC-signering). Generer med: node -e \"console.log(require('crypto').randomBytes(32).toString('hex'))\"",
      );
    }
  }
  if (!process.env.CONTACT_WORKER_URL?.trim()) {
    manglende.push("CONTACT_WORKER_URL (påkrevd for kontaktskjema)");
  } else {
    try {
      new URL(process.env.CONTACT_WORKER_URL);
    } catch {
      manglende.push("CONTACT_WORKER_URL (må være en gyldig URL)");
    }
  }
  if (!process.env.CONTACT_WORKER_SECRET?.trim()) {
    manglende.push("CONTACT_WORKER_SECRET (påkrevd for kontaktskjema)");
  }
  if (!process.env.CONTACT_TO_EMAIL?.trim()) {
    manglende.push("CONTACT_TO_EMAIL (påkrevd for kontaktskjema)");
  }
  if (!process.env.CONTACT_FROM_EMAIL?.trim()) {
    manglende.push("CONTACT_FROM_EMAIL (påkrevd for kontaktskjema)");
  }

  // CLERK_WEBHOOK_SECRET: required i prod (webhook-ruten returnerer 500 uten den,
  // og user.deleted-opprydding fungerer ikke). Warning i dev/test for å lette
  // lokal utvikling uten full Clerk-oppsett.
  if (!process.env.CLERK_WEBHOOK_SECRET?.trim()) {
    if (process.env.NODE_ENV === "production") {
      manglende.push(
        "CLERK_WEBHOOK_SECRET (påkrevd i produksjon — user.deleted-opprydding " +
        "vil feile med 500 uten den)",
      );
    } else {
      logger.warn(
        "CLERK_WEBHOOK_SECRET er ikke satt — Clerk webhook for user.deleted vil ikke fungere. " +
        "Sett variabelen og registrer webhook-URL i Clerk Dashboard.",
      );
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
