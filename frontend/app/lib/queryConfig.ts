/**
 * Delte React Query konfigurasjons-presets.
 * Sentraliserer staleTime, retry og refetch-innstillinger for konsistens.
 */

/** Standard query-opsjoner for Canvas-relaterte hooks (emner, moduler, oppgaver). */
export const CANVAS_QUERY_OPTIONS = {
  staleTime: 1000 * 60 * 2, // 2 minutter før data anses som stale
  refetchOnWindowFocus: false, // Ikke refetch automatisk ved vindu-fokus
} as const;

/** Standard query-opsjoner for auth-relaterte hooks (brukerdata). */
export const AUTH_QUERY_OPTIONS = {
  staleTime: 1000 * 60 * 5, // 5 minutter
  refetchOnWindowFocus: false,
} as const;

/** Standard query-opsjoner for kalender-data. */
export const CALENDAR_QUERY_OPTIONS = {
  staleTime: 1000 * 60, // 60 sekunder
  refetchOnWindowFocus: false,
  gcTime: 5 * 60 * 1000, // Garbage collect etter 5 min
} as const;
