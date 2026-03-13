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
const KI_CHAT_TIMEOUT_MS = 180_000; // 3 minutter for KI-chat (kontekstlasting + oppsummering kan ta lang tid)

// Endepunkter som har lengre timeout (filopplasting, dokumentanalyse, KI-chat som laster Canvas-kontekst)
const LONG_TIMEOUT_PREFIXES = [
    "/api/ki/analyse",
    "/api/ki/oppsummering",
    "/api/ki/chat",
    "/api/ki/task-breakdown",
    "/api/ki/weekly-plan",
];

function getRequestPath(req: Request): string {
    return (req.originalUrl ?? req.url ?? req.path ?? "").split("?")[0] ?? "";
}

export function requestTimeout(req: Request, res: Response, next: NextFunction) {
    const pathname = getRequestPath(req);

    // SSE-endepunkter håndterer sin egen socket-timeout — ikke begrens dem her
    // POST /api/ki/chat og /api/ki/analyze-document bruker SSE-streaming
    const isSseEndpoint =
        (req.method === "POST" && pathname === "/api/ki/chat") ||
        (req.method === "POST" && pathname === "/api/ki/analyze-document");
    if (isSseEndpoint) {
        return next();
    }

    const isKiChat = pathname.startsWith("/api/ki/chat");
    const isLongRequest = isKiChat || LONG_TIMEOUT_PREFIXES.some(p => pathname.startsWith(p));
    const timeoutMs = isKiChat ? KI_CHAT_TIMEOUT_MS : isLongRequest ? UPLOAD_TIMEOUT_MS : DEFAULT_TIMEOUT_MS;

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
