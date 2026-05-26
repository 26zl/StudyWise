/*
 * Segment-scoped error boundary for /dashboard/*.
 *
 * Fanger feil i dashboard-ruten før de bobler opp til app/error.tsx. Bevarer
 * layout (sidebar + header) slik at brukeren kan navigere videre uten full reload.
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

export default function DashboardError({ error, reset }: ErrorPageProps) {
  const { t } = useLanguage();
  const visibleErrorId = getReportableErrorId(error);

  useEffect(() => {
    rememberReportableErrorId(visibleErrorId);
  }, [visibleErrorId]);

  return (
    <div className="flex min-h-[60vh] items-center justify-center px-4 py-8">
      <div className="w-full max-w-md text-center text-slate-900 dark:text-slate-100">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-red-100 dark:bg-red-900/40">
          <AlertTriangle className="h-6 w-6 text-red-600 dark:text-red-300" />
        </div>
        <h2 className="mt-4 text-xl font-semibold">{t("errorPages.runtime.title")}</h2>
        <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">
          {t("errorPages.runtime.description")}
        </p>
        {visibleErrorId ? (
          <p className="mt-2 font-mono text-xs text-slate-500 dark:text-slate-400">
            {t("errorPages.runtime.errorId")}: {visibleErrorId}
          </p>
        ) : null}
        <div className="mt-6 flex flex-col items-center justify-center gap-2 sm:flex-row">
          <button
            type="button"
            onClick={() => reset()}
            className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-700 sm:w-auto"
          >
            <RefreshCcw className="h-4 w-4" />
            {t("errorPages.runtime.retry")}
          </button>
          <Link
            href="/kontakt"
            className="inline-flex w-full items-center justify-center gap-2 rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800 sm:w-auto"
          >
            <MessageCircle className="h-4 w-4" />
            {t("errorPages.runtime.contactSupport")}
          </Link>
        </div>
      </div>
    </div>
  );
}
