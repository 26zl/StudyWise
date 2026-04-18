/**
 * Delte SSE-verktøy (Server-Sent Events) for KI-ruter.
 * Sentraliserer header-oppsett, keepalive og socket-timeout.
 */

import type { Request, Response } from "express";

// Heroku H15 slår inn etter 55s uten aktivitet på socket. Vi sender keepalive
// hvert 15. sekund og én gang umiddelbart etter flushHeaders, så routeren ser
// trafikk også under lange kontekst-lastinger (Canvas sync + Anthropic latency).
const KEEPALIVE_INTERVAL_MS = 15_000;

interface SSESetupResult {
  /** Rydd opp keepalive-intervallet manuelt (gjøres også automatisk ved stream-slutt). */
  clearKeepalive: () => void;
  /** AbortSignal som utløses når total request-deadline er nådd. */
  deadlineSignal: AbortSignal;
}

/**
 * Setter opp SSE-headere, socket-timeout og keepalive-ping.
 * Returnerer en cleanup-funksjon for keepalive-intervallet.
 *
 * @param req  Express-request (brukes for socket-timeout)
 * @param res  Express-response (headere + keepalive-writes)
 * @param socketTimeoutMs  Socket-timeout i ms (default 120 000)
 */
export function setupSSE(req: Request, res: Response, socketTimeoutMs = 120_000): SSESetupResult {
  res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.removeHeader("Content-Encoding");

  if (!req.socket.destroyed) {
    try {
      req.socket.setTimeout(socketTimeoutMs);
    } catch {
      // Socket allerede lukket — ignorer
    }
  }

  res.flushHeaders();

  // Umiddelbar keepalive-pakke: sikrer at routeren ser aktivitet før første
  // Anthropic-chunk, selv om Canvas-kontekst/sync tar lang tid.
  try {
    res.write(": keepalive\n\n");
  } catch {
    // Socket allerede lukket — ignorer
  }

  let interval: ReturnType<typeof setInterval> | undefined = setInterval(() => {
    if (res.writableEnded || res.destroyed) {
      clearKeepalive();
      return;
    }
    try {
      res.write(": keepalive\n\n");
    } catch {
      clearKeepalive();
    }
  }, KEEPALIVE_INTERVAL_MS);

  // Total request-deadline: avbryter hele SSE-requesten etter socketTimeoutMs
  const deadlineController = new AbortController();
  const deadlineTimer = setTimeout(() => {
    deadlineController.abort();
    clearKeepalive();
    if (!res.writableEnded) {
      try { res.end(); } catch { /* allerede lukket */ }
    }
  }, socketTimeoutMs);

  function clearKeepalive() {
    if (interval) {
      clearInterval(interval);
      interval = undefined;
    }
  }

  // Rydd opp umiddelbart når klienten kobler fra (i stedet for å vente opptil 10s på neste keepalive-sjekk)
  req.socket.once("close", clearKeepalive);
  // Rydd opp deadline-timer når response avsluttes normalt
  res.once("finish", () => clearTimeout(deadlineTimer));
  res.once("close", () => clearTimeout(deadlineTimer));

  return { clearKeepalive, deadlineSignal: deadlineController.signal };
}

/**
 * Serialiserer payload til en sikker SSE data-frame streng.
 * JSON serialiseres og base64-kodes slik at event-streamen aldri inneholder
 * rått bruker-/AI-innhold eller linjeskift som kan bryte SSE-rammen.
 */
function serializeSSEFrame(payload: unknown): string {
  const json = JSON.stringify(payload);
  const encoded = Buffer.from(json, "utf8").toString("base64");
  return `data: ${encoded}\n\n`;
}

/**
 * Skriver en serialisert SSE data-frame til response.
 * Sjekker writableEnded for å unngå write etter stream-slutt.
 */
export function writeSSE(res: Response, payload: unknown): boolean {
  if (res.writableEnded) return false;
  try {
    const frame = serializeSSEFrame(payload);
    res.write(frame);
    return true;
  } catch {
    // Klient frakoblet mellom writableEnded-sjekk og write — ignorér
    return false;
  }
}
