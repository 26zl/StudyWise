/**
 * CalendarSection - Kalender-seksjon for dashboardet
 * Henter frister/hendelser og forelesninger fra Canvas Calendar API
 * Inkluderer filter for å velge mellom innleveringer, forelesninger eller begge
 */
"use client";

import { useEffect, useMemo, useState } from "react";
import type { FC } from "react";
import { addMonths, setMonth, setYear, subMonths, format } from "date-fns";
import { Loader2, AlertCircle, Clock, MapPin } from "lucide-react";
import { CalendarHeader } from "./CalendarHeader";
import { CalendarGrid } from "./CalendarGrid";
import { CourseLegend } from "./CourseLegend";
import { useCombinedCalendarData } from "./calendar-api";
import { useUIStore } from "../store/uiStore";
import type { Assignment, CalendarFilterType } from "common/calendar-ui";

// Props for CalendarSection
interface CalendarSectionProps {
  harCanvasToken?: boolean;
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
      <div className="flex items-center gap-3 p-4">
        <Loader2 className="w-5 h-5 animate-spin text-blue-600" />
        <span className="text-sm text-slate-600 dark:text-slate-300">Laster kalenderdata...</span>
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

          {selectedDateAssignments.length > 0 ? (
            <ul className="space-y-2 sm:space-y-3">
              {selectedDateAssignments.map((assignment) => (
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
                    </div>
                  </div>
                </li>
              ))}
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
