/*
 * Frontend API for å fetche kalenderdata fra Canvas.
 * Inkluderer støtte for filtrering mellom innleveringer og forelesninger.
 */
import { useQuery } from "@tanstack/react-query";
import {
  CalendarItemsResponseSchema,
  type CalendarItem,
  type CalendarItemsResponse,
} from "common/calendar";
import type {
  Assignment,
  Course,
  CourseColor,
  CalendarFilterType,
} from "common/calendar-ui";
import { fetchCanvas } from "../canvas/canvas-api";
import { useUIStore } from "../store/uiStore";

// Re-eksporter for bakoverkompatibilitet
export { CanvasTokenMissingError } from "../lib/errors";

// Definer en utvidet palett av farger for kursene - gir hvert emne unik farge
const COLOR_PALETTE: CourseColor[] = [
  "blue",
  "green",
  "purple",
  "red",
  "amber",
  "cyan",
  "pink",
  "indigo",
  "teal",
  "orange",
  "lime",
  "rose",
  "violet",
  "emerald",
  "sky",
  "fuchsia",
];

// Opsjoner for kalender-henting
interface FetchCalendarOptions {
  forceRefresh?: boolean; // Bypass cache og hent ferske data
  page?: number; // Sidenummer for paginering
  limit?: number; // Antall items per side
}

const CALENDAR_PAGE_LIMIT = 500;

function buildCalendarEndpoint(options: FetchCalendarOptions = {}): string {
  // Bygg query params basert på opsjoner
  const params = new URLSearchParams();
  if (options.forceRefresh) params.set("refresh", "true");
  if (options.page) params.set("page", String(options.page));
  if (options.limit) params.set("limit", String(options.limit));

  // Bygg URL med query params
  const queryString = params.toString();
  return `/kalender${queryString ? `?${queryString}` : ""}`;
}

async function fetchCalendarPage(
  options: FetchCalendarOptions = {},
): Promise<CalendarItemsResponse> {
  return fetchCanvas(buildCalendarEndpoint(options), CalendarItemsResponseSchema);
}

// Hent alle kalender-sider slik at frontend ikke mister elementer etter backend-paginering.
export async function fetchAllCalendarItems(
  options: Omit<FetchCalendarOptions, "page"> = {},
): Promise<CalendarItemsResponse> {
  const pageSize = options.limit ?? CALENDAR_PAGE_LIMIT;
  const firstPage = await fetchCalendarPage({
    ...options,
    page: 1,
    limit: pageSize,
  });
  const totalPages = firstPage.meta?.pagination?.totalPages ?? 1;

  if (totalPages <= 1) {
    return firstPage;
  }

  const remainingResults = await Promise.allSettled(
    Array.from({ length: totalPages - 1 }, (_, index) =>
      fetchCalendarPage({
        ...options,
        page: index + 2,
        limit: pageSize,
      }),
    ),
  );

  const items = [
    ...firstPage.items,
    ...remainingResults
      .filter((r): r is PromiseFulfilledResult<CalendarItemsResponse> => r.status === "fulfilled")
      .flatMap((r) => r.value.items),
  ];

  if (!firstPage.meta) {
    return { items };
  }

  return {
    items,
    meta: {
      ...firstPage.meta,
      pagination: {
        page: 1,
        limit: items.length,
        totalItems: items.length,
        totalPages: 1,
        hasNextPage: false,
        hasPrevPage: false,
      },
    },
  };
}
// Regex for å ekstrahere emnekoder - gjenbrukes i mapping-funksjoner
// Matcher: BOP3000, INF2010, DAT101, etc.
const COURSE_CODE_REGEX = /([A-ZÆØÅ]{2,5}\d{4,5}[A-Z]?|\d{4,5}[A-Z])/i;
// Hjelpefunksjon for å ekstrahere emnekode fra en streng
function extractCourseCode(str: string): string | null {
  if (!str) return null;
  const codeMatch = str.match(COURSE_CODE_REGEX);
  if (codeMatch) return codeMatch[0].toUpperCase();
  return null;
}
// Fargekart-helper som returnerer en funksjon for å tildele farger
function createColorMapper(colorMap: Map<string, CourseColor>, startIndex = 0) {
  let colorIndex = startIndex;
  return (key: string): CourseColor => {
    if (!colorMap.has(key)) {
      const color = COLOR_PALETTE[colorIndex % COLOR_PALETTE.length];
      colorMap.set(key, color);
      colorIndex += 1;
    }
    return colorMap.get(key)!;
  };
}
// Funksjon for å mappe kalenderdata til oppgaver og kurs
export function mapCalendarItems(items: CalendarItem[]): {
  assignments: Assignment[];
  courses: Course[];
} {
  const colorMap = new Map<string, CourseColor>();
  const getColorForKey = createColorMapper(colorMap);
  // Lister for kurs og oppgaver
  const courses: Course[] = [];
  const assignments: Assignment[] = [];
  // Behandle hvert kalenderobjekt
  items.forEach((item) => {
    // Prøv å ekstrahere emnekode fra ulike kilder
    let courseCode: string;
    let courseName: string;
    // Prøv i rekkefølge: course_code, course_name, title
    const extractedCode =
      extractCourseCode(item.course_code || "") ||
      extractCourseCode(item.course_name || "") ||
      extractCourseCode(item.title || "");
    if (extractedCode) {
      courseCode = extractedCode;
      courseName = item.course_name || extractedCode;
    } else if (item.course_name) {
      // Bruk kursnavnet direkte hvis ingen kode ble funnet
      courseCode = item.course_name;
      courseName = item.course_name;
    } else if (item.course_code) {
      // Bruk course_code som fallback
      courseCode = item.course_code;
      courseName = item.course_code;
    } else {
      // Siste fallback - ukjent emne
      courseCode = "Annet";
      courseName = "Annet";
    }
    const courseKey = item.course_id
      ? `course-${item.course_id}`
      : `code-${courseCode}`;
    // Gi hvert emne sin egen unike farge
    const courseColor = getColorForKey(courseKey);
    // Legg til kurs hvis det ikke allerede finnes
    if (courseCode && !courses.find((c) => c.code === courseCode)) {
      courses.push({
        id: item.course_id ?? undefined,
        code: courseCode,
        name: courseName,
        color: courseColor,
      });
    }
    // Hopp over elementer uten forfallsdato
    const dueDate = new Date(item.due_at);
    if (Number.isNaN(dueDate.getTime())) return;
    // Parse sluttdato
    const endDate = item.end_at ? new Date(item.end_at) : undefined;
    // Legg til oppgaven
    assignments.push({
      id: item.id,
      title: item.title,
      courseCode,
      courseName,
      courseId: item.course_id ?? undefined,
      courseColor,
      dueDate,
      endDate,
      completed: false,
      description: item.raw_type,
      source: item.source,
      url: item.html_url ?? null,
      location: item.location ?? undefined,
    });
  });
  return { assignments, courses };
}

