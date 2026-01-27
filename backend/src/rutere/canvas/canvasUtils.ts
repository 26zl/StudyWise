/*
* Ulike hjelpefunksjoner og typer for Canvas API
*
*/
import { getCache, setCache } from "../../cache/redis.js";
import { logger } from "../../utils/logger.js";

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

// Hjelpefunksjoner
// Henter Canvas konfig fra miljøvariabler
export const getCanvasConfig = () => ({
    token: process.env.CANVAS_TOKEN,
    baseUrl: process.env.CANVAS_BASE_URL,
});

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
export function requireCanvasToken(_req: unknown, res: unknown, next: () => void) {
    const { token } = getCanvasConfig();
    if (!token) {
        logger.error("Mangler CANVAS_TOKEN i miljøvariabler");
        const response = res as { status: (code: number) => { json: (data: unknown) => void } };
        return response.status(500).json({
            feil: "CANVAS_TOKEN er ikke konfigurert",
            melding: "Legg til CANVAS_TOKEN i backend/.env",
        });
    }
    next();
}

// Hovedfunksjon
export async function canvasFetch<T>(
    endpoint: string,
    options: CanvasFetchOptions = {}
): Promise<CanvasResponse<T>> {
    const { queryParams, timeout = 10000, maxPages = 5 } = options;
    const config = getCanvasConfig();
    const token = options.token || config.token;
    const { baseUrl } = config;

    if (!token) throw new Error("CANVAS_TOKEN er ikke konfigurert (verken i env eller bruker-instillinger)");
    if (!baseUrl) throw new Error("CANVAS_BASE_URL er ikke konfigurert");

    // Bygg URL med query params
    const url = new URL(`${baseUrl}${endpoint}`);
    const cacheKeyParams: string[] = [];

    if (queryParams) {
        // Sorterer keys for stabilitet i cache key
        Object.keys(queryParams).sort().forEach((key) => {
            const value = queryParams[key];
            if (Array.isArray(value)) {
                value.forEach((item) => {
                    url.searchParams.append(`${key}[]`, String(item));
                    cacheKeyParams.push(`${key}[]=${item}`);
                });
            } else {
                url.searchParams.append(key, String(value));
                cacheKeyParams.push(`${key}=${value}`);
            }
        });
    }

    // Generer unik cache key
    const cacheKey = `canvas:${endpoint}?${cacheKeyParams.join("&")}`;

    // Sjekk cache
    try {
        const cachedData = await getCache(cacheKey);
        if (cachedData) {
            logger.info({ cacheKey }, "Redis Cache HIT");
            return JSON.parse(cachedData);
        }
        logger.info({ cacheKey }, "Redis Cache MISS");
    } catch (err) {
        logger.error({ err }, "Cache henting feilet");
    }

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
                    Authorization: `Bearer ${token}`,
                    "Content-Type": "application/json",
                },
                signal: controller.signal,
            });
            if (!response.ok) {
                const errorText = await response.text();
                throw new Error(
                    `Canvas API feil (${response.status}): ${errorText || response.statusText}`
                );
            }
            const data = await response.json();
            pagesFetched++;

            // Hvis ikke array, er det enkeltting - returner med en gang
            if (!Array.isArray(data)) {
                clearTimeout(timeoutId);
                const result = { data: data as T };
                await setCache(cacheKey, JSON.stringify(result));
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
        await setCache(cacheKey, JSON.stringify(result));
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
