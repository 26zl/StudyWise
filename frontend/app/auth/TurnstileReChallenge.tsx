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
import { getApiErrorCode, lagBrukervennligFeilmelding } from "@/app/lib/errorUtils";
import { useTurnstileScript } from "@/app/hooks/useTurnstileScript";
import { turnstileEnabled } from "@/app/lib/validateEnv";

const AUTH_TURNSTILE_SITE_KEY =
  process.env.NEXT_PUBLIC_AUTH_TURNSTILE_SITE_KEY ?? "";

// Når Turnstile er deaktivert i miljøet skal modalen aldri vises
const TURNSTILE_ACTIVE = turnstileEnabled && !!AUTH_TURNSTILE_SITE_KEY;

/**
 * Lytter på /me-query-feil for turnstile_required (403).
 * Viser en modal med Turnstile-widget for re-verifisering.
 */
export function TurnstileReChallenge() {
  const queryClient = useQueryClient();
  const { t } = useLanguage();
  const [showChallenge, setShowChallenge] = useState(false);
  const [isVerifying, setIsVerifying] = useState(false);

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
        if (getApiErrorCode(error) === "turnstile_required") {
          setShowChallenge(true);
        }
      }
    });
    return unsubscribe;
  }, [queryClient]);

  const onVerified = useCallback(() => {
    setShowChallenge(false);
    setIsVerifying(false);
    // Re-trigger /me-queryen slik at appen laster brukerdata på nytt
    void queryClient.invalidateQueries({ queryKey: AUTH_ME_QUERY_KEY });
  }, [queryClient]);

  // reset deklareres lenger ned (TDZ) — bruk ref for å holde deps ærlige.
  const resetRef = useRef<(() => void) | null>(null);

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
      resetRef.current?.();
    } finally {
      setIsVerifying(false);
    }
  }, [isVerifying, onVerified, t]);

  const { containerRef, reset } = useTurnstileScript({
    siteKey: AUTH_TURNSTILE_SITE_KEY,
    action: AUTH_TURNSTILE_ACTION,
    onSuccess: (token) => { void onTurnstileSuccess(token); },
    onError: () => {
      showToast.error(t("auth.humanCheck.title"), t("auth.humanCheck.widgetError"));
    },
    onExpired: () => resetRef.current?.(),
    enabled: showChallenge && TURNSTILE_ACTIVE,
  });

  useEffect(() => {
    resetRef.current = reset;
  }, [reset]);

  if (!showChallenge || !TURNSTILE_ACTIVE) return null;

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
          <div ref={containerRef} />
        </div>
      </div>
    </div>
  );
}
