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
import { Assignment, COURSE_COLOR_CLASSES } from "common/calendar-ui";

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

    return (
        <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm overflow-hidden">
            {/* Ukedager header - kortere tekst på mobil */}
            <div className="grid grid-cols-7 border-b border-slate-200 dark:border-slate-700">
                {WEEK_DAYS.map((day) => (
                    <div
                        key={day}
                        className="py-2 md:py-3 text-center text-xs md:text-sm font-semibold text-slate-500 dark:text-slate-400"
                    >
                        <span className="hidden sm:inline">{day}</span>
                        <span className="sm:hidden">{day.charAt(0)}</span>
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
                    const isOverdue = hasOverdueAssignment(day);
                    const isUpcoming = hasUpcomingDeadline(day);

                    return (
                        <button
                            key={day.toISOString()}
                            onClick={() => onDateClick(day)}
                            aria-label={`${format(day, "d. MMMM")}${dayAssignments.length > 0 ? `, ${dayAssignments.length} ${dayAssignments.length === 1 ? "hendelse" : "hendelser"}` : ""}`}
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
                                        +{dayAssignments.length - 2} mer
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
}

export default CalendarGrid;
