/**
 * CalendarSection - Kalender-seksjon for dashboardet
 * Henter frister/hendelser og forelesninger fra Canvas Calendar API
 * Inkluderer filter for å velge mellom innleveringer, forelesninger eller begge
 */
"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { FC } from "react";
import { addMonths, setMonth, setYear, subMonths, format } from "date-fns";
import { nb } from "date-fns/locale";
import { AlertCircle, Clock, MapPin, Loader2, Sparkles, ChevronDown, ChevronUp, CheckCircle2 } from "lucide-react";
import { CalendarHeader } from "./CalendarHeader";
import { CalendarGrid } from "./CalendarGrid";
import { CourseLegend } from "./CourseLegend";
import { useCombinedCalendarData } from "./calendar-api";
import { useUIStore } from "../store/uiStore";
import { useKIOppsummering, type KIOppsummeringResponse } from "../ki/ki-api";
import { showToast } from "../components/Toaster";
import type { Assignment, CalendarFilterType } from "common/calendar-ui";

// Props for CalendarSection
interface CalendarSectionProps {
  harCanvasToken?: boolean;
}

// KI-oppsummering for kalenderhendelse/oppgave
function KalenderOppsummering({ tekst }: { tekst: string }) {
  const { oppsummer, isPending, data, error } = useKIOppsummering();
  const [aapen, settAapen] = useState(false);
  const [resultat, settResultat] = useState<KIOppsummeringResponse | null>(null);

  const handleOppsummer = useCallback(() => {
    if (resultat) {
      settAapen((v) => !v);
      return;
    }
    oppsummer(tekst, {
      type: "begge",
      onSuccess: (d) => {
        settResultat(d);
        settAapen(true);
      },
      onError: (err) => {
        showToast.error("Kunne ikke oppsummere", err.message);
      },
    });
  }, [tekst, oppsummer, resultat]);

  useEffect(() => {
    if (data?.suksess && !resultat) {
      settResultat(data);
      settAapen(true);
    }
  }, [data, resultat]);

  return (
    <div className="mt-2">
      <button
        type="button"
        onClick={handleOppsummer}
        disabled={isPending}
        className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium border border-purple-200 dark:border-purple-800 bg-purple-50 dark:bg-purple-900/20 text-purple-700 dark:text-purple-300 hover:bg-purple-100 dark:hover:bg-purple-900/40 transition-colors disabled:opacity-50"
      >
        {isPending ? (
          <Loader2 className="w-3.5 h-3.5 animate-spin" />
        ) : (
          <Sparkles className="w-3.5 h-3.5" />
        )}
        {resultat ? (aapen ? "Skjul oppsummering" : "Vis oppsummering") : "Oppsummer med KI"}
        {resultat && (aapen ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />)}
      </button>
      {aapen && resultat && (
        <div className="mt-2 p-3 rounded-lg bg-purple-50 dark:bg-purple-900/20 border border-purple-200 dark:border-purple-800 space-y-2">
          {resultat.oppsummering && (
            <div>
              <h4 className="text-[10px] font-semibold text-purple-600 dark:text-purple-400 uppercase tracking-wide mb-0.5">TL;DR</h4>
              <p className="text-xs text-slate-700 dark:text-slate-300">{resultat.oppsummering}</p>
            </div>
          )}
          {resultat.handlinger && resultat.handlinger.length > 0 && (
            <div>
              <h4 className="text-[10px] font-semibold text-purple-600 dark:text-purple-400 uppercase tracking-wide mb-0.5">Hovedpunkter</h4>
              <ul className="space-y-0.5">
                {resultat.handlinger.map((punkt, i) => (
                  <li key={i} className="flex items-start gap-1.5 text-xs text-slate-700 dark:text-slate-300">
                    <CheckCircle2 className="w-3 h-3 text-purple-500 mt-0.5 shrink-0" />
                    {punkt}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {!resultat.oppsummering && (!resultat.handlinger || resultat.handlinger.length === 0) && (
            <p className="text-xs text-slate-500 dark:text-slate-400">Ingen oppsummering tilgjengelig.</p>
          )}
        </div>
      )}
      {error && !resultat && (
        <p className="mt-1 text-[10px] text-red-500 dark:text-red-400">{error.message}</p>
      )}
    </div>
  );
}

// Informasjons-panel for feilmeldinger og varsler
function InfoPanel({
  type = "info",
  message,
}: {
  type?: "info" | "warning" | "error";
  message: string;
}) {
  const colors =
    type === "error" || type === "warning"
      ? "bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800 text-red-700 dark:text-red-300"
      : "bg-slate-50 dark:bg-slate-800/50 border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200";

  const iconColor = type === "error" || type === "warning" ? "text-red-500" : "";

  return (
    <div className={`flex items-center gap-3 p-4 rounded-lg border ${colors}`}>
      <AlertCircle className={`w-5 h-5 shrink-0 ${iconColor}`} />
      <p className="text-sm">{message}</p>
    </div>
  );
}
// Hoved-komponent
export const CalendarSection: FC<CalendarSectionProps> = ({
  harCanvasToken = false,
}) => {
  const [currentDate, setCurrentDate] = useState(new Date());
  const [selectedDate, setSelectedDate] = useState<Date | null>(new Date());
  const [completedIds, setCompletedIds] = useState<Set<string>>(new Set());
  const [filter, setFilter] = useState<CalendarFilterType>("all");
  const canvasTokenInvalid = useUIStore((state) => state.canvasTokenInvalid);
  // Hent kombinert data fra Canvas
  const { data, isLoading, isError, error, hasLecturesData } = useCombinedCalendarData(
    filter,
    harCanvasToken
  );
  const assignmentsRaw = data?.assignments ?? [];
  const courses = data?.courses ?? [];
  // Reset fullførte innleveringer når data endres
  useEffect(() => {
    setCompletedIds(new Set());
  }, [assignmentsRaw.length]);
// Merk innleveringer som fullførte basert på lokal state
  const assignments: Assignment[] = useMemo(
    () =>
      assignmentsRaw.map((a) => ({
        ...a,
        completed: completedIds.has(a.id),
      })),
    [assignmentsRaw, completedIds]
  );
// Håndteringsfunksjoner for kalendernavigasjon og interaksjon
  const handlePrevMonth = () => setCurrentDate((prev) => subMonths(prev, 1));
  const handleNextMonth = () => setCurrentDate((prev) => addMonths(prev, 1));
  const handleToday = () => {
    setCurrentDate(new Date());
    setSelectedDate(new Date());
  };
  const handleMonthChange = (month: number) => setCurrentDate((prev) => setMonth(prev, month));
  const handleYearChange = (year: number) => setCurrentDate((prev) => setYear(prev, year));
  const handleDateClick = (date: Date) => setSelectedDate(date);
  const handleToggleComplete = (id: string) => {
    setCompletedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };
// Filtrer innleveringer for valgt dato
  const selectedDateAssignments = useMemo(() => {
    if (!selectedDate) return [];
    return assignments.filter(
      (a) =>
        a.dueDate.getDate() === selectedDate.getDate() &&
        a.dueDate.getMonth() === selectedDate.getMonth() &&
        a.dueDate.getFullYear() === selectedDate.getFullYear()
    );
  }, [assignments, selectedDate]);
  if (!harCanvasToken) {
    return <InfoPanel type="warning" message="Du må lagre en Canvas API-token før du kan hente kalenderen." />;
  }
  if (canvasTokenInvalid) {
    return <InfoPanel type="error" message="Canvas-tokenet ditt er ugyldig, utløpt eller slettet i Canvas. Gå til Innstillinger for å legge til et nytt token." />;
  }
  if (isLoading) {
    return (
      <div className="calendar-page animate-pulse">
        {/* Header skeleton */}
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <div className="h-8 w-8 rounded bg-slate-200 dark:bg-slate-700" />
            <div className="h-6 w-36 rounded bg-slate-200 dark:bg-slate-700" />
            <div className="h-8 w-8 rounded bg-slate-200 dark:bg-slate-700" />
          </div>
          <div className="hidden sm:flex gap-2">
            <div className="h-8 w-20 rounded bg-slate-200 dark:bg-slate-700" />
            <div className="h-8 w-28 rounded bg-slate-200 dark:bg-slate-700" />
            <div className="h-8 w-28 rounded bg-slate-200 dark:bg-slate-700" />
          </div>
        </div>
        {/* Grid skeleton */}
        <div className="calendar-layout">
          <div className="rounded-xl border border-slate-200 dark:border-slate-700 p-3">
            <div className="grid grid-cols-7 gap-1">
              {Array.from({ length: 7 }).map((_, i) => (
                <div key={`h-${i}`} className="h-5 rounded bg-slate-200 dark:bg-slate-700 mb-1" />
              ))}
              {Array.from({ length: 35 }).map((_, i) => (
                <div key={`c-${i}`} className="min-h-16 sm:min-h-20 md:min-h-24 rounded bg-slate-100 dark:bg-slate-800" />
              ))}
            </div>
          </div>
          {/* Detaljer-panel skeleton */}
          <div className="rounded-xl border border-slate-200 dark:border-slate-700 p-3 sm:p-4 h-fit">
            <div className="h-5 w-32 rounded bg-slate-200 dark:bg-slate-700 mb-4" />
            <div className="space-y-2">
              <div className="h-12 rounded bg-slate-100 dark:bg-slate-800" />
              <div className="h-12 rounded bg-slate-100 dark:bg-slate-800" />
            </div>
          </div>
        </div>
      </div>
    );
  }
  if (isError) {
    // Lag brukervennlig feilmelding basert på feiltype
    let feilMelding = "Kunne ikke hente kalenderdata";
    const errorMessage = error?.message || "";
    const errorName = error?.name || "";

    if (errorName === "CanvasTokenMissingError" || errorMessage.includes("token mangler")) {
      feilMelding = "Canvas-token mangler. Legg til tokenet i innstillinger.";
    } else if (errorMessage.includes("401") || errorMessage.includes("Ugyldig")) {
      feilMelding = "Canvas-tokenet ditt er ugyldig eller utlopt. Oppdater tokenet i innstillinger.";
    } else if (errorMessage.includes("429") || errorMessage.includes("rate")) {
      feilMelding = "For mange foresporrsler til Canvas. Vent noen sekunder og prov igjen.";
    } else if (errorMessage.includes("timeout") || errorMessage.includes("504")) {
      feilMelding = "Henting av kalenderdata tok for lang tid. Prov igjen.";
    } else if (errorMessage.includes("Nettverk") || errorMessage.includes("fetch")) {
      feilMelding = "Nettverksfeil. Sjekk internettforbindelsen din.";
    }
    return <InfoPanel type="error" message={feilMelding} />;
  }

  // Formater tid for forelesninger
  const formatTime = (date: Date) => format(date, "HH:mm");
  // Hovedrendering
  return (
    <div className="calendar-page">
      <CalendarHeader
        currentDate={currentDate}
        onPrevMonth={handlePrevMonth}
        onNextMonth={handleNextMonth}
        onToday={handleToday}
        onMonthChange={handleMonthChange}
        onYearChange={handleYearChange}
        filter={filter}
        onFilterChange={setFilter}
        hasLecturesData={hasLecturesData}
      />

      <CourseLegend courses={courses} />

      <div className="calendar-layout">
        <CalendarGrid
          currentDate={currentDate}
          assignments={assignments}
          onDateClick={handleDateClick}
          selectedDate={selectedDate}
        />

        {/* Detaljer-panel - mobile-first design */}
        <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 p-3 sm:p-4 h-fit">
          <h2 className="text-base sm:text-lg font-semibold text-slate-900 dark:text-slate-100 mb-3 sm:mb-4">
            {selectedDate
              ? `${filter === "timetable" ? "Forelesninger" : filter === "assignments" ? "Innleveringer" : "Hendelser"} ${selectedDate.getDate()}. ${[
                  "januar",
                  "februar",
                  "mars",
                  "april",
                  "mai",
                  "juni",
                  "juli",
                  "august",
                  "september",
                  "oktober",
                  "november",
                  "desember",
                ][selectedDate.getMonth()]}`
              : "Velg en dato"}
          </h2>
          {/* Valgt datoens oppgaver */}
          {selectedDateAssignments.length > 0 ? (
            <ul className="space-y-2 sm:space-y-3">
              {selectedDateAssignments.map((assignment) => {
                const oppsummeringstekst = [
                  assignment.title,
                  assignment.courseCode && `Emne: ${assignment.courseCode}`,
                  assignment.dueDate && format(assignment.dueDate, "d. MMMM yyyy", { locale: nb }),
                  assignment.location && `Lokasjon: ${assignment.location}`,
                  assignment.description,
                ].filter(Boolean).join(". ");
                return (
                  <li
                    key={assignment.id}
                    className="p-2 sm:p-3 rounded-lg bg-slate-50 dark:bg-slate-700/50 border border-slate-200 dark:border-slate-600"
                  >
                    <div className="flex items-start gap-2 sm:gap-3">
                      {assignment.source !== "event" && assignment.source !== "timetable" &&
                       assignment.description !== "calendar_event" && (
                        <input
                          type="checkbox"
                          checked={assignment.completed}
                          onChange={() => handleToggleComplete(assignment.id)}
                          className="mt-0.5 sm:mt-1 w-4 h-4 rounded border-slate-300 dark:border-slate-500"
                        />
                      )}
                      <div className="flex-1 min-w-0">
                        <p
                          className={`text-sm sm:text-base font-medium text-slate-900 dark:text-slate-100 ${
                            assignment.completed ? "line-through opacity-50" : ""
                          }`}
                        >
                          {assignment.title}
                        </p>
                        <p className="text-xs sm:text-sm text-slate-500 dark:text-slate-400">
                          {assignment.courseCode}
                        </p>

                        {/* Vis tidspunkt for forelesninger */}
                        {(assignment.source === "event" || assignment.source === "timetable") && assignment.endDate && (
                          <div className="flex items-center gap-1 mt-1 text-xs text-slate-500 dark:text-slate-400">
                            <Clock className="w-3 h-3 shrink-0" />
                            <span>{formatTime(assignment.dueDate)} - {formatTime(assignment.endDate)}</span>
                          </div>
                        )}

                        {/* Vis lokasjon */}
                        {assignment.location && (
                          <div className="flex items-center gap-1 mt-1 text-xs text-slate-500 dark:text-slate-400">
                            <MapPin className="w-3 h-3 shrink-0" />
                            <span className="truncate">{assignment.location}</span>
                          </div>
                        )}

                        <KalenderOppsummering tekst={oppsummeringstekst} />
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          ) : selectedDate ? (
            <p className="text-slate-500 dark:text-slate-400 text-xs sm:text-sm">
              {filter === "timetable"
                ? "Ingen forelesninger denne dagen."
                : filter === "assignments"
                  ? "Ingen innleveringer denne dagen."
                  : "Ingen hendelser denne dagen."}
            </p>
          ) : (
            <p className="text-slate-500 dark:text-slate-400 text-xs sm:text-sm">Klikk pa en dato i kalenderen for a se detaljer.</p>
          )}
        </div>
      </div>

      <div className="calendar-footer">
        {filter === "timetable" && !hasLecturesData
          ? "Fant ingen forelesninger i Canvas for dine emner."
          : assignments.length === 0
            ? filter === "timetable"
              ? "Ingen forelesninger funnet for dine emner."
              : filter === "assignments"
                ? "Ingen frister funnet i Canvas for valgt periode."
                : "Ingen hendelser funnet for valgt periode."
            : "Kalenderen synkroniseres automatisk med Canvas LMS"}
      </div>
    </div>
  );
};

export default CalendarSection;
