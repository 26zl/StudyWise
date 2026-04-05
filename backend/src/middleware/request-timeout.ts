/**
 * Request timeout middleware
 *
 * Setter en maks-tid for requests. Hvis requesten ikke er ferdig innen fristen,
 * sendes 504 Gateway Timeout og signalerer avbrudd via AbortController.
 *
 * SSE-endepunkter (text/event-stream) ekskluderes fordi de er langvarige av natur.
 */

import type { Request, Response, NextFunction } from "express";
import { logger } from "../utils/logger.js";
import { apiError } from "../utils/apiError.js";

const DEFAULT_TIMEOUT_MS = 30_000;  // 30 sekunder for vanlige requests
const UPLOAD_TIMEOUT_MS = 120_000;  // 2 minutter for filopplasting, dokumentanalyse, task-breakdown
const KI_CHAT_TIMEOUT_MS = 180_000; // 3 minutter for KI-chat (kontekstlasting + oppsummering kan ta lang tid)
const KI_WEEKLY_PLAN_TIMEOUT_MS = 120_000; // 2 minutter for ukeplangenerator (AI kan ta lang tid)
const FILE_DOWNLOAD_TIMEOUT_MS = 180_000; // 3 minutter for store eller trege Canvas-filer

// Endepunkter som har lengre timeout (filopplasting, dokumentanalyse, KI-chat som laster Canvas-kontekst)
const LONG_TIMEOUT_PREFIXES = [
    "/api/ki/analyze-document",
    "/api/ki/oppsummering",
    "/api/ki/chat",
    "/api/ki/task-breakdown",
    "/api/ki/weekly-plan",
    "/api/quiz/generate",
    "/api/flashcards/generate",
];

function getRequestPath(req: Request): string {
    return (req.originalUrl ?? req.url ?? req.path ?? "").split("?")[0] ?? "";
}

// Utvid Express Request for å inkludere AbortController signal
declare global {
    // eslint-disable-next-line @typescript-eslint/no-namespace
    namespace Express {
        interface Request {
            timeoutSignal?: AbortSignal;
            timeoutAborted?: boolean;
        }
    }
}

/**
 * Setter en tidsfrist for requesten og avbryter nedstrøms operasjoner ved timeout.
 *
 * Legger `req.timeoutSignal` til slik at services kan avbryte fetch/AI-kall osv.
 */
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
    const isWeeklyPlan = pathname.startsWith("/api/ki/weekly-plan");
    const isFileDownload =
        req.method === "GET" &&
        /^\/api\/canvas\/filer\/\d+\/download$/.test(pathname);
    const isLongRequest =
        isKiChat ||
        isWeeklyPlan ||
        isFileDownload ||
        LONG_TIMEOUT_PREFIXES.some(p => pathname.startsWith(p));
    const timeoutMs = isKiChat
        ? KI_CHAT_TIMEOUT_MS
        : isWeeklyPlan
            ? KI_WEEKLY_PLAN_TIMEOUT_MS
            : isFileDownload
                ? FILE_DOWNLOAD_TIMEOUT_MS
                : isLongRequest
                    ? UPLOAD_TIMEOUT_MS
                    : DEFAULT_TIMEOUT_MS;

    // Opprett AbortController for å signalere avbrudd til nedstrøms operasjoner
    const abortController = new AbortController();
    req.timeoutSignal = abortController.signal;
    req.timeoutAborted = false;

    const cleanup = () => {
        clearTimeout(timer);
    };

    const abortRequest = () => {
        if (abortController.signal.aborted) return;
        req.timeoutAborted = true;
        abortController.abort();
    };

    const timer = setTimeout(() => {
        abortRequest();

        if (!res.headersSent) {
            logger.warn(
                { method: req.method, path: req.path, timeoutMs },
                "Request timeout — avbryter nedstrøms operasjoner",
            );
            return apiError.timeout(res, "Forespørselen tok for lang tid. Prøv igjen.");
        }

        // Ikke ødelegg socket manuelt her; vi har allerede sendt 504-respons.
        // Manuell destroy gir ECONNRESET/socket hang up i proxy/klient.
    }, timeoutMs);

    // Rydd opp timeren når responsen er ferdig
    res.once("finish", cleanup);
    res.once("close", cleanup);

    // Rydd opp hvis klienten avbryter requesten tidlig.
    req.once("close", () => {
        cleanup();
        if (!res.writableEnded) {
            abortRequest();
        }
    });

    next();
}
