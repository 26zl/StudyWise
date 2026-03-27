/**
 * TelemetryConsent – viser Vercel Speed Insights kun når bruker har akseptert cookies.
 */
"use client";

import { SpeedInsights } from "@vercel/speed-insights/next";
import { useCookieConsent } from "@/app/hooks/useCookieConsent";

export function TelemetryConsent() {
  const { consent, isReady } = useCookieConsent();

  if (!isReady || consent !== "accepted") {
    return null;
  }

  return (
    <>
      <SpeedInsights />
    </>
  );
}
