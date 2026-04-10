"use client";

import { useAuth } from "@clerk/nextjs";
import { useCallback, useEffect, useRef, useState } from "react";
import { useMeg, useOppdaterUIPreferanser } from "@/app/auth/auth-api";
import type { CookieConsentValue, UIPreferences } from "common/auth";

export const COOKIE_CONSENT_CHANGED_EVENT = "studywise-cookie-consent-changed";
export type CookieConsentStatus = CookieConsentValue | null;
const COOKIE_CONSENT_STORAGE_PREFIX = "studywise_cookie_consent";
const GUEST_COOKIE_CONSENT_STORAGE_KEY = "studywise_guest_cookie_consent";

function parseCookieConsent(value: unknown): CookieConsentStatus {
  return value === "accepted" || value === "declined" ? value : null;
}

// Initialisér synkront fra localStorage ved modul-load (ikke via useEffect)
// slik at consent er tilgjengelig allerede ved første React-render og banneret ikke blinker.
let gjesteSamtykke: CookieConsentStatus =
  typeof window !== "undefined"
    ? parseCookieConsent(window.localStorage.getItem(GUEST_COOKIE_CONSENT_STORAGE_KEY))
    : null;

function getAuthenticatedConsentStorageKey(userId: string): string {
  return `${COOKIE_CONSENT_STORAGE_PREFIX}:${userId}`;
}

function readAuthenticatedConsentFromStorage(userId: string): CookieConsentStatus {
  if (typeof window === "undefined") {
    return null;
  }

  try {
    return parseCookieConsent(
      window.localStorage.getItem(getAuthenticatedConsentStorageKey(userId)),
    );
  } catch {
    return null;
  }
}

function readGuestConsentFromStorage(): CookieConsentStatus {
  if (typeof window === "undefined") {
    return null;
  }

  try {
    // Migrer fra sessionStorage til localStorage (eldre kode brukte sessionStorage)
    const sessionValue = window.sessionStorage.getItem(GUEST_COOKIE_CONSENT_STORAGE_KEY);
    if (sessionValue) {
      window.localStorage.setItem(GUEST_COOKIE_CONSENT_STORAGE_KEY, sessionValue);
      window.sessionStorage.removeItem(GUEST_COOKIE_CONSENT_STORAGE_KEY);
    }
    const guestValue = parseCookieConsent(
      window.localStorage.getItem(GUEST_COOKIE_CONSENT_STORAGE_KEY),
    );
    if (guestValue) return guestValue;

    // Fallback: sjekk om det finnes et bruker-spesifikt samtykke fra en tidligere innlogget økt.
    // Dette dekker tilfellet der bruker godtok cookies mens innlogget (før gjeste-nøkkel ble skrevet).
    for (let i = 0; i < window.localStorage.length; i++) {
      const key = window.localStorage.key(i);
      if (key?.startsWith(COOKIE_CONSENT_STORAGE_PREFIX + ":")) {
        const value = parseCookieConsent(window.localStorage.getItem(key));
        if (value) {
          // Promoter til gjeste-nøkkel slik at denne fallbacken bare kjører én gang
          window.localStorage.setItem(GUEST_COOKIE_CONSENT_STORAGE_KEY, value);
          return value;
        }
      }
    }
    return null;
  } catch {
    return null;
  }
}

function writeGuestConsentToStorage(consent: CookieConsentStatus): void {
  if (typeof window === "undefined") {
    return;
  }

  try {
    if (consent === null) {
      window.localStorage.removeItem(GUEST_COOKIE_CONSENT_STORAGE_KEY);
      window.sessionStorage.removeItem(GUEST_COOKIE_CONSENT_STORAGE_KEY);
      return;
    }

    window.localStorage.setItem(GUEST_COOKIE_CONSENT_STORAGE_KEY, consent);
  } catch {
    // Ignorer lagringsfeil i låste miljøer.
  }
}

