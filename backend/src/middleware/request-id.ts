/**
 * Tildeler en unik request-ID til hver forespørsel for korrelasjon på tvers av logger og revisjon.
 * Leser X-Request-ID fra innkommende request eller genererer ny UUID.
 */
import type { Request, Response, NextFunction } from "express";
import { randomUUID } from "crypto";

const HEADER_REQUEST_ID = "x-request-id";

/** UUID v4 format: 8-4-4-4-12 hex chars */
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Maks lengde for aksepterte request-ID-er (romslig grense for å tillate ikke-UUID-formater) */
const MAX_REQUEST_ID_LENGTH = 128;

/**
 * Setter `req.id` og `x-request-id` respons-header for korrelasjon i logger.
 * Godtar innkommende `x-request-id` hvis den er "trygg", ellers genereres UUID.
 */
export function requestIdMiddleware(req: Request, res: Response, next: NextFunction): void {
  const incoming = req.get(HEADER_REQUEST_ID);
  const trimmed = typeof incoming === "string" ? incoming.trim() : "";
  // Godta kun IDer med rimelig lengde og sikre tegn (ingen linjeskift/kontrolltegn for loggsikkerhet)
  const isValid =
    trimmed.length > 0 &&
    trimmed.length <= MAX_REQUEST_ID_LENGTH &&
    (UUID_PATTERN.test(trimmed) || /^[\w.:-]+$/.test(trimmed));
  const id = isValid ? trimmed : randomUUID();
  (req as Request & { id: string }).id = id;
  res.setHeader(HEADER_REQUEST_ID, id);
  next();
}
