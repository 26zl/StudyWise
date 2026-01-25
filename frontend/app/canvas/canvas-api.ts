/*
* Canvas API klient for frontend
* Håndterer kommunikasjon med backend API for Canvas data
* Må endres etterhvert kun ment for testing nå
*/

import type { ZodType } from "zod";
import { useQuery } from "@tanstack/react-query";

import {
  AnnouncementSchema as _AnnouncementSchema,
  AnnouncementsResponseSchema,
  BrukerSchema as _BrukerSchema,
  EmneSchema as _EmneSchema,
  EmnerResponseSchema,
  TestResponseSchema,
} from "common/canvas";

export type {
  Announcement,
  AnnouncementsResponse,
  Bruker,
  Emne,
  EmnerResponse,
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

// React query hooks
export function useCanvasTest() {
  return useQuery({
    queryKey: ["canvas", "test"],
    queryFn: () => fetchCanvas("/test", TestResponseSchema),
  });
}

export function useCanvasEmner() {
  return useQuery({
    queryKey: ["canvas", "emner"],
    queryFn: () => fetchCanvas("/emner", EmnerResponseSchema),
  });
}

export function useCanvasAnnouncements() {
  return useQuery({
    queryKey: ["canvas", "announcements"],
    queryFn: () => fetchCanvas("/announcements", AnnouncementsResponseSchema),
  });
}