function writeAuthenticatedConsentToStorage(
  userId: string,
  consent: CookieConsentStatus,
): void {
  if (typeof window === "undefined") {
    return;
  }

  try {
    const storageKey = getAuthenticatedConsentStorageKey(userId);
    if (consent === null) {
      window.localStorage.removeItem(storageKey);
      return;
    }

    // Rydd opp gamle consent-entries fra tidligere bruker-IDer (f.eks. etter kontosletting + re-registrering)
    for (let i = window.localStorage.length - 1; i >= 0; i--) {
      const key = window.localStorage.key(i);
      if (key && key.startsWith(COOKIE_CONSENT_STORAGE_PREFIX + ":") && key !== storageKey) {
        window.localStorage.removeItem(key);
      }
    }

    window.localStorage.setItem(storageKey, consent);
  } catch {
    // Ignorer lagringsfeil i browser-miljøer der localStorage er utilgjengelig.
  }
}

function emitCookieConsentChange(value: CookieConsentStatus): void {
  if (typeof window === "undefined") {
    return;
  }

  window.dispatchEvent(
    new CustomEvent<CookieConsentStatus>(COOKIE_CONSENT_CHANGED_EVENT, {
      detail: value,
    }),
  );
}

export function resetGjesteSamtykke(): void {
  gjesteSamtykke = null;
  writeGuestConsentToStorage(null);
  emitCookieConsentChange(null);
}

