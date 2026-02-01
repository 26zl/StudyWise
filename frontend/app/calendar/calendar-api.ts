/*
* Frontend API for å fetche kalenderdata fra Canvas.
*/
import { useQuery } from "@tanstack/react-query";
import { CalendarItemsResponseSchema, type CalendarItem } from "common/calendar";
import { fornySesjon } from "../auth/auth-api";
import type { Assignment, Course, CourseColor } from "common/calendar-ui";

// Spesialisert feilklasse for manglende Canvas-token
export class CanvasTokenMissingError extends Error {
  constructor(message = "Canvas-token mangler") {
    super(message);
    this.name = "CanvasTokenMissingError";
  }
}

// Definer en palett av farger for kursene
const COLOR_PALETTE: CourseColor[] = ["programming", "database", "network", "security", "math"];

// Funksjon for å hente kalenderdata fra backend
async function fetchCalendarItems(forsoktRefresh = false) {
  const res = await fetch("/api/canvas/kalender", {
    credentials: "include",
    cache: "no-store",
  });
  
  // Håndter 401 (ikke autentisert) - prøv refresh token
  if (res.status === 401 && !forsoktRefresh) {
    await fornySesjon();
    return fetchCalendarItems(true);
  }
  
  // Håndter 403 (manglende Canvas-token) - ikke prøv refresh
  if (res.status === 403) {
    const errorBody = await res.json().catch(() => ({}));
    throw new CanvasTokenMissingError(errorBody.melding || errorBody.feil || "Canvas-token mangler");
  }
  
  if (!res.ok) {
    const errorBody = await res.json().catch(() => ({}));
    throw new Error(errorBody.melding || errorBody.feil || "Kunne ikke hente kalenderdata");
  }
  const data = await res.json();
  return CalendarItemsResponseSchema.parse(data);
}

// Funksjon for å mappe kalenderdata til oppgaver og kurs
function mapCalendarItems(items: CalendarItem[]): { assignments: Assignment[]; courses: Course[] } {
  const colorMap = new Map<string, CourseColor>();
  let colorIndex = 0;
// Funksjon for å tildele farger til kurs basert på en nøkkel
  const getColorForKey = (key: string): CourseColor => {
    if (!colorMap.has(key)) {
      const color = COLOR_PALETTE[colorIndex % COLOR_PALETTE.length];
      colorMap.set(key, color);
      colorIndex += 1;
    }
    return colorMap.get(key)!;
  };
  // Lister for kurs og oppgaver
  const courses: Course[] = [];
  const assignments: Assignment[] = [];
  // Behandle hvert kalenderobjekt
  items.forEach((item) => {
    const courseCode =
      item.course_code || item.course_name || (item.course_id ? `course_${item.course_id}` : "Annet");
    const courseKey = item.course_id ? `course-${item.course_id}` : courseCode ? `code-${courseCode}` : "other";
    const courseColor = getColorForKey(courseKey);
    // Legg til kurs hvis det ikke allerede finnes
    if (courseCode && !courses.find((c) => c.code === courseCode)) {
      courses.push({
        id: item.course_id ?? undefined,
        code: courseCode,
        name: item.course_name || courseCode,
        color: courseColor,
      });
    }
    // Hopp over elementer uten forfallsdato
    const dueDate = new Date(item.due_at);
    if (Number.isNaN(dueDate.getTime())) return;
    // Legg til oppgaven
    assignments.push({
      id: item.id,
      title: item.title,
      courseCode,
      courseName: item.course_name || courseCode,
      courseId: item.course_id ?? undefined,
      courseColor,
      dueDate,
      completed: false,
      description: item.raw_type,
      source: item.source,
      url: item.html_url ?? null,
    });
  });
  return { assignments, courses };
}
// React Query hook for å bruke kalenderdata i komponenter
export function useCalendarData(enabled = true) {
  return useQuery({
    queryKey: ["canvas", "calendar"],
    queryFn: async () => {
      const data = await fetchCalendarItems();
      return mapCalendarItems(data.items);
    },
    enabled,
  });
}
