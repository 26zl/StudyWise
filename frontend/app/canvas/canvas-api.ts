/*
* Canvas API klient for frontend
* Håndterer kommunikasjon med backend API for Canvas data
* Henter zod schemas fra common for validering av data
*/
import type { ZodType } from "zod";
import { useQuery } from "@tanstack/react-query";

// Importer Zod schemas fra common
import {
  AnnouncementSchema as _AnnouncementSchema,
  AnnouncementsResponseSchema,
  BrukerSchema as _BrukerSchema,
  EmneSchema as _EmneSchema,
  EmnerResponseSchema,
  ModulesResponseSchema,
  TestResponseSchema,
} from "common/canvas";

// Eksporter typer
export type {
  Announcement,
  AnnouncementsResponse,
  Bruker,
  Emne,
  EmnerResponse,
  Module,
  ModulesResponse,
  TestResponse,
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
// Hent testdata fra Canvas API
export function useCanvasTest() {
  return useQuery({
    queryKey: ["canvas", "test"],
    queryFn: () => fetchCanvas("/test", TestResponseSchema),
  });
}
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
