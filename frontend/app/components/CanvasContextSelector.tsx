"use client";

import { useEffect, useCallback, useRef } from "react";
import { Check, Loader2 } from "lucide-react";
import {
  useCanvasAnnouncements,
  useCanvasCourses,
  useCanvasTodo,
  useCanvasUpcomingEvents,
} from "../canvas/canvas-api";
import { formaterEmneStatus } from "../canvas/canvasUtils";
import { useUIStore, type CanvasContextSelection } from "../store/uiStore";
import { useMeg, useOppdaterPreferanser } from "../auth/auth-api";

// Props for CanvasContextSelector komponenten
interface CanvasContextSelectorProps {
  onContextChange: (context: string) => void;
}

export function CanvasContextSelector({ onContextChange }: CanvasContextSelectorProps) {
  // Bruk global state for valg så de bevares mellom view-bytter
  const selected = useUIStore((state) => state.canvasContextSelection);
  const setSelected = useUIStore((state) => state.setCanvasContextSelection);
  
  // Hent brukerdata og sync preferanser fra backend
  const { data: megData } = useMeg();
  const { mutate: oppdaterBackend } = useOppdaterPreferanser();
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

  const isLoading = loadingAnnouncements || loadingCourses || loadingTodo || loadingEvents;

  // Memoize callback for å unngå uendelig loop
  const byggContext = useCallback(() => {
    const deler: string[] = [];

    // Kunngjøringer med INNHOLD
    if (selected.announcements && announcementsData?.announcements?.length) {
      deler.push("KUNNGJØRINGER:");
      announcementsData.announcements.slice(0, 10).forEach((a) => {
        const dato = a.posted_at ? new Date(a.posted_at).toLocaleDateString("no-NO") : "";
        const courseId = a.context_code ? Number(a.context_code.replace("course_", "")) : null;
        const courseName = (courseId && coursesData?.courses?.find((c) => c.id === courseId)?.name) ?? "";
        deler.push(`\n[${a.title}]${dato ? ` (${dato})` : ""}${courseName ? ` - Emne: ${courseName}` : ""}`);
        // Inkluder innhold (stripet for HTML)
        if (a.message) {
          const stripped = a.message.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
          if (stripped.length > 0) {
            deler.push(stripped.substring(0, 500) + (stripped.length > 500 ? "..." : ""));
          }
        }
      });
      deler.push("");
    }

    // Emner med detaljer
    if (selected.courses && coursesData?.courses?.length) {
      deler.push("DINE EMNER:");
      coursesData.courses.forEach((c) => {
        const status = formaterEmneStatus(c.workflow_state);
        deler.push(`- ${c.name} (${c.course_code || "ukjent kode"}) [${status}]`);
      });
      deler.push("");
    }

    // Oppgaver/TODO med frister og detaljer
    if (selected.assignments && todoData?.todos?.length) {
      deler.push("KOMMENDE FRISTER OG OPPGAVER:");
      todoData.todos.slice(0, 15).forEach((t) => {
        const navn = t.assignment?.name || t.quiz?.title || t.type || "Ukjent";
        const frist = t.assignment?.due_at || t.quiz?.due_at;
        const poeng = t.assignment?.points_possible;
        const courseName = t.context_name ?? "";
        
        let linje = `- ${navn}`;
        if (courseName) linje += ` (${courseName})`;
        if (frist) {
          const fristDato = new Date(frist);
          const dagerIgjen = Math.ceil((fristDato.getTime() - Date.now()) / (1000 * 60 * 60 * 24));
          linje += ` - Frist: ${fristDato.toLocaleDateString("no-NO")}`;
          if (dagerIgjen <= 7 && dagerIgjen >= 0) {
            linje += ` (${dagerIgjen} dager igjen!)`;
          } else if (dagerIgjen < 0) {
            linje += " (FORFALT)";
          }
        }
        if (poeng) linje += ` [${poeng} poeng]`;
        deler.push(linje);
      });
      deler.push("");
    }

    // Kommende hendelser
    if (selected.events && eventsData?.events?.length) {
      deler.push("KOMMENDE HENDELSER:");
      eventsData.events.slice(0, 10).forEach((e) => {
        const start = e.start_at ? new Date(e.start_at) : null;
        const slutt = e.end_at ? new Date(e.end_at) : null;
        const tittel = e.title || "Hendelse";
        
        let linje = `- ${tittel}`;
        if (start) {
          linje += ` - ${start.toLocaleDateString("no-NO")}`;
          if (slutt && start.toDateString() === slutt.toDateString()) {
            linje += ` kl ${start.toLocaleTimeString("no-NO", { hour: "2-digit", minute: "2-digit" })}`;
            linje += `-${slutt.toLocaleTimeString("no-NO", { hour: "2-digit", minute: "2-digit" })}`;
          }
        }
        if (e.location_name) linje += ` @ ${e.location_name}`;
        deler.push(linje);
      });
      deler.push("");
    }

    // Legg til info om at full Canvas-kontekst hentes fra backend
    if (deler.length > 0) {
      deler.push("---");
      deler.push("MERK: Full Canvas-data (moduler, sider, innhold) hentes automatisk fra backend.");
      deler.push("Dette er kun overordnet info - detaljert innhold er tilgjengelig.");
    }

    return deler.join("\n").trim();
  }, [selected, announcementsData, coursesData, todoData, eventsData]);

  // Oppdater context når data eller valg endres
  useEffect(() => {
    const context = byggContext();
    onContextChange(context);
  }, [byggContext, onContextChange]);

  const toggleOption = (key: keyof CanvasContextSelection) => {
    const newSelection = { ...selected, [key]: !selected[key] };
    setSelected(newSelection);
    // Lagre til backend
    oppdaterBackend(newSelection);
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
          <Loader2 className="w-4 h-4 animate-spin text-blue-500" />
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
            onClick={() => toggleOption(option.key)}
            className={`flex flex-col items-start gap-1.5 p-3 rounded-lg border transition-colors ${
              selected[option.key]
                ? "border-blue-500 bg-blue-50 dark:bg-blue-900/20"
                : "border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800"
            } hover:border-blue-400 active:bg-blue-100 dark:active:bg-blue-900/30 cursor-pointer`}
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
                    <Loader2 className="w-3 h-3 animate-spin text-slate-400" />
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
