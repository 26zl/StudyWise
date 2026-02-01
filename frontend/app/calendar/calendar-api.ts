/*
* Frontend API for å fetche kalenderdata fra Canvas og TimeEdit.
* TimeEdit hentes AUTOMATISK basert på Canvas-emnekoder - ingen URL nødvendig!
* Støtter campus-filtrering (Bø, Drammen, Kongsberg, etc.)
* Inkluderer støtte for filtrering mellom innleveringer, timeplan og begge.
*/
import { useQuery } from "@tanstack/react-query";
import { CalendarItemsResponseSchema, type CalendarItem } from "common/calendar";
import { fornySesjon } from "../auth/auth-api";
import type { Assignment, Course, CourseColor, CalendarFilterType } from "common/calendar-ui";

// USN Campus-typer
export type CampusId = "bo" | "drammen" | "kongsberg" | "ringerike" | "vestfold" | "porsgrunn";

export interface Campus {
  id: CampusId;
  code: string;
  name: string;
  aliases: string[];
}

// Liste over USN-campuser (matcher backend)
export const USN_CAMPUSES: Campus[] = [
  { id: "bo", code: "BO", name: "Bo", aliases: ["bo", "boe", "bø"] },
  { id: "drammen", code: "DR", name: "Drammen", aliases: ["drammen", "dr"] },
  { id: "kongsberg", code: "KO", name: "Kongsberg", aliases: ["kongsberg", "ko"] },
  { id: "ringerike", code: "RI", name: "Ringerike", aliases: ["ringerike", "ri", "honefoss", "hønefoss"] },
  { id: "vestfold", code: "VE", name: "Vestfold", aliases: ["vestfold", "ve", "bakkenteigen", "horten"] },
  { id: "porsgrunn", code: "PO", name: "Porsgrunn", aliases: ["porsgrunn", "po"] },
];

// Spesialisert feilklasse for manglende Canvas-token
export class CanvasTokenMissingError extends Error {
  constructor(message = "Canvas-token mangler") {
    super(message);
    this.name = "CanvasTokenMissingError";
  }
}

// Definer en utvidet palett av farger for kursene - gir hvert emne unik farge
const COLOR_PALETTE: CourseColor[] = [
  "blue", "green", "purple", "red", "amber", "cyan", 
  "pink", "indigo", "teal", "orange", "lime", "rose",
  "violet", "emerald", "sky", "fuchsia"
];

// Funksjon for å hente kalenderdata fra backend (Canvas)
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

