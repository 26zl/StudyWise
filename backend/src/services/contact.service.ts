/**
 * Kontakttransport-tjeneste
 * Videresender kontaktmeldinger til ekstern webhook/worker
 *
 * Konfigureres via miljøvariabler:
 * - CONTACT_WORKER_URL: URL til webhook/worker
 * - CONTACT_WORKER_SECRET: Hemmelig nøkkel for autentisering
 * - CONTACT_TO_EMAIL: Mottaker-e-post
 * - CONTACT_FROM_EMAIL: Avsender-e-post
 */

import { logger } from "../utils/logger.js";
import { isProd } from "../utils/env.js";

const TRANSPORT_TIMEOUT_MS = 10000;

export interface KontaktPayload {
  navn: string;
  epost: string;
  emne: string;
  melding: string;
  sideUrl?: string;
  timestamp: string;
  requestId?: string;
}

export interface TransportResult {
  success: boolean;
  error?: string;
}

/**
 * Sjekker om kontakttransport er konfigurert
 */
export function isContactTransportConfigured(): boolean {
  return !!(
    process.env.CONTACT_WORKER_URL?.trim() &&
    process.env.CONTACT_WORKER_SECRET?.trim()
  );
}

/**
 * Henter konfigurasjon for kontakttransport
 */
function getTransportConfig() {
  return {
    workerUrl: process.env.CONTACT_WORKER_URL?.trim(),
    workerSecret: process.env.CONTACT_WORKER_SECRET?.trim(),
    toEmail: process.env.CONTACT_TO_EMAIL?.trim(),
    fromEmail: process.env.CONTACT_FROM_EMAIL?.trim(),
  };
}

/**
 * Sender kontaktmelding til ekstern worker/webhook
 *
 * I development uten konfigurasjon: returnerer mock-suksess
 * I production uten konfigurasjon: kaster feil (503)
 */
export async function sendKontaktmelding(
  payload: KontaktPayload,
): Promise<TransportResult> {
  const config = getTransportConfig();

  // Sjekk om transport er konfigurert
  if (!config.workerUrl || !config.workerSecret) {
    if (isProd) {
      logger.error("Kontakttransport ikke konfigurert i produksjon");
      throw new Error("CONTACT_TRANSPORT_NOT_CONFIGURED");
    }

    // Development: mock-suksess
    logger.info(
      { requestId: payload.requestId, epostDomene: payload.epost.split("@")[1] ?? "unknown" },
      "DEV: Kontaktmelding mottatt (mock-transport)",
    );
    return { success: true };
  }

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), TRANSPORT_TIMEOUT_MS);

    // Bygg payload for worker (ikke logg meldingsinnhold)
    const workerPayload = {
      navn: payload.navn,
      epost: payload.epost,
      emne: payload.emne,
      melding: payload.melding,
      sideUrl: payload.sideUrl,
      timestamp: payload.timestamp,
      toEmail: config.toEmail,
      fromEmail: config.fromEmail,
    };

    const response = await fetch(config.workerUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Contact-Secret": config.workerSecret,
      },
      body: JSON.stringify(workerPayload),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      logger.error(
        {
          status: response.status,
          requestId: payload.requestId,
        },
        "Kontakttransport feilet",
      );
      return { success: false, error: "transport-failed" };
    }

    logger.info(
      {
        requestId: payload.requestId,
        epostDomene: payload.epost.split("@")[1] ?? "unknown",
        timestamp: payload.timestamp,
      },
      "Kontaktmelding sendt til worker",
    );

    return { success: true };
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      logger.error(
        { requestId: payload.requestId },
        "Kontakttransport timet ut",
      );
      return { success: false, error: "timeout" };
    }

    logger.error(
      { err: error, requestId: payload.requestId },
      "Kontakttransport feilet",
    );
    return { success: false, error: "internal-error" };
  }
}
