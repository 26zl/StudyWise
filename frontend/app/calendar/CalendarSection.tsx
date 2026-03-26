/**
 * CalendarSection - Kalender-seksjon for dashboardet
 * Henter frister/hendelser og forelesninger fra Canvas Calendar API.
 * Inkluderer header (navigasjon, filter), emneforklaring og grid.
 */
"use client";

import { useEffect, useMemo, useState } from "react";
import type { FC } from "react";
import { addMonths, setMonth, setYear, subMonths, format } from "date-fns";
import { enUS, nb } from "date-fns/locale";
import { Clock, MapPin, ChevronLeft, ChevronRight, CalendarDays, Filter } from "lucide-react";
import { CalendarGrid } from "./CalendarGrid";
import { CanvasTokenNotice } from "@/app/components/canvas/CanvasTokenNotice";
import { FeilMelding } from "@/app/components/ui/FeilMelding";
import { LoadingView } from "@/app/components/ui/Loading";
import { lagBrukervennligFeilmelding } from "../lib/errorUtils";
import { useCombinedCalendarData } from "./calendar-api";
import { useUIStore } from "../store/uiStore";
import { CanvasKIHandlinger } from "@/app/components/ki/CanvasKIActions";
import { cn } from "../lib/utils";
import type { Assignment, CalendarFilterType } from "common/calendar-ui";
import { COURSE_COLOR_CLASSES } from "common/calendar-ui";
import { useLanguage } from "@/app/i18n";

const COURSE_CODE_REGEX = /^([A-ZÆØÅ]{2,5}\d{4,5}[A-Z]?|\d{4,5}[A-Z])/i;

function capitalizeLabel(label: string) {
  return label.charAt(0).toUpperCase() + label.slice(1);
}

