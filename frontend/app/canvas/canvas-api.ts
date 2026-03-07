/*
 * Canvas API klient for frontend
 * Håndterer kommunikasjon med backend API for Canvas data
 * Henter zod schemas fra common for validering av data
 */
import { z, type ZodType } from "zod";
import { useQuery, type QueryClient } from "@tanstack/react-query";
import { fornySesjon } from "../auth/auth-api";
import { useUIStore } from "../store/uiStore";

// Importer Zod schemas fra common
import {
  CanvasUserSchema,
  AnnouncementsResponseSchema,
  CoursesResponseSchema,
  ModulesResponseSchema,
  AssignmentsResponseSchema,
  CanvasPageSchema,
  CanvasFileSchema,
  CanvasDiscussionTopicSchema,
  UpcomingEventsResponseSchema,
  TodoResponseSchema,
  ModuleItemDetailsResponseSchema,
  ModuleItemOpenResponseSchema,
  CoursesMetadataResponseSchema,
  MetaSchema,
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
import {
  type CanvasErrorCode,
  isRecoverableError as isRecoverableErrorCode,
} from "common/canvasErrors";

// Importer error-klasser fra felles error-modul
import {
  CanvasTokenMissingError,
  CanvasTokenInvalidError,
  CanvasPermissionError,
  CanvasResourceError,
  CanvasApiError,
} from "../lib/errors";

// Re-eksporter for konsumenter
export {
  CanvasTokenMissingError,
  CanvasTokenInvalidError,
  CanvasPermissionError,
  CanvasResourceError,
  CanvasApiError,
  type CanvasErrorCode,
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

// Sjekk om feil er gjenopprettbar (kan prøves igjen)
export function isRecoverableError(error: unknown): boolean {
  if (error instanceof CanvasApiError) {
    return isRecoverableErrorCode(error.code);
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
async function håndterFeilRespons<T>(
  res: Response,
  forsoktRefresh: boolean,
  rekursivFn: () => Promise<T>,
): Promise<void> {
  // Håndter 401 (ikke autentisert / ugyldig token)
  if (res.status === 401) {
    if (!forsoktRefresh) {
      await fornySesjon();
      // Kaster resultatet som en "suksess-avbrudd" — fanges av kalleren
      throw { __retry: true, result: await rekursivFn() };
    }
    markTokenInvalid();
    throw new CanvasTokenInvalidError(
      "Canvas-token er ugyldig eller utløpt. Oppdater tokenet i innstillinger.",
    );
  }

  // Håndter 403 - skille mellom "token mangler" (vår backend) og "permission denied" (Canvas)
  if (res.status === 403) {
    const errorText = await res.text();
    let errorMessage = "Ingen tilgang";
    let errorCode: CanvasErrorCode = "permission_denied";
    try {
      const error = JSON.parse(errorText);
      errorMessage = error.melding || error.feil || errorMessage;
      errorCode = error.kode || errorCode;
    } catch {
      // Ignorer JSON-parse feil
    }

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
    const errorText = await res.text();
    let errorMessage = "Ressursen ble ikke funnet";
    let errorCode: CanvasErrorCode = "resource_not_found";
    try {
      const error = JSON.parse(errorText);
      errorMessage = error.melding || error.feil || errorMessage;
      errorCode = error.kode || errorCode;
      if (errorMessage.toLowerCase().includes("deaktivert")) {
        errorCode = "resource_disabled";
      }
    } catch {
      // Ignorer JSON-parse feil
    }
    throw new CanvasResourceError(
      errorCode as "resource_disabled" | "resource_not_found",
      errorMessage,
    );
  }

  // Håndter 429 - rate limited
  if (res.status === 429) {
    const errorText = await res.text();
    let errorMessage = "For mange forespørsler";
    try {
      const error = JSON.parse(errorText);
      errorMessage = error.melding || error.feil || errorMessage;
    } catch {
      // Ignorer JSON-parse feil
    }
    throw new CanvasApiError("rate_limited", errorMessage, 429);
  }

  // Håndter 5xx - server error (504 er timeout, resten er server_error)
  if (res.status >= 500) {
    const errorText = await res.text();
    let errorMessage = "Serverfeil";
    try {
      const error = JSON.parse(errorText);
      errorMessage = error.melding || error.feil || errorMessage;
    } catch {
      // Ignorer JSON-parse feil
    }
    const code = res.status === 504 ? "timeout" : "server_error";
    throw new CanvasApiError(code, errorMessage, res.status);
  }

  // Generell feil for andre ikke-OK statuser
  if (!res.ok) {
    const errorText = await res.text();
    let errorMessage = "API feil";
    let errorCode: CanvasErrorCode = "unknown";
    try {
      const error = JSON.parse(errorText);
      errorMessage = error.melding || error.feil || errorMessage;
      errorCode = error.kode || errorCode;
    } catch {
      errorMessage = errorText || errorMessage;
    }
    throw new CanvasApiError(errorCode, errorMessage, res.status);
  }
}

// API funksjoner
export async function fetchCanvas<T>(
  endpoint: string,
  schema: ZodType<T>,
  forsoktRefresh = false,
): Promise<T> {
  if (useUIStore.getState().canvasTokenInvalid) {
    throw new CanvasTokenInvalidError(
      "Canvas-token er ugyldig. Oppdater tokenet i innstillinger.",
    );
  }

  const res = await fetch(`/api/canvas${endpoint}`, {
    credentials: "include",
    cache: "no-store",
  });

  try {
    await håndterFeilRespons(res, forsoktRefresh, () =>
      fetchCanvas(endpoint, schema, true),
    );
  } catch (e) {
    if (e && typeof e === "object" && "__retry" in e) {
      return (e as unknown as { result: T }).result;
    }
    throw e;
  }

  const data = await res.json();
  return schema.parse(data);
}

// Variant som tillater null-respons (for 204 No Content)
async function fetchCanvasNullable<T>(
  endpoint: string,
  schema: ZodType<T>,
  forsoktRefresh = false,
): Promise<T | null> {
  if (useUIStore.getState().canvasTokenInvalid) {
    throw new CanvasTokenInvalidError(
      "Canvas-token er ugyldig. Oppdater tokenet i innstillinger.",
    );
  }

  const res = await fetch(`/api/canvas${endpoint}`, {
    credentials: "include",
    cache: "no-store",
  });

  try {
    await håndterFeilRespons(res, forsoktRefresh, () =>
      fetchCanvasNullable(endpoint, schema, true),
    );
  } catch (e) {
    if (e && typeof e === "object" && "__retry" in e) {
      return (e as unknown as { result: T | null }).result;
    }
    throw e;
  }

  // 204 No Content - returner null (ikke en feil)
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

// Hent oppgaver for et spesifikt emne
export function useCanvasAssignments(courseId: number | null, enabled = true) {
  const isEnabled = useCanvasEnabled(enabled);
  return useQuery({
    queryKey: ["canvas", "assignments", courseId],
    queryFn: () =>
      fetchCanvas(`/emner/${courseId}/oppgaver`, AssignmentsResponseSchema),
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

// Hent ALLE oppgaver på tvers av emner
export function useCanvasAllAssignments(options?: { enabled?: boolean }) {
  const isEnabled = useCanvasEnabled(options?.enabled ?? true);
  const coursesQuery = useCanvasCourses(isEnabled);

  const courseIds = coursesQuery.data?.courses?.map((c) => c.id) ?? [];

  return useQuery<AssignmentMedEmne[]>({
    queryKey: ["canvas", "all-assignments", courseIds],
    queryFn: async () => {
      if (coursesQuery.isError) {
        throw coursesQuery.error;
      }

      const courses = coursesQuery.data?.courses;
      if (!courses) return [];

      // Hent oppgaver for alle emner parallelt.
      // Ignorer kun forventede per-emne tilgangsfeil; ikke skjul systemiske parse/API-feil som tom liste.
      const assignmentResults = await Promise.allSettled(
        courses.map(async (course: CanvasCourse) => {
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

      if (criticalErrors.length > 0) {
        throw criticalErrors[0];
      }

      return allAssignments;
    },
    enabled:
      isEnabled &&
      (coursesQuery.isSuccess || coursesQuery.isError),
    ...canvasQueryOptions,
  });
}

// Hent detaljerte modul-items
export function useCanvasModuleItemDetails(
  courseId: number,
  moduleId: number,
  enabled = true,
) {
  const isEnabled = useCanvasEnabled(enabled);
  return useQuery({
    queryKey: ["canvas", "module_items_detailed", courseId, moduleId],
    queryFn: () =>
      fetchCanvas(
        `/emner/${courseId}/modules/${moduleId}/items`,
        ModuleItemDetailsResponseSchema,
      ),
    enabled: !!courseId && !!moduleId && isEnabled,
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

// Hent fil
export function useCanvasFile(fileId: number, enabled = true) {
  const isEnabled = useCanvasEnabled(enabled);
  return useQuery({
    queryKey: ["canvas", "file", fileId],
    queryFn: () => fetchCanvas(`/filer/${fileId}`, CanvasFileSchema),
    enabled: !!fileId && isEnabled,
    ...canvasQueryOptions,
  });
}

// Hent diskusjon
export function useCanvasDiscussion(
  courseId: number,
  topicId: number,
  enabled = true,
) {
  const isEnabled = useCanvasEnabled(enabled);
  return useQuery({
    queryKey: ["canvas", "discussion", courseId, topicId],
    queryFn: () =>
      fetchCanvas(
        `/emner/${courseId}/diskusjoner/${topicId}`,
        CanvasDiscussionTopicSchema,
      ),
    enabled: !!courseId && !!topicId && isEnabled,
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
        z.object({
          files: z.array(CanvasFileSchema),
          meta: MetaSchema.optional(),
        }),
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
        z.object({
          pages: z.array(CanvasPageSchema),
          meta: MetaSchema.optional(),
        }),
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
        z.object({ page: CanvasPageSchema, meta: MetaSchema.optional() }),
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
