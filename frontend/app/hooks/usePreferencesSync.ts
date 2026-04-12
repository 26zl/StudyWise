"use client";

/**
 * Synk av UI-preferanser mellom frontend og backend.
 *
 * Backend er autoritativ ved første innlasting etter innlogging, og lokale
 * endringer i språk/tema sendes tilbake til backend med debounce.
 */
import { useAuth } from "@clerk/nextjs";
import { useEffect, useRef } from "react";
import { useTheme } from "next-themes";
import { useLanguage } from "@/app/i18n";
import { useMeg, useOppdaterUIPreferanser } from "@/app/auth/auth-api";
import type { UIPreferences } from "common/auth";

export function usePreferencesSync() {
  const { isLoaded, userId } = useAuth();
  const { data: me } = useMeg({ enabled: isLoaded && !!userId });
  const { language, setLanguage } = useLanguage();
  const { theme, setTheme } = useTheme();
  const { mutate: syncToBackend } = useOppdaterUIPreferanser();

  const hasAppliedBackend = useRef(false);
  // Forhindrer at effekt 3 tolker endringer som ble forårsaket av effekt 2
  // (apply backend prefs) som bruker-initierte endringer. Settes true etter
  // apply, og resettes i effekt 3 slik at neste faktiske bruker-endring synces.
  const skipNextSync = useRef(false);
  const prevValues = useRef<{
    language?: string;
    theme?: string;
  }>({});
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

  useEffect(() => {
    if (!me?.user || hasAppliedBackend.current) return;
    if (syncedUserId.current !== (userId ?? null)) return;

    hasAppliedBackend.current = true;
    const nextLanguage = uiPrefs?.language ?? language;
    const nextTheme = uiPrefs?.theme ?? theme;

    const willChangeLanguage = !!(uiPrefs?.language && uiPrefs.language !== language);
    const willChangeTheme = !!(uiPrefs?.theme && uiPrefs.theme !== theme);

    if (willChangeLanguage && uiPrefs?.language) {
      setLanguage(uiPrefs.language);
    }
    if (willChangeTheme && uiPrefs?.theme) {
      setTheme(uiPrefs.theme);
    }

    // Hvis vi endret lokalt state, hopp over neste sync-deteksjon — endringen
    // er fra backend, ikke fra brukeren, og trenger ikke sendes tilbake.
    if (willChangeLanguage || willChangeTheme) {
      skipNextSync.current = true;
    }

    prevValues.current = {
      language: nextLanguage,
      theme: nextTheme,
    };
  }, [language, me?.user, setLanguage, setTheme, theme, uiPrefs, userId]);

  useEffect(() => {
    if (!me?.user || !hasAppliedBackend.current) return;
    if (syncedUserId.current !== (userId ?? null)) return;

    const prev = prevValues.current;
    const harGyldigTema =
      theme === "light" || theme === "dark" || theme === "system";
    const harEndringer =
      language !== prev.language || (harGyldigTema && theme !== prev.theme);

    if (!harEndringer) return;

    // Endringen er forårsaket av at backend-prefs ble applied lokalt (effekt 2).
    // Hopp over — vi vil ikke sende de samme verdiene tilbake til backend.
    if (skipNextSync.current) {
      skipNextSync.current = false;
      prevValues.current = { language, theme };
      return;
    }

    prevValues.current = { language, theme };

    if (syncTimer.current) {
      clearTimeout(syncTimer.current);
    }

    syncTimer.current = setTimeout(() => {
      const fullPrefs: UIPreferences = {
        language: language as UIPreferences["language"],
        theme: harGyldigTema ? (theme as UIPreferences["theme"]) : undefined,
      };
      syncToBackendRef.current(fullPrefs);
    }, 500);

    return () => {
      if (syncTimer.current) {
        clearTimeout(syncTimer.current);
        syncTimer.current = null;
      }
    };
  }, [language, me?.user, theme, userId]);
}
