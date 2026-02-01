import type { CourseColor } from "common/calendar-ui";

// Fargeklasser for emner i kalenderen - utvidet palett for unik farge per emne
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

// Lys bakgrunnsklasser for emner i detaljerte visninger
export const COURSE_BG_LIGHT_CLASSES: Record<CourseColor, string> = {
  blue: "bg-blue-50 dark:bg-blue-900/20 border-l-blue-500 dark:border-l-blue-600",
  green: "bg-green-50 dark:bg-green-900/20 border-l-green-500 dark:border-l-green-600",
  purple: "bg-purple-50 dark:bg-purple-900/20 border-l-purple-500 dark:border-l-purple-600",
  red: "bg-red-50 dark:bg-red-900/20 border-l-red-500 dark:border-l-red-600",
  amber: "bg-amber-50 dark:bg-amber-900/20 border-l-amber-500 dark:border-l-amber-600",
  cyan: "bg-cyan-50 dark:bg-cyan-900/20 border-l-cyan-500 dark:border-l-cyan-600",
  pink: "bg-pink-50 dark:bg-pink-900/20 border-l-pink-500 dark:border-l-pink-600",
  indigo: "bg-indigo-50 dark:bg-indigo-900/20 border-l-indigo-500 dark:border-l-indigo-600",
  teal: "bg-teal-50 dark:bg-teal-900/20 border-l-teal-500 dark:border-l-teal-600",
  orange: "bg-orange-50 dark:bg-orange-900/20 border-l-orange-500 dark:border-l-orange-600",
  lime: "bg-lime-50 dark:bg-lime-900/20 border-l-lime-500 dark:border-l-lime-600",
  rose: "bg-rose-50 dark:bg-rose-900/20 border-l-rose-500 dark:border-l-rose-600",
  violet: "bg-violet-50 dark:bg-violet-900/20 border-l-violet-500 dark:border-l-violet-600",
  emerald: "bg-emerald-50 dark:bg-emerald-900/20 border-l-emerald-500 dark:border-l-emerald-600",
  sky: "bg-sky-50 dark:bg-sky-900/20 border-l-sky-500 dark:border-l-sky-600",
  fuchsia: "bg-fuchsia-50 dark:bg-fuchsia-900/20 border-l-fuchsia-500 dark:border-l-fuchsia-600",
  timetable: "bg-slate-50 dark:bg-slate-900/20 border-l-slate-500 dark:border-l-slate-600",
};

// Prikkeklasser for emner i legender og oversikter
export const COURSE_DOT_CLASSES: Record<CourseColor, string> = {
  blue: "bg-blue-500 dark:bg-blue-400",
  green: "bg-green-500 dark:bg-green-400",
  purple: "bg-purple-500 dark:bg-purple-400",
  red: "bg-red-500 dark:bg-red-400",
  amber: "bg-amber-500 dark:bg-amber-400",
  cyan: "bg-cyan-500 dark:bg-cyan-400",
  pink: "bg-pink-500 dark:bg-pink-400",
  indigo: "bg-indigo-500 dark:bg-indigo-400",
  teal: "bg-teal-500 dark:bg-teal-400",
  orange: "bg-orange-500 dark:bg-orange-400",
  lime: "bg-lime-500 dark:bg-lime-400",
  rose: "bg-rose-500 dark:bg-rose-400",
  violet: "bg-violet-500 dark:bg-violet-400",
  emerald: "bg-emerald-500 dark:bg-emerald-400",
  sky: "bg-sky-500 dark:bg-sky-400",
  fuchsia: "bg-fuchsia-500 dark:bg-fuchsia-400",
  timetable: "bg-slate-500 dark:bg-slate-400",
};
