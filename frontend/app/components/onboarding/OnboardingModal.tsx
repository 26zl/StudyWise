/*
 * OnboardingModal - Velkomstguide for nye brukere
 * Vises automatisk ved første gang brukeren åpner dashboardet.
 * Tilstanden lagres på kontoen via uiPreferences.hasSeenOnboarding.
 */
"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  MessageSquare,
  BookOpen,
  CalendarDays,
  Brain,
  Bell,
  Settings,
  ChevronRight,
  ChevronLeft,
  X,
  Sparkles,
} from "lucide-react";
import { useLanguage } from "@/app/i18n";
import type { MessageKey, Translator } from "@/app/i18n/types";

interface OnboardingSteg {
  ikon: React.ReactNode;
  ikonLiten: React.ReactNode;
  tittelKey: MessageKey;
  beskrivKey: MessageKey;
  fargeklasse: string;
}

const STEG: OnboardingSteg[] = [
  {
    ikon: <MessageSquare className="h-8 w-8" />,
    ikonLiten: <MessageSquare className="h-5 w-5" />,
    tittelKey: "onboarding.steps.chat",
    beskrivKey: "onboarding.steps.chatDescription",
    fargeklasse: "bg-blue-100 text-blue-600 dark:bg-blue-900/40 dark:text-blue-400",
  },
  {
    ikon: <BookOpen className="h-8 w-8" />,
    ikonLiten: <BookOpen className="h-5 w-5" />,
    tittelKey: "onboarding.steps.canvas",
    beskrivKey: "onboarding.steps.canvasDescription",
    fargeklasse: "bg-emerald-100 text-emerald-600 dark:bg-emerald-900/40 dark:text-emerald-400",
  },
  {
    ikon: <CalendarDays className="h-8 w-8" />,
    ikonLiten: <CalendarDays className="h-5 w-5" />,
    tittelKey: "onboarding.steps.calendar",
    beskrivKey: "onboarding.steps.calendarDescription",
    fargeklasse: "bg-purple-100 text-purple-600 dark:bg-purple-900/40 dark:text-purple-400",
  },
  {
    ikon: <Brain className="h-8 w-8" />,
    ikonLiten: <Brain className="h-5 w-5" />,
    tittelKey: "onboarding.steps.quiz",
    beskrivKey: "onboarding.steps.quizDescription",
    fargeklasse: "bg-amber-100 text-amber-600 dark:bg-amber-900/40 dark:text-amber-400",
  },
  {
    ikon: <Bell className="h-8 w-8" />,
    ikonLiten: <Bell className="h-5 w-5" />,
    tittelKey: "onboarding.steps.notifications",
    beskrivKey: "onboarding.steps.notificationsDescription",
    fargeklasse: "bg-red-100 text-red-600 dark:bg-red-900/40 dark:text-red-400",
  },
  {
    ikon: <Settings className="h-8 w-8" />,
    ikonLiten: <Settings className="h-5 w-5" />,
    tittelKey: "onboarding.steps.settings",
    beskrivKey: "onboarding.steps.settingsDescription",
    fargeklasse: "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400",
  },
];

interface OnboardingModalProps {
  onLukk: () => void;
}