// Hjelpefunksjon for å sjekke om et element er en forelesning/kalenderhendelse
function isLectureOrEvent(a: Assignment): boolean {
  // Sjekk source
  if (a.source === "event" || a.source === "timetable") return true;
  // Sjekk raw_type (lagret i description) for calendar_events som feilaktig har source=todo
  if (a.description === "calendar_event" || a.description === "CalendarEvent")
    return true;
  return false;
}

// Filtrer kalender-elementer basert på filtertype
function filterAssignments(
  assignments: Assignment[],
  filter: CalendarFilterType,
): Assignment[] {
  if (filter === "all") {
    return assignments;
  }
  if (filter === "assignments") {
    // Vis kun innleveringer - ekskluder alle forelesninger/events
    return assignments.filter((a) => !isLectureOrEvent(a));
  }
  if (filter === "timetable") {
    // Vis kun forelesninger/events
    return assignments.filter((a) => isLectureOrEvent(a));
  }

  return assignments;
}

// React Query hook for å bruke kalenderdata i komponenter
export function useCalendarData(enabled = true) {
  const tokenInvalid = useUIStore((state) => state.canvasTokenInvalid);
  const isEnabled = enabled && !tokenInvalid;
  const query = useQuery({
    queryKey: ["canvas", "calendar"],
    queryFn: async () => {
      const data = await fetchAllCalendarItems();
      return {
        ...mapCalendarItems(data.items),
        meta: data.meta, // Inkluder cache-metadata
      };
    },
    enabled: isEnabled,
    staleTime: 30 * 1000, // 30 sekunder før data anses som stale
    refetchOnWindowFocus: true, // Oppdater når vinduet får fokus
    gcTime: 5 * 60 * 1000, // Garbage collect etter 5 min inaktivitet
  });

  return query;
}

// React Query hook for kombinert kalender- og forelesningsdata med filtrering
// Bruker kun /kalender - ingen ekstra fetch ved filter-bytte
export function useCombinedCalendarData(
  filter: CalendarFilterType = "all",
  hasCanvasToken: boolean = true,
) {
  // Hent ALL data fra /kalender (inkluderer både assignments OG events/forelesninger)
  // Filtreringen skjer client-side - ingen ekstra API-kall ved filter-bytte
  const canvasQuery = useCalendarData(hasCanvasToken);

  // Alle data kommer fra samme kilde
  const allAssignments = canvasQuery.data?.assignments ?? [];
  const allCourses = canvasQuery.data?.courses ?? [];

  // Filtrer client-side basert på valgt filter (ingen ny fetch!)
  const filteredAssignments = filterAssignments(allAssignments, filter);

  // Sorter etter dato
  filteredAssignments.sort((a, b) => a.dueDate.getTime() - b.dueDate.getTime());

  return {
    data: {
      assignments: filteredAssignments,
      courses: allCourses,
    },
    isLoading: canvasQuery.isLoading,
    isError: canvasQuery.isError,
    error: canvasQuery.error,
    hasLecturesData: allAssignments.some((a) => isLectureOrEvent(a)),
    hasCanvasData: allAssignments.length > 0,
    // Eksponerer refetch for manuell oppdatering
    refetch: canvasQuery.refetch,
    // Cache-metadata (fromCache, cacheAge)
    cacheInfo: canvasQuery.data?.meta,
  };
}
