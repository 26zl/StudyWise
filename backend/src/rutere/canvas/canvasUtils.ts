/*
* Ulike hjelpefunksjoner og typer for Canvas API
*/
import crypto from "crypto";
import validator from "validator";
import { Request, Response as ExpressResponse, NextFunction } from "express";
import { getCache, setCache } from "../../cache/redis.js";
import { logger } from "../../utils/logger.js";
import {
  createCanvasError,
  classifyHttpStatus,
  getErrorMessage,
  getErrorResponse,
  type CanvasErrorCode,
} from "./canvasErrors.js";

// Typer og Interfaces
// Canvas fetch funksjon med paginering og timeout
export interface CanvasFetchOptions {
    queryParams?: Record<string, string | number | boolean | string[]>;
    timeout?: number;
    maxPages?: number;
    token?: string;
    cacheTtl?: number; // Custom cache TTL i sekunder
    maxRetries?: number; // Maks antall retry ved rate limit
}

// Standardisert responsformat
export interface CanvasResponse<T> {
    data: T;
    meta?: {
        pagesFetched: number;
        itemsCount: number;
    };
}

// Legacy feiltype for bakoverkompatibilitet (deprecated - bruk CanvasApiError)
interface CanvasHttpError extends Error {
    status?: number;
    details?: string;
    retryAfter?: number;
    code?: CanvasErrorCode;
}

// Standard cache TTL verdier (i sekunder)
export const CACHE_TTL = {
    COURSES: 1800,      // 30 min - emner endres sjelden
    MODULES: 1800,      // 30 min - moduler endres sjelden
    ASSIGNMENTS: 600,   // 10 min - oppgaver kan oppdateres
    ANNOUNCEMENTS: 300, // 5 min - announcements kan være tidskritiske
    TODO: 120,          // 2 min - todo-liste er dynamisk
    EVENTS: 120,        // 2 min - hendelser er dynamiske
    USER_PROFILE: 3600, // 60 min - profil endres sjelden
    FILES: 1800,        // 30 min - filer endres sjelden
    PAGES: 1800,        // 30 min - sider endres sjelden
    DISCUSSIONS: 1800,  // 30 min - diskusjonstråder (tittel/innhold) endres sjelden
    DEFAULT: 600,       // 10 min - standard fallback
} as const;

// Paginering: per_page verdier for ulike endepunkt-typer
export const PAGE_SIZE = {
    DEFAULT: 100,       // Standard for de fleste lister
    ANNOUNCEMENTS: 50,  // Kunngjøringer har ofte mye innhold
    MODULES: 50,        // Moduler inkluderer items, begrens størrelse
} as const;

// Paginering: maks antall sider å hente (forhindrer uendelige loops)
export const MAX_PAGES = {
    DEFAULT: 5,         // Standard for de fleste endepunkter
    CALENDAR: 10,       // Kalenderhendelser kan spenne over mange sider
    LECTURES: 15,       // Forelesninger over lengre periode trenger mer data
} as const;

// Hjelpefunksjon for å vente med exponential backoff
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

// Hjelpefunksjoner
// Henter Canvas konfig fra miljøvariabler
export const hentCanvasKonfig = () => ({
    baseUrl: process.env.CANVAS_BASE_URL,
});


// Kalender vindu konfigurasjon (måneder)
export const KALENDER_VINDU = {
    MÅNEDER_TILBAKE: 1,
    MÅNEDER_FREM: 6,
} as const;

// Utvidet vindu for forelesninger/TimeEdit (henter mer data for å fange opp alle)
export const FORELESNINGER_VINDU = {
    MÅNEDER_TILBAKE: 3,
    MÅNEDER_FREM: 12,
} as const;

