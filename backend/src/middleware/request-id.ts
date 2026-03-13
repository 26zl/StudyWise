/**
 * Tildeler en unik request-ID til hver forespørsel for korrelasjon på tvers av logger og revisjon.
 * Leser X-Request-ID fra innkommende request eller genererer ny UUID.
 */
import type { Request, Response, NextFunction } from "express";
import { randomUUID } from "crypto";

const HEADER_REQUEST_ID = "x-request-id";

/** UUID v4 format: 8-4-4-4-12 hex chars */
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Max length for accepted request IDs (generous limit to allow non-UUID formats) */
const MAX_REQUEST_ID_LENGTH = 128;

export function requestIdMiddleware(req: Request, res: Response, next: NextFunction): void {
  const incoming = req.get(HEADER_REQUEST_ID);
  const trimmed = typeof incoming === "string" ? incoming.trim() : "";
  // Accept only reasonable-length IDs with safe characters (no newlines/control chars for log safety)
  const isValid = trimmed.length > 0
    && trimmed.length <= MAX_REQUEST_ID_LENGTH
    && (UUID_PATTERN.test(trimmed) || /^[\w.:-]+$/.test(trimmed));
  const id = isValid ? trimmed : randomUUID();
  (req as Request & { id: string }).id = id;
  res.setHeader(HEADER_REQUEST_ID, id);
  next();
}
