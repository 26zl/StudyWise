/**
 * CourseLegend - Viser fargeforklaring for emner
 * Brukes sammen med kalender for å vise hvilke farger som tilhører hvilke emner
 */
"use client";

import { cn } from "../lib/utils";
import { Course, COURSE_COLOR_CLASSES } from "common/calendar-ui";

// Props for CourseLegend-komponenten
interface CourseLegendProps {
    courses: Course[];
}

// Hovedkomponent for CourseLegend som viser unike emnekoder med fargeindikatorer
export function CourseLegend({ courses }: CourseLegendProps) {
    if (courses.length === 0) {
        return null;
    }

    // Regex for å ekstrahere emnekoder
    const COURSE_CODE_REGEX = /^([A-ZÆØÅ]{2,5}\d{4,5}[A-Z]?|\d{4,5}[A-Z])/i;
    
    // Filtrer ut duplikater og håndter spesialtilfeller
    const uniqueCourses = courses.filter((course, index, self) => {
        // Hopp over "Annet" helt
        if (course.code === "Annet") return false;
        
        // Ekstraher ren emnekode
        const codeMatch = course.code.match(COURSE_CODE_REGEX);
        const cleanCode = codeMatch ? codeMatch[0].toUpperCase() : course.code;
        
        // Sjekk om vi allerede har denne emnekoden
        return self.findIndex(c => {
            const otherMatch = c.code.match(COURSE_CODE_REGEX);
            const otherClean = otherMatch ? otherMatch[0].toUpperCase() : c.code;
            return otherClean === cleanCode;
        }) === index;
    });

    return (
        <div className="flex flex-wrap items-center gap-2 sm:gap-3 mb-3 sm:mb-4 px-2 sm:px-3 py-1.5 sm:py-2 bg-slate-100/50 dark:bg-slate-800/50 rounded-lg text-[10px] sm:text-xs">
            <span className="font-medium text-slate-500 dark:text-slate-400">
                Emner:
            </span>
            {uniqueCourses.map((course) => {
                // Ekstraher kun emnekoden (f.eks. "BOP3000")
                const codeMatch = course.code.match(COURSE_CODE_REGEX);
                const displayCode = codeMatch ? codeMatch[0].toUpperCase() : course.code;

                return (
                    <div key={course.code} className="flex items-center gap-1 sm:gap-1.5">
                        <span
                            className={cn(
                                "w-2 h-2 sm:w-2.5 sm:h-2.5 rounded-full shrink-0",
                                COURSE_COLOR_CLASSES[course.color]
                            )}
                        />
                        <span className="text-slate-700 dark:text-slate-200 font-medium">
                            {displayCode}
                        </span>
                    </div>
                );
            })}
        </div>
    );
}

export default CourseLegend;
