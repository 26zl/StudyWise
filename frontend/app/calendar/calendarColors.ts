import type { CourseColor } from "common/calendar-ui";

// Fargeklasser for emner i kalenderen
export const COURSE_COLOR_CLASSES: Record<CourseColor, string> = {
  programming: "bg-blue-500 dark:bg-blue-600",
  database: "bg-green-500 dark:bg-green-600",
  network: "bg-purple-500 dark:bg-purple-600",
  security: "bg-red-500 dark:bg-red-600",
  math: "bg-amber-500 dark:bg-amber-600",
};

// Lys bakgrunnsklasser for emner i detaljerte visninger
export const COURSE_BG_LIGHT_CLASSES: Record<CourseColor, string> = {
  programming: "bg-blue-50 dark:bg-blue-900/20 border-l-blue-500 dark:border-l-blue-600",
  database: "bg-green-50 dark:bg-green-900/20 border-l-green-500 dark:border-l-green-600",
  network: "bg-purple-50 dark:bg-purple-900/20 border-l-purple-500 dark:border-l-purple-600",
  security: "bg-red-50 dark:bg-red-900/20 border-l-red-500 dark:border-l-red-600",
  math: "bg-amber-50 dark:bg-amber-900/20 border-l-amber-500 dark:border-l-amber-600",
};

// Prikkeklasser for emner i legender og oversikter
export const COURSE_DOT_CLASSES: Record<CourseColor, string> = {
  programming: "bg-blue-500 dark:bg-blue-400",
  database: "bg-green-500 dark:bg-green-400",
  network: "bg-purple-500 dark:bg-purple-400",
  security: "bg-red-500 dark:bg-red-400",
  math: "bg-amber-500 dark:bg-amber-400",
};
