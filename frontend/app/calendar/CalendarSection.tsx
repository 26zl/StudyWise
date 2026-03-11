/**
 * CalendarSection - Kalender-seksjon for dashboardet
 * Henter frister/hendelser og forelesninger fra Canvas Calendar API.
 * Inkluderer header (navigasjon, filter), emneforklaring og grid.
 */
"use client";

import { useEffect, useMemo, useState } from "react";
import type { FC } from "react";
import { addMonths, setMonth, setYear, subMonths, format } from "date-fns";
import { nb } from "date-fns/locale";
import { Clock, MapPin, ChevronLeft, ChevronRight, CalendarDays, Filter } from "lucide-react";
import { CalendarGrid } from "./CalendarGrid";
import { FeilMelding } from "../components/FeilMelding";
import { lagBrukervennligFeilmelding, CANVAS_TOKEN_UGYLDIG_MELDING } from "../lib/errorUtils";
import { useCombinedCalendarData } from "./calendar-api";
import { useUIStore } from "../store/uiStore";
import { KIOppsummering } from "../components/KIOppsummering";
import { cn } from "../lib/utils";
import type { Assignment, CalendarFilterType } from "common/calendar-ui";
import { COURSE_COLOR_CLASSES } from "common/calendar-ui";

const MONTHS = ["Januar", "Februar", "Mars", "April", "Mai", "Juni", "Juli", "August", "September", "Oktober", "November", "Desember"];
const FILTER_OPTIONS: { value: CalendarFilterType; label: string; shortLabel: string }[] = [
  { value: "all", label: "Alle hendelser", shortLabel: "Alle" },
  { value: "assignments", label: "Kun innleveringer", shortLabel: "Oppgaver" },
  { value: "timetable", label: "Kun forelesninger", shortLabel: "Forelesninger" },
];
const COURSE_CODE_REGEX = /^([A-ZÆØÅ]{2,5}\d{4,5}[A-Z]?|\d{4,5}[A-Z])/i;

