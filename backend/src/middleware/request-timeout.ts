/**
 * Request timeout middleware
 *
 * Setter en maks-tid for requests. Hvis requesten ikke er ferdig innen fristen,
 * sendes 504 Gateway Timeout og requesten avbrytes.
 *
 * SSE-endepunkter (text/event-stream) ekskluderes fordi de er langvarige av natur.
 */

import type { Request, Response, NextFunction } from "express";
import { logger } from "../utils/logger.js";

const DEFAULT_TIMEOUT_MS = 30_000;  // 30 sekunder for vanlige requests
const UPLOAD_TIMEOUT_MS = 120_000;  // 2 minutter for filopplasting

// Endepunkter som har lengre timeout (filopplasting, dokumentanalyse, KI-chat som laster Canvas-kontekst)
const LONG_TIMEOUT_PREFIXES = [
    "/api/ki/analyse",
    "/api/ki/oppsummering",
    "/api/ki/chat",
];

export function requestTimeout(req: Request, res: Response, next: NextFunction) {
    // SSE-streams håndterer sin egen timeout — ikke begrens dem her
    // Sjekkes via Accept-header siden Content-Type ennå ikke er satt
    if (req.headers.accept === "text/event-stream") {
        return next();
    }

    const isLongRequest = LONG_TIMEOUT_PREFIXES.some(p => req.path.startsWith(p));
    const timeoutMs = isLongRequest ? UPLOAD_TIMEOUT_MS : DEFAULT_TIMEOUT_MS;

    const timer = setTimeout(() => {
        if (!res.headersSent) {
            logger.warn(
                { method: req.method, path: req.path, timeoutMs },
                "Request timeout — avbryter",
            );
            res.status(504).json({
                feil: "Gateway Timeout",
                melding: "Forespørselen tok for lang tid. Prøv igjen.",
            });
        }
    }, timeoutMs);

    // Rydd opp timeren når responsen er ferdig
    res.on("close", () => clearTimeout(timer));

    next();
}