// Funksjon for å hente timeplan fra TimeEdit AUTOMATISK (basert på Canvas-emnekoder)
// Støtter campus-filtrering
async function fetchTimeEditItems(campus?: CampusId, forsoktRefresh = false) {
  // Bygg URL med campus-parameter hvis satt
  const params = new URLSearchParams();
  if (campus) {
    params.set("campus", campus);
  }
  const url = params.toString() ? `/api/timeplan/kalender?${params}` : "/api/timeplan/kalender";
  
  const res = await fetch(url, {
    credentials: "include",
    cache: "no-store",
  });
  
  if ((res.status === 401 || res.status === 403) && !forsoktRefresh) {
    await fornySesjon();
    return fetchTimeEditItems(campus, true);
  }
  
  if (!res.ok) {
    // Returner tom liste ved feil (ikke kræsj hele kalenderen)
    const errorBody = await res.json().catch(() => ({}));
    console.warn("TimeEdit-feil:", errorBody.melding || errorBody.feil);
    return { items: [], meta: { automatic: true } };
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
  
  // Regex for å ekstrahere emnekoder
  // Matcher: BOP3000, INF2010, DAT101, etc.
  const COURSE_CODE_REGEX = /([A-ZÆØÅ]{2,5}\d{4,5}[A-Z]?|\d{4,5}[A-Z])/i;
  // Matcher UE-format: UE_222_BOP3000_1_2026 -> BOP3000
  const UE_CODE_REGEX = /UE_\d+_([A-ZÆØÅ]{2,5}\d{4,5}[A-Z]?)_/i;
  
  // Hjelpefunksjon for å ekstrahere emnekode fra en streng
  const extractCourseCode = (str: string): string | null => {
    if (!str) return null;
    
    // Prøv standard emnekode-format først
    const codeMatch = str.match(COURSE_CODE_REGEX);
    if (codeMatch) return codeMatch[0].toUpperCase();
    
    // Prøv UE-format
    const ueMatch = str.match(UE_CODE_REGEX);
    if (ueMatch && ueMatch[1]) return ueMatch[1].toUpperCase();
    
    return null;
  };
  
  // Behandle hvert kalenderobjekt
  items.forEach((item) => {
    // Prøv å ekstrahere emnekode fra ulike kilder
    let courseCode: string;
    
    // Prøv i rekkefølge: course_code, course_name, title
    const extractedCode = extractCourseCode(item.course_code || "") 
      || extractCourseCode(item.course_name || "")
      || extractCourseCode(item.title || "");
    
    if (extractedCode) {
      courseCode = extractedCode;
    } else if (item.course_id) {
      courseCode = `Emne ${item.course_id}`;
    } else {
      // Siste fallback - bruk "Timeplan" for TimeEdit-elementer
      courseCode = item.source === "timetable" ? "Timeplan" : "Annet";
    }
    
    const courseKey = item.course_id ? `course-${item.course_id}` : `code-${courseCode}`;
    
    // Gi hvert emne sin egen unike farge (også TimeEdit-elementer)
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
    
    // Parse sluttdato for TimeEdit-elementer
    const endDate = item.end_at ? new Date(item.end_at) : undefined;
    
    // Legg til oppgaven
    assignments.push({
      id: item.id,
      title: item.title,
      courseCode,
      courseName: item.course_name || courseCode,
      courseId: item.course_id ?? undefined,
      courseColor,
      dueDate,
      endDate,
      completed: false,
      description: item.raw_type,
      source: item.source,
      url: item.html_url ?? null,
      // TimeEdit-spesifikke felter
      location: item.location ?? undefined,
      teacher: item.teacher ?? undefined,
      activityType: item.activity_type ?? undefined,
    });
  });
  return { assignments, courses };
}

// Filtrer kalender-elementer basert på filtertype
function filterAssignments(
  assignments: Assignment[], 
  filter: CalendarFilterType
): Assignment[] {
  if (filter === "all") {
    return assignments;
  }
  
  if (filter === "assignments") {
    return assignments.filter(a => a.source !== "timetable");
  }
  
  if (filter === "timetable") {
    return assignments.filter(a => a.source === "timetable");
  }
  
  return assignments;
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

// React Query hook for TimeEdit-data (AUTOMATISK - med campus-støtte)
export function useTimeEditData(enabled = true, campus?: CampusId) {
  return useQuery({
    queryKey: ["timeEdit", "calendar", "automatic", campus],
    queryFn: async () => {
      const data = await fetchTimeEditItems(campus);
      return mapCalendarItems(data.items);
    },
    enabled,
    // Ikke feil hvis TimeEdit ikke er tilgjengelig
    retry: false,
  });
}

// React Query hook for kombinert kalender- og TimeEdit-data med filtrering og campus
export function useCombinedCalendarData(
  filter: CalendarFilterType = "all",
  hasCanvasToken: boolean = true,
  campus?: CampusId
) {
  // Hent Canvas-data hvis ikke kun timeplan
  const canvasQuery = useCalendarData(hasCanvasToken && filter !== "timetable");
  
  // Hent TimeEdit-data automatisk hvis ikke kun innleveringer (med campus-filter)
  const timeEditQuery = useTimeEditData(hasCanvasToken && filter !== "assignments", campus);
  
  // Kombiner data
  const isLoading = canvasQuery.isLoading || timeEditQuery.isLoading;
  const isError = canvasQuery.isError && timeEditQuery.isError; // Bare feil hvis begge feiler
  const error = canvasQuery.error || timeEditQuery.error;
  
  // Slå sammen assignments og courses
  const canvasAssignments = canvasQuery.data?.assignments ?? [];
  const canvasCourses = canvasQuery.data?.courses ?? [];
  const timeEditAssignments = timeEditQuery.data?.assignments ?? [];
  const timeEditCourses = timeEditQuery.data?.courses ?? [];
  
  // Kombiner og filtrer
  const allAssignments = [...canvasAssignments, ...timeEditAssignments];
  const filteredAssignments = filterAssignments(allAssignments, filter);
  
  // Sorter etter dato
  filteredAssignments.sort((a, b) => a.dueDate.getTime() - b.dueDate.getTime());
  
  // Kombiner kurs (unngå duplikater)
  const courseMap = new Map<string, Course>();
  [...canvasCourses, ...timeEditCourses].forEach((course) => {
    if (!courseMap.has(course.code)) {
      courseMap.set(course.code, course);
    }
  });
  const allCourses = Array.from(courseMap.values());
  
  return {
    data: {
      assignments: filteredAssignments,
      courses: allCourses,
    },
    isLoading,
    isError,
    error,
    // Ekstra info for debugging
    hasTimeEditData: timeEditAssignments.length > 0,
    hasCanvasData: canvasAssignments.length > 0,
  };
}