// Helper: beregn kalendervindu-datoer for API-kall
export const beregnKalenderVindu = (options?: {
    månederTilbake?: number;
    månederFrem?: number;
}): { startDate: string; endDate: string } => {
    const månederTilbake = options?.månederTilbake ?? KALENDER_VINDU.MÅNEDER_TILBAKE;
    const månederFrem = options?.månederFrem ?? KALENDER_VINDU.MÅNEDER_FREM;
    const now = new Date();
    const startDate = new Date(now);
    startDate.setMonth(startDate.getMonth() - månederTilbake);
    const endDate = new Date(now);
    endDate.setMonth(endDate.getMonth() + månederFrem);
    return {
        startDate: startDate.toISOString().split("T")[0],
        endDate: endDate.toISOString().split("T")[0],
    };
};

// Helper: avgrens kalender-vindu (nå -1 mnd til +6 mnd)
export const erInnenforKalenderVindu = (isoDato?: string | null, options?: {
    månederTilbake?: number;
    månederFrem?: number;
}) => {
    if (!isoDato) return false;
    const time = Date.parse(isoDato);
    if (Number.isNaN(time)) return false;
    const månederFrem = options?.månederFrem ?? KALENDER_VINDU.MÅNEDER_FREM;
    const månederTilbake = options?.månederTilbake ?? KALENDER_VINDU.MÅNEDER_TILBAKE;
    const endWindow = new Date();
    endWindow.setMonth(endWindow.getMonth() + månederFrem);
    const startWindow = new Date();
    startWindow.setMonth(startWindow.getMonth() - månederTilbake);
    return time >= startWindow.getTime() && time <= endWindow.getTime();
};

// Parse Link header for paginering
export function parseLinkHeader(linkHeader: string | null): string | null {
    if (!linkHeader) return null;
    const links = linkHeader.split(",");
    for (const link of links) {
        const match = link.match(/<([^>]+)>;\s*rel="next"/);
        if (match) return match[1];
    }
    return null;
}

// Middleware
// Sjekk at Canvas token er konfigurert
export function krevCanvasToken(req: Request, res: ExpressResponse, next: NextFunction) {
    try {
        if (!req.user?.id) {
            return res.status(401).json(getErrorResponse("token_invalid"));
        }
        if (!req.canvasToken) {
            return res.status(403).json(getErrorResponse("token_missing"));
        }
        next();
    } catch (error) {
        logger.error({ err: error }, "Feil ved validering av Canvas-token");
        return res.status(500).json(getErrorResponse("server_error"));
    }
}

// Hjelpefunksjon for å logge rate limit status (bruker native fetch Response)
function loggRateLimitStatus(response: globalThis.Response, endpoint: string) {
    const remaining = response.headers.get("X-Rate-Limit-Remaining");
    const requestCost = response.headers.get("X-Request-Cost");
    if (remaining) {
        const remainingNum = parseFloat(remaining);
        if (remainingNum < 100) {
            logger.warn({
                remaining: remainingNum,
                requestCost,
                endpoint
            }, "Canvas rate limit kvote lav");
        } else if (remainingNum < 300) {
            logger.info({
                remaining: remainingNum,
                requestCost,
                endpoint
            }, "Canvas rate limit kvote moderat");
        }
    }
}

// Liste over sensitive endepunkter som IKKE skal caches
const SENSITIVE_ENDPOINTS = [
    "/api/v1/users/self/profile",
    "/api/v1/users/self",
    "/api/v1/conversations"
];

// In-flight request map for singleflight deduplication
// Når flere kall til samme cache key er in-flight samtidig, deles én promise
const inflightRequests = new Map<string, Promise<CanvasResponse<unknown>>>();

