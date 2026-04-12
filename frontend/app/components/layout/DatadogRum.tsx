"use client";

import { useEffect } from "react";
import { useCookieConsent } from "@/app/hooks/useCookieConsent";

type DatadogUser = {
  id: string;
  studywiseUserId?: string;
};

let pendingDatadogUser: DatadogUser | null = null;
let pendingClearUser = false;

// Lazy-referanse til datadogRum — settes ved første dynamiske import.
// Unngår at @datadog/browser-rum evalueres flere ganger av Turbopack/Strict Mode
// som forårsaker "SDK is loaded more than once"-advarsel.
let ddRum: typeof import("@datadog/browser-rum").datadogRum | null = null;
let ddReactPlugin: typeof import("@datadog/browser-rum-react").reactPlugin | null = null;
let ddImportPromise: Promise<void> | null = null;

async function loadDatadogModules() {
  if (ddRum) return;
  if (ddImportPromise) {
    await ddImportPromise;
    return;
  }
  ddImportPromise = (async () => {
    const [rumModule, reactModule] = await Promise.all([
      import("@datadog/browser-rum"),
      import("@datadog/browser-rum-react"),
    ]);
    ddRum = rumModule.datadogRum;
    ddReactPlugin = reactModule.reactPlugin;
  })();
  await ddImportPromise;
}

function flushPendingDatadogUser() {
  if (!ddRum?.getInitConfiguration()) return;

  if (pendingClearUser) {
    ddRum.clearUser();
    pendingClearUser = false;
    pendingDatadogUser = null;
    return;
  }

  if (pendingDatadogUser) {
    ddRum.setUser(pendingDatadogUser);
    pendingDatadogUser = null;
  }
}

/**
 * Initialiserer Datadog RUM (Real User Monitoring) for frontend.
 * Bruker React-pluginen for feilsporing; Next.js App Router brukes (ikke React Router).
 * Aktiveres kun når NEXT_PUBLIC_DD_RUM_APPLICATION_ID og NEXT_PUBLIC_DD_RUM_CLIENT_TOKEN er satt.
 */
declare global {
  interface Window {
    __DD_RUM_INIT_DONE__?: boolean;
  }
}

export function DatadogRum() {
  const { consent, isReady } = useCookieConsent();

  useEffect(() => {
    if (!isReady) {
      return;
    }

    // Hvis RUM aldri er initialisert OG brukeren ikke har samtykket — gjør ingenting.
    // Dette er den eneste tidlige exit: vi vil verken laste modulene eller røre Datadog.
    const alreadyInitFlag = typeof window !== "undefined" && window.__DD_RUM_INIT_DONE__ === true;
    if (!alreadyInitFlag && consent !== "accepted") {
      return;
    }

    const applicationId = process.env.NEXT_PUBLIC_DD_RUM_APPLICATION_ID;
    const clientToken = process.env.NEXT_PUBLIC_DD_RUM_CLIENT_TOKEN;
    const site = process.env.NEXT_PUBLIC_DD_SITE ?? "us5.datadoghq.com";
    if (!alreadyInitFlag && (!applicationId || !clientToken)) {
      return;
    }

    // Last alltid modulene før vi tar consent-beslutninger. Etter en Turbopack HMR
    // er modul-scope `ddRum` resatt til null mens `__DD_RUM_INIT_DONE__` på window
    // fortsatt er true; uten en re-import ville vi mistet referansen og ikke kunnet
    // kalle setTrackingConsent når brukeren bytter samtykke.
    void loadDatadogModules().then(() => {
      if (!ddRum || !ddReactPlugin) return;

      const isAlreadyInit = Boolean(ddRum.getInitConfiguration());

      if (isAlreadyInit) {
        // Post-init samtykke-endring: oppdater tracking-consent runtime uten reload.
        // Datadogs offisielle GDPR-API (v5+) — 'not-granted' stopper sending,
        // 'granted' slår på igjen.
        if (typeof window !== "undefined") window.__DD_RUM_INIT_DONE__ = true;
        try {
          ddRum.setTrackingConsent(consent === "accepted" ? "granted" : "not-granted");
          if (consent === "accepted") {
            flushPendingDatadogUser();
          }
        } catch {
          // Datadog RUM er ikke kritisk – la appen fortsette
        }
        return;
      }

      // Førstegangs-init krever eksplisitt samtykke + nødvendige env-variabler.
      if (consent !== "accepted" || !applicationId || !clientToken) {
        return;
      }

      if (typeof window !== "undefined") window.__DD_RUM_INIT_DONE__ = true;
      try {
        ddRum.init({
          applicationId,
          clientToken,
          site,
          service: "studywise-frontend",
          env: process.env.NODE_ENV ?? "development",
          version: process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA ?? "0.0.0",
          sessionSampleRate: 100,
          sessionReplaySampleRate: 50,
          defaultPrivacyLevel: "mask-user-input",
          trackUserInteractions: true,
          trackResources: true,
          trackLongTasks: true,
          // Eksplisitt GDPR-consent: vi init-er kun etter accepted,
          // men setter flagget for klarhet og for å kunne flippe runtime.
          trackingConsent: "granted",
          // Distribuert tracing: kobler frontend RUM-traces til backend APM-traces
          allowedTracingUrls: [{ match: /\/api\//, propagatorTypes: ["tracecontext"] }],
          plugins: [ddReactPlugin({ router: false }) as import("@datadog/browser-rum").RumPlugin],
        });
        flushPendingDatadogUser();
      } catch {
        if (typeof window !== "undefined") {
          window.__DD_RUM_INIT_DONE__ = false;
        }
      }
    });
  }, [consent, isReady]);

  return null;
}

/**
 * Setter bruker-ID i Datadog RUM for å koble sesjoner til brukere.
 * Kall denne etter innlogging (f.eks. i auth-provider eller dashboard).
 */
export function setDatadogUser(user: DatadogUser) {
  if (!ddRum?.getInitConfiguration()) {
    pendingDatadogUser = user;
    pendingClearUser = false;
    return;
  }
  ddRum.setUser(user);
}

/**
 * Fjerner bruker-ID fra Datadog RUM ved utlogging.
 */
export function clearDatadogUser() {
  if (!ddRum?.getInitConfiguration()) {
    pendingDatadogUser = null;
    pendingClearUser = true;
    return;
  }
  ddRum.clearUser();
}
