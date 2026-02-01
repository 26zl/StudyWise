/**
 * CalendarSection - Kalender-seksjon for dashboardet
 * Henter frister/hendelser fra Canvas og timeplan fra TimeEdit
 * TimeEdit hentes AUTOMATISK basert på Canvas-emnekoder - ingen URL nødvendig!
 * Støtter campus-filtrering (Bø, Drammen, Kongsberg, etc.)
 * Inkluderer filter for å velge mellom innleveringer, timeplan eller begge
 */
"use client";

import { useEffect, useMemo, useState } from "react";
import type { FC } from "react";
import { addMonths, setMonth, setYear, subMonths, format } from "date-fns";
import { Loader2, AlertCircle, Clock, MapPin, User } from "lucide-react";
import { CalendarHeader } from "./CalendarHeader";
import { CalendarGrid } from "./CalendarGrid";
import { CourseLegend } from "./CourseLegend";
import { useCombinedCalendarData, type CampusId } from "./calendar-api";
import type { Assignment, CalendarFilterType } from "common/calendar-ui";

interface CalendarSectionProps {
  harCanvasToken?: boolean;
  campus?: CampusId;
}

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

export const CalendarSection: FC<CalendarSectionProps> = ({ 
  harCanvasToken = false,
  campus,
}) => {
  const [currentDate, setCurrentDate] = useState(new Date());
  const [selectedDate, setSelectedDate] = useState<Date | null>(new Date());
  const [completedIds, setCompletedIds] = useState<Set<string>>(new Set());
  const [filter, setFilter] = useState<CalendarFilterType>("all");

  // Hent kombinert data - TimeEdit hentes AUTOMATISK med campus-filter
  const { data, isLoading, isError, error, hasTimeEditData } = useCombinedCalendarData(
    filter,
    harCanvasToken,
    campus
  );
  const assignmentsRaw = data?.assignments ?? [];
  const courses = data?.courses ?? [];

  useEffect(() => {
    setCompletedIds(new Set());
  }, [assignmentsRaw.length]);

  const assignments: Assignment[] = useMemo(
    () =>
      assignmentsRaw.map((a) => ({
        ...a,
        completed: completedIds.has(a.id),
      })),
    [assignmentsRaw, completedIds]
  );

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
      feilMelding = "Canvas-tokenet ditt er ugyldig eller utløpt. Oppdater tokenet i innstillinger.";
    } else if (errorMessage.includes("429") || errorMessage.includes("rate")) {
      feilMelding = "For mange forespørsler til Canvas. Vent noen sekunder og prøv igjen.";
    } else if (errorMessage.includes("timeout") || errorMessage.includes("504")) {
      feilMelding = "Henting av kalenderdata tok for lang tid. Prøv igjen.";
    } else if (errorMessage.includes("Nettverk") || errorMessage.includes("fetch")) {
      feilMelding = "Nettverksfeil. Sjekk internettforbindelsen din.";
    }
    
    return <InfoPanel type="error" message={feilMelding} />;
  }

  // Formater tid for timeplan-elementer
  const formatTime = (date: Date) => format(date, "HH:mm");

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
        hasTimeEditData={hasTimeEditData}
      />

      <CourseLegend courses={courses} />

      <div className="calendar-layout">
        <CalendarGrid
          currentDate={currentDate}
          assignments={assignments}
          onDateClick={handleDateClick}
          selectedDate={selectedDate}
        />

        <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 p-4 h-fit">
          <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100 mb-4">
            {selectedDate
              ? `${filter === "timetable" ? "Timeplan" : filter === "assignments" ? "Innleveringer" : "Hendelser"} ${selectedDate.getDate()}. ${[
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
            <ul className="space-y-3">
              {selectedDateAssignments.map((assignment) => (
                <li
                  key={assignment.id}
                  className="p-3 rounded-lg bg-slate-50 dark:bg-slate-700/50 border border-slate-200 dark:border-slate-600"
                >
                  <div className="flex items-start gap-3">
                    {assignment.source !== "timetable" && (
                      <input
                        type="checkbox"
                        checked={assignment.completed}
                        onChange={() => handleToggleComplete(assignment.id)}
                        className="mt-1 w-4 h-4 rounded border-slate-300 dark:border-slate-500"
                      />
                    )}
                    <div className="flex-1 min-w-0">
                      <p
                        className={`font-medium text-slate-900 dark:text-slate-100 ${
                          assignment.completed ? "line-through opacity-50" : ""
                        }`}
                      >
                        {assignment.title}
                      </p>
                      <p className="text-sm text-slate-500 dark:text-slate-400">
                        {assignment.courseCode}
                      </p>
                      
                      {/* Vis tidspunkt for timeplan-elementer */}
                      {assignment.source === "timetable" && assignment.endDate && (
                        <div className="flex items-center gap-1 mt-1 text-xs text-slate-500 dark:text-slate-400">
                          <Clock className="w-3 h-3" />
                          <span>{formatTime(assignment.dueDate)} - {formatTime(assignment.endDate)}</span>
                        </div>
                      )}
                      
                      {/* Vis lokasjon for timeplan-elementer */}
                      {assignment.location && (
                        <div className="flex items-center gap-1 mt-1 text-xs text-slate-500 dark:text-slate-400">
                          <MapPin className="w-3 h-3" />
                          <span>{assignment.location}</span>
                        </div>
                      )}
                      
                      {/* Vis foreleser for timeplan-elementer */}
                      {assignment.teacher && (
                        <div className="flex items-center gap-1 mt-1 text-xs text-slate-500 dark:text-slate-400">
                          <User className="w-3 h-3" />
                          <span>{assignment.teacher}</span>
                        </div>
                      )}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          ) : selectedDate ? (
            <p className="text-slate-500 dark:text-slate-400 text-sm">
              {filter === "timetable" 
                ? "Ingen timeplan-hendelser denne dagen."
                : filter === "assignments"
                  ? "Ingen innleveringer denne dagen."
                  : "Ingen hendelser denne dagen."}
            </p>
          ) : (
            <p className="text-slate-500 dark:text-slate-400 text-sm">Klikk på en dato i kalenderen for å se detaljer.</p>
          )}
        </div>
      </div>

      <div className="calendar-footer">
        {filter === "timetable" && !hasTimeEditData
          ? "Fant ingen timeplan fra TimeEdit for dine emner. Universitetet har kanskje ikke publisert timeplanen enda."
          : assignments.length === 0
            ? filter === "timetable"
              ? "Ingen timeplan-hendelser funnet for dine emner."
              : filter === "assignments"
                ? "Ingen frister funnet i Canvas for valgt periode."
                : "Ingen hendelser funnet for valgt periode."
            : filter === "timetable"
              ? "Timeplanen synkroniseres automatisk med TimeEdit basert pa dine Canvas-emner"
              : filter === "assignments"
                ? "Kalenderen synkroniseres med Canvas LMS"
                : "Kalenderen synkroniseres automatisk med Canvas LMS og TimeEdit"}
      </div>
    </div>
  );
};

export default CalendarSection;
