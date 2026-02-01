/**
 * CalendarSection - Kalender-seksjon for dashboardet
 * Henter frister/hendelser fra Canvas og viser kalender + detaljer
 */
"use client";

import { useEffect, useMemo, useState } from "react";
import type { FC } from "react";
import { addMonths, setMonth, setYear, subMonths } from "date-fns";
import { Loader2, AlertCircle } from "lucide-react";
import { CalendarHeader } from "./CalendarHeader";
import { CalendarGrid } from "./CalendarGrid";
import { CourseLegend } from "./CourseLegend";
import { useCalendarData } from "./calendar-api";
import type { Assignment } from "common/calendar-ui";

interface CalendarSectionProps {
  harCanvasToken?: boolean;
}

function InfoPanel({
  type = "info",
  message,
}: {
  type?: "info" | "warning" | "error";
  message: string;
}) {
  const colors =
    type === "error"
      ? "bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800 text-red-700 dark:text-red-200"
      : type === "warning"
        ? "bg-amber-50 dark:bg-amber-900/20 border-amber-200 dark:border-amber-700 text-amber-800 dark:text-amber-200"
        : "bg-slate-50 dark:bg-slate-800/50 border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200";

  return (
    <div className={`flex items-center gap-3 p-4 rounded-lg border ${colors}`}>
      <AlertCircle className="w-5 h-5 shrink-0" />
      <p className="text-sm">{message}</p>
    </div>
  );
}

export const CalendarSection: FC<CalendarSectionProps> = ({ harCanvasToken = false }) => {
  const [currentDate, setCurrentDate] = useState(new Date());
  const [selectedDate, setSelectedDate] = useState<Date | null>(new Date());
  const [completedIds, setCompletedIds] = useState<Set<string>>(new Set());

  const { data, isLoading, isError, error } = useCalendarData(harCanvasToken);
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
    return <InfoPanel type="warning" message="Du må lagre et gyldig Canvas API-token før kalenderen kan vises." />;
  }

  if (isLoading) {
    return (
      <div className="flex items-center gap-3 p-4">
        <Loader2 className="w-5 h-5 animate-spin text-blue-600" />
        <span className="text-sm text-slate-600 dark:text-slate-300">Laster kalenderdata fra Canvas...</span>
      </div>
    );
  }

  if (isError) {
    return <InfoPanel type="error" message={error?.message || "Kunne ikke hente kalenderdata"} />;
  }

  return (
    <div className="calendar-page">
      <CalendarHeader
        currentDate={currentDate}
        onPrevMonth={handlePrevMonth}
        onNextMonth={handleNextMonth}
        onToday={handleToday}
        onMonthChange={handleMonthChange}
        onYearChange={handleYearChange}
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
              ? `Innleveringer ${selectedDate.getDate()}. ${[
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
                    <input
                      type="checkbox"
                      checked={assignment.completed}
                      onChange={() => handleToggleComplete(assignment.id)}
                      className="mt-1 w-4 h-4 rounded border-slate-300 dark:border-slate-500"
                    />
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
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          ) : selectedDate ? (
            <p className="text-slate-500 dark:text-slate-400 text-sm">Ingen innleveringer denne dagen.</p>
          ) : (
            <p className="text-slate-500 dark:text-slate-400 text-sm">Klikk på en dato i kalenderen for å se innleveringer.</p>
          )}
        </div>
      </div>

      <div className="calendar-footer">
        {assignments.length === 0
          ? "Ingen frister funnet i Canvas for valgt periode."
          : "Kalenderen synkroniseres med Canvas LMS"}
      </div>
    </div>
  );
};

export default CalendarSection;
