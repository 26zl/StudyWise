/*
 * KI-rute konstanter
 * Sentraliserte verdier for cache TTL og timeout
 */

/** Cache TTL for KI-oppsummering (sekunder) */
export const KI_OPPSUMMERING_CACHE_TTL = 3600; // 1 time

/** Timeout for AI/Canvas API-kall (ms) */
export const KI_TIMEOUT_MS = 60_000; // 60 sekunder

/** TTL for session-level chunk caching (sekunder) — gjenbruk kontekst for oppfølgingsspørsmål */
export const SESSION_CONTEXT_TTL = 120; // 2 minutter — kort nok til at oppfølgingsspørsmål om nytt tema får fersk kontekst
