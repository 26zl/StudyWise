/*
 * CalendarHeader - Header for kalendervisning
 * Navigasjon mellom måneder og valg av måned/år
 * Inkluderer filter for innleveringer/timeplan
 */
"use client";

import { format } from "date-fns";
import { nb } from "date-fns/locale";
import { ChevronLeft, ChevronRight, CalendarDays, Filter } from "lucide-react";
import type { CalendarFilterType } from "common/calendar-ui";

interface CalendarHeaderProps {
    currentDate: Date;
    onPrevMonth: () => void;
    onNextMonth: () => void;
    onToday: () => void;
    onMonthChange: (month: number) => void;
    onYearChange: (year: number) => void;
    filter?: CalendarFilterType;
    onFilterChange?: (filter: CalendarFilterType) => void;
    hasTimeEditData?: boolean; // Viser om det finnes TimeEdit-data (lastes automatisk)
}

const MONTHS = [
    "Januar",
    "Februar",
    "Mars",
    "April",
    "Mai",
    "Juni",
    "Juli",
    "August",
    "September",
    "Oktober",
    "November",
    "Desember",
];

const FILTER_OPTIONS: { value: CalendarFilterType; label: string }[] = [
    { value: "all", label: "Alle hendelser" },
    { value: "assignments", label: "Kun innleveringer" },
    { value: "timetable", label: "Kun timeplan" },
];

export function CalendarHeader({
    currentDate,
    onPrevMonth,
    onNextMonth,
    onToday,
    onMonthChange,
    onYearChange,
    filter = "all",
    onFilterChange,
    hasTimeEditData = false,
}: CalendarHeaderProps) {
    const currentYear = new Date().getFullYear();
    const years = Array.from({ length: 5 }, (_, i) => currentYear - 2 + i);

    return (
        <div className="flex flex-col gap-4 mb-6">
            {/* Hovedrad: Tittel, velgere og navigasjon */}
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
                {/* Tittel og velgere */}
                <div className="flex flex-col sm:flex-row items-start sm:items-center gap-4">
                    <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-100 capitalize">
                        {format(currentDate, "MMMM yyyy", { locale: nb })}
                    </h1>

                    <div className="flex items-center gap-2">
                        {/* Maaned-velger */}
                        <select
                            value={currentDate.getMonth().toString()}
                            onChange={(e) => onMonthChange(parseInt(e.target.value))}
                            className="h-9 px-3 rounded-lg border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-700 text-slate-900 dark:text-slate-100 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                        >
                            {MONTHS.map((month, index) => (
                                <option key={month} value={index.toString()}>
                                    {month}
                                </option>
                            ))}
                        </select>

                        {/* Aar-velger */}
                        <select
                            value={currentDate.getFullYear().toString()}
                            onChange={(e) => onYearChange(parseInt(e.target.value))}
                            className="h-9 px-3 rounded-lg border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-700 text-slate-900 dark:text-slate-100 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                        >
                            {years.map((year) => (
                                <option key={year} value={year.toString()}>
                                    {year}
                                </option>
                            ))}
                        </select>
                    </div>
                </div>

                {/* Navigasjonsknapper */}
                <div className="flex items-center gap-2">
                    {/* I dag-knapp */}
                    <button
                        onClick={onToday}
                        className="flex items-center gap-2 h-9 px-4 rounded-lg border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-700 text-slate-700 dark:text-slate-200 text-sm font-medium hover:bg-slate-50 dark:hover:bg-slate-600 transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500"
                    >
                        <CalendarDays className="w-4 h-4" />
                        I dag
                    </button>

                    {/* Forrige/Neste maaned */}
                    <div className="flex items-center border border-slate-200 dark:border-slate-600 rounded-lg overflow-hidden">
                        <button
                            onClick={onPrevMonth}
                            className="h-9 w-9 flex items-center justify-center bg-white dark:bg-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-600 transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-inset"
                            aria-label="Forrige maaned"
                        >
                            <ChevronLeft className="w-5 h-5" />
                        </button>
                        <div className="w-px h-9 bg-slate-200 dark:bg-slate-600" />
                        <button
                            onClick={onNextMonth}
                            className="h-9 w-9 flex items-center justify-center bg-white dark:bg-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-600 transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-inset"
                            aria-label="Neste maaned"
                        >
                            <ChevronRight className="w-5 h-5" />
                        </button>
                    </div>
                </div>
            </div>

            {/* Filter-rad (vises alltid hvis onFilterChange er tilgjengelig) */}
            {onFilterChange && (
                <div className="flex items-center gap-3 pb-2 border-b border-slate-200 dark:border-slate-700">
                    <div className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-400">
                        <Filter className="w-4 h-4" />
                        <span>Vis:</span>
                    </div>
                    <div className="flex items-center gap-1">
                        {FILTER_OPTIONS.map((option) => {
                            const isActive = filter === option.value;
                            
                            return (
                                <button
                                    key={option.value}
                                    onClick={() => onFilterChange(option.value)}
                                    className={`
                                        px-3 py-1.5 rounded-lg text-sm font-medium transition-colors
                                        ${isActive
                                            ? "bg-blue-600 text-white"
                                            : "bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700"
                                        }
                                    `}
                                >
                                    {option.label}
                                </button>
                            );
                        })}
                    </div>
                    {filter === "timetable" && !hasTimeEditData && (
                        <span className="text-xs text-amber-600 dark:text-amber-400 ml-2">
                            (Ingen timeplan-data funnet for dine emner)
                        </span>
                    )}
                    {filter !== "all" && (
                        <span className="text-xs text-slate-500 dark:text-slate-400 ml-2">
                            {filter === "assignments" ? "(Canvas innleveringer)" : "(TimeEdit timeplan - automatisk)"}
                        </span>
                    )}
                </div>
            )}
        </div>
    );
}

export default CalendarHeader;
