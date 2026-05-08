/**
 * CanvasContextSelector – velger hvilke Canvas-data (nyheter, emner, oppgaver, hendelser) som skal inngå i KI-kontekst.
 * Synkroniserer valg med backend (preferanser) og bruker enkel av/på-logikk per kategori.
 */
"use client";

import { useEffect, useRef } from "react";
import { AlertTriangle, Check } from "lucide-react";
import { LoadingSpinner } from "@/app/components/ui/Loading";
import { useUIStore, type CanvasContextSelection } from "@/app/store/uiStore";
import { useMeg, useDebouncedPreferanseOppdater } from "@/app/auth/auth-api";
import { useLanguage } from "@/app/i18n";

export function CanvasContextSelector() {
  const { t } = useLanguage();
  // Bruk global state for valg så de bevares mellom view-bytter
  const selected = useUIStore((state) => state.canvasContextSelection);
  const setSelected = useUIStore((state) => state.setCanvasContextSelection);

  // Hent brukerdata og sync preferanser fra backend (debounced for å unngå mange PUT ved rask bruk)
  const { data: megData } = useMeg();
  const {
    mutate: oppdaterBackendDebounced,
    isPending: oppdatererPreferanser,
    flush: flushPreferanser,
  } = useDebouncedPreferanseOppdater();
  const initializedRef = useRef(false);

  // Synkroniser fra backend ved første load
  useEffect(() => {
    if (megData?.user?.canvasContextPreferences && !initializedRef.current) {
      setSelected(megData.user.canvasContextPreferences);
      initializedRef.current = true;
    }
  }, [megData?.user?.canvasContextPreferences, setSelected]);

  useEffect(() => {
    const handlePageHide = () => {
      flushPreferanser();
    };
    const handleVisibilityChange = () => {
      if (document.visibilityState === "hidden") {
        flushPreferanser();
      }
    };

    window.addEventListener("pagehide", handlePageHide);
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener("pagehide", handlePageHide);
      flushPreferanser();
    };
  }, [flushPreferanser]);

  const isLoading = oppdatererPreferanser;

  const toggleOption = (key: keyof CanvasContextSelection) => {
    if (oppdatererPreferanser) return;

    const newSelection = { ...selected, [key]: !selected[key] };
    setSelected(newSelection);
    oppdaterBackendDebounced(newSelection);
  };

  // Hjelpetekst når alt er av
  const allOff =
    !selected.announcements && !selected.courses && !selected.assignments && !selected.events;

  const options = [
    {
      key: "announcements" as const,
      label: t("settings.canvasContext.selector.options.announcements.label"),
      description: t("settings.canvasContext.selector.options.announcements.description"),
    },
    {
      key: "courses" as const,
      label: t("settings.canvasContext.selector.options.courses.label"),
      description: t("settings.canvasContext.selector.options.courses.description"),
    },
    {
      key: "assignments" as const,
      label: t("settings.canvasContext.selector.options.assignments.label"),
      description: t("settings.canvasContext.selector.options.assignments.description"),
    },
    {
      key: "events" as const,
      label: t("settings.canvasContext.selector.options.events.label"),
      description: t("settings.canvasContext.selector.options.events.description"),
    },
  ];

  return (
    <div className="rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/50">
      <div className="flex items-center justify-between p-3 sm:p-4 border-b border-slate-200 dark:border-slate-700">
        <h4 className="text-sm font-semibold text-slate-900 dark:text-white">
          {t("settings.canvasContext.selector.title")}
        </h4>
        {isLoading && (
          <LoadingSpinner className="w-4 h-4 text-blue-600 dark:text-blue-400 animate-spin" />
        )}
      </div>
      <div className="mx-3 sm:mx-4 mt-3 flex items-start gap-2 rounded border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-800 dark:bg-amber-900/20 dark:text-amber-200">
        <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        <p>{t("settings.canvasContext.selector.notice")}</p>
      </div>
      {allOff && (
        <div className="mx-3 sm:mx-4 mt-3 text-xs text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 px-3 py-2 rounded">
          {t("settings.canvasContext.selector.emptySelection")}
        </div>
      )}
      <div className="p-3 sm:p-4 grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-2 sm:gap-3">
        {options.map((option) => (
          <button
            key={option.key}
            type="button"
            onClick={() => toggleOption(option.key)}
            disabled={oppdatererPreferanser}
            className={`flex flex-col items-start gap-1.5 p-3 rounded-lg border transition-colors ${
              selected[option.key]
                ? "border-blue-500 bg-blue-50 dark:bg-blue-900/20"
                : "border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800"
            } hover:border-blue-400 active:bg-blue-100 dark:active:bg-blue-900/30 cursor-pointer disabled:opacity-60 disabled:cursor-wait`}
          >
            <div className="flex items-center gap-2 w-full">
              <div
                className={`w-5 h-5 rounded border-2 flex items-center justify-center shrink-0 ${
                  selected[option.key]
                    ? "border-blue-500 bg-blue-500"
                    : "border-slate-300 dark:border-slate-600"
                }`}
              >
                {selected[option.key] && <Check className="w-3 h-3 text-white" />}
              </div>
              <div className="text-left flex-1 min-w-0">
                <span className="text-sm font-medium text-slate-900 dark:text-white truncate block">
                  {option.label}
                </span>
              </div>
            </div>
            <p className="text-xs text-slate-500 dark:text-slate-400 truncate w-full">
              {option.description}
            </p>
          </button>
        ))}
      </div>
    </div>
  );
}
