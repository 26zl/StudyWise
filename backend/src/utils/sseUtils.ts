/**
 * Delte SSE-verktøy (Server-Sent Events) for KI-ruter.
 * Sentraliserer header-oppsett, keepalive og socket-timeout.
 */

import type { Request, Response } from "express";

const KEEPALIVE_INTERVAL_MS = 10_000;

interface SSESetupResult {
  /** Rydd opp keepalive-intervallet manuelt (gjøres også automatisk ved stream-slutt). */
  clearKeepalive: () => void;
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

  function clearKeepalive() {
    if (interval) {
      clearInterval(interval);
      interval = undefined;
    }
  }

  return { clearKeepalive };
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
  const frame = serializeSSEFrame(payload);
  res.write(frame);
  return true;
}
