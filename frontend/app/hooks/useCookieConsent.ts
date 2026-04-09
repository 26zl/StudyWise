"use client";

import { useAuth } from "@clerk/nextjs";
import { useCallback, useEffect, useState } from "react";
import { useMeg, useOppdaterUIPreferanser } from "@/app/auth/auth-api";
import type { CookieConsentValue, UIPreferences } from "common/auth";

export const COOKIE_CONSENT_CHANGED_EVENT = "studywise-cookie-consent-changed";
export type CookieConsentStatus = CookieConsentValue | null;
const COOKIE_CONSENT_STORAGE_PREFIX = "studywise_cookie_consent";
const GUEST_COOKIE_CONSENT_STORAGE_KEY = "studywise_guest_cookie_consent";

let gjesteSamtykke: CookieConsentStatus = null;

function parseCookieConsent(value: unknown): CookieConsentStatus {
  return value === "accepted" || value === "declined" ? value : null;
}

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
    // Gjestesamtykke skal bare leve i aktiv nettleserøkt.
    // Rydd bort eventuelle persistente legacy-verdier fra eldre kode.
    window.localStorage.removeItem(GUEST_COOKIE_CONSENT_STORAGE_KEY);
    return parseCookieConsent(
      window.sessionStorage.getItem(GUEST_COOKIE_CONSENT_STORAGE_KEY),
    );
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

    window.sessionStorage.setItem(GUEST_COOKIE_CONSENT_STORAGE_KEY, consent);
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
    gjesteSamtykke = readGuestConsentFromStorage();
    setGuestConsent(gjesteSamtykke);

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

    // Synk gjestesamtykke til backend
    void oppdaterUIPreferanser({
      language: me?.user?.uiPreferences?.language,
      theme: me?.user?.uiPreferences?.theme,
      cookieConsent: gjesteVerdi,
    }).then(() => {
      // Rydd opp gjestesamtykke etter vellykket synk
      resetGjesteSamtykke();
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
