/**
 * CourseLegend - Viser fargeforklaring for emner
 * Brukes sammen med kalender for å vise hvilke farger som tilhører hvilke emner
 */
"use client";

import { cn } from "../lib/utils";
import { Course } from "common/calendar-ui";
import { COURSE_COLOR_CLASSES } from "./calendarColors";

interface CourseLegendProps {
    courses: Course[];
}

export function CourseLegend({ courses }: CourseLegendProps) {
    if (courses.length === 0) {
        return null;
    }

    return (
        <div className="mb-4 sm:mb-6 p-2 sm:p-3 bg-slate-100/50 dark:bg-slate-800/50 rounded-lg">
            <span className="text-xs sm:text-sm font-medium text-slate-500 dark:text-slate-400 block mb-2 sm:hidden">
                Emner:
            </span>
            <div className="flex items-center gap-2 overflow-x-auto scrollbar-hide pb-1 sm:pb-0 sm:flex-wrap sm:gap-4">
                <span className="text-sm font-medium text-slate-500 dark:text-slate-400 hidden sm:block shrink-0">
                    Emner:
                </span>
                {courses.map((course) => (
                    <div key={course.code} className="flex items-center gap-1.5 sm:gap-2 shrink-0">
                        <span
                            className={cn(
                                "w-2.5 h-2.5 sm:w-3 sm:h-3 rounded-full shrink-0",
                                COURSE_COLOR_CLASSES[course.color]
                            )}
                        />
                        <span className="text-xs sm:text-sm text-slate-700 dark:text-slate-200 whitespace-nowrap">
                            {/* Vis kun kode på mobil, full tekst på desktop */}
                            <span className="sm:hidden">{course.code}</span>
                            <span className="hidden sm:inline">{course.code} - {course.name}</span>
                        </span>
                    </div>
                ))}
            </div>
        </div>
    );
}

export default CourseLegend;
