/*
 * Canvas API klient for frontend
 * Håndterer kommunikasjon med backend API for Canvas data
 * Henter zod schemas fra common for validering av data
 */
import type { ZodType } from "zod";
import { useQuery, type QueryClient } from "@tanstack/react-query";
import { useUIStore } from "../store/uiStore";
import { fetchApi } from "../lib/apiClient";

// Importer Zod schemas fra common
import {
  CanvasUserSchema,
  AnnouncementsResponseSchema,
  CoursesResponseSchema,
  ModulesResponseSchema,
  AssignmentsResponseSchema,
  CanvasPageSchema,
  UpcomingEventsResponseSchema,
  TodoResponseSchema,
  ModuleItemOpenResponseSchema,
  CoursesMetadataResponseSchema,
  FilesResponseSchema,
  PagesResponseSchema,
  FrontPageResponseSchema,
  type CanvasAssignment,
  type CanvasCourse,
  type ModuleItemOpenResponse,
} from "common/canvas";

// Eksporter typer
export type {
  CanvasUser,
  CanvasAnnouncement,
  AnnouncementsResponse,
  CanvasCourse,
  CoursesResponse,
  CanvasModule,
  ModulesResponse,
  CanvasAssignment,
  AssignmentsResponse,
  CanvasCalendarEvent,
  CanvasTodoItem,
  CanvasPage,
  CanvasFile,
  CanvasDiscussionTopic,
  CanvasModuleItemDetail,
  ModuleItemOpenResponse,
  CourseContentMetadata,
  CoursesMetadataResponse,
} from "common/canvas";

// Importer delte feiltyper fra common
import { type CanvasErrorCode } from "common/canvasErrors";

// Importer error-klasser fra felles error-modul
import {
  CanvasTokenMissingError,
  CanvasTokenInvalidError,
  CanvasPermissionError,
  CanvasResourceError,
  CanvasApiError,
} from "../lib/errors";

// Sjekk om en feil er en token-feil som krever re-autentisering
function isTokenError(error: unknown): boolean {
  if (error instanceof CanvasTokenMissingError) return true;
  if (error instanceof CanvasTokenInvalidError) return true;
  // Ny: CanvasPermissionError er IKKE en token-feil
  if (error instanceof CanvasPermissionError) return false;
  if (error instanceof CanvasResourceError) return false;
  if (error instanceof CanvasApiError) {
    return error.code === "token_invalid" || error.code === "token_missing";
  }
  if (error instanceof Error) {
    const msg = error.message.toLowerCase();
    // Kun ekte token-feil, ikke "ingen tilgang"
    return (
      msg.includes("token") &&
      (msg.includes("ugyldig") ||
        msg.includes("mangler") ||
        msg.includes("utløpt"))
    );
  }
  return false;
}

// Retry-funksjon som stopper ved token-feil
function shouldRetryCanvasQuery(failureCount: number, error: unknown): boolean {
  // Aldri retry ved token-feil
  if (isTokenError(error)) return false;
  // Maks 2 retries for andre feil
  return failureCount < 2;
}

function shouldIgnoreAssignmentError(error: unknown): boolean {
  return (
    error instanceof CanvasPermissionError ||
    error instanceof CanvasResourceError
  );
}

// Marker token som ugyldig i global state
function markTokenInvalid() {
  useUIStore.getState().setCanvasTokenInvalid(true);
}

// Nullstill token-status (kall når nytt token lagres)
export function resetCanvasTokenStatus() {
  useUIStore.getState().setCanvasTokenInvalid(false);
}

