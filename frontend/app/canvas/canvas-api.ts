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
  MetaSchema,
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
} from "common/canvas";

// Spesialisert feilklasse for manglende/ugyldig Canvas-token
export class CanvasTokenMissingError extends Error {
  constructor(message = "Canvas-token mangler") {
    super(message);
    this.name = "CanvasTokenMissingError";
  }
}

export class CanvasTokenInvalidError extends Error {
  constructor(message = "Canvas-token er ugyldig eller utløpt") {
    super(message);
    this.name = "CanvasTokenInvalidError";
  }
}

// Sjekk om en feil er en token-feil som ikke skal prøves på nytt
function isTokenError(error: unknown): boolean {
  if (error instanceof CanvasTokenMissingError) return true;
  if (error instanceof CanvasTokenInvalidError) return true;
  if (error instanceof Error) {
    const msg = error.message.toLowerCase();
    return msg.includes("token") && (msg.includes("ugyldig") || msg.includes("mangler") || msg.includes("utløpt"));
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

// Marker token som ugyldig i global state
function markTokenInvalid() {
  useUIStore.getState().setCanvasTokenInvalid(true);
}

// Nullstill token-status (kall når nytt token lagres)
export function resetCanvasTokenStatus() {
  useUIStore.getState().setCanvasTokenInvalid(false);
}

// API funksjoner
async function fetchCanvas<T>(endpoint: string, schema: ZodType<T>, forsoktRefresh = false): Promise<T> {
  // Sjekk om token allerede er markert som ugyldig
  if (useUIStore.getState().canvasTokenInvalid) {
    throw new CanvasTokenInvalidError("Canvas-token er ugyldig. Oppdater tokenet i innstillinger.");
  }

  // Bruker relativ URL slik at Next.js rewrites håndterer videresending til backend (i Docker eller localhost)
  const res = await fetch(`/api/canvas${endpoint}`, {
    credentials: "include",
    cache: "no-store",
  });

  // Håndter 401 (ikke autentisert / ugyldig token)
  if (res.status === 401) {
    // Prøv refresh først
    if (!forsoktRefresh) {
      await fornySesjon();
      return fetchCanvas(endpoint, schema, true);
    }
    // Etter refresh-forsøk, marker token som ugyldig
    markTokenInvalid();
    throw new CanvasTokenInvalidError("Canvas-token er ugyldig eller utløpt. Oppdater tokenet i innstillinger.");
  }

  // Håndter 403 (manglende Canvas-token) - ikke prøv refresh
  if (res.status === 403) {
    const errorText = await res.text();
    let errorMessage = "Canvas-token mangler";
    try {
      const error = JSON.parse(errorText);
      errorMessage = error.melding || error.feil || errorMessage;
    } catch {
      // Ignorer JSON-parse feil, bruk default melding
    }
    markTokenInvalid();
    throw new CanvasTokenMissingError(errorMessage);
  }

  if (!res.ok) {
    const errorText = await res.text();
    let errorMessage = "API feil";
    try {
      const error = JSON.parse(errorText);
      errorMessage = error.melding || error.feil || errorMessage;
    } catch {
      errorMessage = errorText || errorMessage;
    }
    throw new Error(errorMessage);
  }
  const data = await res.json();
  return schema.parse(data); // Type-safe parsing med Zod
}

// Variant som tillater null-respons (for 204 No Content)
async function fetchCanvasNullable<T>(endpoint: string, schema: ZodType<T>, forsoktRefresh = false): Promise<T | null> {
  // Sjekk om token allerede er markert som ugyldig
  if (useUIStore.getState().canvasTokenInvalid) {
    throw new CanvasTokenInvalidError("Canvas-token er ugyldig. Oppdater tokenet i innstillinger.");
  }

  const res = await fetch(`/api/canvas${endpoint}`, {
    credentials: "include",
    cache: "no-store",
  });

  if (res.status === 401) {
    if (!forsoktRefresh) {
      await fornySesjon();
      return fetchCanvasNullable(endpoint, schema, true);
    }
    markTokenInvalid();
    throw new CanvasTokenInvalidError("Canvas-token er ugyldig eller utløpt. Oppdater tokenet i innstillinger.");
  }

  if (res.status === 403) {
    const errorText = await res.text();
    let errorMessage = "Canvas-token mangler";
    try {
      const error = JSON.parse(errorText);
      errorMessage = error.melding || error.feil || errorMessage;
    } catch { /* ignorer */ }
    markTokenInvalid();
    throw new CanvasTokenMissingError(errorMessage);
  }

  // 204 No Content - returner null (ikke en feil)
  if (res.status === 204) {
    return null;
  }

  if (!res.ok) {
    const errorText = await res.text();
    let errorMessage = "API feil";
    try {
      const error = JSON.parse(errorText);
      errorMessage = error.melding || error.feil || errorMessage;
    } catch {
      errorMessage = errorText || errorMessage;
    }
    throw new Error(errorMessage);
  }
  const data = await res.json();
  return schema.parse(data);
}

// Schema for modul-item open respons
const ModuleItemOpenResponseSchema = z.union([
  z.object({ type: z.literal("File"), downloadPath: z.string() }),
  z.object({ type: z.literal("ExternalUrl"), url: z.string() }),
  z.object({ type: z.literal("Page"), page_url: z.string(), html_url: z.string().optional() }),
]);

export type ModuleItemOpenResponse = z.infer<typeof ModuleItemOpenResponseSchema>;

// Åpne modul-item via backend (henter fil-info dynamisk for filer uten content_id)
export async function openModuleItem(
  courseId: number,
  moduleId: number,
  itemId: number
): Promise<ModuleItemOpenResponse> {
  return fetchCanvas(
    `/emner/${courseId}/modules/${moduleId}/items/${itemId}/open`,
    ModuleItemOpenResponseSchema
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
    queryFn: () => fetchCanvas("/users/self/upcoming_events", UpcomingEventsResponseSchema),
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

// Hent detaljerte modul-items
export function useCanvasModuleItemDetails(courseId: number, moduleId: number, enabled = true) {
  const isEnabled = useCanvasEnabled(enabled);
  return useQuery({
    queryKey: ["canvas", "module_items_detailed", courseId, moduleId],
    queryFn: () => fetchCanvas(`/emner/${courseId}/modules/${moduleId}/items`, ModuleItemDetailsResponseSchema),
    enabled: !!courseId && !!moduleId && isEnabled,
    ...canvasQueryOptions,
  });
}

// Hent wiki page
export function useCanvasPage(courseId: number, pageId: string | number, enabled = true) {
  const isEnabled = useCanvasEnabled(enabled);
  return useQuery({
    queryKey: ["canvas", "page", courseId, pageId],
    queryFn: () => fetchCanvas(`/emner/${courseId}/pages/${pageId}`, CanvasPageSchema),
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
export function useCanvasDiscussion(courseId: number, topicId: number, enabled = true) {
  const isEnabled = useCanvasEnabled(enabled);
  return useQuery({
    queryKey: ["canvas", "discussion", courseId, topicId],
    queryFn: () => fetchCanvas(`/emner/${courseId}/diskusjoner/${topicId}`, CanvasDiscussionTopicSchema),
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
        z.object({ files: z.array(CanvasFileSchema), meta: MetaSchema.optional() })
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
        z.object({ pages: z.array(CanvasPageSchema), meta: MetaSchema.optional() })
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
        z.object({ page: CanvasPageSchema, meta: MetaSchema.optional() })
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
}
