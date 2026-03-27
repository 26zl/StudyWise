"use client";

import { useAuth } from "@clerk/nextjs";
import { useCallback, useEffect, useState } from "react";
import { useMeg, useOppdaterUIPreferanser } from "@/app/auth/auth-api";
import type { CookieConsentValue, UIPreferences } from "common/auth";

export const COOKIE_CONSENT_CHANGED_EVENT = "studywise-cookie-consent-changed";
export type CookieConsentStatus = CookieConsentValue | null;

let gjesteSamtykke: CookieConsentStatus = null;

function parseCookieConsent(value: unknown): CookieConsentStatus {
  return value === "accepted" || value === "declined" ? value : null;
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
  emitCookieConsentChange(null);
}

export function useCookieConsent() {
  const { isLoaded, userId } = useAuth();
  const { data: me, isPending: henterMeg } = useMeg({
    enabled: isLoaded && !!userId,
  });
  const { mutateAsync: oppdaterUIPreferanser, isPending } =
    useOppdaterUIPreferanser();
  const [guestConsent, setGuestConsent] =
    useState<CookieConsentStatus>(gjesteSamtykke);
  const [pendingConsent, setPendingConsent] =
    useState<CookieConsentStatus>(null);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
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

  const isAuthenticated = !!userId;
  const backendConsent = parseCookieConsent(
    me?.user?.uiPreferences?.cookieConsent,
  );
  const consent =
    pendingConsent ?? (isAuthenticated ? backendConsent : guestConsent);
  const isReady = isLoaded && (!isAuthenticated || !henterMeg);

  const setConsent = useCallback(
    async (nextConsent: Exclude<CookieConsentStatus, null>) => {
      if (!isAuthenticated) {
        gjesteSamtykke = nextConsent;
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

      setPendingConsent(nextConsent);
      try {
        await oppdaterUIPreferanser(nextPrefs);
        emitCookieConsentChange(nextConsent);
      } finally {
        setPendingConsent(null);
      }
    },
    [isAuthenticated, me?.user?.uiPreferences, oppdaterUIPreferanser],
  );

  return {
    consent,
    isAuthenticated,
    isPending: isAuthenticated && isPending,
    isReady,
    setConsent,
  };
}
