/**
 * UpcomingDeadlines - Panel for kommende innleveringsfrister
 * Viser de neste innleveringene sortert etter dato med status-indikatorer
 */
"use client";

import { format, startOfDay, differenceInDays } from "date-fns";
import { nb } from "date-fns/locale";
import { Clock, CheckCircle, AlertTriangle, CalendarPlus } from "lucide-react";
import { cn } from "../lib/utils";
import { Assignment, COURSE_BORDER_CLASSES } from "common/calendar-ui";

// Props for UpcomingDeadlines-komponenten
interface UpcomingDeadlinesProps {
    assignments: Assignment[];
    onToggleComplete: (id: string) => void;
}

// type for frist-status
type DeadlineStatus = "overdue" | "today" | "soon" | "normal";

// Hovedkomponent for kommende frister
export function UpcomingDeadlines({
    assignments,
    onToggleComplete,
}: UpcomingDeadlinesProps) {
    const today = startOfDay(new Date());

    // Filtrer og sorter innleveringer (kun ufullforte, maks 7 stk)
    const sortedAssignments = [...assignments]
        .filter((a) => !a.completed)
        .sort((a, b) => a.dueDate.getTime() - b.dueDate.getTime())
        .slice(0, 7);

    // Beregn status basert pa fristdato
    const getDeadlineStatus = (dueDate: Date): DeadlineStatus => {
        const daysDiff = differenceInDays(startOfDay(dueDate), today);

        if (daysDiff < 0) return "overdue";
        if (daysDiff === 0) return "today";
        if (daysDiff <= 3) return "soon";
        return "normal";
    };

    // Formater frist-tekst
    const formatDeadlineText = (dueDate: Date): string => {
        const daysDiff = differenceInDays(startOfDay(dueDate), today);

        if (daysDiff < 0) return `${Math.abs(daysDiff)} dager siden`;
        if (daysDiff === 0) return "I dag";
        if (daysDiff === 1) return "I morgen";
        if (daysDiff <= 7) return `Om ${daysDiff} dager`;
        return format(dueDate, "d. MMMM", { locale: nb });
    };

    return (
        <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm h-fit">
            {/* Header - responsiv padding */}
            <div className="p-3 sm:p-4 border-b border-slate-200 dark:border-slate-700">
                <h2 className="text-base sm:text-lg font-semibold text-slate-900 dark:text-slate-100">
                    Kommende frister
                </h2>
                <p className="text-xs sm:text-sm text-slate-500 dark:text-slate-400 mt-0.5">
                    Dine neste innleveringer
                </p>
            </div>

            {/* Liste - responsiv h-fit og padding */}
            <div className="p-2 sm:p-3 space-y-2 max-h-64 sm:max-h-96 lg:max-h-150 overflow-y-auto">
                {sortedAssignments.length === 0 ? (
                    <div className="py-8 text-center text-slate-500 dark:text-slate-400">
                        <CheckCircle className="w-12 h-12 mx-auto mb-3 opacity-50" />
                        <p className="font-medium">Ingen aktive frister!</p>
                        <p className="text-sm mt-1">Nyt friheten</p>
                    </div>
                ) : (
                    sortedAssignments.map((assignment) => {
                        const status = getDeadlineStatus(assignment.dueDate);

                        return (
                            <div
                                key={assignment.id}
                                className={cn(
                                    "p-3 rounded-lg border-l-4 bg-slate-50 dark:bg-slate-700/30 hover:bg-slate-100 dark:hover:bg-slate-700/50 transition-colors animate-fade-in",
                                    COURSE_BORDER_CLASSES[assignment.courseColor]
                                )}
                            >
                                <div className="flex items-start justify-between gap-2">
                                    <div className="min-w-0 flex-1">
                                        <div className="flex items-center gap-2 mb-1">
                                            <span className="text-xs font-semibold text-slate-500 dark:text-slate-400">
                                                {assignment.courseCode}
                                            </span>
                                            {status === "overdue" && (
                                                <span className="inline-flex items-center gap-1 text-xs text-red-600 dark:text-red-400 font-medium">
                                                    <AlertTriangle className="w-3 h-3" />
                                                    Forfalt
                                                </span>
                                            )}
                                            {status === "today" && (
                                                <span className="inline-flex items-center gap-1 text-xs text-amber-600 dark:text-amber-400 font-medium">
                                                    <Clock className="w-3 h-3" />
                                                    I dag
                                                </span>
                                            )}
                                        </div>
                                        <h3 className="text-sm font-medium text-slate-900 dark:text-slate-100 truncate">
                                            {assignment.title}
                                        </h3>
                                        <div className="flex items-center gap-2 mt-1.5 text-xs text-slate-500 dark:text-slate-400">
                                            <Clock className="w-3.5 h-3.5" />
                                            <span>{formatDeadlineText(assignment.dueDate)}</span>
                                            {assignment.dueTime && (
                                                <>
                                                    <span>-</span>
                                                    <span>{assignment.dueTime}</span>
                                                </>
                                            )}
                                        </div>
                                    </div>

                                    {/* Checkbox kun for innleveringer, ikke forelesninger */}
                                    {(assignment.source === "assignment" || assignment.source === "todo") &&
                                     assignment.description !== "calendar_event" && (
                                        <button
                                            onClick={() => onToggleComplete(assignment.id)}
                                            className={cn(
                                                "w-5 h-5 rounded-full border-2 shrink-0 transition-all hover:scale-110",
                                                status === "overdue"
                                                    ? "border-red-500 dark:border-red-400 hover:bg-red-100 dark:hover:bg-red-900/30"
                                                    : "border-blue-500 dark:border-blue-400 hover:bg-blue-100 dark:hover:bg-blue-900/30"
                                            )}
                                            title="Marker som fullfort"
                                            aria-label="Marker som fullfort"
                                        />
                                    )}
                                </div>

                                {/* Eksport-knapp */}
                                <div className="mt-3">
                                    <button className="flex items-center gap-1.5 h-7 px-2 text-xs text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-200 dark:hover:bg-slate-600 rounded transition-colors">
                                        <CalendarPlus className="w-3.5 h-3.5" />
                                        Eksporter
                                    </button>
                                </div>
                            </div>
                        );
                    })
                )}
            </div>
        </div>
    );
}

export default UpcomingDeadlines;
