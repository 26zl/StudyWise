"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AUTH_TURNSTILE_ACTION } from "common/auth";
import { Loader2, ShieldCheck } from "lucide-react";
import { showToast } from "@/app/components/ui/Toaster";
import { verifyAuthTurnstile } from "@/app/auth/auth-turnstile-api";
import { useLanguage } from "@/app/i18n";
import { lagBrukervennligFeilmelding } from "@/app/lib/errorUtils";
import { useTurnstileScript } from "@/app/hooks/useTurnstileScript";
import { getTurnstileErrorHelp } from "@/app/auth/turnstileErrorHelp";

const AUTH_TURNSTILE_SITE_KEY =
  process.env.NEXT_PUBLIC_AUTH_TURNSTILE_SITE_KEY ?? "";

type AuthTurnstileInlineProps = {
  initialVerified: boolean;
  onVerified: () => void;
};

export function AuthTurnstileInline({
  initialVerified,
  onVerified,
}: AuthTurnstileInlineProps) {
  const { t } = useLanguage();
  const [isVerified, setIsVerified] = useState(initialVerified);
  const [isVerifying, setIsVerifying] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [errorCode, setErrorCode] = useState<string | null>(null);
  const [showErrorDetails, setShowErrorDetails] = useState(false);

  // Når Turnstile ikke er konfigurert, hopp over verifisering
  useEffect(() => {
    if (!isVerified && !AUTH_TURNSTILE_SITE_KEY) {
      onVerified();
    }
  }, [isVerified, onVerified]);

  // reset fra useTurnstileScript er stable (tom deps i hook-en), men deklareres
  // lenger ned — bruker ref for å unngå TDZ samtidig som vi holder deps ærlige.
  const resetRef = useRef<(() => void) | null>(null);

  const onTurnstileSuccess = useCallback(async (token: string) => {
    if (isVerified || isVerifying) {
      return;
    }

    setIsVerifying(true);
    setErrorMessage(null);
    setErrorCode(null);

    try {
      await verifyAuthTurnstile(token);
      setIsVerified(true);
      onVerified();
    } catch (error) {
      const message = lagBrukervennligFeilmelding(
        error instanceof Error ? error : null,
        { auth: true },
        t("errors.generic.default"),
        t,
      );
      setErrorMessage(message);
      showToast.error(t("auth.humanCheck.title"), message);
      resetRef.current?.();
    } finally {
      setIsVerifying(false);
    }
  }, [isVerified, isVerifying, onVerified, t]);

  const onTurnstileError = useCallback((code?: string) => {
    setErrorMessage(t("auth.humanCheck.widgetError"));
    setErrorCode(code ?? null);
  }, [t]);

  const onRetryClick = useCallback(() => {
    setErrorMessage(null);
    setErrorCode(null);
    setShowErrorDetails(false);
    resetRef.current?.();
  }, []);

  const { containerRef, reset } = useTurnstileScript({
    siteKey: AUTH_TURNSTILE_SITE_KEY,
    action: AUTH_TURNSTILE_ACTION,
    onSuccess: (token) => { void onTurnstileSuccess(token); },
    onError: onTurnstileError,
    onExpired: onTurnstileError,
    enabled: !isVerified && !!AUTH_TURNSTILE_SITE_KEY,
  });

  useEffect(() => {
    resetRef.current = reset;
  }, [reset]);

  if (isVerified || !AUTH_TURNSTILE_SITE_KEY) {
    return null;
  }

  return (
    <div className="relative z-10 rounded-3xl border border-slate-200 bg-white/95 p-6 shadow-lg dark:border-slate-700 dark:bg-slate-800/95">
      <div className="mb-4 flex items-start gap-4">
        <div className="rounded-2xl bg-blue-50 p-3 text-blue-700 dark:bg-blue-900/30 dark:text-blue-200">
          <ShieldCheck className="h-6 w-6" />
        </div>
        <div className="space-y-2">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
            {t("auth.humanCheck.eyebrow")}
          </p>
          <h2 className="text-base font-semibold text-slate-900 dark:text-white">
            {t("auth.humanCheck.title")}
          </h2>
          <p className="text-sm leading-6 text-slate-600 dark:text-slate-300">
            {t("auth.humanCheck.description")}
          </p>
        </div>
      </div>

      <div className="space-y-3">
        {/* Container er alltid mountet — Cloudflare-widgeten kan rendre en synlig
            checkbox hvis bruker er høyrisiko. Med interaction-only er den ofte
            usynlig, så vi viser en spinner-stripe under inntil verifiseringen
            er ferdig (eller en feil oppstår). */}
        <div ref={containerRef} className="flex justify-center" />

        {!errorMessage && (
          <div className="flex items-center justify-center gap-2 text-sm text-slate-500 dark:text-slate-300">
            <Loader2 className="h-4 w-4 animate-spin" />
            {t("auth.humanCheck.verifying")}
          </div>
        )}

        {errorMessage && (
          <div className="space-y-2">
            <p className="text-sm text-red-600 dark:text-red-400">
              {errorMessage}
            </p>
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={onRetryClick}
                className="text-sm font-medium text-blue-600 underline-offset-2 hover:underline dark:text-blue-400"
              >
                {t("auth.humanCheck.retry")}
              </button>
              {errorCode && (
                <button
                  type="button"
                  onClick={() => setShowErrorDetails((v) => !v)}
                  className="text-xs text-slate-500 underline-offset-2 hover:underline dark:text-slate-400"
                  aria-expanded={showErrorDetails}
                >
                  {showErrorDetails
                    ? t("auth.humanCheck.hideDetails")
                    : t("auth.humanCheck.showDetails")}
                </button>
              )}
            </div>
            {showErrorDetails && errorCode && (() => {
              const help = getTurnstileErrorHelp(errorCode);
              return (
                <div className="space-y-2 rounded-md bg-slate-100 px-3 py-2 text-xs text-slate-700 dark:bg-slate-900 dark:text-slate-300">
                  <p className="font-mono">
                    {t("auth.humanCheck.errorCodeLabel")}: {errorCode}
                  </p>
                  {help && (
                    <>
                      <p>
                        <span className="font-semibold">
                          {t("auth.humanCheck.causeLabel")}:
                        </span>{" "}
                        {t(help.causeKey as never)}
                      </p>
                      <p>
                        <span className="font-semibold">
                          {t("auth.humanCheck.solutionLabel")}:
                        </span>{" "}
                        {t(help.solutionKey as never)}
                      </p>
                    </>
                  )}
                </div>
              );
            })()}
          </div>
        )}
      </div>
    </div>
  );
}