// Hovedfunksjon - med singleflight deduplication
export async function hentCanvasData<T>(
    endpoint: string,
    options: CanvasFetchOptions = {}
): Promise<CanvasResponse<T>> {
    const { baseUrl } = hentCanvasKonfig();
    const canvasToken = options.token ?? null;
    if (!canvasToken) throw new Error("Canvas-token mangler for innlogget bruker");
    if (!baseUrl) throw new Error("CANVAS_BASE_URL er ikke konfigurert");
    const cleanToken = canvasToken.replace(/^Bearer\s+/i, "").trim();
    const erSensitiv = SENSITIVE_ENDPOINTS.some(p => endpoint.includes(p));

    // Sensitive endepunkter skal ikke dedupliseres
    if (erSensitiv) {
        return hentCanvasDataImpl<T>(endpoint, options, cleanToken, baseUrl);
    }

    // Bygg cache key for deduplication (samme logikk som i impl)
    const tokenAvtrykk = crypto.createHash("sha256").update(cleanToken).digest("hex").slice(0, 32);
    const sortedParams: string[] = [];
    if (options.queryParams) {
        Object.keys(options.queryParams).sort().forEach((key) => {
            const value = options.queryParams![key];
            if (Array.isArray(value)) {
                const arrayKey = key.endsWith("[]") ? key : `${key}[]`;
                value.forEach((item) => sortedParams.push(`${arrayKey}=${item}`));
            } else {
                sortedParams.push(`${key}=${value}`);
            }
        });
    }
    const dedupKey = `canvas:${tokenAvtrykk}:${endpoint}?${sortedParams.join("&")}`;

    // Sjekk om det allerede er en in-flight request for denne nøkkelen
    const existing = inflightRequests.get(dedupKey);
    if (existing) {
        return existing as Promise<CanvasResponse<T>>;
    }

    // Opprett og registrer ny request
    const promise = hentCanvasDataImpl<T>(endpoint, options, cleanToken, baseUrl)
        .finally(() => {
            inflightRequests.delete(dedupKey);
        });

    inflightRequests.set(dedupKey, promise as Promise<CanvasResponse<unknown>>);
    return promise;
}