// Felles feilhåndtering for Canvas API-responser
// Håndterer 401, 403, 404, 429, 5xx og generelle feil
async function håndterFeilRespons(
  res: Response,
): Promise<void> {
  if (res.status === 401) {
    markTokenInvalid();
    throw new CanvasTokenInvalidError(
      "Ikke autentisert eller token utløpt. Logg inn på nytt.",
    );
  }

  // Hjelpefunksjon: parse feilrespons-body til melding + kode
  const parseErrorBody = async (
    defaultMessage: string,
    defaultCode: CanvasErrorCode,
  ): Promise<{ errorMessage: string; errorCode: CanvasErrorCode }> => {
    const errorText = await res.text();
    let errorMessage = defaultMessage;
    let errorCode = defaultCode;
    try {
      const error = JSON.parse(errorText);
      errorMessage = error.melding || error.feil || errorMessage;
      errorCode = error.kode || errorCode;
    } catch {
      if (errorText) errorMessage = errorText;
    }
    return { errorMessage, errorCode };
  };

  // Håndter 403 - skille mellom "token mangler" (vår backend) og "permission denied" (Canvas)
  if (res.status === 403) {
    const { errorMessage, errorCode } = await parseErrorBody("Ingen tilgang", "permission_denied");
    if (
      errorCode === "token_missing" ||
      errorMessage.toLowerCase().includes("token mangler")
    ) {
      markTokenInvalid();
      throw new CanvasTokenMissingError(errorMessage);
    }
    throw new CanvasPermissionError(errorMessage);
  }

  // Håndter 404 - ressurs deaktivert eller ikke funnet
  if (res.status === 404) {
    const { errorMessage, errorCode } = await parseErrorBody("Ressursen ble ikke funnet", "resource_not_found");
    const resolvedCode = errorMessage.toLowerCase().includes("deaktivert") ? "resource_disabled" : errorCode;
    throw new CanvasResourceError(
      resolvedCode as "resource_disabled" | "resource_not_found",
      errorMessage,
    );
  }

  // Håndter 429 - rate limited
  if (res.status === 429) {
    const { errorMessage, errorCode } = await parseErrorBody("For mange forespørsler", "rate_limited");
    throw new CanvasApiError(errorCode, errorMessage, 429);
  }

  // Håndter 5xx - server error (504 er timeout, resten er server_error)
  if (res.status >= 500) {
    const defaultCode: CanvasErrorCode = res.status === 504 ? "timeout" : "server_error";
    const { errorMessage, errorCode } = await parseErrorBody("Serverfeil", defaultCode);
    throw new CanvasApiError(errorCode, errorMessage, res.status);
  }

  // Generell feil for andre ikke-OK statuser
  if (!res.ok) {
    const { errorMessage, errorCode } = await parseErrorBody("API feil", "unknown");
    throw new CanvasApiError(errorCode, errorMessage, res.status);
  }
}

// API funksjoner
export async function fetchCanvas<T>(
  endpoint: string,
  schema: ZodType<T>,
): Promise<T> {
  if (useUIStore.getState().canvasTokenInvalid) {
    throw new CanvasTokenInvalidError(
      "Canvas-token er ugyldig. Oppdater tokenet i innstillinger.",
    );
  }

  const res = await fetchApi(`/api/canvas${endpoint}`);

  await håndterFeilRespons(res);

  const data = await res.json();
  return schema.parse(data);
}

// Variant som tillater null-respons (for 204 No Content)
async function fetchCanvasNullable<T>(
  endpoint: string,
  schema: ZodType<T>,
): Promise<T | null> {
  if (useUIStore.getState().canvasTokenInvalid) {
    throw new CanvasTokenInvalidError(
      "Canvas-token er ugyldig. Oppdater tokenet i innstillinger.",
    );
  }

  const res = await fetchApi(`/api/canvas${endpoint}`);

  await håndterFeilRespons(res);

  if (res.status === 204) {
    return null;
  }

  const data = await res.json();
  return schema.parse(data);
}

// Åpne modul-item via backend (henter fil-info dynamisk for filer uten content_id)
export async function openModuleItem(
  courseId: number,
  moduleId: number,
  itemId: number,
): Promise<ModuleItemOpenResponse> {
  return fetchCanvas(
    `/emner/${courseId}/modules/${moduleId}/items/${itemId}/open`,
    ModuleItemOpenResponseSchema,
  );
}

// Standard query-opsjoner for Canvas-hooks
const canvasQueryOptions = {
  retry: shouldRetryCanvasQuery,
  staleTime: 1000 * 60 * 2, // 2 minutter før data anses som stale
  refetchOnWindowFocus: false, // Ikke refetch automatisk ved vindu-fokus
};

// Hook for å sjekke om Canvas-queries skal være aktivert
function useCanvasEnabled(enabled: boolean): boolean {
  const tokenInvalid = useUIStore((state) => state.canvasTokenInvalid);
  return enabled && !tokenInvalid;
}

// React Query hooks
// Hent innlogget bruker (og trigger sync i backend)
export function useCanvasUser(enabled = true) {
  const isEnabled = useCanvasEnabled(enabled);
  return useQuery({
    queryKey: ["canvas", "whoami"],
    queryFn: () => fetchCanvas("/whoami", CanvasUserSchema),
    enabled: isEnabled,
    ...canvasQueryOptions,
  });
}

// Hent courses
export function useCanvasCourses(enabled = true) {
  const isEnabled = useCanvasEnabled(enabled);
  return useQuery({
    queryKey: ["canvas", "courses"],
    queryFn: () => fetchCanvas("/emner", CoursesResponseSchema),
    enabled: isEnabled,
    ...canvasQueryOptions,
  });
}

