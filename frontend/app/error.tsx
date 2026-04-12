/*
 * Global error boundary for ufangede klient-feil i Next.js App Router.
 * MÅ være en klient-komponent og MÅ ta imot { error, reset } props.
 * Vises automatisk når en underliggende route eller komponent kaster.
 */
"use client";

import { useEffect } from "react";
import Link from "next/link";
import { AlertTriangle, RefreshCcw, MessageCircle } from "lucide-react";
import { useLanguage } from "@/app/i18n";
import { getReportableErrorId } from "@/app/lib/errorUtils";
import { rememberReportableErrorId } from "@/app/lib/apiClient";

interface ErrorPageProps {
  error: Error & { digest?: string };
  reset: () => void;
}

// Next.js logger feilen automatisk server-side via error.digest, og Datadog RUM
// fanger ufangede klient-feil via React-pluginen. Vi unngår console.error her
// for å ikke risikere å lekke PII fra error.message i nettleserens devtools.
export default function GlobalError({ error, reset }: ErrorPageProps) {
  const { t } = useLanguage();

  // Vis kun ID som faktisk tilhører feilen som rendres nå.
  // `digest` dekker render-/server-feil der ingen requestId finnes.
  const visibleErrorId = getReportableErrorId(error);

  // Lagre feil-ID i sessionStorage.
  // Vi bruker sessionStorage (ikke URL-query) til å gi feil-ID-en videre til
  // /kontakt — slik unngår vi at PostHog/andre pageview-loggere fanger
  // request-ID-en som en del av den synlige nettleseradressen.
  useEffect(() => {
    rememberReportableErrorId(visibleErrorId);
  }, [visibleErrorId]);

  return (
    <main className="flex min-h-screen items-center justify-center px-4 py-12 text-slate-900 dark:text-slate-100">
      <div className="w-full max-w-md text-center">
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-red-100 dark:bg-red-900/40">
          <AlertTriangle className="h-7 w-7 text-red-600 dark:text-red-300" />
        </div>
        <p className="mt-5 text-sm font-semibold uppercase tracking-wider text-red-600 dark:text-red-400">
          {t("errorPages.runtime.eyebrow")}
        </p>
        <h1 className="mt-2 text-3xl font-bold sm:text-4xl">{t("errorPages.runtime.title")}</h1>
        <p className="mt-4 text-base leading-7 text-slate-600 dark:text-slate-300">
          {t("errorPages.runtime.description")}
        </p>
        {visibleErrorId ? (
          <p className="mt-3 font-mono text-xs text-slate-500 dark:text-slate-400">
            {t("errorPages.runtime.errorId")}: {visibleErrorId}
          </p>
        ) : null}
        <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
          <button
            type="button"
            onClick={() => reset()}
            className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-blue-600 px-5 py-2.5 text-sm font-medium text-white transition-colors hover:bg-blue-700 sm:w-auto"
          >
            <RefreshCcw className="h-4 w-4" />
            {t("errorPages.runtime.retry")}
          </button>
          <Link
            href="/kontakt"
            className="inline-flex w-full items-center justify-center gap-2 rounded-lg border border-slate-200 bg-white px-5 py-2.5 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800 sm:w-auto"
          >
            <MessageCircle className="h-4 w-4" />
            {t("errorPages.runtime.contactSupport")}
          </Link>
        </div>
      </div>
    </main>
  );
}
