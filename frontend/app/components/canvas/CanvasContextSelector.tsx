/**
 * CanvasContextSelector – velger hvilke Canvas-data (nyheter, emner, oppgaver, hendelser) som skal inngå i KI-kontekst.
 * Synkroniserer valg med backend (preferanser) og viser antall per kategori.
 */
"use client";

import { useEffect, useRef } from "react";
import { Check } from "lucide-react";
import { LoadingSpinner } from "@/app/components/ui/Loading";
import {
  useCanvasAnnouncements,
  useCanvasCourses,
  useCanvasTodo,
  useCanvasUpcomingEvents,
} from "@/app/canvas/canvas-api";
import { useUIStore, type CanvasContextSelection } from "@/app/store/uiStore";
import { useMeg, useDebouncedPreferanseOppdater } from "@/app/auth/auth-api";

export function CanvasContextSelector() {
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

  const { data: announcementsData, isLoading: loadingAnnouncements } = useCanvasAnnouncements();
  const { data: coursesData, isLoading: loadingCourses } = useCanvasCourses();
  const { data: todoData, isLoading: loadingTodo } = useCanvasTodo(selected.assignments);
  const { data: eventsData, isLoading: loadingEvents } = useCanvasUpcomingEvents(selected.events);

  const isLoading =
    loadingAnnouncements ||
    loadingCourses ||
    loadingTodo ||
    loadingEvents ||
    oppdatererPreferanser;

  const toggleOption = (key: keyof CanvasContextSelection) => {
    if (oppdatererPreferanser) return;

    const newSelection = { ...selected, [key]: !selected[key] };
    setSelected(newSelection);
    oppdaterBackendDebounced(newSelection);
  };

  // Hjelpetekst når alt er av
  const allOff = !selected.announcements && !selected.courses && !selected.assignments && !selected.events;

  const options = [
    {
      key: "announcements" as const,
      label: "Nyheter",
      count: announcementsData?.announcements?.length || 0,
      description: "Kunngjøringer fra forelesere",
      loading: loadingAnnouncements,
    },
    {
      key: "courses" as const,
      label: "Emner",
      count: coursesData?.courses?.length || 0,
      description: "Dine aktive emner",
      loading: loadingCourses,
    },
    {
      key: "assignments" as const,
      label: "Oppgaver",
      count: todoData?.todos?.length || 0,
      description: "Frister og innleveringer",
      loading: loadingTodo,
    },
    {
      key: "events" as const,
      label: "Hendelser",
      count: eventsData?.events?.length || 0,
      description: "Kalender og møter",
      loading: loadingEvents,
    },
  ];

  return (
    <div className="rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/50">
      <div className="flex items-center justify-between p-3 sm:p-4 border-b border-slate-200 dark:border-slate-700">
        <h4 className="text-sm font-semibold text-slate-900 dark:text-white">
          Gi AI tilgang til:
        </h4>
        {isLoading && (
          <LoadingSpinner className="w-4 h-4 text-blue-600 dark:text-blue-400 animate-spin" />
        )}
      </div>
      {allOff && (
        <div className="mx-3 sm:mx-4 mt-3 text-xs text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 px-3 py-2 rounded">
          Ingen data valgt. AI kan ikke svare på Canvas-spørsmål før du velger minst ett datasett.
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
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-slate-900 dark:text-white truncate">
                    {option.label}
                  </span>
                  {option.loading ? (
                    <LoadingSpinner className="w-3 h-3 text-blue-600 dark:text-blue-400 animate-spin" />
                  ) : (
                    <span className="text-xs text-slate-500 dark:text-slate-400">
                      ({option.count})
                    </span>
                  )}
                </div>
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
