/*
 * Delte typer for kalender/frist data brukt mellom backend og frontend.
 * Samler Canvas-oppgaver, kommende hendelser og todo-elementer i ett format.
 */

import { z } from "zod";

// Kilde/type for kalender-element
export const CalendarSourceSchema = z.enum(["assignment", "event", "todo", "timetable"]);

// Et normalisert kalender-element med kurs-info
export const CalendarItemSchema = z.object({
  id: z.string(),
  title: z.string(),
  due_at: z.string(), // ISO dato/tid (startpunkt)
  end_at: z.string().nullable().optional(), // ISO dato/tid (sluttpunkt)
  course_id: z.number().nullable().optional(),
  course_code: z.string().nullable().optional(),
  course_name: z.string().nullable().optional(),
  source: CalendarSourceSchema,
  html_url: z.string().nullable().optional(),
  raw_type: z.string().optional(),
  // Hendelse-spesifikke felter
  location: z.string().nullable().optional(), // Rom/lokasjon
});

// Paginerings-metadata (brukes internt i CalendarItemsResponseSchema)
const PaginationMetaSchema = z.object({
  page: z.number(),
  limit: z.number(),
  totalItems: z.number(),
  totalPages: z.number(),
  hasNextPage: z.boolean(),
  hasPrevPage: z.boolean(),
});

// Respons for kalender-endepunkt
export const CalendarItemsResponseSchema = z.object({
  items: z.array(CalendarItemSchema),
  meta: z
    .object({
      generatedAt: z.string(),
      courseCount: z.number().optional(),
      // Paginering
      pagination: PaginationMetaSchema.optional(),
      // Cache-status
      fromCache: z.boolean().optional(),
      cacheAge: z.number().optional(), // Sekunder siden cache ble satt
    })
    .optional(),
});

// TypeScript typer zod eksportering
export type CalendarItem = z.infer<typeof CalendarItemSchema>;
export type CalendarItemsResponse = z.infer<typeof CalendarItemsResponseSchema>;
export type CalendarSource = z.infer<typeof CalendarSourceSchema>;
