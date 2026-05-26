/**
 * TermsReacceptModal — vises når brukeren har godtatt en eldre versjon av
 * vilkår/personvern enn det som er publisert nå. Modalen blokkerer bruk av
 * tjenesten inntil brukeren bekrefter ny aksept.
 *
 * Juridisk formål: sikre at brukeren får eksplisitt anledning til å lese nye
 * vilkår før de fortsetter å bruke tjenesten. Aksepten audit-logges med
 * versjon, tidsstempel og IP som bevis.
 */
"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Loader2, ShieldAlert } from "lucide-react";
import { useAuth } from "@clerk/nextjs";
import { useLanguage } from "@/app/i18n";
import { useMeg, useLoggUtWithRedirect } from "@/app/auth/auth-api";
import { fetchApi } from "@/app/lib/apiClient";
import { useDialogAccessibility } from "@/app/hooks/useDialogAccessibility";
import { showToast } from "@/app/components/ui/Toaster";
import { TERMS_VERSION } from "common/system";

export function TermsReacceptModal() {
  const { isLoaded, userId } = useAuth();
  const { t } = useLanguage();
  const megQuery = useMeg({ enabled: isLoaded && !!userId });
  const handleLoggUt = useLoggUtWithRedirect();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const dialogRef = useRef<HTMLDivElement>(null);
  const acceptButtonRef = useRef<HTMLButtonElement>(null);

  const acceptedVersion = megQuery.data?.user?.termsVersionAccepted;
  // Vis modal hvis bruker er innlogget, vi har lastet /me, OG bruker enten
  // ikke har akseptert noe versjon enda (legacy-kontoer fra før vi begynte å
  // logge dette) eller har en eldre versjon enn gjeldende.
  const mustReaccept =
    isLoaded && !!userId && megQuery.data?.user !== undefined && acceptedVersion !== TERMS_VERSION;

  useDialogAccessibility({
    open: mustReaccept,
    containerRef: dialogRef,
    initialFocusRef: acceptButtonRef,
    // Escape er bevisst no-op: brukeren må eksplisitt godta eller logge ut.
    onClose: () => {
      /* no-op */
    },
  });

  // Lås body-scroll mens modalen er åpen
  useEffect(() => {
    if (!mustReaccept) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, [mustReaccept]);

  if (!mustReaccept) return null;

  const handleAccept = async () => {
    setPending(true);
    setError(null);
    try {
      const res = await fetchApi("/api/user/accept-terms", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ version: TERMS_VERSION }),
      });
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }
      // Refetch /me slik at acceptedVersion blir oppdatert → modalen lukker seg.
      await megQuery.refetch();
      showToast.success(t("termsReaccept.success"));
    } catch {
      setError(t("termsReaccept.error"));
      setPending(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-60 flex items-center justify-center bg-black/40 px-4 dark:bg-black/60"
      style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="terms-reaccept-title"
        tabIndex={-1}
        className="w-full max-w-lg rounded-2xl border border-slate-200 bg-white p-6 shadow-2xl dark:border-slate-700 dark:bg-slate-900"
      >
        <div className="mb-4 flex items-start gap-3">
          <div className="rounded-lg bg-amber-100 p-2 dark:bg-amber-900/30">
            <ShieldAlert className="h-5 w-5 text-amber-600 dark:text-amber-400" />
          </div>
          <div>
            <h2
              id="terms-reaccept-title"
              className="text-lg font-semibold text-slate-900 dark:text-white"
            >
              {t("termsReaccept.title")}
            </h2>
            <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
              {t("termsReaccept.description")}
            </p>
          </div>
        </div>

        <div className="mb-5 rounded-lg border border-slate-200 bg-slate-50 p-4 text-sm dark:border-slate-700 dark:bg-slate-800/50">
          <p className="mb-2 text-slate-700 dark:text-slate-300">
            {t("termsReaccept.reviewPrompt")}
          </p>
          <div className="flex flex-wrap gap-3">
            <Link
              href="/vilkar"
              target="_blank"
              rel="noopener"
              prefetch={false}
              className="inline-flex items-center gap-1 text-sm font-medium text-blue-600 underline hover:text-blue-700 dark:text-blue-400"
            >
              {t("termsReaccept.termsLink")}
            </Link>
            <Link
              href="/personvern"
              target="_blank"
              rel="noopener"
              prefetch={false}
              className="inline-flex items-center gap-1 text-sm font-medium text-blue-600 underline hover:text-blue-700 dark:text-blue-400"
            >
              {t("termsReaccept.privacyLink")}
            </Link>
          </div>
          <p className="mt-3 text-xs text-slate-500 dark:text-slate-400">
            {t("termsReaccept.versionLabel", { version: TERMS_VERSION })}
          </p>
        </div>

        {error && (
          <p className="mb-3 text-sm text-red-600 dark:text-red-400" role="alert">
            {error}
          </p>
        )}

        <div className="flex flex-col-reverse items-stretch justify-between gap-2 sm:flex-row sm:items-center">
          {/* Sekundær utvei for bruker som ikke vil godta — likeverdig synlig
              for å unngå dark-pattern (GDPR / Datatilsynets veileder). */}
          <button
            type="button"
            onClick={() => void handleLoggUt()}
            disabled={pending}
            className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
          >
            {t("termsReaccept.logoutButton")}
          </button>
          <button
            ref={acceptButtonRef}
            type="button"
            onClick={() => void handleAccept()}
            disabled={pending}
            className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-blue-500 dark:hover:bg-blue-600"
          >
            {pending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            {pending ? t("termsReaccept.accepting") : t("termsReaccept.acceptButton")}
          </button>
        </div>
      </div>
    </div>
  );
}