export function OnboardingModal({ onLukk }: OnboardingModalProps) {
  // Velkomst-side (-1) + funksjonsteg (0..STEG.length-1)
  const [aktivtSteg, settAktivtSteg] = useState(-1);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const { t } = useLanguage();

  // Åpne dialog ved mount
  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog && !dialog.open) {
      dialog.showModal();
    }
  }, []);

  // Steng ved Escape
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    const handleCancel = (e: Event) => {
      e.preventDefault();
      lukkModal();
    };
    dialog.addEventListener("cancel", handleCancel);
    return () => dialog.removeEventListener("cancel", handleCancel);
  });

  const lukkModal = useCallback(() => {
    dialogRef.current?.close();
    onLukk();
  }, [onLukk]);

  const neste = useCallback(() => {
    if (aktivtSteg < STEG.length - 1) {
      settAktivtSteg((s) => s + 1);
    } else {
      lukkModal();
    }
  }, [aktivtSteg, lukkModal]);

  const forrige = useCallback(() => {
    settAktivtSteg((s) => Math.max(-1, s - 1));
  }, []);

  const erVelkomst = aktivtSteg === -1;
  const erSistSteg = aktivtSteg === STEG.length - 1;
  const steg = erVelkomst ? null : STEG[aktivtSteg];

  return (
    <dialog
      ref={dialogRef}
      className="fixed inset-0 z-50 m-auto w-[calc(100%-2rem)] max-w-lg rounded-2xl border border-gray-200 bg-white p-0 shadow-2xl backdrop:bg-black/50 dark:border-gray-700 dark:bg-gray-900"
      aria-label={t("onboarding.welcome")}
    >
      <div className="relative flex flex-col">
        {/* Lukk-knapp */}
        <button
          type="button"
          onClick={lukkModal}
          className="absolute right-3 top-3 rounded-lg p-1.5 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-gray-800 dark:hover:text-gray-300"
          aria-label={t("common.actions.close")}
        >
          <X className="h-5 w-5" />
        </button>

        {/* Innhold */}
        <div className="px-6 pt-8 pb-6">
          {erVelkomst ? (
            <VelkomstSide t={t} />
          ) : (
            steg && <StegSide steg={steg} t={t} />
          )}
        </div>

        {/* Steg-indikator og navigasjon */}
        <div className="flex items-center justify-between border-t border-gray-200 px-6 py-4 dark:border-gray-700">
          <div className="flex items-center gap-1.5">
            {!erVelkomst && (
              <span className="text-xs text-gray-500 dark:text-gray-400">
                {t("onboarding.stepOf", {
                  current: aktivtSteg + 1,
                  total: STEG.length,
                })}
              </span>
            )}
          </div>

          <div className="flex items-center gap-2">
            {!erVelkomst && (
              <button
                type="button"
                onClick={forrige}
                className="flex items-center gap-1 rounded-lg px-3 py-2 text-sm font-medium text-gray-600 transition-colors hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-800"
              >
                <ChevronLeft className="h-4 w-4" />
                {t("onboarding.previous")}
              </button>
            )}

            {erVelkomst && (
              <button
                type="button"
                onClick={lukkModal}
                className="rounded-lg px-3 py-2 text-sm font-medium text-gray-500 transition-colors hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-800"
              >
                {t("onboarding.skip")}
              </button>
            )}

            <button
              type="button"
              onClick={neste}
              className="flex items-center gap-1 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-700 dark:bg-blue-500 dark:hover:bg-blue-600"
            >
              {erVelkomst
                ? t("common.actions.start")
                : erSistSteg
                  ? t("onboarding.getStarted")
                  : t("onboarding.next")}
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* Steg-prikker */}
        {!erVelkomst && (
          <div className="flex justify-center gap-1.5 pb-4">
            {STEG.map((_, i) => (
              <button
                key={i}
                type="button"
                onClick={() => settAktivtSteg(i)}
                className={`h-2 rounded-full transition-all ${
                  i === aktivtSteg
                    ? "w-6 bg-blue-600 dark:bg-blue-400"
                    : "w-2 bg-gray-300 hover:bg-gray-400 dark:bg-gray-600 dark:hover:bg-gray-500"
                }`}
                aria-label={`${t("onboarding.stepOf", { current: i + 1, total: STEG.length })}`}
              />
            ))}
          </div>
        )}
      </div>
    </dialog>
  );
}

// Velkomst-innhold (første side)
function VelkomstSide({ t }: { t: Translator }) {
  return (
    <div className="flex flex-col items-center text-center">
      <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-linear-to-br from-blue-500 to-purple-600 text-white shadow-lg">
        <Sparkles className="h-8 w-8" />
      </div>
      <h2 className="mb-2 text-2xl font-bold text-gray-900 dark:text-white">
        {t("onboarding.welcome")}
      </h2>
      <p className="max-w-sm text-gray-600 dark:text-gray-400">
        {t("onboarding.welcomeDescription")}
      </p>

      {/* Forhåndsvisning av funksjoner */}
      <div className="mt-6 grid w-full grid-cols-3 gap-3">
        {STEG.map((s, i) => (
          <div
            key={i}
            className="flex flex-col items-center gap-1.5 rounded-xl border border-gray-100 p-3 dark:border-gray-800"
          >
            <div className={`flex h-10 w-10 items-center justify-center rounded-xl ${s.fargeklasse}`}>
              {s.ikonLiten}
            </div>
            <span className="text-xs font-medium text-gray-700 dark:text-gray-300">
              {t(s.tittelKey)}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

// Steg-innhold (enkelt steg)
function StegSide({
  steg,
  t,
}: {
  steg: OnboardingSteg;
  t: Translator;
}) {
  return (
    <div className="flex flex-col items-center text-center">
      <div className={`mb-5 flex h-16 w-16 items-center justify-center rounded-2xl ${steg.fargeklasse}`}>
        {steg.ikon}
      </div>
      <h3 className="mb-2 text-xl font-bold text-gray-900 dark:text-white">
        {t(steg.tittelKey)}
      </h3>
      <p className="max-w-sm text-gray-600 dark:text-gray-400">
        {t(steg.beskrivKey)}
      </p>
    </div>
  );
}
