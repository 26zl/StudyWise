"use client";

/**
 * TurnstileReChallenge — vises som modal/overlay når backend returnerer
 * turnstile_required (403) under en autentisert sesjon.
 *
 * I stedet for å logge brukeren ut, viser vi Turnstile-widgeten inline
 * og re-trigger /me-queryen etter vellykket verifisering.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { ShieldCheck } from "lucide-react";
import { AUTH_TURNSTILE_ACTION } from "common/auth";
import { verifyAuthTurnstile } from "@/app/auth/auth-turnstile-api";
import { useLanguage } from "@/app/i18n";
import { AUTH_ME_QUERY_KEY } from "@/app/auth/auth-api";
import { showToast } from "@/app/components/ui/Toaster";
import { lagBrukervennligFeilmelding } from "@/app/lib/errorUtils";

type TurnstileRenderer = {
  render: (element: HTMLElement, options: Record<string, unknown>) => string;
  reset: (widgetId: string) => void;
  remove: (widgetId: string) => void;
};

type TurnstileWindow = Window & {
  turnstile?: TurnstileRenderer;
};

const AUTH_TURNSTILE_SITE_KEY =
  process.env.NEXT_PUBLIC_AUTH_TURNSTILE_SITE_KEY ?? "";

/**
 * Lytter på /me-query-feil for turnstile_required (403).
 * Viser en modal med Turnstile-widget for re-verifisering.
 */
export function TurnstileReChallenge() {
  const queryClient = useQueryClient();
  const { t } = useLanguage();
  const [showChallenge, setShowChallenge] = useState(false);
  const [isVerifying, setIsVerifying] = useState(false);
  const turnstileRef = useRef<HTMLDivElement>(null);
  const widgetIdRef = useRef<string | null>(null);

  // Lytt på /me-query feil for turnstile_required
  useEffect(() => {
    const unsubscribe = queryClient.getQueryCache().subscribe((event) => {
      if (
        event?.type === "updated" &&
        event.query.queryKey[0] === AUTH_ME_QUERY_KEY[0] &&
        event.query.queryKey[1] === AUTH_ME_QUERY_KEY[1] &&
        event.query.state.status === "error"
      ) {
        const error = event.query.state.error;
        const msg = error instanceof Error ? error.message : "";
        // Sjekk om feilen er turnstile_required (matcher meldingen satt i auth-api.ts)
        if (/sikkerhetsverifisering utløpt/i.test(msg) || /turnstile_required/i.test(msg)) {
          setShowChallenge(true);
        }
      }
    });
    return unsubscribe;
  }, [queryClient]);

  const onVerified = useCallback(() => {
    setShowChallenge(false);
    setIsVerifying(false);
    // Rydd opp widget
    if (widgetIdRef.current) {
      const currentWindow = window as TurnstileWindow;
      try { currentWindow.turnstile?.remove(widgetIdRef.current); } catch { /* ignorer */ }
      widgetIdRef.current = null;
    }
    // Re-trigger /me-queryen slik at appen laster brukerdata på nytt
    void queryClient.invalidateQueries({ queryKey: AUTH_ME_QUERY_KEY });
  }, [queryClient]);

  const onTurnstileSuccess = useCallback(async (token: string) => {
    if (isVerifying) return;
    setIsVerifying(true);
    try {
      await verifyAuthTurnstile(token);
      onVerified();
    } catch (error) {
      const message = lagBrukervennligFeilmelding(
        error instanceof Error ? error : null,
        { auth: true },
        t("errors.generic.default"),
        t,
      );
      showToast.error(t("auth.humanCheck.title"), message);
      // Reset widget for nytt forsøk
      const currentWindow = window as TurnstileWindow;
      if (widgetIdRef.current && currentWindow.turnstile) {
        currentWindow.turnstile.reset(widgetIdRef.current);
      }
    } finally {
      setIsVerifying(false);
    }
  }, [isVerifying, onVerified, t]);

  // Renderer Turnstile-widget når modal vises
  useEffect(() => {
    if (!showChallenge || !AUTH_TURNSTILE_SITE_KEY) return;

    const renderWidget = () => {
      const currentWindow = window as TurnstileWindow;
      if (turnstileRef.current && !widgetIdRef.current && currentWindow.turnstile) {
        widgetIdRef.current = currentWindow.turnstile.render(turnstileRef.current, {
          sitekey: AUTH_TURNSTILE_SITE_KEY,
          action: AUTH_TURNSTILE_ACTION,
          callback: (token: string) => { void onTurnstileSuccess(token); },
          "error-callback": () => {
            showToast.error(t("auth.humanCheck.title"), t("auth.humanCheck.widgetError"));
          },
          "expired-callback": () => {
            const cw = window as TurnstileWindow;
            if (widgetIdRef.current && cw.turnstile) cw.turnstile.reset(widgetIdRef.current);
          },
          theme: "auto",
        });
      }
    };

    // Sjekk om Turnstile-scriptet allerede er lastet
    const currentWindow = window as TurnstileWindow;
    if (currentWindow.turnstile) {
      // Kort forsinkelse for at DOM-en skal rendre turnstileRef
      const timer = setTimeout(renderWidget, 50);
      return () => clearTimeout(timer);
    }

    // Last scriptet hvis det ikke finnes
    const existingScript = document.querySelector<HTMLScriptElement>(
      'script[src^="https://challenges.cloudflare.com/turnstile/v0/api.js"]',
    );
    if (existingScript) {
      existingScript.addEventListener("load", renderWidget, { once: true });
      return () => existingScript.removeEventListener("load", renderWidget);
    }

    const script = document.createElement("script");
    script.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
    script.async = true;
    script.defer = true;
    script.onload = () => setTimeout(renderWidget, 100);
    document.head.appendChild(script);
  }, [showChallenge, onTurnstileSuccess, t]);

  // Rydd opp widget ved unmount
  useEffect(() => {
    return () => {
      if (widgetIdRef.current) {
        const currentWindow = window as TurnstileWindow;
        try { currentWindow.turnstile?.remove(widgetIdRef.current); } catch { /* ignorer */ }
        widgetIdRef.current = null;
      }
    };
  }, []);

  if (!showChallenge || !AUTH_TURNSTILE_SITE_KEY) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div className="mx-4 w-full max-w-sm rounded-2xl border border-slate-200 bg-white p-6 shadow-2xl dark:border-slate-700 dark:bg-slate-800">
        <div className="mb-4 flex items-start gap-4">
          <div className="rounded-2xl bg-blue-50 p-3 text-blue-700 dark:bg-blue-900/30 dark:text-blue-200">
            <ShieldCheck className="h-6 w-6" />
          </div>
          <div className="space-y-1">
            <h2 className="text-base font-semibold text-slate-900 dark:text-white">
              {t("auth.humanCheck.rechallenge.title")}
            </h2>
            <p className="text-sm leading-6 text-slate-600 dark:text-slate-300">
              {t("auth.humanCheck.rechallenge.description")}
            </p>
          </div>
        </div>
        <div className="flex justify-center">
          <div ref={turnstileRef} />
        </div>
      </div>
    </div>
  );
}
