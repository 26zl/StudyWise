/**
 * DateDetailsModal - Modal for visning av innleveringer for en dato
 * Viser detaljer om alle oppgaver for valgt dato med mulighet for å markere som fullført
 */
"use client";

import { useEffect, useRef } from "react";
import { format } from "date-fns";
import { nb } from "date-fns/locale";
import { Clock, Check, X as XIcon } from "lucide-react";
import { cn } from "../app/lib/utils";
import {
    Assignment,
    COURSE_BG_LIGHT_CLASSES,
    COURSE_DOT_CLASSES,
} from "../app/types/calendar";

interface DateDetailsModalProps {
    date: Date | null;
    assignments: Assignment[];
    open: boolean;
    onOpenChange: (open: boolean) => void;
    onToggleComplete: (id: string) => void;
}

export function DateDetailsModal({
    date,
    assignments,
    open,
    onOpenChange,
    onToggleComplete,
}: DateDetailsModalProps) {
    const dialogRef = useRef<HTMLDialogElement>(null);

    // Synkroniser open prop med dialog element
    useEffect(() => {
        const dialog = dialogRef.current;
        if (!dialog) return;

        if (open) {
            dialog.showModal();
        } else {
            dialog.close();
        }
    }, [open]);

    // Lukk ved klikk utenfor
    const handleBackdropClick = (e: React.MouseEvent<HTMLDialogElement>) => {
        const dialog = dialogRef.current;
        if (!dialog) return;

        const rect = dialog.getBoundingClientRect();
        const isClickInside =
            e.clientX >= rect.left &&
            e.clientX <= rect.right &&
            e.clientY >= rect.top &&
            e.clientY <= rect.bottom;

        if (!isClickInside) {
            onOpenChange(false);
        }
    };

    // Lukk ved Escape
    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === "Escape") {
            onOpenChange(false);
        }
    };

    if (!date) return null;

    const dateAssignments = assignments.filter(
        (a) => a.dueDate.toDateString() === date.toDateString()
    );

    return (
        <dialog
            ref={dialogRef}
            onClick={handleBackdropClick}
            onKeyDown={handleKeyDown}
            className="fixed inset-0 z-50 m-auto w-full max-w-md rounded-xl bg-white dark:bg-slate-800 p-0 shadow-xl backdrop:bg-black/50 backdrop:backdrop-blur-sm"
        >
            {/* Header */}
            <div className="flex items-center justify-between border-b border-slate-200 dark:border-slate-700 p-4">
                <h2 className="text-xl font-semibold text-slate-900 dark:text-slate-100">
                    {format(date, "EEEE d. MMMM yyyy", { locale: nb })}
                </h2>
                <button
                    onClick={() => onOpenChange(false)}
                    className="h-8 w-8 flex items-center justify-center rounded-lg text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors"
                    aria-label="Lukk"
                >
                    <XIcon className="w-5 h-5" />
                </button>
            </div>

            {/* Content */}
            <div className="p-4 space-y-3 max-h-[400px] overflow-y-auto">
                {dateAssignments.length === 0 ? (
                    <p className="text-slate-500 dark:text-slate-400 text-center py-6">
                        Ingen innleveringer denne dagen
                    </p>
                ) : (
                    dateAssignments.map((assignment) => (
                        <div
                            key={assignment.id}
                            className={cn(
                                "p-4 rounded-lg border-l-4 transition-all",
                                COURSE_BG_LIGHT_CLASSES[assignment.courseColor],
                                assignment.completed && "opacity-60"
                            )}
                        >
                            <div className="flex items-start justify-between gap-3">
                                <div className="flex-1">
                                    <div className="flex items-center gap-2 mb-1">
                                        <span
                                            className={cn(
                                                "w-2.5 h-2.5 rounded-full",
                                                COURSE_DOT_CLASSES[assignment.courseColor]
                                            )}
                                        />
                                        <span className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                                            {assignment.courseCode}
                                            {assignment.courseName && ` - ${assignment.courseName}`}
                                        </span>
                                    </div>
                                    <h3
                                        className={cn(
                                            "font-medium text-slate-900 dark:text-slate-100",
                                            assignment.completed && "line-through"
                                        )}
                                    >
                                        {assignment.title}
                                    </h3>
                                    {assignment.description && (
                                        <p className="text-sm text-slate-500 dark:text-slate-400 mt-2">
                                            {assignment.description}
                                        </p>
                                    )}
                                    {assignment.dueTime && (
                                        <div className="flex items-center gap-2 mt-3 text-sm text-slate-500 dark:text-slate-400">
                                            <Clock className="w-4 h-4" />
                                            <span>Frist: {assignment.dueTime}</span>
                                        </div>
                                    )}
                                </div>

                                <button
                                    onClick={() => onToggleComplete(assignment.id)}
                                    className={cn(
                                        "flex items-center gap-1 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors flex-shrink-0",
                                        assignment.completed
                                            ? "bg-slate-200 dark:bg-slate-600 text-slate-700 dark:text-slate-200 hover:bg-slate-300 dark:hover:bg-slate-500"
                                            : "border border-slate-300 dark:border-slate-600 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700"
                                    )}
                                >
                                    {assignment.completed ? (
                                        <>
                                            <XIcon className="w-4 h-4" />
                                            Angre
                                        </>
                                    ) : (
                                        <>
                                            <Check className="w-4 h-4" />
                                            Fullfort
                                        </>
                                    )}
                                </button>
                            </div>
                        </div>
                    ))
                )}
            </div>
        </dialog>
    );
}

export default DateDetailsModal;
