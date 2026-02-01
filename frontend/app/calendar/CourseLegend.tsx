/**
 * CourseLegend - Viser fargeforklaring for emner
 * Brukes sammen med kalender for å vise hvilke farger som tilhører hvilke emner
 */
"use client";

import { cn } from "../lib/utils";
import { Course, COURSE_COLOR_CLASSES } from "common/calendar-ui";

interface CourseLegendProps {
    courses: Course[];
}

export function CourseLegend({ courses }: CourseLegendProps) {
    if (courses.length === 0) {
        return null;
    }

    return (
        <div className="flex flex-wrap items-center gap-4 mb-6 p-3 bg-slate-100/50 dark:bg-slate-800/50 rounded-lg">
            <span className="text-sm font-medium text-slate-500 dark:text-slate-400">
                Emner:
            </span>
            {courses.map((course) => (
                <div key={course.code} className="flex items-center gap-2">
                    <span
                        className={cn(
                            "w-3 h-3 rounded-full",
                            COURSE_COLOR_CLASSES[course.color]
                        )}
                    />
                    <span className="text-sm text-slate-700 dark:text-slate-200">
                        {course.code} - {course.name}
                    </span>
                </div>
            ))}
        </div>
    );
}

export default CourseLegend;
