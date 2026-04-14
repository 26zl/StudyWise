/*
 * Cookie banner – vises til bruker godtar eller avviser.
 * Innloggede brukere lagrer samtykke i databasen og cacher det i localStorage for å unngå reprompt.
 * Gjester lagrer samtykke i en cookie med 30 dagers levetid.
 * Les mer lenker til /personvern.
 */
"use client";

import { useId, useCallback, useState, useEffect } from "react";
import { usePathname } from "next/navigation";
import Link from "next/link";
import { useCookieConsent, type CookieConsentStatus } from "@/app/hooks/useCookieConsent";
import { useLanguage } from "@/app/i18n";
import { showToast } from "@/app/components/ui/Toaster";

export function CookieBanner() {
  const { t } = useLanguage();
  const { consent, isAuthenticated, isReady, isPending, setConsent } = useCookieConsent();
  const titleId = useId();
  const pathname = usePathname();

  // Sjekk gjeste-cookie i useEffect for å unngå hydration mismatch
  const [harGjesteCookie, setHarGjesteCookie] = useState(false);
  useEffect(() => {
    if (isAuthenticated) return;
    try {
      const match = document.cookie
        .split("; ")
        .find((c) => c.startsWith("studywise_guest_consent="));
      if (match) {
        const val = match.split("=")[1];
        if (val === "accepted" || val === "declined") {
          setHarGjesteCookie(true);
        }
      }
    } catch { /* cookie-lesing utilgjengelig */ }
  }, [isAuthenticated]);

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

  if (!isReady || consent !== null) return null;

  // Ikke vis banneret midt i innlogging/registrering. Nye brukere har ennå ikke
  // et lagret cookieConsent-valg, men å vise en fullskjerm-prompt oppå Clerk-UI
  // er forstyrrende. Banneret vises i stedet når de lander på dashboard/forsiden.
  if (pathname.startsWith("/auth/")) return null;

  // Gjeste-cookie oppdaget etter hydrering — ikke vis banneret
  if (harGjesteCookie) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 dark:bg-black/50 backdrop-blur-xs"
      style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="mx-4 w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl dark:bg-slate-900 dark:shadow-[0_8px_40px_rgba(0,0,0,0.4)] border border-slate-200 dark:border-slate-700"
      >
        <div className="space-y-3">
          <h2 id={titleId} className="text-base font-semibold text-slate-900 dark:text-white">
            {t("cookies.banner.title")}
          </h2>
          <p className="text-sm leading-relaxed text-slate-600 dark:text-slate-300">
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
        <div className="mt-5 flex gap-3">
          <button
            type="button"
            onClick={() => void handleChoice("declined")}
            disabled={isPending}
            className="flex-1 px-4 py-2.5 text-sm font-medium text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white border border-slate-300 dark:border-slate-600 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {t("cookies.banner.declineButton")}
          </button>
          <button
            type="button"
            onClick={() => void handleChoice("accepted")}
            disabled={isPending}
            className="flex-1 px-4 py-2.5 text-sm font-medium text-white bg-slate-900 dark:bg-white dark:text-slate-900 rounded-lg hover:bg-slate-800 dark:hover:bg-slate-100 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {t("cookies.banner.acceptButton")}
          </button>
        </div>
      </div>
    </div>
  );
}