// Hent kunngjøringer
export function useCanvasAnnouncements(enabled = true) {
  const isEnabled = useCanvasEnabled(enabled);
  return useQuery({
    queryKey: ["canvas", "announcements"],
    queryFn: () => fetchCanvas("/announcements", AnnouncementsResponseSchema),
    enabled: isEnabled,
    ...canvasQueryOptions,
  });
}

// Hent moduler for et spesifikt emne
export function useCanvasModules(courseId: number | null, enabled = true) {
  const isEnabled = useCanvasEnabled(enabled);
  return useQuery({
    queryKey: ["canvas", "modules", courseId],
    queryFn: () =>
      fetchCanvas(`/emner/${courseId}/modules`, ModulesResponseSchema),
    enabled: !!courseId && isEnabled,
    ...canvasQueryOptions,
  });
}

// Hent kommende hendelser
export function useCanvasUpcomingEvents(enabled = true) {
  const isEnabled = useCanvasEnabled(enabled);
  return useQuery({
    queryKey: ["canvas", "upcoming_events"],
    queryFn: () =>
      fetchCanvas("/users/self/upcoming_events", UpcomingEventsResponseSchema),
    enabled: isEnabled,
    ...canvasQueryOptions,
  });
}

// Hent todo liste
export function useCanvasTodo(enabled = true) {
  const isEnabled = useCanvasEnabled(enabled);
  return useQuery({
    queryKey: ["canvas", "todo"],
    queryFn: () => fetchCanvas("/users/self/todo", TodoResponseSchema),
    enabled: isEnabled,
    ...canvasQueryOptions,
  });
}

// Oppgave med emnenavn (frontend-only berikelse av CanvasAssignment)
export interface AssignmentMedEmne extends CanvasAssignment {
  course_name: string;
}

// Enkel inline concurrency-begrenser — unngår å installere p-limit i frontend.
// Kjøres kun ved behov (ikke på modul-nivå).
function createConcurrencyLimit(concurrency: number) {
  let active = 0;
  const queue: Array<() => void> = [];
  return function limit<T>(fn: () => Promise<T>): Promise<T> {
    return new Promise((resolve, reject) => {
      const run = () => {
        active++;
        fn()
          .then(resolve, reject)
          .finally(() => {
            active--;
            if (queue.length > 0) queue.shift()!();
          });
      };
      if (active < concurrency) run();
      else queue.push(run);
    });
  };
}

// Hent ALLE oppgaver på tvers av emner
export function useCanvasAllAssignments(options?: {
  enabled?: boolean;
  courses?: CanvasCourse[];
}) {
  const isEnabled = useCanvasEnabled(options?.enabled ?? true);
  const providedCourses = options?.courses;
  const coursesQuery = useCanvasCourses(isEnabled && !providedCourses);
  const courses = providedCourses ?? coursesQuery.data?.courses;
  const courseIds = courses?.map((c) => c.id) ?? [];
  const hasResolvedCourses = providedCourses !== undefined || coursesQuery.isSuccess;

  return useQuery<AssignmentMedEmne[]>({
    queryKey: ["canvas", "all-assignments", courseIds],
    queryFn: async () => {
      if (!courses) return [];

      // Hent oppgaver for alle emner med begrenset concurrency (maks 4 samtidige kall)
      // for å unngå å hammere backend med N samtidige kall ved mange emner.
      const limit = createConcurrencyLimit(4);
      const assignmentResults = await Promise.allSettled(
        courses.map((course: CanvasCourse) =>
          limit(async () => {
            const response = await fetchCanvas(
              `/emner/${course.id}/oppgaver`,
              AssignmentsResponseSchema,
            );

            return response.assignments.map(
              (assignment): AssignmentMedEmne => ({
                ...assignment,
                course_name: course.name,
                course_id: course.id,
              }),
            );
          }),
        ),
      );

      const allAssignments: AssignmentMedEmne[] = [];
      const criticalErrors: unknown[] = [];

      for (const result of assignmentResults) {
        if (result.status === "fulfilled") {
          allAssignments.push(...result.value);
          continue;
        }

        if (!shouldIgnoreAssignmentError(result.reason)) {
          criticalErrors.push(result.reason);
        }
      }

      // Kast kun hvis vi ikke har noe data i det hele tatt
      if (criticalErrors.length > 0 && allAssignments.length === 0) {
        throw criticalErrors[0];
      }

      return allAssignments;
    },
    enabled: isEnabled && hasResolvedCourses,
    ...canvasQueryOptions,
  });
}

