/**
 * Delte typer og fargemappinger for kalenderkomponentene
 */

import type { CalendarSource } from "./calendar.js";

// Farger for ulike emner/kurs - utvidet palett for unik farge per emne
export type CourseColor =
  | "blue"
  | "green"
  | "purple"
  | "red"
  | "amber"
  | "cyan"
  | "pink"
  | "indigo"
  | "teal"
  | "orange"
  | "lime"
  | "rose"
  | "violet"
  | "emerald"
  | "sky"
  | "fuchsia"
  | "timetable"; // For forelesninger/kalender-hendelser

// Filter-typer for kalendervisning
export type CalendarFilterType = "all" | "assignments" | "timetable";

// Innlevering/oppgave/hendelse
export interface Assignment {
  id: string;
  title: string;
  courseCode: string;
  courseName?: string;
  courseId?: number;
  courseColor: CourseColor;
  dueDate: Date;
  dueTime?: string;
  endDate?: Date; // Sluttid (for forelesninger/hendelser)
  completed: boolean;
  description?: string;
  source?: CalendarSource;
  url?: string | null;
  // Hendelse-spesifikke felter
  location?: string; // Rom/lokasjon
}

// Emne/kurs
export interface Course {
  id?: number;
  code: string;
  name: string;
  color: CourseColor;
}

// Fargemapping for CSS-klasser
export const COURSE_COLOR_CLASSES: Record<CourseColor, string> = {
  blue: "bg-blue-500 dark:bg-blue-600",
  green: "bg-green-500 dark:bg-green-600",
  purple: "bg-purple-500 dark:bg-purple-600",
  red: "bg-red-500 dark:bg-red-600",
  amber: "bg-amber-500 dark:bg-amber-600",
  cyan: "bg-cyan-500 dark:bg-cyan-600",
  pink: "bg-pink-500 dark:bg-pink-600",
  indigo: "bg-indigo-500 dark:bg-indigo-600",
  teal: "bg-teal-500 dark:bg-teal-600",
  orange: "bg-orange-500 dark:bg-orange-600",
  lime: "bg-lime-500 dark:bg-lime-600",
  rose: "bg-rose-500 dark:bg-rose-600",
  violet: "bg-violet-500 dark:bg-violet-600",
  emerald: "bg-emerald-500 dark:bg-emerald-600",
  sky: "bg-sky-500 dark:bg-sky-600",
  fuchsia: "bg-fuchsia-500 dark:bg-fuchsia-600",
  timetable: "bg-slate-500 dark:bg-slate-600",
};
