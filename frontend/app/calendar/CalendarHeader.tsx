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
        <div className="flex flex-col gap-3 sm:gap-4 mb-4 sm:mb-6">
            {/* Rad 1: Tittel */}
            <h1 className="text-xl sm:text-2xl font-bold text-slate-900 dark:text-slate-100 capitalize">
                {format(currentDate, "MMMM yyyy", { locale: nb })}
            </h1>
            
            {/* Rad 2: Velgere og navigasjon */}
            <div className="flex flex-wrap items-center justify-between gap-2 sm:gap-4">
                {/* Måned/År velgere */}
                <div className="flex items-center gap-2">
                    {/* Maaned-velger */}
                    <select
                        value={currentDate.getMonth().toString()}
                        onChange={(e) => onMonthChange(parseInt(e.target.value))}
                        className="h-8 sm:h-9 px-2 sm:px-3 rounded-lg border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-700 text-slate-900 dark:text-slate-100 text-xs sm:text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
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
                        className="h-8 sm:h-9 px-2 sm:px-3 rounded-lg border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-700 text-slate-900 dark:text-slate-100 text-xs sm:text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    >
                        {years.map((year) => (
                            <option key={year} value={year.toString()}>
                                {year}
                            </option>
                        ))}
                    </select>
                </div>

                {/* Navigasjonsknapper */}
                <div className="flex items-center gap-1.5 sm:gap-2">
                    {/* I dag-knapp */}
                    <button
                        onClick={onToday}
                        className="flex items-center gap-1.5 sm:gap-2 h-8 sm:h-9 px-2.5 sm:px-4 rounded-lg border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-700 text-slate-700 dark:text-slate-200 text-xs sm:text-sm font-medium hover:bg-slate-50 dark:hover:bg-slate-600 active:bg-slate-100 dark:active:bg-slate-500 transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500"
                    >
                        <CalendarDays className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
                        <span className="hidden xs:inline">I dag</span>
                    </button>

                    {/* Forrige/Neste maaned */}
                    <div className="flex items-center border border-slate-200 dark:border-slate-600 rounded-lg overflow-hidden">
                        <button
                            onClick={onPrevMonth}
                            className="h-8 w-8 sm:h-9 sm:w-9 flex items-center justify-center bg-white dark:bg-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-600 active:bg-slate-100 dark:active:bg-slate-500 transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-inset"
                            aria-label="Forrige maaned"
                        >
                            <ChevronLeft className="w-4 h-4 sm:w-5 sm:h-5" />
                        </button>
                        <div className="w-px h-8 sm:h-9 bg-slate-200 dark:bg-slate-600" />
                        <button
                            onClick={onNextMonth}
                            className="h-8 w-8 sm:h-9 sm:w-9 flex items-center justify-center bg-white dark:bg-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-600 active:bg-slate-100 dark:active:bg-slate-500 transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-inset"
                            aria-label="Neste maaned"
                        >
                            <ChevronRight className="w-4 h-4 sm:w-5 sm:h-5" />
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
}

export default CalendarHeader;