// Hent wiki page
export function useCanvasPage(
  courseId: number,
  pageId: string | number,
  enabled = true,
) {
  const isEnabled = useCanvasEnabled(enabled);
  return useQuery({
    queryKey: ["canvas", "page", courseId, pageId],
    queryFn: () =>
      fetchCanvas(`/emner/${courseId}/pages/${pageId}`, CanvasPageSchema),
    enabled: !!courseId && !!pageId && isEnabled,
    ...canvasQueryOptions,
  });
}

// Hent alle filer i et kurs
export function useCanvasFiles(courseId: number | null, enabled = true) {
  const isEnabled = useCanvasEnabled(enabled);
  return useQuery({
    queryKey: ["canvas", "files", courseId],
    queryFn: () =>
      fetchCanvas(
        `/emner/${courseId}/files`,
        FilesResponseSchema,
      ),
    select: (res) => res.files,
    enabled: !!courseId && isEnabled,
    ...canvasQueryOptions,
  });
}

// Hent alle sider i et kurs
export function useCanvasPages(courseId: number | null, enabled = true) {
  const isEnabled = useCanvasEnabled(enabled);
  return useQuery({
    queryKey: ["canvas", "pages", courseId],
    queryFn: () =>
      fetchCanvas(
        `/emner/${courseId}/pages`,
        PagesResponseSchema,
      ),
    select: (res) => res.pages,
    enabled: !!courseId && isEnabled,
    ...canvasQueryOptions,
  });
}

// Hent frontpage for et kurs (returnerer null hvis kurset ikke har en frontpage)
export function useCanvasFrontPage(courseId: number | null, enabled = true) {
  const isEnabled = useCanvasEnabled(enabled);
  return useQuery({
    queryKey: ["canvas", "frontpage", courseId],
    queryFn: async () => {
      const result = await fetchCanvasNullable(
        `/emner/${courseId}/frontpage`,
        FrontPageResponseSchema,
      );
      return result?.page ?? null;
    },
    enabled: !!courseId && isEnabled,
    ...canvasQueryOptions,
  });
}

// Prefetch funksjon for app-start - laster data i bakgrunnen
export function prefetchCanvasData(queryClient: QueryClient) {
  // Prefetch kunngjøringer og emner parallelt
  queryClient.prefetchQuery({
    queryKey: ["canvas", "announcements"],
    queryFn: () => fetchCanvas("/announcements", AnnouncementsResponseSchema),
  });
  // Emner
  queryClient.prefetchQuery({
    queryKey: ["canvas", "courses"],
    queryFn: () => fetchCanvas("/emner", CoursesResponseSchema),
  });
  // Metadata for emner (frontpage/modules/files tilgjengelighet)
  queryClient.prefetchQuery({
    queryKey: ["canvas", "courses-metadata"],
    queryFn: () =>
      fetchCanvas("/emner/metadata", CoursesMetadataResponseSchema),
    staleTime: 1000 * 60 * 30,
  });
  // Kalenderdata (frister, forelesninger, hendelser)
  queryClient.prefetchQuery({
    queryKey: ["canvas", "calendar"],
    queryFn: async () => {
      const { fetchAllCalendarItems, mapCalendarItems } = await import(
        "../calendar/calendar-api"
      );
      const data = await fetchAllCalendarItems();
      return { ...mapCalendarItems(data.items), meta: data.meta };
    },
    staleTime: 30 * 1000,
  });
  // Canvas-bruker (brukes av innstillinger-profil)
  queryClient.prefetchQuery({
    queryKey: ["canvas", "whoami"],
    queryFn: () => fetchCanvas("/whoami", CanvasUserSchema),
  });
  // Todo-liste (brukes av AI Canvas-kontekst i innstillinger)
  queryClient.prefetchQuery({
    queryKey: ["canvas", "todo"],
    queryFn: () => fetchCanvas("/users/self/todo", TodoResponseSchema),
  });
  // Kommende hendelser (brukes av AI Canvas-kontekst i innstillinger)
  queryClient.prefetchQuery({
    queryKey: ["canvas", "upcoming_events"],
    queryFn: () =>
      fetchCanvas("/users/self/upcoming_events", UpcomingEventsResponseSchema),
  });
}

// Hent innholds-metadata for alle emner (forside, moduler, filer)
// Brukes for å dynamisk vise/skjule knapper basert på hva som finnes
export function useCoursesMetadata(enabled = true) {
  const isEnabled = useCanvasEnabled(enabled);
  return useQuery({
    queryKey: ["canvas", "courses-metadata"],
    queryFn: () =>
      fetchCanvas("/emner/metadata", CoursesMetadataResponseSchema),
    enabled: isEnabled,
    staleTime: 1000 * 60 * 30, // 30 minutter - metadata endres sjelden
    refetchOnWindowFocus: false,
  });
}
