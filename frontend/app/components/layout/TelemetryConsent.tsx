/**
 * TelemetryConsent – viser Vercel Speed Insights kun når bruker har akseptert cookies.
 * Lytter på studywise-cookie-consent-changed og storage for å oppdatere tilstand.
 */
"use client";

import { useEffect, useState } from "react";
import { SpeedInsights } from "@vercel/speed-insights/next";
import {
  COOKIE_CONSENT_CHANGED_EVENT,
  getStoredCookieConsent,
  type CookieConsentStatus,
} from "./CookieBanner";

export function TelemetryConsent() {
  const [consent, setConsent] = useState<CookieConsentStatus>(null);

  useEffect(() => {
    const syncConsent = () => {
      setConsent(getStoredCookieConsent());
    };

    syncConsent();
    window.addEventListener("storage", syncConsent);
    window.addEventListener(COOKIE_CONSENT_CHANGED_EVENT, syncConsent);

    return () => {
      window.removeEventListener("storage", syncConsent);
      window.removeEventListener(COOKIE_CONSENT_CHANGED_EVENT, syncConsent);
    };
  }, []);

  if (consent !== "accepted") {
    return null;
  }

  return (
    <>
      <SpeedInsights />
    </>
  );
}