// Intern implementasjon av hentCanvasData
async function hentCanvasDataImpl<T>(
    endpoint: string,
    options: CanvasFetchOptions,
    cleanToken: string,
    baseUrl: string
): Promise<CanvasResponse<T>> {
    const {
        queryParams,
        timeout = 10000,
        maxPages = 5,
        cacheTtl = CACHE_TTL.DEFAULT,
        maxRetries = 3
    } = options;
    // Sjekk om endepunktet inneholder sensitiv data som IKKE skal caches
    const erSensitiv = SENSITIVE_ENDPOINTS.some(p => endpoint.includes(p));
    // Logg debug info for sensitive endepunkter (uten token-data for sikkerhet)
    if (erSensitiv) {
        logger.info({
            tokenPresent: cleanToken.length > 0,
            endpoint
        }, "Forbereder Canvas-kall mot sensitivt endepunkt");
    }
    // Bygg URL med query params
    // Canvas API forventer array-params som: context_codes[]=val1&context_codes[]=val2
    // IKKE: context_codes[][]=val1 (dobbel brackets gir 500-feil)
    const url = new URL(`${baseUrl}${endpoint}`);
    const cacheNokkelParams: string[] = [];
    if (queryParams) {
        // Sorterer keys for stabilitet i cache key
        Object.keys(queryParams).sort().forEach((key) => {
            const value = queryParams[key];
            if (Array.isArray(value)) {
                // Hvis key allerede slutter på [], ikke legg til enda en []
                // Dette fikser bug hvor context_codes[] ble til context_codes[][]
                const arrayKey = key.endsWith("[]") ? key : `${key}[]`;
                value.forEach((item) => {
                    url.searchParams.append(arrayKey, String(item));
                    cacheNokkelParams.push(`${arrayKey}=${item}`);
                });
            } else {
                url.searchParams.append(key, String(value));
                cacheNokkelParams.push(`${key}=${value}`);
            }
        });
    }
    // Generer unik cache key per token (unngå lekkasje mellom brukere)
    const tokenAvtrykk = crypto.createHash("sha256").update(cleanToken).digest("hex").slice(0, 32);
    const cacheNokkel = `canvas:${tokenAvtrykk}:${endpoint}?${cacheNokkelParams.join("&")}`;
    // Sjekk cache (KUN hvis ikke sensitiv)
    if (!erSensitiv) {
        try {
            const cachedData = await getCache(cacheNokkel);
            if (cachedData) {
                const parsed = JSON.parse(cachedData);
                // Sjekk om dette er en cachet negativ respons (feilet tidligere)
                if (parsed.error && parsed.cached) {
                    logger.info({ cacheKey: cacheNokkel, errorCode: parsed.error }, "Redis Cache HIT (negativ)");
                    // Re-throw den samme feilen som vi ville fått fra API
                    const error = createCanvasError(
                        parsed.error as CanvasErrorCode,
                        getErrorMessage(parsed.error as CanvasErrorCode),
                        { httpStatus: parsed.error === "permission_denied" ? 403 : 404, endpoint }
                    );
                    throw error;
                }
                logger.info({ cacheKey: cacheNokkel }, "Redis Cache HIT");
                return parsed;
            }
            logger.info({ cacheKey: cacheNokkel }, "Redis Cache MISS");
        } catch (err) {
            // Re-throw Canvas errors (inkludert cached negative responses)
            if (err instanceof Error && err.name === "CanvasApiError") {
                throw err;
            }
            logger.error({ err }, "Cache henting feilet");
        }
    } else {
        logger.info({ endpoint }, "Skipper cache for sensitivt endepunkt");
    }
    // Hent data fra API (med paginering og retry-logikk)
    const allItems: unknown[] = [];
    let currentUrl: string | null = url.toString();
    let pagesFetched = 0;
    while (currentUrl && pagesFetched < maxPages) {
        let retryCount = 0;
        let response: globalThis.Response | null = null;
        // Retry-loop for rate limiting
        while (retryCount <= maxRetries) {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), timeout);
            try {
                response = await fetch(currentUrl, {
                    method: "GET",
                    headers: {
                        Authorization: `Bearer ${cleanToken}`,
                        "Content-Type": "application/json",
                    },
                    signal: controller.signal,
                });
                // Logg rate limit status
                loggRateLimitStatus(response, endpoint);
                // Håndter rate limiting (429)
                if (response.status === 429) {
                    const retryAfterHeader = response.headers.get("Retry-After");
                    const retryAfterSeconds = retryAfterHeader ? parseInt(retryAfterHeader, 10) : null;
                    if (retryCount >= maxRetries) {
                        const error = new Error("Canvas rate limit nådd - maks antall retry forsøk brukt") as CanvasHttpError;
                        error.status = 429;
                        error.retryAfter = retryAfterSeconds || undefined;
                        error.details = `Prøv igjen om ${retryAfterSeconds || "noen"} sekunder`;
                        logger.error({
                            endpoint,
                            retryCount,
                            retryAfterSeconds
                        }, "Canvas rate limit - gir opp etter maks retry");
                        throw error;
                    }
                    // Exponential backoff: 1s, 2s, 4s (eller bruk Retry-After header)
                    const backoffMs = retryAfterSeconds
                        ? retryAfterSeconds * 1000
                        : Math.min(1000 * Math.pow(2, retryCount), 10000);
                    logger.warn({
                        endpoint,
                        retryCount: retryCount + 1,
                        maxRetries,
                        backoffMs,
                        retryAfterSeconds
                    }, "Canvas rate limit (429) - venter før retry");
                    await sleep(backoffMs);
                    retryCount++;
                    continue;
                }
                // Annen feil - klassifiser basert på status og respons
                if (!response.ok) {
                    const errorText = await response.text();
                    const errorCode = classifyHttpStatus(response.status, errorText);

                    // Logg strukturert feil (uten sensitiv data)
                    logger.warn({
                        endpoint,
                        httpStatus: response.status,
                        errorCode,
                        // Ikke logg token eller full errorText (kan inneholde sensitiv data)
                    }, `Canvas API feil: ${errorCode}`);

                    // Cache "permanente" feil (permission denied, resource disabled/not found)
                    // Dette forhindrer gjentatte kall til endpoints som alltid vil feile
                    const permanentErrors = ["permission_denied", "resource_disabled", "resource_not_found"];
                    if (!erSensitiv && cacheTtl > 0 && permanentErrors.includes(errorCode)) {
                        const negativeResult = {
                            data: null,
                            error: errorCode,
                            cached: true,
                        };
                        // Cache negative result med kortere TTL (5 minutter)
                        const negativeCacheTtl = Math.min(cacheTtl, 300);
                        await setCache(cacheNokkel, JSON.stringify(negativeResult), negativeCacheTtl);
                        logger.debug({ endpoint, errorCode, cacheTtl: negativeCacheTtl }, "Cachet negativ respons");
                    }

                    // Opprett strukturert feil
                    const error = createCanvasError(
                        errorCode,
                        getErrorMessage(errorCode),
                        {
                            httpStatus: response.status,
                            endpoint,
                            details: errorText,
                        }
                    );
                    throw error;
                }
                // Suksess - bryt ut av retry-loop
                break;
            } catch (error) {
                if (error instanceof Error && error.name === "AbortError") {
                    throw new Error(`Canvas API timeout etter ${timeout}ms`);
                }
                throw error;
            } finally {
                // Sikrer at timeout alltid blir ryddet opp
                clearTimeout(timeoutId);
            }
        }
        if (!response) {
            throw new Error("Uventet feil: ingen respons fra Canvas API");
        }
        const data = await response.json();
        pagesFetched++;
        // Hvis ikke array, er det enkeltting - returner med en gang
        if (!Array.isArray(data)) {
            const result = { data: data as T };
            if (!erSensitiv && cacheTtl > 0) {
                await setCache(cacheNokkel, JSON.stringify(result), cacheTtl);
            }
            return result;
        }
        // Hvis array, legg til og sjekk neste side
        allItems.push(...data);
        const linkHeader = response.headers.get("Link");
        currentUrl = parseLinkHeader(linkHeader);
        if (!currentUrl) break;
    }
    // Returner samlet resultat
    const result = {
        data: allItems as T,
        meta: {
            pagesFetched,
            itemsCount: allItems.length,
        },
    };
    // Lagre i cache med custom TTL (KUN hvis ikke sensitiv)
    if (!erSensitiv && cacheTtl > 0) {
        await setCache(cacheNokkel, JSON.stringify(result), cacheTtl);
        logger.info({ endpoint, pagesFetched, itemsCount: allItems.length, cacheTtl }, "Canvas data hentet og cachet");
    }
    return result;
}