function getCalendarLabels(language: "nb" | "en") {
  if (language === "en") {
    return {
      missingToken: "You must save a Canvas API token to fetch the calendar.",
      loadError: "Could not fetch calendar data. Try again.",
      today: "Today",
      prevMonth: "Previous month",
      nextMonth: "Next month",
      filterLabel: "Show:",
      filters: {
        all: { label: "All events", shortLabel: "All" },
        assignments: { label: "Assignments only", shortLabel: "Tasks" },
        timetable: { label: "Lectures only", shortLabel: "Lectures" },
      },
      noLecturesFoundShort: "(No lectures found)",
      coursesLegend: "Courses:",
      headings: {
        lectures: "Lectures",
        assignments: "Assignments",
        events: "Events",
      },
      selectDate: "Select a date",
      noLecturesThisDay: "No lectures on this day.",
      noAssignmentsThisDay: "No assignments on this day.",
      noEventsThisDay: "No events on this day.",
      clickDate: "Click a date in the calendar to see details.",
      noLecturesForCourses: "No lectures found in Canvas for your courses.",
      noLecturesPeriod: "No lectures found for your courses.",
      noAssignmentsPeriod: "No deadlines found in Canvas for the selected period.",
      noEventsPeriod: "No events found for the selected period.",
      syncedWithCanvas: "The calendar syncs automatically with Canvas LMS",
      courseLabel: "Course",
      locationLabel: "Location",
    };
  }

  return {
    missingToken: "Du må lagre en Canvas API-token for å hente kalenderen.",
    loadError: "Kunne ikke hente kalenderdata. Prøv igjen.",
    today: "I dag",
    prevMonth: "Forrige måned",
    nextMonth: "Neste måned",
    filterLabel: "Vis:",
    filters: {
      all: { label: "Alle hendelser", shortLabel: "Alle" },
      assignments: { label: "Kun innleveringer", shortLabel: "Oppgaver" },
      timetable: { label: "Kun forelesninger", shortLabel: "Forelesninger" },
    },
    noLecturesFoundShort: "(Ingen forelesninger funnet)",
    coursesLegend: "Emner:",
    headings: {
      lectures: "Forelesninger",
      assignments: "Innleveringer",
      events: "Hendelser",
    },
    selectDate: "Velg en dato",
    noLecturesThisDay: "Ingen forelesninger denne dagen.",
    noAssignmentsThisDay: "Ingen innleveringer denne dagen.",
    noEventsThisDay: "Ingen hendelser denne dagen.",
    clickDate: "Klikk på en dato i kalenderen for å se detaljer.",
    noLecturesForCourses: "Fant ingen forelesninger i Canvas for dine emner.",
    noLecturesPeriod: "Ingen forelesninger funnet for dine emner.",
    noAssignmentsPeriod: "Ingen frister funnet i Canvas for valgt periode.",
    noEventsPeriod: "Ingen hendelser funnet for valgt periode.",
    syncedWithCanvas: "Kalenderen synkroniseres automatisk med Canvas LMS",
    courseLabel: "Emne",
    locationLabel: "Lokasjon",
  };
}

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
  const { language, t } = useLanguage();
  const labels = getCalendarLabels(language);
  const locale = language === "en" ? enUS : nb;
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
  const filterOptions: { value: CalendarFilterType; label: string; shortLabel: string }[] = useMemo(
    () => [
      { value: "all", label: labels.filters.all.label, shortLabel: labels.filters.all.shortLabel },
      { value: "assignments", label: labels.filters.assignments.label, shortLabel: labels.filters.assignments.shortLabel },
      { value: "timetable", label: labels.filters.timetable.label, shortLabel: labels.filters.timetable.shortLabel },
    ],
    [labels],
  );
  const monthOptions = useMemo(
    () =>
      Array.from({ length: 12 }, (_, index) => ({
        value: index.toString(),
        label: capitalizeLabel(format(new Date(2026, index, 1), "MMMM", { locale })),
      })),
    [locale],
  );
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
  if (!harCanvasToken) {
    return (
      <div className="p-4 sm:p-6 lg:p-8">
        <CanvasTokenNotice />
      </div>
    );
  }
  if (canvasTokenInvalid) {
    return (
      <div className="p-4 sm:p-6 lg:p-8">
        <CanvasTokenNotice variant="invalid" />
      </div>
    );
  }
  if (isLoading) {
    return (
      <div className="calendar-page flex min-h-100 items-center justify-center">
        <LoadingView translationKey="common.loading.calendar" fullPage={false} />
      </div>
    );
  }
  if (isError) {
    const feilMelding = lagBrukervennligFeilmelding(
      error instanceof Error ? error : null,
      { kalender: true },
      labels.loadError,
      t,
    );
    return <FeilMelding melding={feilMelding} />;
  }

  // Formater tid for forelesninger
  const formatTime = (date: Date) => format(date, "HH:mm");

  return (
    <div className="calendar-page">
      {/* Header: måned/år, navigasjon, filter */}
      <div className="flex flex-col gap-3 sm:gap-4 mb-4 sm:mb-6">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 sm:gap-4">
          <div className="flex flex-col sm:flex-row items-start sm:items-center gap-2 sm:gap-4 w-full sm:w-auto">
            <h1 className="text-xl sm:text-2xl font-bold text-slate-900 dark:text-slate-100 capitalize">
              {format(currentDate, "MMMM yyyy", { locale })}
            </h1>
            <div className="flex items-center gap-2">
              <select
                value={currentDate.getMonth().toString()}
                onChange={(e) => handleMonthChange(parseInt(e.target.value, 10))}
                className="h-8 sm:h-9 px-2 sm:px-3 rounded-lg border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-700 text-slate-900 dark:text-slate-100 text-xs sm:text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                {monthOptions.map((month) => (
                  <option key={month.value} value={month.value}>{month.label}</option>
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
              type="button"
              onClick={handleToday}
              className="flex items-center gap-1.5 sm:gap-2 h-8 sm:h-9 px-2.5 sm:px-4 rounded-lg border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-700 text-slate-700 dark:text-slate-200 text-xs sm:text-sm font-medium hover:bg-slate-50 dark:hover:bg-slate-600 transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <CalendarDays className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
              {labels.today}
            </button>
            <div className="flex items-center border border-slate-200 dark:border-slate-600 rounded-lg overflow-hidden">
              <button type="button" onClick={handlePrevMonth} className="h-8 w-8 sm:h-9 sm:w-9 flex items-center justify-center bg-white dark:bg-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-600 transition-colors" aria-label={labels.prevMonth}>
                <ChevronLeft className="w-4 h-4 sm:w-5 sm:h-5" />
              </button>
              <div className="w-px h-8 sm:h-9 bg-slate-200 dark:bg-slate-600" />
              <button type="button" onClick={handleNextMonth} className="h-8 w-8 sm:h-9 sm:w-9 flex items-center justify-center bg-white dark:bg-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-600 transition-colors" aria-label={labels.nextMonth}>
                <ChevronRight className="w-4 h-4 sm:w-5 sm:h-5" />
              </button>
            </div>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2 sm:gap-3 pb-2 border-b border-slate-200 dark:border-slate-700">
          <div className="flex items-center gap-1.5 sm:gap-2 text-xs sm:text-sm text-slate-600 dark:text-slate-400">
            <Filter className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
            <span>{labels.filterLabel}</span>
          </div>
          <div className="flex items-center gap-1">
            {filterOptions.map((option) => (
              <button
                type="button"
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
            <span className="text-[10px] sm:text-xs text-amber-600 dark:text-amber-400">{labels.noLecturesFoundShort}</span>
          )}
        </div>
      </div>

      {/* Emneforklaring */}
      {uniqueCourses.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 sm:gap-3 mb-3 sm:mb-4 px-2 sm:px-3 py-1.5 sm:py-2 bg-slate-100/50 dark:bg-slate-800/50 rounded-lg text-[10px] sm:text-xs">
          <span className="font-medium text-slate-500 dark:text-slate-400">{labels.coursesLegend}</span>
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
          language={language}
          onDateClick={setSelectedDate}
          selectedDate={selectedDate}
        />

        {/* Detaljer-panel - mobile-first design */}
        <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 p-3 sm:p-4 h-fit">
          <h2 className="text-base sm:text-lg font-semibold text-slate-900 dark:text-slate-100 mb-3 sm:mb-4">
            {selectedDate
              ? `${filter === "timetable" ? labels.headings.lectures : filter === "assignments" ? labels.headings.assignments : labels.headings.events}${language === "en" ? " for " : " "}${format(selectedDate, language === "en" ? "MMMM d" : "d. MMMM", { locale })}`
              : labels.selectDate}
          </h2>
          {/* Valgt datoens oppgaver */}
          {selectedDateAssignments.length > 0 ? (
            <ul className="space-y-2 sm:space-y-3">
              {selectedDateAssignments.map((assignment) => {
                const erHendelse =
                  assignment.source === "event" || assignment.source === "timetable";
                const beskrivelse =
                  assignment.description && assignment.description !== "calendar_event"
                    ? assignment.description
                    : undefined;
                const oppsummeringstekst = [
                  assignment.title,
                  assignment.courseCode &&
                    `${labels.courseLabel}: ${assignment.courseCode}`,
                  assignment.dueDate &&
                    format(
                      assignment.dueDate,
                      language === "en" ? "MMMM d, yyyy" : "d. MMMM yyyy",
                      { locale },
                    ),
                  assignment.location &&
                    `${labels.locationLabel}: ${assignment.location}`,
                  beskrivelse,
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

                        <CanvasKIHandlinger
                          tekst={oppsummeringstekst}
                          storrelse="sm"
                          kildetype={erHendelse ? "event" : "assignment"}
                          tittel={assignment.title}
                          emne={assignment.courseName ?? assignment.courseCode}
                        />
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          ) : selectedDate ? (
            <p className="text-slate-500 dark:text-slate-400 text-xs sm:text-sm">
              {filter === "timetable"
                ? labels.noLecturesThisDay
                : filter === "assignments"
                  ? labels.noAssignmentsThisDay
                  : labels.noEventsThisDay}
            </p>
          ) : (
            <p className="text-slate-500 dark:text-slate-400 text-xs sm:text-sm">{labels.clickDate}</p>
          )}
        </div>
      </div>

      <div className="calendar-footer">
        {filter === "timetable" && !hasLecturesData
          ? labels.noLecturesForCourses
          : assignments.length === 0
            ? filter === "timetable"
              ? labels.noLecturesPeriod
              : filter === "assignments"
                ? labels.noAssignmentsPeriod
                : labels.noEventsPeriod
            : labels.syncedWithCanvas}
      </div>
    </div>
  );
};

export default CalendarSection;
