/*
* Canvas API klient for frontend
* Håndterer kommunikasjon med backend API for Canvas data
* Henter zod schemas fra common for validering av data
*/
import { z, type ZodType } from "zod";
import { useQuery, type QueryClient } from "@tanstack/react-query";
import { fornySesjon } from "../auth/auth-api";

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

// API funksjoner 
async function fetchCanvas<T>(endpoint: string, schema: ZodType<T>, forsoktRefresh = false): Promise<T> {
  // Bruker relativ URL slik at Next.js rewrites håndterer videresending til backend (i Docker eller localhost)
  const res = await fetch(`/api/canvas${endpoint}`, {
    credentials: "include",
    cache: "no-store",
  });
  if ((res.status === 401 || res.status === 403) && !forsoktRefresh) {
    await fornySesjon();
    return fetchCanvas(endpoint, schema, true);
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

// React Query hooks
// Hent innlogget bruker (og trigger sync i backend)
export function useCanvasUser(enabled = true) {
  return useQuery({
    queryKey: ["canvas", "whoami"],
    queryFn: () => fetchCanvas("/whoami", CanvasUserSchema),
    enabled,
  });
}

// Hent courses
export function useCanvasCourses(enabled = true) {
  return useQuery({
    queryKey: ["canvas", "courses"],
    queryFn: () => fetchCanvas("/emner", CoursesResponseSchema),
    enabled,
  });
}
// Hent kunngjøringer
export function useCanvasAnnouncements(enabled = true) {
  return useQuery({
    queryKey: ["canvas", "announcements"],
    queryFn: () => fetchCanvas("/announcements", AnnouncementsResponseSchema),
    enabled,
  });
}
// Hent moduler for et spesifikt emne
export function useCanvasModules(courseId: number | null, enabled = true) {
  return useQuery({
    queryKey: ["canvas", "modules", courseId],
    queryFn: () =>
      fetchCanvas(`/emner/${courseId}/modules`, ModulesResponseSchema),
    enabled: !!courseId && enabled,
  });
}

// Hent oppgaver for et spesifikt emne
export function useCanvasAssignments(courseId: number | null, enabled = true) {
  return useQuery({
    queryKey: ["canvas", "assignments", courseId],
    queryFn: () =>
      fetchCanvas(`/emner/${courseId}/oppgaver`, AssignmentsResponseSchema),
    enabled: !!courseId && enabled,
  });
}

// Hent kommende hendelser
export function useCanvasUpcomingEvents(enabled = true) {
  return useQuery({
    queryKey: ["canvas", "upcoming_events"],
    queryFn: () => fetchCanvas("/users/self/upcoming_events", UpcomingEventsResponseSchema),
    enabled,
  });
}

// Hent todo liste
export function useCanvasTodo(enabled = true) {
  return useQuery({
    queryKey: ["canvas", "todo"],
    queryFn: () => fetchCanvas("/users/self/todo", TodoResponseSchema),
    enabled,
  });
}

// Hent detaljerte modul-items
export function useCanvasModuleItemDetails(courseId: number, moduleId: number, enabled = true) {
  return useQuery({
    queryKey: ["canvas", "module_items_detailed", courseId, moduleId],
    queryFn: () => fetchCanvas(`/emner/${courseId}/modules/${moduleId}/items`, ModuleItemDetailsResponseSchema),
    enabled: !!courseId && !!moduleId && enabled,
  });
}

// Hent wiki page
export function useCanvasPage(courseId: number, pageId: string | number, enabled = true) {
  return useQuery({
    queryKey: ["canvas", "page", courseId, pageId],
    queryFn: () => fetchCanvas(`/emner/${courseId}/pages/${pageId}`, CanvasPageSchema),
    enabled: !!courseId && !!pageId && enabled,
  });
}

// Hent fil
export function useCanvasFile(fileId: number, enabled = true) {
  return useQuery({
    queryKey: ["canvas", "file", fileId],
    queryFn: () => fetchCanvas(`/filer/${fileId}`, CanvasFileSchema),
    enabled: !!fileId && enabled,
  });
}

// Hent diskusjon
export function useCanvasDiscussion(courseId: number, topicId: number, enabled = true) {
  return useQuery({
    queryKey: ["canvas", "discussion", courseId, topicId],
    queryFn: () => fetchCanvas(`/emner/${courseId}/diskusjoner/${topicId}`, CanvasDiscussionTopicSchema),
    enabled: !!courseId && !!topicId && enabled,
  });
}

// Hent alle filer i et kurs
export function useCanvasFiles(courseId: number | null, enabled = true) {
  return useQuery({
    queryKey: ["canvas", "files", courseId],
    queryFn: () =>
      fetchCanvas(
        `/emner/${courseId}/files`,
        z.object({ files: z.array(CanvasFileSchema), meta: MetaSchema.optional() })
      ),
    select: (res) => res.files,
    enabled: !!courseId && enabled,
  });
}

// Hent alle sider i et kurs
export function useCanvasPages(courseId: number | null, enabled = true) {
  return useQuery({
    queryKey: ["canvas", "pages", courseId],
    queryFn: () =>
      fetchCanvas(
        `/emner/${courseId}/pages`,
        z.object({ pages: z.array(CanvasPageSchema), meta: MetaSchema.optional() })
      ),
    select: (res) => res.pages,
    enabled: !!courseId && enabled,
  });
}

// Hent frontpage for et kurs
export function useCanvasFrontPage(courseId: number | null, enabled = true) {
  return useQuery({
    queryKey: ["canvas", "frontpage", courseId],
    queryFn: () =>
      fetchCanvas(
        `/emner/${courseId}/frontpage`,
        z.object({ page: CanvasPageSchema, meta: MetaSchema.optional() })
      ),
    select: (res) => res.page,
    enabled: !!courseId && enabled,
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
