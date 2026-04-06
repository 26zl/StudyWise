/**
 * CalendarGrid - Kalendervisning med dager og innleveringer
 * Viser månedskalender med oppgaver/innleveringer markert per dag
 */
"use client";

import { useMemo, memo } from "react";
import {
    startOfMonth,
    endOfMonth,
    startOfWeek,
    endOfWeek,
    eachDayOfInterval,
    format,
    isSameMonth,
    isSameDay,
    isToday,
    isBefore,
    startOfDay,
} from "date-fns";
import { enUS, nb } from "date-fns/locale";
import { AlertCircle } from "lucide-react";
import { cn } from "../lib/utils";
import { Assignment, COURSE_COLOR_CLASSES } from "common/calendar-ui";

// Props for CalendarGrid-komponenten
interface CalendarGridProps {
    currentDate: Date;
    assignments: Assignment[];
    language: "nb" | "en";
    onDateClick: (date: Date) => void;
    selectedDate: Date | null;
}

function getCalendarGridLabels(language: "nb" | "en") {
    if (language === "en") {
        return {
            weekDays: [
                { full: "Mon", mobile: "Mo" },
                { full: "Tue", mobile: "Tu" },
                { full: "Wed", mobile: "We" },
                { full: "Thu", mobile: "Th" },
                { full: "Fri", mobile: "Fr" },
                { full: "Sat", mobile: "Sa" },
                { full: "Sun", mobile: "Su" },
            ],
            dayLabel: (date: Date) => format(date, "MMMM d", { locale: enUS }),
            eventCount: (count: number) => count === 1 ? "1 event" : `${count} events`,
            more: (count: number) => `+${count} more`,
        };
    }

    return {
        weekDays: [
            { full: "Man", mobile: "Ma" },
            { full: "Tir", mobile: "Ti" },
            { full: "Ons", mobile: "On" },
            { full: "Tor", mobile: "To" },
            { full: "Fre", mobile: "Fr" },
            { full: "Lør", mobile: "Lø" },
            { full: "Søn", mobile: "Sø" },
        ],
        dayLabel: (date: Date) => format(date, "d. MMMM", { locale: nb }),
        eventCount: (count: number) => count === 1 ? "1 hendelse" : `${count} hendelser`,
        more: (count: number) => `+${count} mer`,
    };
}

