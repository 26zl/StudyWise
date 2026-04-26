"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AUTH_TURNSTILE_ACTION } from "common/auth";
import { Loader2, ShieldCheck } from "lucide-react";
import { showToast } from "@/app/components/ui/Toaster";
import { verifyAuthTurnstile } from "@/app/auth/auth-turnstile-api";
import { useLanguage } from "@/app/i18n";
import { lagBrukervennligFeilmelding } from "@/app/lib/errorUtils";
import { useTurnstileScript } from "@/app/hooks/useTurnstileScript";
import { turnstileEnabled } from "@/app/lib/validateEnv";

const AUTH_TURNSTILE_SITE_KEY =
  process.env.NEXT_PUBLIC_AUTH_TURNSTILE_SITE_KEY ?? "";

// Effektivt aktiveringsflagg: krever både master-flagg OG sitekey
const TURNSTILE_ACTIVE = turnstileEnabled && !!AUTH_TURNSTILE_SITE_KEY;

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

  // Når Turnstile er deaktivert eller ikke konfigurert, hopp rett over til verifisert
  useEffect(() => {
    if (!isVerified && !TURNSTILE_ACTIVE) {
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

  const onTurnstileError = useCallback(() => {
    setErrorMessage(t("auth.humanCheck.widgetError"));
  }, [t]);

  const { containerRef, isLoaded, reset } = useTurnstileScript({
    siteKey: AUTH_TURNSTILE_SITE_KEY,
    action: AUTH_TURNSTILE_ACTION,
    onSuccess: (token) => { void onTurnstileSuccess(token); },
    onError: onTurnstileError,
    onExpired: onTurnstileError,
    enabled: !isVerified && TURNSTILE_ACTIVE,
  });

  useEffect(() => {
    resetRef.current = reset;
  }, [reset]);

  if (isVerified || !TURNSTILE_ACTIVE) {
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
        <div className="relative flex justify-center">
          <div
            ref={containerRef}
            className={isLoaded ? undefined : "opacity-0"}
          />
          {!isLoaded && (
            <div className="absolute inset-0 flex h-16.25 w-75 items-center justify-center rounded-xl border border-slate-200 bg-slate-50 dark:border-slate-700 dark:bg-slate-900">
              <Loader2 className="h-5 w-5 animate-spin text-slate-400" />
            </div>
          )}
        </div>

        {isVerifying && (
          <div className="flex items-center justify-center gap-2 text-sm text-slate-500 dark:text-slate-300">
            <Loader2 className="h-4 w-4 animate-spin" />
            {t("auth.humanCheck.verifying")}
          </div>
        )}

        {errorMessage && (
          <p className="text-sm text-red-600 dark:text-red-400">
            {errorMessage}
          </p>
        )}
      </div>
    </div>
  );
}