// Props for CalendarSection
interface CalendarSectionProps {
  harCanvasToken?: boolean;
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
    return <FeilMelding melding="Du må lagre en Canvas API-token for å hente kalenderen." />;
  }
  if (canvasTokenInvalid) {
    return <FeilMelding type="warning" melding={CANVAS_TOKEN_UGYLDIG_MELDING} />;
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
    const feilMelding = lagBrukervennligFeilmelding(
      error instanceof Error ? error : null,
      { kalender: true },
      "Kunne ikke hente kalenderdata. Prøv igjen."
    );
    return <FeilMelding melding={feilMelding} />;
  }

  // Formater tid for forelesninger
  const formatTime = (date: Date) => format(date, "HH:mm");
  const currentYear = new Date().getFullYear();
  const years = Array.from({ length: 5 }, (_, i) => currentYear - 2 + i);
  const uniqueCourses = useMemo(() => {
    return courses.filter((course, index, self) => {
      if (course.code === "Annet") return false;
      const codeMatch = course.code.match(COURSE_CODE_REGEX);
      const cleanCode = codeMatch ? codeMatch[0].toUpperCase() : course.code;
      return self.findIndex((c) => (c.code.match(COURSE_CODE_REGEX)?.[0]?.toUpperCase() ?? c.code) === cleanCode) === index;
    });
  }, [courses]);

  return (
    <div className="calendar-page">
      {/* Header: måned/år, navigasjon, filter */}
      <div className="flex flex-col gap-3 sm:gap-4 mb-4 sm:mb-6">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 sm:gap-4">
          <div className="flex flex-col sm:flex-row items-start sm:items-center gap-2 sm:gap-4 w-full sm:w-auto">
            <h1 className="text-xl sm:text-2xl font-bold text-slate-900 dark:text-slate-100 capitalize">
              {format(currentDate, "MMMM yyyy", { locale: nb })}
            </h1>
            <div className="flex items-center gap-2">
              <select
                value={currentDate.getMonth().toString()}
                onChange={(e) => handleMonthChange(parseInt(e.target.value, 10))}
                className="h-8 sm:h-9 px-2 sm:px-3 rounded-lg border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-700 text-slate-900 dark:text-slate-100 text-xs sm:text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                {MONTHS.map((month, index) => (
                  <option key={month} value={index.toString()}>{month}</option>
                ))}
              </select>
              <select
                value={currentDate.getFullYear().toString()}
                onChange={(e) => handleYearChange(parseInt(e.target.value, 10))}
                className="h-8 sm:h-9 px-2 sm:px-3 rounded-lg border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-700 text-slate-900 dark:text-slate-100 text-xs sm:text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                {years.map((year) => (
                  <option key={year} value={year.toString()}>{year}</option>
                ))}
              </select>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={handleToday}
              className="flex items-center gap-1.5 sm:gap-2 h-8 sm:h-9 px-2.5 sm:px-4 rounded-lg border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-700 text-slate-700 dark:text-slate-200 text-xs sm:text-sm font-medium hover:bg-slate-50 dark:hover:bg-slate-600 transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <CalendarDays className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
              I dag
            </button>
            <div className="flex items-center border border-slate-200 dark:border-slate-600 rounded-lg overflow-hidden">
              <button onClick={handlePrevMonth} className="h-8 w-8 sm:h-9 sm:w-9 flex items-center justify-center bg-white dark:bg-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-600 transition-colors" aria-label="Forrige måned">
                <ChevronLeft className="w-4 h-4 sm:w-5 sm:h-5" />
              </button>
              <div className="w-px h-8 sm:h-9 bg-slate-200 dark:bg-slate-600" />
              <button onClick={handleNextMonth} className="h-8 w-8 sm:h-9 sm:w-9 flex items-center justify-center bg-white dark:bg-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-600 transition-colors" aria-label="Neste måned">
                <ChevronRight className="w-4 h-4 sm:w-5 sm:h-5" />
              </button>
            </div>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2 sm:gap-3 pb-2 border-b border-slate-200 dark:border-slate-700">
          <div className="flex items-center gap-1.5 sm:gap-2 text-xs sm:text-sm text-slate-600 dark:text-slate-400">
            <Filter className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
            <span>Vis:</span>
          </div>
          <div className="flex items-center gap-1">
            {FILTER_OPTIONS.map((option) => (
              <button
                key={option.value}
                onClick={() => setFilter(option.value)}
                className={cn(
                  "px-2 sm:px-3 py-1 sm:py-1.5 rounded-lg text-xs sm:text-sm font-medium transition-colors",
                  filter === option.value ? "bg-blue-600 text-white" : "bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700"
                )}
              >
                <span className="sm:hidden">{option.shortLabel}</span>
                <span className="hidden sm:inline">{option.label}</span>
              </button>
            ))}
          </div>
          {filter === "timetable" && !hasLecturesData && (
            <span className="text-[10px] sm:text-xs text-amber-600 dark:text-amber-400">(Ingen forelesninger funnet)</span>
          )}
        </div>
      </div>

      {/* Emneforklaring */}
      {uniqueCourses.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 sm:gap-3 mb-3 sm:mb-4 px-2 sm:px-3 py-1.5 sm:py-2 bg-slate-100/50 dark:bg-slate-800/50 rounded-lg text-[10px] sm:text-xs">
          <span className="font-medium text-slate-500 dark:text-slate-400">Emner:</span>
          {uniqueCourses.map((course) => {
            const displayCode = course.code.match(COURSE_CODE_REGEX)?.[0]?.toUpperCase() ?? course.code;
            return (
              <div key={course.code} className="flex items-center gap-1 sm:gap-1.5">
                <span className={cn("w-2 h-2 sm:w-2.5 sm:h-2.5 rounded-full shrink-0", COURSE_COLOR_CLASSES[course.color])} />
                <span className="text-slate-700 dark:text-slate-200 font-medium">{displayCode}</span>
              </div>
            );
          })}
        </div>
      )}

      <div className="calendar-layout">
        <CalendarGrid
          currentDate={currentDate}
          assignments={assignments}
          onDateClick={setSelectedDate}
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

                        <KIOppsummering tekst={oppsummeringstekst} storrelse="sm" />
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
