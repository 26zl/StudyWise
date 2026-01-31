/*
 * CalendarHeader - Header for kalendervisning
 * Navigasjon mellom måneder og valg av måned/år
 */
"use client";

import { format } from "date-fns";
import { nb } from "date-fns/locale";
import { ChevronLeft, ChevronRight, CalendarDays } from "lucide-react";

interface CalendarHeaderProps {
    currentDate: Date;
    onPrevMonth: () => void;
    onNextMonth: () => void;
    onToday: () => void;
    onMonthChange: (month: number) => void;
    onYearChange: (year: number) => void;
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

export function CalendarHeader({
    currentDate,
    onPrevMonth,
    onNextMonth,
    onToday,
    onMonthChange,
    onYearChange,
}: CalendarHeaderProps) {
    const currentYear = new Date().getFullYear();
    const years = Array.from({ length: 5 }, (_, i) => currentYear - 2 + i);

    return (
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 mb-6">
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

                {/* Forrige/Neste måned */}
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
    );
}

export default CalendarHeader;
