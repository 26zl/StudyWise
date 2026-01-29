/*
* Ulike hjelpefunksjoner og typer for Canvas API
*
*/
import crypto from "crypto";
import validator from "validator";
import { getCache, setCache } from "../../cache/redis.js";
import { logger } from "../../utils/logger.js";
// import { User } from "../../database/models/User.js";
// import { decrypt } from "../../utils/kryptering.js";

// Typer og Interfaces
// Canvas fetch funksjon med paginering og timeout
export interface CanvasFetchOptions {
    queryParams?: Record<string, string | number | boolean | string[]>;
    timeout?: number;
    maxPages?: number;
    token?: string;
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
}

// Hjelpefunksjoner
// Henter Canvas konfig fra miljøvariabler
export const getCanvasConfig = () => ({
    token: process.env.CANVAS_TOKEN,
    baseUrl: process.env.CANVAS_BASE_URL,
});

// Hent brukerens lagrede Canvas token (dekryptert) - DISABLED foreløpig
// const hentBrukerCanvasToken = async (): Promise<string | null> => {
//     try {
//         const bruker = await User.findOne().select("+canvasApiToken");
//         if (!bruker?.canvasApiToken) return null;
//         return decrypt(bruker.canvasApiToken);
//     } catch (error) {
//         logger.error({ err: error }, "Kunne ikke hente eller dekryptere Canvas-token");
//         throw error;
//     }
// };
// Finn riktig Canvas token (overstyrt > env) (bruker-token er DISABLED foreløpig)
export const finnCanvasToken = async (overstyrtToken?: string): Promise<string | null> => {
    if (overstyrtToken) return overstyrtToken;

    return process.env.CANVAS_TOKEN || null;
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
export async function requireCanvasToken(_req: unknown, res: unknown, next: () => void) {
    try {
        const canvasToken = await finnCanvasToken();
        if (!canvasToken) {
            logger.error("Mangler Canvas-token (env)");
            const response = res as { status: (code: number) => { json: (data: unknown) => void } };
            return response.status(500).json({
                feil: "Canvas-token er ikke konfigurert",
                melding: "Legg til CANVAS_TOKEN i backend/.env",
            });
        }
        next();
    } catch (error) {
        logger.error({ err: error }, "Feil ved validering av Canvas-token");
        const response = res as { status: (code: number) => { json: (data: unknown) => void } };
        return response.status(500).json({
            feil: "Kunne ikke verifisere Canvas-token",
            melding: "Sjekk CANVAS_TOKEN i backend/.env",
        });
    }
}

// Hovedfunksjon
export async function canvasFetch<T>(
    endpoint: string,
    options: CanvasFetchOptions = {}
): Promise<CanvasResponse<T>> {
    const { queryParams, timeout = 10000, maxPages = 5 } = options;
    const config = getCanvasConfig();
    const canvasToken = await finnCanvasToken(options.token);
    const { baseUrl } = config;

    if (!canvasToken) throw new Error("Canvas-token er ikke konfigurert (i env)");
    if (!baseUrl) throw new Error("CANVAS_BASE_URL er ikke konfigurert");

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
    const tokenAvtrykk = crypto.createHash("sha256").update(canvasToken).digest("hex").slice(0, 12);
    const cacheNokkel = `canvas:${tokenAvtrykk}:${endpoint}?${cacheNokkelParams.join("&")}`;

    // Sjekk cache
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
    // Sett opp abort controller for timeout
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    // Hent data fra API (med paginering)
    try {
        const allItems: unknown[] = [];
        let currentUrl: string | null = url.toString();
        let pagesFetched = 0;
        while (currentUrl && pagesFetched < maxPages) {
            const response = await fetch(currentUrl, {
                method: "GET",
                headers: {
                    Authorization: `Bearer ${canvasToken}`,
                    "Content-Type": "application/json",
                },
                signal: controller.signal,
            });
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
            const data = await response.json();
            pagesFetched++;

            // Hvis ikke array, er det enkeltting - returner med en gang
            if (!Array.isArray(data)) {
                clearTimeout(timeoutId);
                const result = { data: data as T };
                await setCache(cacheNokkel, JSON.stringify(result));
                return result;
            }

            // Hvis array, legg til og sjekk neste side
            allItems.push(...data);

            const linkHeader = response.headers.get("Link");
            currentUrl = parseLinkHeader(linkHeader);
            if (!currentUrl) break;
        } // Clearer timeout
        clearTimeout(timeoutId);
        const result = {
            data: allItems as T,
            meta: {
                pagesFetched,
                itemsCount: allItems.length,
            },
        };
        // Lagre i cache
        await setCache(cacheNokkel, JSON.stringify(result));
        return result;
    } catch (error) {
        clearTimeout(timeoutId);
        if (error instanceof Error && error.name === "AbortError") {
            throw new Error(`Canvas API timeout etter ${timeout}ms`);
        }
        logger.error({ err: error, endpoint }, "Canvas API-kall feilet");
        throw error;
    }
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
