/*
* Ulike hjelpefunksjoner og typer for Canvas API
*/
import crypto from "crypto";
import validator from "validator";
import { Request, Response as ExpressResponse, NextFunction } from "express";
import { getCache, setCache } from "../../cache/redis.js";
import { logger } from "../../utils/logger.js";

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
// Feiltype for Canvas HTTP-feil
interface CanvasHttpError extends Error {
    status?: number;
    details?: string;
    retryAfter?: number;
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

// Hjelpefunksjon for å vente med exponential backoff
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

// Hjelpefunksjoner
// Henter Canvas konfig fra miljøvariabler
export const hentCanvasKonfig = () => ({
    baseUrl: process.env.CANVAS_BASE_URL,
});

// Hent Canvas token (overstyrt eller fra miljøvariabel)
export const hentCanvasToken = (overstyrtToken?: string): string | null => {
    return overstyrtToken ?? null;
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
            return res.status(401).json({
                feil: "Ikke autentisert",
                melding: "Logg inn for å bruke Canvas-funksjoner.",
            });
        }
        if (!req.canvasToken) {
            return res.status(403).json({
                feil: "Canvas-token mangler",
                melding: "Koble brukeren til Canvas før du bruker disse endepunktene.",
            });
        }
        next();
    } catch (error) {
        logger.error({ err: error }, "Feil ved validering av Canvas-token");
        return res.status(500).json({
            feil: "Kunne ikke verifisere Canvas-token",
            melding: "Kunne ikke validere brukerens Canvas-token.",
        });
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

// Hovedfunksjon
export async function hentCanvasData<T>(
    endpoint: string,
    options: CanvasFetchOptions = {}
): Promise<CanvasResponse<T>> {
    const {
        queryParams,
        timeout = 10000,
        maxPages = 5,
        cacheTtl = CACHE_TTL.DEFAULT,
        maxRetries = 3
    } = options;
    const config = hentCanvasKonfig();
    const canvasToken = hentCanvasToken(options.token);
    const { baseUrl } = config;
    if (!canvasToken) throw new Error("Canvas-token mangler for innlogget bruker");
    if (!baseUrl) throw new Error("CANVAS_BASE_URL er ikke konfigurert");
    // Fjern "Bearer " hvis det ligger i tokenet (vanlig feil ved copy-paste)
    const cleanToken = canvasToken.replace(/^Bearer\s+/i, "").trim();
    // Sjekk om endepunktet inneholder sensitiv data som IKKE skal caches
    const erSensitiv = SENSITIVE_ENDPOINTS.some(p => endpoint.includes(p));
    // Logg token-debug info (kun trygg info)
    if (erSensitiv) { // Logg dette kun for sensitive kall (som often er de første som feiler)
        logger.info({
            tokenLength: cleanToken.length,
            tokenStart: cleanToken.substring(0, 4) + "...",
            endpoint
        }, "Forbereder Canvas-kall");
    }
    // Bygg URL med query params
    const url = new URL(`${baseUrl}${endpoint}`);
    const cacheNokkelParams: string[] = [];
    if (queryParams) {
        // Sorterer keys for stabilitet i cache key
        Object.keys(queryParams).sort().forEach((key) => {
            const value = queryParams[key];
            if (Array.isArray(value)) {
                value.forEach((item) => {
                    url.searchParams.append(`${key}[]`, String(item));
                    cacheNokkelParams.push(`${key}[]=${item}`);
                });
            } else {
                url.searchParams.append(key, String(value));
                cacheNokkelParams.push(`${key}=${value}`);
            }
        });
    }
    // Generer unik cache key per token (unngå lekkasje mellom brukere)
    const tokenAvtrykk = crypto.createHash("sha256").update(cleanToken).digest("hex").slice(0, 12);
    const cacheNokkel = `canvas:${tokenAvtrykk}:${endpoint}?${cacheNokkelParams.join("&")}`;
    // Sjekk cache (KUN hvis ikke sensitiv)
    if (!erSensitiv) {
        try {
            const cachedData = await getCache(cacheNokkel);
            if (cachedData) {
                logger.info({ cacheKey: cacheNokkel }, "Redis Cache HIT");
                return JSON.parse(cachedData);
            }
            logger.info({ cacheKey: cacheNokkel }, "Redis Cache MISS");
        } catch (err) {
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
                clearTimeout(timeoutId);
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
                // Annen feil
                if (!response.ok) {
                    const errorText = await response.text();
                    if (response.status === 401) {
                        const error = new Error("Ugyldig Canvas-token") as CanvasHttpError;
                        error.status = 401;
                        error.details = errorText;
                        throw error;
                    }
                    const error = new Error(
                        `Canvas API feil (${response.status}): ${errorText || response.statusText}`
                    ) as CanvasHttpError;
                    error.status = response.status;
                    throw error;
                }
                // Suksess - bryt ut av retry-loop
                break;
            } catch (error) {
                clearTimeout(timeoutId);
                if (error instanceof Error && error.name === "AbortError") {
                    throw new Error(`Canvas API timeout etter ${timeout}ms`);
                }
                throw error;
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