/*
 * Cookie banner – vises til bruker godtar eller avviser.
 * Innloggede brukere lagrer samtykke i databasen og cacher det i localStorage for å unngå reprompt.
 * Gjester lagrer fortsatt kun samtykke i minnet for aktiv side.
 * Les mer lenker til /personvern.
 */
"use client";

import { useState, useEffect, useId, useCallback } from "react";
import Link from "next/link";
import { useCookieConsent, type CookieConsentStatus } from "@/app/hooks/useCookieConsent";
import { useLanguage } from "@/app/i18n";
import { showToast } from "@/app/components/ui/Toaster";

export function CookieBanner() {
  const { t } = useLanguage();
  const { consent, isReady, isPending, setConsent } = useCookieConsent();
  const [mounted, setMounted] = useState(false);
  const titleId = useId();

  useEffect(() => {
    setMounted(true);
  }, []);

  const handleChoice = useCallback(
    async (choice: Exclude<CookieConsentStatus, null>) => {
      try {
        await setConsent(choice);
      } catch {
        showToast.error(
          t("cookies.banner.errorTitle"),
          t("cookies.banner.errorDescription"),
        );
      }
    },
    [setConsent, t],
  );

  if (!mounted || !isReady || consent !== null) return null;

  return (
    <div
      role="region"
      aria-labelledby={titleId}
      className="fixed bottom-0 left-0 right-0 z-50 p-4 md:p-5 bg-white dark:bg-slate-900 border-t border-slate-200 dark:border-slate-700 shadow-[0_-4px_20px_rgba(0,0,0,0.08)] dark:shadow-[0_-4px_20px_rgba(0,0,0,0.3)]"
    >
      <div className="max-w-4xl mx-auto flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div className="space-y-2">
          <h2 id={titleId} className="text-sm font-semibold text-slate-900 dark:text-white">
            {t("cookies.banner.title")}
          </h2>
          <p className="text-sm text-slate-600 dark:text-slate-300">
          {t("cookies.banner.description")}{" "}
          <Link
            href="/personvern"
            prefetch={false}
            className="underline text-slate-700 dark:text-slate-200 hover:text-slate-900 dark:hover:text-white focus:outline-none focus:ring-2 focus:ring-blue-500 rounded"
          >
            {t("cookies.banner.learnMore")}
          </Link>
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3 shrink-0">
          <button
            type="button"
            onClick={() => void handleChoice("declined")}
            disabled={isPending}
            className="px-4 py-2.5 text-sm font-medium text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white border border-slate-300 dark:border-slate-600 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {t("cookies.banner.declineButton")}
          </button>
          <button
            type="button"
            onClick={() => void handleChoice("accepted")}
            disabled={isPending}
            className="px-4 py-2.5 text-sm font-medium text-white bg-slate-900 dark:bg-white dark:text-slate-900 rounded-lg hover:bg-slate-800 dark:hover:bg-slate-100 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {t("cookies.banner.acceptButton")}
          </button>
        </div>
      </div>
    </div>
  );
}
