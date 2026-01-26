/*
* Canvas API klient for frontend
* Håndterer kommunikasjon med backend API for Canvas data
* Henter zod schemas fra common for validering av data
*/
import type { ZodType } from "zod";
import { useQuery, type QueryClient } from "@tanstack/react-query";

// Importer Zod schemas fra common
import {
  AnnouncementsResponseSchema,
  EmnerResponseSchema,
  ModulesResponseSchema,
} from "common/canvas";

// Eksporter typer
export type {
  Announcement,
  AnnouncementsResponse,
  Emne,
  EmnerResponse,
  Module,
  ModulesResponse,
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
// Hent emner
export function useCanvasEmner() {
  return useQuery({
    queryKey: ["canvas", "emner"],
    queryFn: () => fetchCanvas("/emner", EmnerResponseSchema),
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

// Prefetch funksjon for app-start - laster data i bakgrunnen
export function prefetchCanvasData(queryClient: QueryClient) {
  // Prefetch kunngjøringer og emner parallelt
  queryClient.prefetchQuery({
    queryKey: ["canvas", "announcements"],
    queryFn: () => fetchCanvas("/announcements", AnnouncementsResponseSchema),
  });

  queryClient.prefetchQuery({
    queryKey: ["canvas", "emner"],
    queryFn: () => fetchCanvas("/emner", EmnerResponseSchema),
  });
}
