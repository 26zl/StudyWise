/*
* Canvas API klient for frontend
* Håndterer kommunikasjon med backend API for Canvas data
* Henter zod schemas fra common for validering av data
*/
import type { ZodType } from "zod";
import { useQuery, type QueryClient } from "@tanstack/react-query";

// Importer Zod schemas fra common
import {
  CanvasUserSchema,
  AnnouncementsResponseSchema,
  CoursesResponseSchema,
  ModulesResponseSchema,
  AssignmentsResponseSchema,
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
} from "common/canvas";

// API funksjoner 
async function fetchCanvas<T>(endpoint: string, schema: ZodType<T>): Promise<T> {
  // Bruker relativ URL slik at Next.js rewrites håndterer videresending til backend (i Docker eller localhost)
  const res = await fetch(`/api/canvas${endpoint}`);
  if (!res.ok) {
    const error = await res.json();
    throw new Error(error.melding || error.feil || "API feil");
  }
  const data = await res.json();
  return schema.parse(data); // Type-safe parsing med Zod
}

// React Query hooks
// Hent innlogget bruker (og trigger sync i backend)
export function useCanvasUser() {
  return useQuery({
    queryKey: ["canvas", "whoami"],
    queryFn: () => fetchCanvas("/whoami", CanvasUserSchema),
  });
}

// Hent courses
export function useCanvasCourses() {
  return useQuery({
    queryKey: ["canvas", "courses"],
    queryFn: () => fetchCanvas("/emner", CoursesResponseSchema),
  });
}
// Hent kunngjøringer
export function useCanvasAnnouncements() {
  return useQuery({
    queryKey: ["canvas", "announcements"],
    queryFn: () => fetchCanvas("/announcements", AnnouncementsResponseSchema),
  });
}
// Hent moduler for et spesifikt emne
export function useCanvasModules(courseId: number | null) {
  return useQuery({
    queryKey: ["canvas", "modules", courseId],
    queryFn: () =>
      fetchCanvas(`/emner/${courseId}/modules`, ModulesResponseSchema),
    enabled: !!courseId,
  });
}

// Hent oppgaver for et spesifikt emne
export function useCanvasAssignments(courseId: number | null) {
  return useQuery({
    queryKey: ["canvas", "assignments", courseId],
    queryFn: () =>
      fetchCanvas(`/emner/${courseId}/oppgaver`, AssignmentsResponseSchema),
    enabled: !!courseId,
  });
}

// Prefetch funksjon for app-start - laster data i bakgrunnen
export function prefetchCanvasData(queryClient: QueryClient) {
  // Prefetch kunngjøringer og emner parallelt
  queryClient.prefetchQuery({
    queryKey: ["canvas", "announcements"],
    queryFn: () => fetchCanvas("/announcements", AnnouncementsResponseSchema),
  });

  queryClient.prefetchQuery({
    queryKey: ["canvas", "courses"],
    queryFn: () => fetchCanvas("/emner", CoursesResponseSchema),
  });
}
