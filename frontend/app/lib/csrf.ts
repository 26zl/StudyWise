/**
 * CSRF-hjelp for frontend: legger til x-studywise-csrf-header på state-endrende kall.
 * Bruk withCsrfProtection() rundt fetch-options for POST/PUT/PATCH/DELETE mot /api/*.
 * Backend (csrf.ts) krever headeren + at Origin/Referer matcher WEB_ORIGINS.
 */
import {
  AUTH_CSRF_HEADER_NAME,
  AUTH_CSRF_HEADER_VALUE,
} from "common/auth";

// Setter CSRF-header for state-endrende kall. GET/HEAD/OPTIONS påvirkes ikke.
const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

// Hjelpefunksjon for å legge til CSRF-header på fetch-opsjoner for state-endrende kall.
export function withCsrfProtection(init: RequestInit = {}): RequestInit {
  const method = (init.method ?? "GET").toUpperCase();
  if (SAFE_METHODS.has(method)) {
    return init;
  }

  // Legg til CSRF-header for POST/PUT/PATCH/DELETE
  const headers = new Headers(init.headers);
  headers.set(AUTH_CSRF_HEADER_NAME, AUTH_CSRF_HEADER_VALUE);

  // Returner nye opsjoner med CSRF-headeren lagt til
  return {
    ...init,
    headers,
  };
}
