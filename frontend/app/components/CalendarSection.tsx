/**
 * CalendarSection - Kalender-seksjon for dashboardet
 * Kombinerer CalendarHeader, CalendarGrid og CourseLegend
 * Håndterer tilstand og navigasjon for kalenderen
 
"use client";

import { useState, useMemo } from "react";
import { addMonths, subMonths, setMonth, setYear } from "date-fns";
import { CalendarHeader } from "./CalendarHeader";
import { CalendarGrid } from "./CalendarGrid";
//import { CourseLegend } from "./CourseLegend";
//import type { Assignment, Course } from "../types/calendar";

// Demo-data for utvikling - vil bli erstattet med Canvas API-data
const DEMO_COURSES: Course[] = [
    { code: "IS-304", name: "Programmering", color: "programming" },
    { code: "IS-305", name: "Databaser", color: "database" },
    { code: "IS-306", name: "Nettverk", color: "network" },
    { code: "IS-307", name: "Sikkerhet", color: "security" },
    { code: "MA-100", name: "Matematikk", color: "math" },
];

const DEMO_ASSIGNMENTS: Assignment[] = [
    {
        id: "1",
        title: "Innlevering 1",
        courseCode: "IS-304",
        courseColor: "programming",
        dueDate: new Date(2026, 0, 15),
        completed: true,
    },
    {
        id: "2",
        title: "Databaseprosjekt",
        courseCode: "IS-305",
        courseColor: "database",
        dueDate: new Date(2026, 1, 3),
        completed: false,
    },
    {
        id: "3",
        title: "Nettverkslab",
        courseCode: "IS-306",
        courseColor: "network",
        dueDate: new Date(2026, 1, 5),
        completed: false,
    },
    {
        id: "4",
        title: "Sikkerhetsoving",
        courseCode: "IS-307",
        courseColor: "security",
        dueDate: new Date(2026, 1, 10),
        completed: false,
    },
    {
        id: "5",
        title: "Matteeksamen",
        courseCode: "MA-100",
        courseColor: "math",
        dueDate: new Date(2026, 1, 20),
        completed: false,
    },
];

export function CalendarSection() {
    const [currentDate, setCurrentDate] = useState(new Date());
    const [selectedDate, setSelectedDate] = useState<Date | null>(null);

    // Navigasjonsfunksjoner
    const handlePrevMonth = () => setCurrentDate((prev) => subMonths(prev, 1));
    const handleNextMonth = () => setCurrentDate((prev) => addMonths(prev, 1));
    const handleToday = () => {
        setCurrentDate(new Date());
        setSelectedDate(new Date());
    };
    const handleMonthChange = (month: number) => {
        setCurrentDate((prev) => setMonth(prev, month));
    };
    const handleYearChange = (year: number) => {
        setCurrentDate((prev) => setYear(prev, year));
    };
    const handleDateClick = (date: Date) => {
        setSelectedDate(date);
    };

    // Filtrer innleveringer for valgt dato
    const selectedDateAssignments = useMemo(() => {
        if (!selectedDate) return [];
        return DEMO_ASSIGNMENTS.filter(
            (a) =>
                a.dueDate.getDate() === selectedDate.getDate() &&
                a.dueDate.getMonth() === selectedDate.getMonth() &&
                a.dueDate.getFullYear() === selectedDate.getFullYear()
        );
    }, [selectedDate]);

    return (
        <div className="calendar-page">
          
            <CalendarHeader
                currentDate={currentDate}
                onPrevMonth={handlePrevMonth}
                onNextMonth={handleNextMonth}
                onToday={handleToday}
                onMonthChange={handleMonthChange}
                onYearChange={handleYearChange}
            />

            
            <CourseLegend courses={DEMO_COURSES} />
           
          
            <div className="calendar-layout">
               
                <CalendarGrid
                    currentDate={currentDate}
                    assignments={DEMO_ASSIGNMENTS}
                    onDateClick={handleDateClick}
                    selectedDate={selectedDate}
                />

                
                <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 p-4 h-fit">
                    <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100 mb-4">
                        {selectedDate
                            ? `Innleveringer ${selectedDate.getDate()}. ${
                                  [
                                      "januar",
                                      "februar",
                                      "mars",
                                      "april",
                                      "mai",
                                      "juni",
                                      "juli",
                                      "august",
                                      "september",
                                      "oktober",
                                      "november",
                                      "desember",
                                  ][selectedDate.getMonth()]
                              }`
                            : "Velg en dato"}
                    </h2>

                    {selectedDateAssignments.length > 0 ? (
                        <ul className="space-y-3">
                            {selectedDateAssignments.map((assignment) => (
                                <li
                                    key={assignment.id}
                                    className="p-3 rounded-lg bg-slate-50 dark:bg-slate-700/50 border border-slate-200 dark:border-slate-600"
                                >
                                    <div className="flex items-start gap-3">
                                        <input
                                            type="checkbox"
                                            checked={assignment.completed}
                                            readOnly
                                            className="mt-1 w-4 h-4 rounded border-slate-300 dark:border-slate-500"
                                        />
                                        <div className="flex-1 min-w-0">
                                            <p
                                                className={`font-medium text-slate-900 dark:text-slate-100 ${
                                                    assignment.completed
                                                        ? "line-through opacity-50"
                                                        : ""
                                                }`}
                                            >
                                                {assignment.title}
                                            </p>
                                            <p className="text-sm text-slate-500 dark:text-slate-400">
                                                {assignment.courseCode}
                                            </p>
                                        </div>
                                    </div>
                                </li>
                            ))}
                        </ul>
                    ) : selectedDate ? (
                        <p className="text-slate-500 dark:text-slate-400 text-sm">
                            Ingen innleveringer denne dagen.
                        </p>
                    ) : (
                        <p className="text-slate-500 dark:text-slate-400 text-sm">
                            Klikk pa en dato i kalenderen for a se innleveringer.
                        </p>
                    )}
                </div>
            </div>

           
            <div className="calendar-footer">
                Kalender synkroniseres med Canvas LMS
            </div>
        </div>
    );
}

export default CalendarSection;
*/