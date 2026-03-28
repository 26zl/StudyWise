/*
 * Cookie banner – vises til bruker godtar eller avviser.
 * Innloggede brukere lagrer samtykke i databasen og cacher det i localStorage for å unngå reprompt.
 * Gjester lagrer fortsatt kun samtykke i minnet for aktiv side.
 * Les mer lenker til /personvern.
 */
"use client";

import { useState, useEffect, useId } from "react";
import Link from "next/link";
import { useCookieConsent } from "@/app/hooks/useCookieConsent";

export function CookieBanner() {
  const { consent, isReady, setConsent } = useCookieConsent();
  const [mounted, setMounted] = useState(false);
  const titleId = useId();

  useEffect(() => {
    setMounted(true);
  }, []);

  const handleAccept = () => void setConsent("accepted");
  const handleDecline = () => void setConsent("declined");

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
            Informasjon om bruk av informasjonskapsler
          </h2>
          <p className="text-sm text-slate-600 dark:text-slate-300">
          Vi bruker nødvendige cookies og driftsmonitorering for innlogging, sikkerhet og feilsporing (berettiget interesse, GDPR Art. 6(1)(f)). «Godta alle» aktiverer i tillegg valgfrie ytelsesmålinger basert på ditt samtykke (Art. 6(1)(a)).{" "}
          <Link
            href="/personvern"
            prefetch={false}
            className="underline text-slate-700 dark:text-slate-200 hover:text-slate-900 dark:hover:text-white focus:outline-none focus:ring-2 focus:ring-blue-500 rounded"
          >
            Les mer i personvernerklæringen
          </Link>
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3 shrink-0">
          <button
            type="button"
            onClick={handleDecline}
            className="px-4 py-2 text-sm font-medium text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white border border-slate-300 dark:border-slate-600 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
          >
            Kun nødvendige
          </button>
          <button
            type="button"
            onClick={handleAccept}
            className="px-4 py-2 text-sm font-medium text-white bg-slate-900 dark:bg-white dark:text-slate-900 rounded-lg hover:bg-slate-800 dark:hover:bg-slate-100 transition-colors"
          >
            Godta alle
          </button>
        </div>
      </div>
    </div>
  );
}
