/**
 * PostHog produktanalyse for frontend.
 *
 * Formål: Måle brukeratferd (funnels, retention, paths) — i motsetning til Datadog RUM
 * som måler teknisk ytelse. Brukes for å svare på "leverer produktet verdi?".
 *
 * Konfigurasjon:
 *   - US Cloud-instans (us.i.posthog.com) — prosjektet er hostet i US-regionen
 *   - persistence: "memory" → ingen cookies, ingen localStorage. Null GDPR-fotavtrykk
 *     utover allerede-samtykket telemetri; ingen ny entry i cookie-banner nødvendig.
 *   - disable_session_recording: true → ingen session replay (privacy + bundle-størrelse)
 *   - autocapture: true → pageviews, klikk og form-submissions fanges automatisk
 *
 * Gate: Samme useCookieConsent som DatadogRum. Null init før brukeren har akseptert
 * telemetri, akkurat som Datadog RUM.
 *
 * Lazy-loading: posthog-js er ~50kB gzip. Vi dynamisk-importerer etter consent så
 * første bundle ikke bærer kostnaden for brukere som takker nei.
 */
"use client";

import { useEffect } from "react";
import { useCookieConsent } from "@/app/hooks/useCookieConsent";

type PostHogClient = typeof import("posthog-js").default;
type PostHogConsentState = "accepted" | "declined" | "unknown";

// Lazy-referanse til posthog-klienten. Settes ved første dynamic-import etter consent.
let posthogClient: PostHogClient | null = null;
let posthogImportPromise: Promise<void> | null = null;
let posthogConsentState: PostHogConsentState = "unknown";

// Queue for events som fires før posthog er lastet eller initialisert.
// Tømmes automatisk når klienten er klar.
interface QueuedEvent {
  name: string;
  properties?: Record<string, unknown>;
}
const pendingEvents: QueuedEvent[] = [];

// User-ID som venter på init. Settes kun hvis identifiserbar bruker skal kobles
// til anonyme sesjoner — men i cookieless-modus er dette best-effort per sesjon.
let pendingIdentify: { distinctId: string; properties?: Record<string, unknown> } | null = null;
let pendingReset = false;

declare global {
  interface Window {
    __POSTHOG_INIT_DONE__?: boolean;
  }
}

async function loadPostHogModule(): Promise<void> {
  if (posthogClient) return;
  if (posthogImportPromise) {
    await posthogImportPromise;
    return;
  }
  posthogImportPromise = (async () => {
    const mod = await import("posthog-js");
    posthogClient = mod.default;
  })();
  await posthogImportPromise;
}

function clearPendingEvents(): void {
  pendingEvents.length = 0;
}

function updateConsentState(consent: "accepted" | "declined" | null): void {
  posthogConsentState = consent === "accepted" || consent === "declined" ? consent : "unknown";
  if (posthogConsentState !== "accepted") {
    clearPendingEvents();
  }
}

function isInitialized(): boolean {
  // posthog-js setter __loaded etter init(). Uten denne flagget er kall no-ops
  // under unit-test/SSR og ved feilet init.
  return Boolean(posthogClient && (posthogClient as unknown as { __loaded?: boolean }).__loaded);
}

function flushPendingQueue(): void {
  if (!isInitialized()) return;
  if (!posthogClient) return;

  if (pendingReset) {
    try {
      posthogClient.reset();
    } catch {
      // Reset er best-effort — ignorer
    }
    pendingReset = false;
    pendingIdentify = null;
  }

  if (pendingIdentify) {
    try {
      posthogClient.identify(pendingIdentify.distinctId, pendingIdentify.properties);
    } catch {
      // Identify er best-effort
    }
    pendingIdentify = null;
  }

  while (pendingEvents.length > 0) {
    const event = pendingEvents.shift();
    if (!event) break;
    try {
      posthogClient.capture(event.name, event.properties);
    } catch {
      // Dropp event ved feil — telemetri må aldri krasje UI
    }
  }
}

/**
 * Klient-komponent som initialiserer PostHog når brukeren har akseptert telemetri.
 * Rendres én gang i app-shellen (ved siden av DatadogRum). Returnerer null — all
 * tilstand ligger i modul-scope så helper-funksjoner utenfor React kan trigge events.
 */
