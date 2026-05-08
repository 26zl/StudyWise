/*
 * Node DNS-overstyring for MongoDB+SRV-tilkobling
 *
 * Når MONGO_URI bruker mongodb+srv://, gjør driveren et SRV-oppslag via Node sin
 * DNS-resolver. På utviklermaskiner der systemresolveren peker på 127.0.0.1
 * (f.eks. en stoppet lokal DNS-daemon) feiler oppslaget med
 * ECONNREFUSED/querySrv før noen Mongo-tilkobling i det hele tatt prøves.
 *
 * Modulen tilbyr:
 *   1. Eksplisitt overstyring via NODE_DNS_SERVERS (gjelder også prod hvis nødvendig)
 *   2. Automatisk dev-fallback til Google DNS når SRV-oppslaget avvises
 *   3. Feildeteksjon (isRefusedDnsSrvLookup) som lar database.ts retrye trygt
 *
 * Merk: dns.setServers() påvirker hele prosessen — også Redis, Pinecone, Clerk
 * og Anthropic vil bruke de samme DNS-serverne etter at den er kalt.
 */

import dns from "node:dns";
import { logger } from "./logger.js";

// Google Public DNS — brukes kun som fallback i dev (aldri i produksjon)
const DEFAULT_DEV_DNS_SERVERS = ["8.8.8.8", "8.8.4.4"];

/** Splitter kommaseparert env-verdi til en liste av trimmede DNS-servere */
function parseDnsServers(value: string | undefined): string[] {
  return (value ?? "")
    .split(",")
    .map((server) => server.trim())
    .filter(Boolean);
}

/**
 * Setter Node sin DNS-resolver fra NODE_DNS_SERVERS hvis variabelen er satt.
 * Returnerer true hvis overstyring ble aktivert, false ellers (uten env-var
 * eller ved ugyldig format — dns.setServers kaster på ugyldige IP-er).
 */
export function configureNodeDnsServersFromEnv(): boolean {
  const configuredServers = parseDnsServers(process.env.NODE_DNS_SERVERS);
  if (configuredServers.length === 0) {
    return false;
  }

  try {
    dns.setServers(configuredServers);
  } catch (error) {
    // Ugyldig IP eller format — fall tilbake til systemresolveren stille
    logger.warn({ err: error }, "Ugyldig NODE_DNS_SERVERS - ignorerer DNS-overstyring");
    return false;
  }

  logger.info(
    { dnsServers: dns.getServers() },
    "Node DNS-servere konfigurert fra NODE_DNS_SERVERS",
  );
  return true;
}

/**
 * Aktiverer Google DNS som fallback når SRV-oppslaget ble avvist lokalt.
 * No-op i produksjon — vi vil aldri auto-overstyre Heroku sin DNS-stack.
 */
export function configureDevDnsFallback(): boolean {
  if (process.env.NODE_ENV === "production") {
    // Bevisst no-op: bruk NODE_DNS_SERVERS hvis prod faktisk trenger overstyring
    return false;
  }

  const previousServers = dns.getServers();
  try {
    dns.setServers(DEFAULT_DEV_DNS_SERVERS);
  } catch (error) {
    logger.warn({ err: error }, "Kunne ikke konfigurere dev fallback-DNS");
    return false;
  }

  // Logges som warn fordi SRV-feilen som utløste fallback er reell selv om
  // vi recovery-er — utvikler bør fikse den lokale resolveren på sikt.
  logger.warn(
    {
      previousDnsServers: previousServers,
      dnsServers: dns.getServers(),
    },
    "Node DNS-oppslag ble avvist; bruker dev fallback-DNS og retryer",
  );
  return true;
}

/**
 * Sjekker om en feil er en avvist SRV-DNS-lookup (ECONNREFUSED/querySrv).
 * Brukes av database.ts for å avgjøre om dev-fallback + retry skal kjøres.
 *
 * Verifisert mot mongodb@7.2.0 + mongoose@9.6.1: SRV-feilen propagerer som
 * en rå NodeJS.ErrnoException med code/syscall intakt. For å være robust mot
 * fremtidige driver-/Mongoose-versjoner som måtte wrappe feilen, traverserer
 * vi også `cause`, `reason` (Mongoose TopologyDescription) og `errors`
 * (AggregateError). Syklusvern via visited-set forhindrer henging på
 * patologiske `cause`-løkker.
 */
export function isRefusedDnsSrvLookup(error: unknown): boolean {
  const visited = new Set<object>();

  const matches = (candidate: unknown): boolean => {
    if (!candidate || typeof candidate !== "object") return false;
    if (visited.has(candidate)) return false;
    visited.add(candidate);

    const e = candidate as {
      code?: unknown;
      syscall?: unknown;
      cause?: unknown;
      reason?: unknown;
      errors?: unknown;
    };

    if (e.code === "ECONNREFUSED" && e.syscall === "querySrv") return true;
    if (matches(e.cause)) return true;
    if (matches(e.reason)) return true;
    if (Array.isArray(e.errors) && e.errors.some(matches)) return true;
    return false;
  };

  return matches(error);
}