// Hovedkomponent for kalendergrid som viser dager og innleveringer
export const CalendarGrid = memo(function CalendarGrid({
    currentDate,
    assignments,
    language,
    onDateClick,
    selectedDate,
}: CalendarGridProps) {
    const labels = getCalendarGridLabels(language);

    // Beregn alle dager som skal vises i kalenderen
    const days = useMemo(() => {
        const monthStart = startOfMonth(currentDate);
        const monthEnd = endOfMonth(currentDate);
        const calendarStart = startOfWeek(monthStart, { weekStartsOn: 1 });
        const calendarEnd = endOfWeek(monthEnd, { weekStartsOn: 1 });

        return eachDayOfInterval({ start: calendarStart, end: calendarEnd });
    }, [currentDate]);

    // Pre-beregn assignments per dato i en Map for O(1) oppslag
    // Dette erstatter 126+ filter-operasjoner med 1 enkelt pass
    const assignmentsByDate = useMemo(() => {
        const map = new Map<string, Assignment[]>();
        for (const a of assignments) {
            const key = format(a.dueDate, "yyyy-MM-dd");
            const existing = map.get(key);
            if (existing) {
                existing.push(a);
            } else {
                map.set(key, [a]);
            }
        }
        return map;
    }, [assignments]);

    // Beregn today og threeDaysFromNow — oppdateres ved navigering/re-render
    const today = useMemo(() => startOfDay(new Date()), []);
    const threeDaysFromNow = useMemo(() => {
        const d = new Date(today);
        d.setDate(today.getDate() + 3);
        return d;
    }, [today]);

    // Hent innleveringer for en gitt dato - O(1) oppslag
    const getAssignmentsForDate = (date: Date): Assignment[] => {
        const key = format(date, "yyyy-MM-dd");
        return assignmentsByDate.get(key) || [];
    };

    // Sjekk om datoen har forfalte (overdue) innleveringer
    const hasOverdueAssignment = (dayAssignments: Assignment[]) => {
        return dayAssignments.some(
            (a) => !a.completed && isBefore(startOfDay(a.dueDate), today)
        );
    };

    // Sjekk om datoen har innleveringer som snart forfaller (innen 3 dager)
    const hasUpcomingDeadline = (dayAssignments: Assignment[]) => {
        return dayAssignments.some(
            (a) =>
                !a.completed &&
                !isBefore(startOfDay(a.dueDate), today) &&
                isBefore(startOfDay(a.dueDate), threeDaysFromNow)
        );
    };

    return (
        <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm overflow-hidden">
            {/* Ukedager header - kortere tekst på mobil */}
            <div className="grid grid-cols-7 border-b border-slate-200 dark:border-slate-700">
                {labels.weekDays.map((day) => (
                    <div
                        key={day.full}
                        className="py-2 md:py-3 text-center text-xs md:text-sm font-semibold text-slate-500 dark:text-slate-400"
                    >
                        <span className="hidden sm:inline">{day.full}</span>
                        <span className="sm:hidden">{day.mobile}</span>
                    </div>
                ))}
            </div>

            {/* Kalenderdager - mobile-first med mindre høyde på små skjermer */}
            <div className="grid grid-cols-7">
                {days.map((day, index) => {
                    const dayAssignments = getAssignmentsForDate(day);
                    const isCurrentMonth = isSameMonth(day, currentDate);
                    const isSelected = selectedDate && isSameDay(day, selectedDate);
                    const isTodayDate = isToday(day);
                    const isOverdue = hasOverdueAssignment(dayAssignments);
                    const isUpcoming = hasUpcomingDeadline(dayAssignments);

                    return (
                        <button
                            type="button"
                            key={day.toISOString()}
                            onClick={() => onDateClick(day)}
                            aria-label={`${labels.dayLabel(day)}${dayAssignments.length > 0 ? `, ${labels.eventCount(dayAssignments.length)}` : ""}`}
                            className={cn(
                                // Mobile-first: mindre padding og høyde, større på desktop
                                "min-h-16 sm:min-h-20 md:min-h-24 p-1 sm:p-1.5 md:p-2 border-b border-r border-slate-200 dark:border-slate-700 text-left transition-all duration-200 relative",
                                "hover:bg-slate-50 dark:hover:bg-slate-700/50 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-inset",
                                !isCurrentMonth && "bg-slate-50 dark:bg-slate-900/50 text-slate-400 dark:text-slate-500",
                                isSelected && "bg-blue-50 dark:bg-blue-900/30 ring-2 ring-blue-500 ring-inset",
                                isTodayDate && !isSelected && "bg-blue-50/50 dark:bg-blue-900/20",
                                index % 7 === 6 && "border-r-0"
                            )}
                        >
                            {/* Dagnummer - mindre på mobil */}
                            <div className="flex items-center justify-between mb-0.5 sm:mb-1">
                                <span
                                    className={cn(
                                        "text-xs sm:text-sm font-medium w-5 h-5 sm:w-6 sm:h-6 md:w-7 md:h-7 flex items-center justify-center rounded-full",
                                        isTodayDate && "bg-blue-500 text-white"
                                    )}
                                >
                                    {format(day, "d")}
                                </span>
                                {/* Varsler - kun vis på desktop eller når valgt */}
                                <span className="hidden sm:block">
                                    {isUpcoming && !isOverdue && (
                                        <AlertCircle className="w-3 h-3 md:w-4 md:h-4 text-amber-500 dark:text-amber-400" />
                                    )}
                                    {isOverdue && (
                                        <AlertCircle className="w-3 h-3 md:w-4 md:h-4 text-red-500 dark:text-red-400" />
                                    )}
                                </span>
                            </div>

                            {/* Innleveringsbadges - skjult på mobil, vis bare antall */}
                            <div className="hidden sm:block space-y-0.5 md:space-y-1">
                                {dayAssignments.slice(0, 2).map((assignment) => (
                                    <div
                                        key={assignment.id}
                                        className={cn(
                                            "text-[10px] md:text-xs px-1 md:px-1.5 py-0.5 rounded truncate text-white font-medium",
                                            COURSE_COLOR_CLASSES[assignment.courseColor],
                                            assignment.completed && "opacity-50 line-through"
                                        )}
                                        title={`${assignment.courseCode}: ${assignment.title}`}
                                    >
                                        {assignment.courseCode}
                                    </div>
                                ))}
                                {dayAssignments.length > 2 && (
                                    <div className="text-[10px] md:text-xs text-slate-500 dark:text-slate-400 font-medium px-1">
                                        {labels.more(dayAssignments.length - 2)}
                                    </div>
                                )}
                            </div>

                            {/* Mobil: Vis bare fargede prikker for hendelser */}
                            <div className="flex flex-wrap gap-0.5 sm:hidden mt-0.5">
                                {dayAssignments.slice(0, 3).map((assignment) => (
                                    <div
                                        key={assignment.id}
                                        className={cn(
                                            "w-1.5 h-1.5 rounded-full",
                                            COURSE_COLOR_CLASSES[assignment.courseColor]
                                        )}
                                    />
                                ))}
                            </div>

                            {/* Antall innleveringer badge */}
                            {dayAssignments.length > 0 && (
                                <div className="absolute top-0.5 right-0.5 sm:top-1 sm:right-1 w-4 h-4 sm:w-5 sm:h-5 bg-blue-500 dark:bg-blue-600 text-white text-[10px] sm:text-xs font-bold rounded-full flex items-center justify-center">
                                    {dayAssignments.length}
                                </div>
                            )}
                        </button>
                    );
                })}
            </div>
        </div>
    );
});

export default CalendarGrid;
