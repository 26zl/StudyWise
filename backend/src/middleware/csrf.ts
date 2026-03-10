/**
 * CSRF-beskyttelse for state-endrende forespørsler.
 * Krever at POST/PUT/PATCH/DELETE har:
 * - Header x-studywise-csrf: 1 (satt av frontend; hindrer tredjepartsider uten tilgang til JS)
 * - Origin eller Referer som matcher WEB_ORIGINS (hindrer forespørsler fra andre domener).
 * GET/OPTIONS påvirkes ikke (f.eks. /health for Heroku).
 * Server-til-server-kall (f.eks. Vercel SSR → Heroku) sender headeren men har ofte ikke Origin;
 * vi avviser kun når origin/referer finnes og er ugyldig.
 */
import type { NextFunction, Request, Response } from "express";
import {
  AUTH_CSRF_HEADER_NAME,
  AUTH_CSRF_HEADER_VALUE,
} from "common/auth";
import { sendError } from "../utils/apiError.js";
import { isProd } from "../utils/env.js";

const UNSAFE_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

// Hent tillatte origins fra miljøvariabler (WEB_ORIGINS), som er en kommaseparert liste over gyldige frontend-origins.
function getAllowedOrigins(): Set<string> {
  return new Set(
    (process.env.WEB_ORIGINS ?? process.env.WEB_ORIGIN ?? "")
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean),
  );
}

// Hjelpefunksjon for å ekstrahere origin fra Referer-headeren, hvis Origin-headeren mangler (f.eks. i noen SSR-scenarier).
function getOriginFromReferer(referer: string | undefined): string | null {
  if (!referer) return null;
  try {
    return new URL(referer).origin;
  } catch {
    return null;
  }
}

// Send 403 Forbidden med en melding om CSRF-feil.
function rejectCsrf(res: Response, melding: string): void {
  sendError(res, "validation_error", {
    status: 403,
    feil: "Forbidden",
    melding,
  });
}

// Middleware for å beskytte mot CSRF på state-endrende forespørsler.
export function beskytteMotCsrf(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  if (!UNSAFE_METHODS.has(req.method)) {
    return next();
  }

  const origin = req.get("origin");
  const refererOrigin = getOriginFromReferer(req.get("referer"));

  // I dev: tillat same-origin (f.eks. Swagger UI på /api-docs som kaller samme server)
  if (!isProd) {
    const host = req.get("host");
    if (host) {
      const backendOrigin = `${req.protocol}://${host}`.toLowerCase();
      const o = (origin || refererOrigin || "").toLowerCase();
      if (o === backendOrigin) return next();
    }
  }

  // Påkrevd: kun forespørsler som sender vår CSRF-header godtas (frontend setter den).
  const csrfHeader = req.get(AUTH_CSRF_HEADER_NAME);
  if (csrfHeader !== AUTH_CSRF_HEADER_VALUE) {
    return rejectCsrf(res, "Mangler gyldig CSRF-beskyttelse.");
  }

  // Ekstra sjekk: origin/referer må komme fra tillatte frontend-origins (WEB_ORIGINS).
  const allowedOrigins = getAllowedOrigins();
  if (origin && !allowedOrigins.has(origin)) {
    return rejectCsrf(res, "Ugyldig origin for foresporselen.");
  }

  if (!origin && refererOrigin && !allowedOrigins.has(refererOrigin)) {
    return rejectCsrf(res, "Ugyldig referer for foresporselen.");
  }

  return next();
}