/**
 * Sjekker at en streng er trygg som path-segment (ingen path traversal).
 * Avviser "..", "/", "\\" og null-byte for å forhindre path traversal i API-URLer.
 */
export function isSafePathSegment(value: string): boolean {
    if (typeof value !== "string" || value.length === 0 || value.length > 500) return false;
    if (value.includes("..") || value.includes("/") || value.includes("\\") || value.includes("\0")) return false;
    return true;
}

// Valider redirect URL for å forhindre Open Redirect sårbarheter
export function validateCanvasRedirectUrl(urlStr: string, allowedOrigin: string, pathPrefix?: string): string | null {
    try {
        const allowedUrl = new URL(allowedOrigin);
        const allowedHost = allowedUrl.hostname;
        // Bruk validator.isURL med strict whitelist
        const isValid = validator.isURL(urlStr, {
            protocols: ["https", "http"],
            require_protocol: true,
            host_whitelist: [allowedHost],
            validate_length: true
        });
        if (!isValid) return null;
        // Ekstra sjekk for path prefix hvis nødvendig (validator sjekker ikke path content - kun host)
        if (pathPrefix) {
            const url = new URL(urlStr);
            if (!url.pathname.startsWith(pathPrefix)) return null;
        }
        return urlStr;
    } catch {
        return null;
    }
}
