"use client";

/**
 * React-hook for `matchMedia`.
 *
 * Returnerer true/false for en CSS media query og oppdaterer ved endring.
 * Bruker `useSyncExternalStore` for å unngå hydration mismatch mellom
 * server (alltid false) og klient.
 */
import { useCallback, useSyncExternalStore } from "react";

export const MOBILE_MEDIA_QUERY = "(max-width: 767px)";

/**
 * Lytter på `window.matchMedia(query)` og returnerer om den matcher.
 */
export function useMediaQuery(query: string): boolean {
  const subscribe = useCallback(
    (callback: () => void) => {
      if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
        return () => {};
      }
      const mediaQuery = window.matchMedia(query);
      mediaQuery.addEventListener("change", callback);
      return () => mediaQuery.removeEventListener("change", callback);
    },
    [query],
  );

  const getSnapshot = useCallback(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
      return false;
    }
    return window.matchMedia(query).matches;
  }, [query]);

  const getServerSnapshot = useCallback(() => false, []);

  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
