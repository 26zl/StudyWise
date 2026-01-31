/**
 
Calendar type definitions
Typer for kalender-funksjonalitet*/

// Farger for ulike emner/kurs
export type CourseColor = 
    | "programming" 
    | "database" 
    | "network" 
    | "security" 
    | "math";

// Innlevering/oppgave
export interface Assignment {
    id: string;
    title: string;
    courseCode: string;
    courseName?: string;
    courseColor: CourseColor;
    dueDate: Date;
    dueTime?: string;
    completed: boolean;
    description?: string;
}

// Emne/kurs
export interface Course {
    code: string;
    name: string;
    color: CourseColor;
}

// Fargemapping for CSS-klasser
export const COURSE_COLOR_CLASSES: Record<CourseColor, string> = {
    programming: "bg-blue-500 dark:bg-blue-600",
    database: "bg-green-500 dark:bg-green-600",
    network: "bg-purple-500 dark:bg-purple-600",
    security: "bg-red-500 dark:bg-red-600",
    math: "bg-amber-500 dark:bg-amber-600",
};

// Fargemapping for border-left (deadlines panel)
export const COURSE_BORDER_CLASSES: Record<CourseColor, string> = {
    programming: "border-l-blue-500 dark:border-l-blue-600",
    database: "border-l-green-500 dark:border-l-green-600",
    network: "border-l-purple-500 dark:border-l-purple-600",
    security: "border-l-red-500 dark:border-l-red-600",
    math: "border-l-amber-500 dark:border-l-amber-600",
};
// Fargemapping for bakgrunn med opacity (modal)
export const COURSE_BG_LIGHT_CLASSES: Record<CourseColor, string> = {
    programming: "bg-blue-50 dark:bg-blue-900/20 border-l-blue-500 dark:border-l-blue-600",
    database: "bg-green-50 dark:bg-green-900/20 border-l-green-500 dark:border-l-green-600",
    network: "bg-purple-50 dark:bg-purple-900/20 border-l-purple-500 dark:border-l-purple-600",
    security: "bg-red-50 dark:bg-red-900/20 border-l-red-500 dark:border-l-red-600",
    math: "bg-amber-50 dark:bg-amber-900/20 border-l-amber-500 dark:border-l-amber-600",
};

// Fargemapping for dots
export const COURSE_DOT_CLASSES: Record<CourseColor, string> = {
    programming: "bg-blue-500 dark:bg-blue-400",
    database: "bg-green-500 dark:bg-green-400",
    network: "bg-purple-500 dark:bg-purple-400",
    security: "bg-red-500 dark:bg-red-400",
    math: "bg-amber-500 dark:bg-amber-400",
};