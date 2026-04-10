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
  /** Callback ved feil */
  onError?: () => void;
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

    const renderWidget = () => {
      const turnstile = getTurnstile();
      if (containerRef.current && !widgetIdRef.current && turnstile) {
        const options: Record<string, unknown> = {
          sitekey: siteKey,
          callback: (token: string) => onSuccess(token),
          "error-callback": () => onError?.(),
          "expired-callback": () => onExpired?.(),
          theme: "auto",
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
      return () => clearTimeout(timer);
    }

    // Sjekk om scriptet allerede er i DOM (men ennå ikke ferdig lastet)
    const existingScript = document.querySelector<HTMLScriptElement>(
      `script[src^="https://challenges.cloudflare.com/turnstile/v0/api.js"]`,
    );
    if (existingScript) {
      existingScript.addEventListener("load", renderWidget, { once: true });
      return () => existingScript.removeEventListener("load", renderWidget);
    }

    // Last inn scriptet
    const script = document.createElement("script");
    script.src = TURNSTILE_SCRIPT_URL;
    script.async = true;
    script.defer = true;
    script.onload = () => setTimeout(renderWidget, 100);
    document.head.appendChild(script);

    return undefined;
  }, [enabled, siteKey, action, onSuccess, onError, onExpired]);

  // Rydd opp widget ved unmount
  useEffect(() => {
    return () => {
      if (widgetIdRef.current) {
        const turnstile = getTurnstile();
        try {
          turnstile?.remove(widgetIdRef.current);
        } catch { /* ignorer */ }
        widgetIdRef.current = null;
      }
    };
  }, []);

  return { containerRef, isLoaded, reset: resetWidget };
}
