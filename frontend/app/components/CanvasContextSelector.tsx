"use client";

import { useEffect, useRef } from "react";
import { Check } from "lucide-react";
import { LoadingSpinner } from "./LoadingSpinner";
import {
  useCanvasAnnouncements,
  useCanvasCourses,
  useCanvasTodo,
  useCanvasUpcomingEvents,
} from "../canvas/canvas-api";
import { useUIStore, type CanvasContextSelection } from "../store/uiStore";
import { useMeg, useOppdaterPreferanser } from "../auth/auth-api";
import { showToast } from "./Toaster";
import { lagBrukervennligFeilmelding } from "../lib/errorUtils";

export function CanvasContextSelector() {
  // Bruk global state for valg så de bevares mellom view-bytter
  const selected = useUIStore((state) => state.canvasContextSelection);
  const setSelected = useUIStore((state) => state.setCanvasContextSelection);
  
  // Hent brukerdata og sync preferanser fra backend
  const { data: megData } = useMeg();
  const {
    mutateAsync: oppdaterBackend,
    isPending: oppdatererPreferanser,
  } = useOppdaterPreferanser();
  const initializedRef = useRef(false);
  
  // Synkroniser fra backend ved første load
  useEffect(() => {
    if (megData?.user?.canvasContextPreferences && !initializedRef.current) {
      setSelected(megData.user.canvasContextPreferences);
      initializedRef.current = true;
    }
  }, [megData?.user?.canvasContextPreferences, setSelected]);

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

  const toggleOption = async (key: keyof CanvasContextSelection) => {
    if (oppdatererPreferanser) return;

    const previousSelection = selected;
    const newSelection = { ...selected, [key]: !selected[key] };
    setSelected(newSelection);

    try {
      await oppdaterBackend(newSelection);
    } catch (error) {
      setSelected(previousSelection);
      showToast.error(
        "Kunne ikke oppdatere AI-kontekst",
        lagBrukervennligFeilmelding(
          error instanceof Error ? error : null,
          { canvas: true },
          "Prøv igjen.",
        ),
      );
    }
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
            onClick={() => void toggleOption(option.key)}
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
