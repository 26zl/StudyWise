/**
 * CalendarGrid - Kalendervisning med dager og innleveringer
 * Viser månedskalender med oppgaver/innleveringer markert per dag
 */
"use client";

import { useMemo } from "react";
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
import { AlertCircle } from "lucide-react";
import { cn } from "../lib/utils";
import { Assignment } from "common/calendar-ui";
import { COURSE_COLOR_CLASSES } from "./calendarColors";

interface CalendarGridProps {
    currentDate: Date;
    assignments: Assignment[];
    onDateClick: (date: Date) => void;
    selectedDate: Date | null;
}

const WEEK_DAYS = ["Man", "Tir", "Ons", "Tor", "Fre", "Lor", "Son"];

export function CalendarGrid({
    currentDate,
    assignments,
    onDateClick,
    selectedDate,
}: CalendarGridProps) {
    // Beregn alle dager som skal vises i kalenderen
    const days = useMemo(() => {
        const monthStart = startOfMonth(currentDate);
        const monthEnd = endOfMonth(currentDate);
        const calendarStart = startOfWeek(monthStart, { weekStartsOn: 1 });
        const calendarEnd = endOfWeek(monthEnd, { weekStartsOn: 1 });

        return eachDayOfInterval({ start: calendarStart, end: calendarEnd });
    }, [currentDate]);

    // Hent innleveringer for en gitt dato
    const getAssignmentsForDate = (date: Date) => {
        return assignments.filter((a) => isSameDay(a.dueDate, date));
    };

    // Sjekk om datoen har forfalte (overdue) innleveringer
    const hasOverdueAssignment = (date: Date) => {
        const dayAssignments = getAssignmentsForDate(date);
        const today = startOfDay(new Date());
        return dayAssignments.some(
            (a) => !a.completed && isBefore(startOfDay(a.dueDate), today)
        );
    };

    // Sjekk om datoen har innleveringer som snart forfaller (innen 3 dager)
    const hasUpcomingDeadline = (date: Date) => {
        const today = startOfDay(new Date());
        const threeDaysFromNow = new Date(today);
        threeDaysFromNow.setDate(today.getDate() + 3);

        const dayAssignments = getAssignmentsForDate(date);
        return dayAssignments.some(
            (a) =>
                !a.completed &&
                !isBefore(startOfDay(a.dueDate), today) &&
                isBefore(startOfDay(a.dueDate), threeDaysFromNow)
        );
    };

    // Korte dagnavn for mobil
    const WEEK_DAYS_SHORT = ["M", "T", "O", "T", "F", "L", "S"];

    return (
        <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm overflow-hidden">
            {/* Ukedager header - responsiv tekst */}
            <div className="grid grid-cols-7 border-b border-slate-200 dark:border-slate-700">
                {WEEK_DAYS.map((day, i) => (
                    <div
                        key={day}
                        className="py-2 sm:py-3 text-center text-xs sm:text-sm font-semibold text-slate-500 dark:text-slate-400"
                    >
                        {/* Vis kort navn på mobil, fullt navn på større skjermer */}
                        <span className="sm:hidden">{WEEK_DAYS_SHORT[i]}</span>
                        <span className="hidden sm:inline">{day}</span>
                    </div>
                ))}
            </div>

            {/* Kalenderdager - responsiv grid */}
            <div className="grid grid-cols-7">
                {days.map((day, index) => {
                    const dayAssignments = getAssignmentsForDate(day);
                    const isCurrentMonth = isSameMonth(day, currentDate);
                    const isSelected = selectedDate && isSameDay(day, selectedDate);
                    const isTodayDate = isToday(day);
                    const isOverdue = hasOverdueAssignment(day);
                    const isUpcoming = hasUpcomingDeadline(day);

                    return (
                        <button
                            key={day.toISOString()}
                            onClick={() => onDateClick(day)}
                            className={cn(
                                // Responsiv høyde: mindre på mobil, større på desktop
                                "min-h-16 sm:min-h-20 md:min-h-24 lg:min-h-28",
                                "p-1 sm:p-2 border-b border-r border-slate-200 dark:border-slate-700 text-left transition-all duration-200 relative",
                                "hover:bg-slate-50 dark:hover:bg-slate-700/50 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-inset",
                                // Touch-vennlig på mobil
                                "active:bg-slate-100 dark:active:bg-slate-700",
                                !isCurrentMonth && "bg-slate-50 dark:bg-slate-900/50 text-slate-400 dark:text-slate-500",
                                isSelected && "bg-blue-50 dark:bg-blue-900/30 ring-2 ring-blue-500 ring-inset",
                                isTodayDate && !isSelected && "bg-blue-50/50 dark:bg-blue-900/20",
                                index % 7 === 6 && "border-r-0"
                            )}
                        >
                            {/* Dagnummer - responsiv størrelse */}
                            <div className="flex items-center justify-between mb-0.5 sm:mb-1">
                                <span
                                    className={cn(
                                        "text-xs sm:text-sm font-medium",
                                        "w-5 h-5 sm:w-6 sm:h-6 md:w-7 md:h-7",
                                        "flex items-center justify-center rounded-full",
                                        isTodayDate && "bg-blue-500 text-white"
                                    )}
                                >
                                    {format(day, "d")}
                                </span>
                                {isUpcoming && !isOverdue && (
                                    <AlertCircle className="w-3 h-3 sm:w-4 sm:h-4 text-amber-500 dark:text-amber-400" />
                                )}
                                {isOverdue && (
                                    <AlertCircle className="w-3 h-3 sm:w-4 sm:h-4 text-red-500 dark:text-red-400" />
                                )}
                            </div>

                            {/* Innleveringsbadges - responsiv, skjul detaljer på mobil */}
                            <div className="space-y-0.5 sm:space-y-1 hidden sm:block">
                                {dayAssignments.slice(0, 2).map((assignment) => (
                                    <div
                                        key={assignment.id}
                                        className={cn(
                                            "text-[10px] sm:text-xs px-1 sm:px-1.5 py-0.5 rounded truncate text-white font-medium",
                                            COURSE_COLOR_CLASSES[assignment.courseColor],
                                            assignment.completed && "opacity-50 line-through"
                                        )}
                                        title={`${assignment.courseCode}: ${assignment.title}`}
                                    >
                                        {assignment.courseCode}
                                    </div>
                                ))}
                                {dayAssignments.length > 2 && (
                                    <div className="text-[10px] sm:text-xs text-slate-500 dark:text-slate-400 font-medium px-1">
                                        +{dayAssignments.length - 2}
                                    </div>
                                )}
                            </div>
                            {/* Mobil: vis kun fargeprikker for innleveringer */}
                            <div className="flex flex-wrap gap-0.5 sm:hidden mt-1">
                                {dayAssignments.slice(0, 4).map((assignment) => (
                                    <span
                                        key={assignment.id}
                                        className={cn(
                                            "w-2 h-2 rounded-full",
                                            COURSE_COLOR_CLASSES[assignment.courseColor],
                                            assignment.completed && "opacity-50"
                                        )}
                                        title={`${assignment.courseCode}: ${assignment.title}`}
                                    />
                                ))}
                            </div>

                            {/* Antall innleveringer badge - responsiv størrelse */}
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
}

export default CalendarGrid;
