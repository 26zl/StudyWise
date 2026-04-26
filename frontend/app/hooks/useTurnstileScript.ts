"use client";

/**
 * Delt hook for lasting og rendering av Cloudflare Turnstile-widget.
 * Brukes av AuthTurnstileInline, TurnstileReChallenge og ContactForm.
 *
 * Gjenbruker eksisterende script-tag hvis den finnes, og rydder opp
 * widget ved unmount for å unngå lekkasjer.
 */

import { useCallback, useEffect, useRef, useState } from "react";

const TURNSTILE_SCRIPT_URL =
  "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";

export type TurnstileRenderer = {
  render: (element: HTMLElement, options: Record<string, unknown>) => string;
  reset: (widgetId: string) => void;
  remove: (widgetId: string) => void;
};

type TurnstileWindow = Window & {
  turnstile?: TurnstileRenderer;
};

function getTurnstile(): TurnstileRenderer | undefined {
  return (window as TurnstileWindow).turnstile;
}

interface UseTurnstileScriptOptions {
  siteKey: string;
  /** Valgfri action-tag (brukes av auth-Turnstile) */
  action?: string;
  /** Callback ved vellykket verifisering */
  onSuccess: (token: string) => void;
  /** Callback ved feil. Mottar Cloudflare-feilkoden (f.eks. "600010") når tilgjengelig. */
  onError?: (errorCode?: string) => void;
  /** Callback ved utløpt token */
  onExpired?: () => void;
  /** Om widgeten skal rendres (default: true) */
  enabled?: boolean;
}

interface UseTurnstileScriptResult {
  /** Ref som skal plasseres på container-div for widgeten */
  containerRef: React.RefObject<HTMLDivElement | null>;
  /** Om Turnstile-scriptet er lastet og widgeten rendret */
  isLoaded: boolean;
  /** Tilbakestill widgeten (f.eks. etter innsending) */
  reset: () => void;
}

export function useTurnstileScript({
  siteKey,
  action,
  onSuccess,
  onError,
  onExpired,
  enabled = true,
}: UseTurnstileScriptOptions): UseTurnstileScriptResult {
  const containerRef = useRef<HTMLDivElement>(null);
  const widgetIdRef = useRef<string | null>(null);
  const [isLoaded, setIsLoaded] = useState(false);

  const resetWidget = useCallback(() => {
    const turnstile = getTurnstile();
    if (widgetIdRef.current && turnstile) {
      turnstile.reset(widgetIdRef.current);
    }
  }, []);

  // Render widget
  useEffect(() => {
    if (!enabled || !siteKey || typeof window === "undefined") return;

    // Strict Mode-guard: effekten mountes → unmountes → mountes igjen umiddelbart.
    // Når script.onload fra en tidligere mount fyres etter unmount, vil
    // containerRef peke på en detached DOM-node, og Turnstile kaster 600010.
    // `cancelled` sørger for at utsatte callbacks fra en unmountet effekt blir no-ops.
    let cancelled = false;

    const renderWidget = () => {
      if (cancelled) return;
      const turnstile = getTurnstile();
      // Ekstra guard: containerRef må også være attached til DOM-en fortsatt.
      // I Strict Mode kan ref-en peke på en node som er tatt ut av dokumentet.
      if (
        containerRef.current &&
        !widgetIdRef.current &&
        turnstile &&
        document.contains(containerRef.current)
      ) {
        const options: Record<string, unknown> = {
          sitekey: siteKey,
          callback: (token: string) => onSuccess(token),
          // Cloudflare kaller error-callback med en feilkode (string). Vi videresender
          // koden så UI-laget kan vise "Feilkode: 600010" og brukeren kan google den.
          "error-callback": (errorCode?: unknown) =>
            onError?.(typeof errorCode === "string" ? errorCode : undefined),
          "expired-callback": () => onExpired?.(),
          theme: "auto",
          // Vises kun når Cloudflare faktisk trenger interaksjon (high-risk besøk).
          // For VPN/NAT/skole-WiFi hopper Cloudflare nå rett til en kortere passive
          // sjekk i stedet for å eskalere til full challenge — som er hovedårsaken
          // til 600010. Må samsvare med "Non-interactive" widget-modus i CF-dashbord.
          appearance: "interaction-only",
          // Hindrer at widgeten auto-genererer ny token ved klient-sidefeil
          // (f.eks. 600010). Uten dette spammes /verify til rate-limit slår inn.
          retry: "never",
          // Ikke auto-refresh tokens i bakgrunnen. Tokens lever ~290s — uten dette
          // får vi "invalid-input-response" fra Cloudflare når brukeren har sittet
          // og fylt ut skjema lenge. Med "manual" må widgeten resettes eksplisitt.
          "refresh-expired": "manual",
        };
        if (action) options.action = action;

        widgetIdRef.current = turnstile.render(containerRef.current, options);
        setIsLoaded(true);
      }
    };

    // Sjekk om Turnstile allerede er lastet
    if (getTurnstile()) {
      // Kort forsinkelse for at DOM-en skal ha mountet containerRef
      const timer = setTimeout(renderWidget, 50);
      return () => {
        cancelled = true;
        clearTimeout(timer);
      };
    }

    // Sjekk om scriptet allerede er i DOM (men ennå ikke ferdig lastet)
    const existingScript = document.querySelector<HTMLScriptElement>(
      `script[src^="https://challenges.cloudflare.com/turnstile/v0/api.js"]`,
    );
    if (existingScript) {
      existingScript.addEventListener("load", renderWidget, { once: true });
      return () => {
        cancelled = true;
        existingScript.removeEventListener("load", renderWidget);
      };
    }

    // Last inn scriptet
    const script = document.createElement("script");
    script.src = TURNSTILE_SCRIPT_URL;
    script.async = true;
    script.defer = true;
    // Bruk addEventListener i stedet for script.onload så vi ikke overskriver
    // handlers fra andre samtidige mounts (Strict Mode) — og så vi kan fjerne
    // handleren eksplisitt i cleanup.
    const handleScriptLoad = () => {
      if (cancelled) return;
      setTimeout(renderWidget, 100);
    };
    script.addEventListener("load", handleScriptLoad, { once: true });
    document.head.appendChild(script);

    return () => {
      cancelled = true;
      script.removeEventListener("load", handleScriptLoad);
    };
  }, [enabled, siteKey, action, onSuccess, onError, onExpired]);

  // Rydd opp widget ved unmount
  useEffect(() => {
    return () => {
      const id = widgetIdRef.current;
      if (!id) return;
      // Nullstill ref FØR remove for å hindre at React 19 Strict Mode-dobbel-mount
      // eller hot-reload trigger remove() to ganger på samme widgetId.
      widgetIdRef.current = null;
      const turnstile = getTurnstile();
      try {
        turnstile?.remove(id);
      } catch { /* widgeten kan allerede være fjernet av React */ }
    };
  }, []);

  return { containerRef, isLoaded, reset: resetWidget };
}
