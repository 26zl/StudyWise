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

type TurnstileClientErrorCode = string | number | undefined;

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
  onError?: (errorCode?: string) => void;
  /** Callback ved utløpt token */
  onExpired?: () => void;
  /** Om widgeten skal rendres (default: true) */
  enabled?: boolean;
}

const TURNSTILE_CLIENT_MAX_RETRIES = 2;
const TURNSTILE_CLIENT_RETRY_BASE_DELAY_MS = 1500;

export function shouldRetryTurnstileClientError(
  errorCode: TurnstileClientErrorCode,
): boolean {
  const normalized = String(errorCode ?? "").trim();
  const numericCode = Number(normalized);
  const family = Number.isFinite(numericCode)
    ? Math.floor(numericCode / 1000)
    : null;

  return (
    normalized === "110600" ||
    normalized === "110620" ||
    normalized === "200500" ||
    family === 300 ||
    family === 600
  );
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
  const callbacksRef = useRef({ onSuccess, onError, onExpired });
  const retryCountRef = useRef(0);
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [isLoaded, setIsLoaded] = useState(false);

  useEffect(() => {
    callbacksRef.current = { onSuccess, onError, onExpired };
  }, [onSuccess, onError, onExpired]);

  const clearRetryTimer = useCallback(() => {
    if (retryTimerRef.current) {
      clearTimeout(retryTimerRef.current);
      retryTimerRef.current = null;
    }
  }, []);

  const removeWidget = useCallback((updateLoadedState = true, resetRetries = true) => {
    if (retryTimerRef.current) {
      clearTimeout(retryTimerRef.current);
      retryTimerRef.current = null;
    }
    if (resetRetries) {
      retryCountRef.current = 0;
    }
    const id = widgetIdRef.current;
    widgetIdRef.current = null;
    if (updateLoadedState) {
      setIsLoaded(false);
    }
    if (!id || typeof window === "undefined") return;

    try {
      getTurnstile()?.remove(id);
    } catch {
      // Widgeten kan allerede være fjernet av React/Cloudflare.
    }
  }, []);

  const resetWidget = useCallback(() => {
    const turnstile = getTurnstile();
    if (widgetIdRef.current && turnstile) {
      try {
        turnstile.reset(widgetIdRef.current);
      } catch {
        callbacksRef.current.onError?.("reset_failed");
      }
    }
  }, []);

  // Render widget
  useEffect(() => {
    if (!enabled || !siteKey || typeof window === "undefined") {
      removeWidget();
      return;
    }

    // Strict Mode-guard: effekten mountes → unmountes → mountes igjen umiddelbart.
    // Når script.onload fra en tidligere mount fyres etter unmount, vil
    // containerRef peke på en detached DOM-node, og Turnstile kaster 600010.
    // `cancelled` sørger for at utsatte callbacks fra en unmountet effekt blir no-ops.
    let cancelled = false;

    const resetForRetry = () => {
      const id = widgetIdRef.current;
      const turnstile = getTurnstile();
      if (!id || !turnstile) {
        renderWidget();
        return;
      }

      try {
        turnstile.reset(id);
      } catch {
        removeWidget(true, false);
        renderWidget();
      }
    };

    const scheduleRetry = () => {
      if (retryCountRef.current >= TURNSTILE_CLIENT_MAX_RETRIES) {
        return false;
      }

      retryCountRef.current += 1;
      const delay =
        TURNSTILE_CLIENT_RETRY_BASE_DELAY_MS * retryCountRef.current;
      clearRetryTimer();
      retryTimerRef.current = setTimeout(() => {
        retryTimerRef.current = null;
        if (cancelled || !widgetIdRef.current) return;
        resetForRetry();
      }, delay);
      return true;
    };

    const handleTurnstileError = (errorCode: TurnstileClientErrorCode) => {
      const normalized = String(errorCode ?? "").trim() || undefined;
      if (shouldRetryTurnstileClientError(normalized) && scheduleRetry()) {
        return true;
      }

      callbacksRef.current.onError?.(normalized);
      return true;
    };

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
          callback: (token: string) => {
            retryCountRef.current = 0;
            clearRetryTimer();
            callbacksRef.current.onSuccess(token);
          },
          "error-callback": (errorCode: TurnstileClientErrorCode) =>
            handleTurnstileError(errorCode),
          "expired-callback": () => callbacksRef.current.onExpired?.(),
          theme: "auto",
        };
        if (action) options.action = action;

        try {
          widgetIdRef.current = turnstile.render(containerRef.current, options);
          setIsLoaded(true);
        } catch {
          callbacksRef.current.onError?.("render_failed");
          setIsLoaded(false);
        }
      }
    };

    // Sjekk om Turnstile allerede er lastet
    if (getTurnstile()) {
      // Kort forsinkelse for at DOM-en skal ha mountet containerRef
      const timer = setTimeout(renderWidget, 50);
      return () => {
        cancelled = true;
        clearTimeout(timer);
        clearRetryTimer();
        removeWidget();
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
        clearRetryTimer();
        removeWidget();
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
      clearRetryTimer();
      removeWidget();
    };
  }, [enabled, siteKey, action, clearRetryTimer, removeWidget, resetWidget]);

  // Rydd opp widget ved unmount
  useEffect(() => {
    return () => removeWidget(false);
  }, [removeWidget]);

  return { containerRef, isLoaded, reset: resetWidget };
}
