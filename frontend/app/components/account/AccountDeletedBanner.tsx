"use client";

/**
 * Banner som vises på forsiden etter at brukeren har slettet kontoen sin.
 * Leser et engangs-flagg fra sessionStorage som AccountPage skriver rett
 * før den redirecter til "/", og fjerner flagget umiddelbart etter.
 *
 * Hvis brukeren hadde en lagret Canvas-tilgangsnøkkel inkluderer banneret
 * en eksplisitt påminnelse om at den må slettes manuelt i Canvas-innstillingene
 * — StudyWise rører IKKE Canvas selv.
 */
import { useEffect, useRef, useState } from "react";
import { CheckCircle2, ShieldAlert, X } from "lucide-react";
import { useLanguage } from "@/app/i18n";

const STORAGE_KEY = "studywise:account-deleted";

type FlagState = {
  partial: boolean;
  hadCanvasToken: boolean;
};

function lesOgFjernFlagg(): FlagState | null {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    sessionStorage.removeItem(STORAGE_KEY);
    const parsed = JSON.parse(raw) as Partial<FlagState>;
    return {
      partial: !!parsed.partial,
      hadCanvasToken: !!parsed.hadCanvasToken,
    };
  } catch {
    return null;
  }
}

export function AccountDeletedBanner() {
  const { t } = useLanguage();
  const [state, setState] = useState<FlagState | null>(null);
  // Strict Mode i dev kjører effekten to ganger; uten denne ref-gaten ville
  // andre kjøring lest et tomt sessionStorage (etter at første kjøring
  // fjernet nøkkelen) og resette state tilbake til null før banneret rakk
  // å vises.
  const harLestRef = useRef(false);

  useEffect(() => {
    if (harLestRef.current) return;
    harLestRef.current = true;
    setState(lesOgFjernFlagg());
  }, []);

  if (!state) return null;

  const tittel = state.partial
    ? t("landing.accountDeleted.partialTitle")
    : t("landing.accountDeleted.successTitle");
  const beskrivelse = state.partial
    ? t("landing.accountDeleted.partialDescription")
    : t("landing.accountDeleted.successDescription");

  return (
    <div className="px-4 pt-6 sm:px-6 lg:px-8" role="status" aria-live="polite">
      <div className="mx-auto flex max-w-3xl items-start gap-3 rounded-2xl border border-emerald-200 bg-emerald-50/80 p-4 shadow-sm dark:border-emerald-900 dark:bg-emerald-950/30">
        <CheckCircle2
          className="mt-0.5 h-5 w-5 shrink-0 text-emerald-600 dark:text-emerald-300"
          aria-hidden="true"
        />
        <div className="min-w-0 flex-1 space-y-2">
          <p className="text-sm font-semibold text-emerald-900 dark:text-emerald-100">
            {tittel}
          </p>
          <p className="text-sm leading-6 text-emerald-800/90 dark:text-emerald-200/90">
            {beskrivelse}
          </p>
          {state.hadCanvasToken ? (
            <div className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3 dark:border-amber-900 dark:bg-amber-950/40">
              <ShieldAlert
                className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-300"
                aria-hidden="true"
              />
              <div className="space-y-1">
                <p className="text-sm font-medium text-amber-900 dark:text-amber-100">
                  {t("landing.accountDeleted.canvasReminderTitle")}
                </p>
                <p className="text-sm leading-6 text-amber-800/90 dark:text-amber-200/90">
                  {t("landing.accountDeleted.canvasReminderBody")}
                </p>
              </div>
            </div>
          ) : null}
        </div>
        <button
          type="button"
          onClick={() => setState(null)}
          className="rounded-lg p-1.5 text-emerald-700 transition hover:bg-emerald-100 dark:text-emerald-200 dark:hover:bg-emerald-900/40"
          aria-label={t("landing.accountDeleted.dismiss")}
        >
          <X className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}