export function useCookieConsent() {
  const { isLoaded, userId } = useAuth();
  const {
    data: me,
    isPending: henterMeg,
    isSuccess: harBackendBrukerdata,
    isError: feiletBrukerdata,
  } = useMeg({
    enabled: isLoaded && !!userId,
  });
  const { mutateAsync: oppdaterUIPreferanser, isPending } =
    useOppdaterUIPreferanser();
  // Les gjeste-samtykke synkront ved første klient-render via useRef.
  // useRef-initializer kjører synkront under render (ikke som useEffect etter paint),
  // slik at consent er tilgjengelig allerede i første frame — ingen flash.
  const guestInitRef = useRef(false);
  if (!guestInitRef.current && typeof window !== "undefined") {
    guestInitRef.current = true;
    gjesteSamtykke = readGuestConsentFromStorage();
  }
  const [guestConsent, setGuestConsent] =
    useState<CookieConsentStatus>(gjesteSamtykke);
  const [cachedAuthenticatedConsent, setCachedAuthenticatedConsent] =
    useState<CookieConsentStatus>(null);
  const [pendingConsent, setPendingConsent] =
    useState<CookieConsentStatus>(null);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    // Oppdater i tilfelle localStorage endret seg mellom SSR og hydrering
    const fresh = readGuestConsentFromStorage();
    if (fresh !== guestConsent) {
      gjesteSamtykke = fresh;
      setGuestConsent(fresh);
    }

    const handleConsentChange = (event: Event) => {
      if (event instanceof CustomEvent) {
        setGuestConsent(parseCookieConsent(event.detail));
        return;
      }

      setGuestConsent(gjesteSamtykke);
    };

    window.addEventListener(
      COOKIE_CONSENT_CHANGED_EVENT,
      handleConsentChange as EventListener,
    );
    return () => {
      window.removeEventListener(
        COOKIE_CONSENT_CHANGED_EVENT,
        handleConsentChange as EventListener,
      );
    };
  }, []);

  useEffect(() => {
    if (!isLoaded || !userId) {
      setCachedAuthenticatedConsent(null);
      return;
    }

    setCachedAuthenticatedConsent(readAuthenticatedConsentFromStorage(userId));
  }, [isLoaded, userId]);

  useEffect(() => {
    if (typeof window === "undefined" || !userId) {
      return;
    }

    const storageKey = getAuthenticatedConsentStorageKey(userId);
    const handleStorage = (event: StorageEvent) => {
      if (event.key !== storageKey) {
        return;
      }

      setCachedAuthenticatedConsent(parseCookieConsent(event.newValue));
    };

    window.addEventListener("storage", handleStorage);
    return () => {
      window.removeEventListener("storage", handleStorage);
    };
  }, [userId]);

  const isAuthenticated = !!userId;
  const backendConsent = parseCookieConsent(
    me?.user?.uiPreferences?.cookieConsent,
  );

  // Re-les gjeste-samtykke fra localStorage når bruker logger ut,
  // fordi modulvariabelen gjesteSamtykke kan være null etter promotering.
  useEffect(() => {
    if (!isAuthenticated) {
      const lagret = readGuestConsentFromStorage();
      if (lagret && lagret !== gjesteSamtykke) {
        gjesteSamtykke = lagret;
        setGuestConsent(lagret);
      }
    }
  }, [isAuthenticated]);

  const consent =
    pendingConsent ??
    (isAuthenticated
      ? (backendConsent ?? cachedAuthenticatedConsent ?? guestConsent)
      : guestConsent);
  const harConsentFraCache = cachedAuthenticatedConsent !== null;
  const isReady =
    isLoaded &&
    (!isAuthenticated ||
      harConsentFraCache ||
      harBackendBrukerdata ||
      feiletBrukerdata ||
      !henterMeg);

  useEffect(() => {
    if (!isAuthenticated || !userId || henterMeg) {
      return;
    }

    // Behold lokal cache hvis backend midlertidig mangler samtykkeverdien.
    // Dette hindrer at banneret blinker tilbake ved ut-av-rekkefolge-svar.
    if (backendConsent === null) {
      return;
    }

    writeAuthenticatedConsentToStorage(userId, backendConsent);
    setCachedAuthenticatedConsent(backendConsent);
  }, [backendConsent, henterMeg, isAuthenticated, userId]);

  // Promoter gjestesamtykke til backend når bruker logger inn og backend ikke har samtykke
  useEffect(() => {
    if (!isAuthenticated || !harBackendBrukerdata || backendConsent !== null) {
      return;
    }

    // Sjekk om det finnes et gjestesamtykke som kan promoteres
    const gjesteVerdi = gjesteSamtykke ?? readGuestConsentFromStorage();
    if (!gjesteVerdi) {
      return;
    }

    // Synk gjestesamtykke til backend — men behold gjestesamtykke i localStorage
    // slik at banneret ikke dukker opp igjen etter utlogging.
    void oppdaterUIPreferanser({
      language: me?.user?.uiPreferences?.language,
      theme: me?.user?.uiPreferences?.theme,
      cookieConsent: gjesteVerdi,
    }).catch(() => {
      // Ignorer feil — bruker blir spurt på nytt neste gang
    });
  }, [isAuthenticated, harBackendBrukerdata, backendConsent, me?.user?.uiPreferences, oppdaterUIPreferanser]);

  const setConsent = useCallback(
    async (nextConsent: Exclude<CookieConsentStatus, null>) => {
      if (!isAuthenticated) {
        gjesteSamtykke = nextConsent;
        writeGuestConsentToStorage(nextConsent);
        setGuestConsent(nextConsent);
        emitCookieConsentChange(nextConsent);
        return;
      }

      const currentPrefs = me?.user?.uiPreferences;
      const nextPrefs: UIPreferences = {
        language: currentPrefs?.language,
        theme: currentPrefs?.theme,
        cookieConsent: nextConsent,
      };

      // Lagre i localStorage umiddelbart slik at banneret forsvinner selv ved API-feil
      if (userId) {
        writeAuthenticatedConsentToStorage(userId, nextConsent);
        setCachedAuthenticatedConsent(nextConsent);
      }
      // Lagre også som gjeste-samtykke slik at banneret ikke dukker opp igjen etter utlogging
      gjesteSamtykke = nextConsent;
      writeGuestConsentToStorage(nextConsent);
      setGuestConsent(nextConsent);
      emitCookieConsentChange(nextConsent);

      setPendingConsent(nextConsent);
      try {
        await oppdaterUIPreferanser(nextPrefs);
      } finally {
        setPendingConsent(null);
      }
    },
    [isAuthenticated, me?.user?.uiPreferences, oppdaterUIPreferanser, userId],
  );

  return {
    consent,
    isAuthenticated,
    isPending: isAuthenticated && isPending,
    isReady,
    setConsent,
  };
}
