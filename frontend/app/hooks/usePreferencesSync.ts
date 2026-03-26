"use client";

/**
 * Synk av UI-preferanser mellom frontend og backend.
 *
 * Backend er autoritativ ved første innlasting etter innlogging (vi "hydrater" UI fra /me),
 * og lokale endringer (språk/tema/cookie-samtykke) sendes tilbake til backend (debounced).
 */
import { useAuth } from "@clerk/nextjs";
import { useEffect, useRef } from "react";
import { useTheme } from "next-themes";
import { useLanguage } from "@/app/i18n";
import {
  COOKIE_CONSENT_STORAGE_KEY,
  COOKIE_CONSENT_CHANGED_EVENT,
  getStoredCookieConsent,
  type CookieConsentStatus,
} from "@/app/components/layout/CookieBanner";
import { useMeg, useOppdaterUIPreferanser } from "@/app/auth/auth-api";
import type { UIPreferences } from "common/auth";

/**
 * Synkroniserer UI-preferanser (sprak, tema, cookie-samtykke) med backend.
 * - Ved innlogging: backend-preferanser overskriver localStorage (backend er autorativ)
 * - Ved endring: localStorage-endringer synkes til backend (debounced)
 */
export function usePreferencesSync() {
  const { isLoaded, userId } = useAuth();
  const { data: me } = useMeg({ enabled: isLoaded && !!userId });
  const { language, setLanguage } = useLanguage();
  const { theme, setTheme } = useTheme();
  const { mutate: syncToBackend } = useOppdaterUIPreferanser();

  // Track if we've already applied backend preferences this session
  const hasAppliedBackend = useRef(false);
  // Track previous values to detect local changes
  const prevValues = useRef<{
    language?: string;
    theme?: string;
    cookieConsent?: CookieConsentStatus;
  }>({});
  // Debounce timer
  const syncTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const syncedUserId = useRef<string | null>(null);
  const syncToBackendRef = useRef(syncToBackend);

  const uiPrefs = me?.user?.uiPreferences;

  useEffect(() => {
    syncToBackendRef.current = syncToBackend;
  }, [syncToBackend]);

  useEffect(() => {
    const nextUserId = userId ?? null;
    if (syncedUserId.current === nextUserId) return;

    syncedUserId.current = nextUserId;
    hasAppliedBackend.current = false;
    prevValues.current = {};

    if (syncTimer.current) {
      clearTimeout(syncTimer.current);
      syncTimer.current = null;
    }
  }, [userId]);

  // Step 1: Apply backend preferences to local state on first load
  useEffect(() => {
    if (!me?.user || hasAppliedBackend.current) return;
    hasAppliedBackend.current = true;
    const currentConsent = getStoredCookieConsent();
    const backendConsent = uiPrefs?.cookieConsent;
    const nextLanguage = uiPrefs?.language ?? language;
    const nextTheme = uiPrefs?.theme ?? theme;
    let nextCookieConsent = currentConsent;

    if (uiPrefs?.language && uiPrefs.language !== language) {
      setLanguage(uiPrefs.language);
    }
    if (uiPrefs?.theme && uiPrefs.theme !== theme) {
      setTheme(uiPrefs.theme);
    }
    if (uiPrefs?.cookieConsent) {
      if (!currentConsent) {
        // Only apply if user hasn't already set consent locally
        try {
          localStorage.setItem(COOKIE_CONSENT_STORAGE_KEY, uiPrefs.cookieConsent);
          window.dispatchEvent(
            new CustomEvent(COOKIE_CONSENT_CHANGED_EVENT, {
              detail: uiPrefs.cookieConsent,
            }),
          );
          nextCookieConsent = uiPrefs.cookieConsent;
        } catch {
          /* ignore */
        }
      }
    }

    if (currentConsent && currentConsent !== backendConsent) {
      syncToBackendRef.current({
        language: nextLanguage as UIPreferences["language"],
        theme:
          nextTheme === "light" || nextTheme === "dark" || nextTheme === "system"
            ? nextTheme
            : undefined,
        cookieConsent: currentConsent as UIPreferences["cookieConsent"],
      });
    }

    // Use verdiene etter backend-apply som baseline, slik at init ikke
    // blir tolket som en ny lokal endring og trigger unødvendig PUT /preferences.
    prevValues.current = {
      language: nextLanguage,
      theme: nextTheme,
      cookieConsent: nextCookieConsent,
    };
  }, [me?.user, uiPrefs, language, setLanguage, theme, setTheme]);

  // Step 2: Watch for local changes and sync to backend
  useEffect(() => {
    if (!me?.user || !hasAppliedBackend.current) return;

    const currentConsent = getStoredCookieConsent();
    const prev = prevValues.current;
    const changes: Partial<UIPreferences> = {};

    if (language !== prev.language) {
      changes.language = language as UIPreferences["language"];
    }
    if (
      theme &&
      theme !== prev.theme &&
      (theme === "light" || theme === "dark" || theme === "system")
    ) {
      changes.theme = theme as UIPreferences["theme"];
    }
    if (currentConsent !== prev.cookieConsent && currentConsent) {
      changes.cookieConsent = currentConsent as UIPreferences["cookieConsent"];
    }

    if (Object.keys(changes).length > 0) {
      prevValues.current = { language, theme, cookieConsent: currentConsent };

      // Debounce backend sync
      if (syncTimer.current) clearTimeout(syncTimer.current);
      syncTimer.current = setTimeout(() => {
        const fullPrefs: UIPreferences = {
          language: language as UIPreferences["language"],
          theme:
            theme === "light" || theme === "dark" || theme === "system"
              ? theme
              : undefined,
          cookieConsent:
            currentConsent === "accepted" || currentConsent === "declined"
              ? currentConsent
              : undefined,
        };
        syncToBackendRef.current(fullPrefs);
      }, 500);
    }
  }, [language, theme, me?.user]);

  // Step 3: Listen for cookie consent changes (from CookieBanner)
  useEffect(() => {
    if (!me?.user || !hasAppliedBackend.current) return;

    const handleConsentChange = () => {
      const consent = getStoredCookieConsent();
      if (consent && consent !== prevValues.current.cookieConsent) {
        prevValues.current.cookieConsent = consent;
        const fullPrefs: UIPreferences = {
          language: language as UIPreferences["language"],
          theme:
            theme === "light" || theme === "dark" || theme === "system"
              ? theme
              : undefined,
          cookieConsent: consent as UIPreferences["cookieConsent"],
        };
        syncToBackendRef.current(fullPrefs);
      }
    };

    window.addEventListener(COOKIE_CONSENT_CHANGED_EVENT, handleConsentChange);
    return () =>
      window.removeEventListener(
        COOKIE_CONSENT_CHANGED_EVENT,
        handleConsentChange,
      );
  }, [me?.user, language, theme]);
}