export function PostHogAnalytics(): null {
  const { consent, isReady } = useCookieConsent();

  useEffect(() => {
    if (!isReady) {
      return;
    }

    updateConsentState(consent);

    // Post-init samtykke-endring: hvis PostHog allerede er initialisert,
    // respekter samtykke-tilbaketrekking (og re-opt-in) runtime uten reload.
    // opt_out_capturing() stopper all capture fremover; opt_in_capturing() slår på igjen.
    if (
      typeof window !== "undefined" &&
      window.__POSTHOG_INIT_DONE__ &&
      posthogClient &&
      isInitialized()
    ) {
      try {
        if (consent === "accepted") {
          posthogClient.opt_in_capturing();
          flushPendingQueue();
        } else {
          posthogClient.opt_out_capturing();
        }
      } catch {
        // Telemetri må aldri krasje UI.
      }
      return;
    }

    // Første init kun ved eksplisitt samtykke — samme mønster som før.
    if (consent !== "accepted") {
      return;
    }

    const apiKey = process.env.NEXT_PUBLIC_POSTHOG_KEY;
    const apiHost = process.env.NEXT_PUBLIC_POSTHOG_HOST ?? "https://us.i.posthog.com";
    if (!apiKey) {
      // Silent skip i dev/CI der PostHog ikke er konfigurert — samme mønster som DatadogRum.
      return;
    }

    // Én init per window — unngår dobbel init i Strict Mode og Turbopack HMR.
    if (typeof window !== "undefined" && window.__POSTHOG_INIT_DONE__) {
      flushPendingQueue();
      return;
    }

    void loadPostHogModule().then(() => {
      if (!posthogClient) return;

      // Hvis allerede initialisert fra en tidligere mount (HMR), bare tøm queuen
      if (isInitialized()) {
        if (typeof window !== "undefined") window.__POSTHOG_INIT_DONE__ = true;
        flushPendingQueue();
        return;
      }

      if (typeof window !== "undefined") window.__POSTHOG_INIT_DONE__ = true;

      try {
        posthogClient.init(apiKey, {
          api_host: apiHost,
          // Null cookies, null localStorage. Sesjonen identifiseres i minnet per fane.
          // Konsekvens: samme bruker på tvers av faner/besøk teller som separate anonyme
          // besøkende. Vi mister cross-session retention på anonymt nivå, men beholder
          // all funnels og retention innen én sesjon.
          persistence: "memory",
          // Session replay deaktivert: bundle-størrelse og privacy-hensyn.
          disable_session_recording: true,
          // Autocapture: pageviews, klikk, form-submissions og heatmaps automatisk.
          // Vi trenger ingen manuell capture-kall for å bygge enkle funnels.
          autocapture: true,
          capture_pageview: true,
          capture_pageleave: true,
          // Ikke kjør i test/development med mindre noen eksplisitt setter nøkkelen.
          loaded: () => {
            flushPendingQueue();
          },
          // Ikke send noe ved init-feil — lar telemetri være stille i stedet for å lekke
          // feil til brukeren.
          on_xhr_error: () => {
            /* ignore */
          },
        });
      } catch {
        if (typeof window !== "undefined") {
          window.__POSTHOG_INIT_DONE__ = false;
        }
      }
    });
  }, [consent, isReady]);

  return null;
}

// ── Eksterne helper-funksjoner (kallbare fra hooks, services, catch-blokker) ──

/**
 * Rapporter et produkt-event (f.eks. "chat_message_sent", "quiz_generated").
 *
 * Trygg å kalle før PostHog er lastet eller initialisert — events queues og sendes
 * automatisk når klienten er klar. Hvis brukeren aldri gir samtykke, dropper vi
 * eventene stille.
 */
export function captureProductEvent(name: string, properties?: Record<string, unknown>): void {
  try {
    if (posthogConsentState !== "accepted") {
      return;
    }
    if (isInitialized() && posthogClient) {
      posthogClient.capture(name, properties);
      return;
    }
    // Queue kun etter eksplisitt samtykke. Vi sender aldri aktivitet som skjedde
    // før brukeren godtok valgfrie målinger.
    if (pendingEvents.length < 50) {
      pendingEvents.push({ name, properties });
    }
  } catch {
    // Telemetri må aldri krasje UI.
  }
}

/**
 * Identifiser nåværende bruker med en stabil ID (vanligvis Clerk user-ID).
 * I cookieless-modus gjelder identifikasjonen kun for den aktive sesjonen.
 */
export function identifyPostHogUser(
  distinctId: string,
  properties?: Record<string, unknown>,
): void {
  try {
    if (isInitialized() && posthogClient) {
      posthogClient.identify(distinctId, properties);
      return;
    }
    pendingIdentify = { distinctId, properties };
    pendingReset = false;
  } catch {
    // ignore
  }
}

/**
 * Fjern bruker-ID fra PostHog-sesjonen (ved utlogging).
 */
export function resetPostHogUser(): void {
  try {
    if (isInitialized() && posthogClient) {
      posthogClient.reset();
      return;
    }
    pendingReset = true;
    pendingIdentify = null;
  } catch {
    // ignore
  }
}
