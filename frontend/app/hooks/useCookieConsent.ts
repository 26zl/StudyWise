"use client";

import { useAuth } from "@clerk/nextjs";
import { useCallback, useEffect, useRef, useState } from "react";
import { useMeg, useOppdaterUIPreferanser } from "@/app/auth/auth-api";
import type { CookieConsentValue, UIPreferences } from "common/auth";

export const COOKIE_CONSENT_CHANGED_EVENT = "studywise-cookie-consent-changed";
export type CookieConsentStatus = CookieConsentValue | null;
const COOKIE_CONSENT_STORAGE_PREFIX = "studywise_cookie_consent";
const GUEST_COOKIE_CONSENT_COOKIE_NAME = "studywise_guest_consent";
const GUEST_CONSENT_MAX_AGE_DAYS = 30;

function parseCookieConsent(value: unknown): CookieConsentStatus {
  return value === "accepted" || value === "declined" ? value : null;
}

function readGuestCookie(): CookieConsentStatus {
  if (typeof document === "undefined") return null;
  const match = document.cookie
    .split("; ")
    .find((c) => c.startsWith(`${GUEST_COOKIE_CONSENT_COOKIE_NAME}=`));
  return match ? parseCookieConsent(match.split("=")[1]) : null;
}

function writeGuestCookie(value: CookieConsentStatus): void {
  if (typeof document === "undefined") return;
  if (value === null) {
    document.cookie = `${GUEST_COOKIE_CONSENT_COOKIE_NAME}=; max-age=0; path=/; SameSite=Lax; Secure`;
    return;
  }
  const maxAge = GUEST_CONSENT_MAX_AGE_DAYS * 24 * 60 * 60;
  document.cookie = `${GUEST_COOKIE_CONSENT_COOKIE_NAME}=${value}; max-age=${maxAge}; path=/; SameSite=Lax; Secure`;
}

// Initialisér synkront fra cookie ved modul-load (ikke via useEffect)
// slik at consent er tilgjengelig allerede ved første React-render og banneret ikke blinker.
// Cookie med 30 dagers levetid brukes for gjester, i tråd med personvernteksten.
let gjesteSamtykke: CookieConsentStatus =
  typeof window !== "undefined" ? readGuestCookie() : null;

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
    // Migrer fra eldre lagringsmekanismer (localStorage/sessionStorage) til cookie
    const legacyKey = "studywise_guest_cookie_consent";
    const localValue = window.localStorage.getItem(legacyKey);
    if (localValue) window.localStorage.removeItem(legacyKey);
    const sessionValue = window.sessionStorage.getItem(legacyKey);
    if (sessionValue) window.sessionStorage.removeItem(legacyKey);
    const migrateValue = parseCookieConsent(localValue ?? sessionValue);
    if (migrateValue) {
      writeGuestCookie(migrateValue);
      return migrateValue;
    }

    return readGuestCookie();
  } catch {
    return null;
  }
}

function writeGuestConsentToStorage(consent: CookieConsentStatus): void {
  if (typeof window === "undefined") {
    return;
  }

  try {
    writeGuestCookie(consent);
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
    // Oppdater i tilfelle gjeste-cookie endret seg mellom SSR og hydrering
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

  // Re-les gjeste-samtykke fra cookie når bruker logger ut,
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

  // For innloggede brukere: bruk backend- eller cache-verdi, IKKE gjeste-cookie.
  // Gjeste-cookien kan tilhøre en annen person på delt maskin.
  // Hvis ingen verdi finnes, vises banneret på nytt (consent === null).
  const consent =
    pendingConsent ??
    (isAuthenticated
      ? (backendConsent ?? cachedAuthenticatedConsent)
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

  // Ikke promoter gjeste-cookie til innlogget bruker — på delt maskin kan
  // gjeste-valget tilhøre en annen person. Innloggede brukere uten lagret
  // samtykke får banneret på nytt og tar et eget aktivt valg.

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
      // Ikke skriv til gjeste-cookie — det kan lekke til neste bruker på delt maskin.
      // Banneret vises ved utlogging bare hvis gjesten ikke har et eget valg.
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
