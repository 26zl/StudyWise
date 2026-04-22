/**
 * useActivityTracker — sporer brukerens aktive tid i appen ved å sende heartbeats
 * til backend. Kun når:
 *   1) fanen er synlig (document.visibilityState === "visible"), OG
 *   2) det har vært mus-/tastatur-/scroll-aktivitet siste 120 sekunder.
 *
 * Tre heartbeat-kilder brukes for å minimere over-/underestimering:
 *   - Debouncet "første heartbeat" 10s etter stabil type (fanger opp besøk < 60s
 *     uten å spamme dokumenter ved rask SPA-navigasjon).
 *   - 60s-intervall for kontinuerlig oppdatering.
 *   - "Close" heartbeat via `fetch({ keepalive: true })` på `pagehide` og
 *     `visibilitychange → hidden` for å registrere siste sekundene av en økt.
 *
 * Backend (POST /api/user/activity/heartbeat) forlenger siste intervall hvis det
 * er åpent og typen er den samme, ellers starter et nytt intervall. Intervallene
 * flettes inn i /study-stats/today sammen med chat-intervaller.
 *
 * Nettverksfeil svelges (best-effort). No-op under SSR.
 */
"use client";

import { useEffect, useRef } from "react";
import {
  ACTIVITY_HEARTBEAT_INTERVAL_MS,
  ACTIVITY_IDLE_THRESHOLD_MS,
  type ActivityType,
} from "common/activity";
import { AUTH_CSRF_HEADER_NAME, AUTH_CSRF_HEADER_VALUE } from "common/auth";
import { fetchAuthedJson } from "@/app/lib/apiClient";
import { getClerkTokenForRequest } from "@/app/lib/clerkTokenForApi";

/** Debounce før første heartbeat sendes etter type-bytte. Kort nok til å fange opp
 * sideskifter > 10s, lenge nok til å unngå dokument-spam når brukeren raskt klikker
 * mellom Canvas-faner. */
const INITIAL_HEARTBEAT_DELAY_MS = 10 * 1000;

async function sendHeartbeat(type: ActivityType): Promise<void> {
  try {
    await fetchAuthedJson("/api/user/activity/heartbeat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type }),
    });
  } catch {
    // Stille feil — heartbeats er best-effort; neste tick prøver igjen.
  }
}

/** Sender en "close" heartbeat som overlever page unload via `keepalive: true`.
 * Backend krever `Authorization: Bearer <clerk-token>` (se middleware/auth.ts), så vi må
 * sende et cached token — kan ikke kalle `await getClerkTokenForRequest()` under pagehide
 * fordi async work kan bli kuttet. Tokenet caches i `tokenRef` ved hver heartbeat.
 * Vi kan ikke bruke sendBeacon siden CSRF-middleware krever custom header. */
function sendCloseHeartbeatKeepalive(type: ActivityType, token: string | null): void {
  if (typeof fetch === "undefined") return;
  if (!token) return;
  try {
    void fetch("/api/user/activity/heartbeat", {
      method: "POST",
      keepalive: true,
      credentials: "include",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${token}`,
        [AUTH_CSRF_HEADER_NAME]: AUTH_CSRF_HEADER_VALUE,
      },
      body: JSON.stringify({ type }),
    });
  } catch {
    // Best-effort — tabben er på vei bort uansett.
  }
}

export function useActivityTracker(type: ActivityType | null, enabled: boolean) {
  // Starter på 0 slik at første heartbeat KREVER at brukeren faktisk har
  // interagert (mus/tastatur/scroll/touch) etter mount. Uten dette ville en fane
  // som bare står åpen uten bruker fått opptil ~2 min falsk "aktiv tid" før
  // idle-terskelen slår inn.
  const sistInteraksjonRef = useRef<number>(0);
  const typeRef = useRef<ActivityType | null>(type);
  typeRef.current = type;
  // Cache av siste Clerk-token. Close-heartbeat-stien kan ikke await — den må sende
  // tokenet synkront. Holdes oppdatert i forsøkHeartbeat (≤ 60s gammel ved close).
  const tokenRef = useRef<string | null>(null);

  useEffect(() => {
    if (!enabled) return;
    if (typeof window === "undefined") return;

    const oppdaterInteraksjon = () => {
      sistInteraksjonRef.current = Date.now();
    };

    const events: Array<keyof WindowEventMap> = [
      "mousemove",
      "mousedown",
      "keydown",
      "scroll",
      "touchstart",
      "wheel",
    ];
    for (const e of events) {
      window.addEventListener(e, oppdaterInteraksjon, { passive: true });
    }

    return () => {
      for (const e of events) {
        window.removeEventListener(e, oppdaterInteraksjon);
      }
    };
  }, [enabled]);

  useEffect(() => {
    if (!enabled) return;
    if (typeof window === "undefined") return;
    if (!type) return;

    let kansellert = false;

    const forsøkHeartbeat = async () => {
      if (kansellert) return;
      if (document.visibilityState !== "visible") return;
      const sidenInteraksjon = Date.now() - sistInteraksjonRef.current;
      if (sidenInteraksjon > ACTIVITY_IDLE_THRESHOLD_MS) return;
      const currentType = typeRef.current;
      if (!currentType) return;
      // Oppdater token-cache før vi sender, så close-heartbeat ved pagehide har
      // et ferskt Bearer-token tilgjengelig synkront.
      tokenRef.current = await getClerkTokenForRequest();
      await sendHeartbeat(currentType);
    };

    // Varm token-cachen ved mount så close-heartbeat virker selv hvis tabben lukkes
    // før første intervall-heartbeat har kjørt. Ignorerer feil — best-effort.
    void (async () => {
      if (kansellert) return;
      const token = await getClerkTokenForRequest();
      if (!kansellert) tokenRef.current = token;
    })();

    // Debouncet første heartbeat: fyres 10s etter type stabiliserer, slik at rask
    // SPA-navigasjon ikke lager ett dokument per klikk, men besøk > 10s fortsatt telles.
    const initialTimer = window.setTimeout(() => {
      void forsøkHeartbeat();
    }, INITIAL_HEARTBEAT_DELAY_MS);

    // Kontinuerlig oppdatering mens brukeren er aktiv.
    const intervalId = window.setInterval(() => {
      void forsøkHeartbeat();
    }, ACTIVITY_HEARTBEAT_INTERVAL_MS);

    // Close-heartbeat når fanen lukkes eller skjules — sikrer at de siste sekundene
    // registreres. Bruker `keepalive: true` så requesten overlever unload.
    const onClose = () => {
      if (document.visibilityState === "visible") return;
      const sidenInteraksjon = Date.now() - sistInteraksjonRef.current;
      if (sidenInteraksjon > ACTIVITY_IDLE_THRESHOLD_MS) return;
      const currentType = typeRef.current;
      if (!currentType) return;
      sendCloseHeartbeatKeepalive(currentType, tokenRef.current);
    };
    const onVisibilityChange = () => {
      if (document.visibilityState === "hidden") {
        onClose();
      }
    };
    window.addEventListener("pagehide", onClose);
    document.addEventListener("visibilitychange", onVisibilityChange);

    return () => {
      kansellert = true;
      window.clearTimeout(initialTimer);
      window.clearInterval(intervalId);
      window.removeEventListener("pagehide", onClose);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [enabled, type]);
}
