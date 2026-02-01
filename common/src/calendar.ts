/*
 * Delte typer for kalender/frist data brukt mellom backend og frontend.
 * Samler Canvas-oppgaver, kommende hendelser og todo-elementer i ett format.
 */

import { z } from "zod";

// Kilde/type for kalender-element
export const CalendarSourceSchema = z.enum(["assignment", "event", "todo"]);

// Et normalisert kalender-element med kurs-info
export const CalendarItemSchema = z.object({
  id: z.string(),
  title: z.string(),
  due_at: z.string(), // ISO dato/tid
  course_id: z.number().nullable().optional(),
  course_code: z.string().nullable().optional(),
  course_name: z.string().nullable().optional(),
  source: CalendarSourceSchema,
  html_url: z.string().nullable().optional(),
  raw_type: z.string().optional(),
});

// Respons for kalender-endepunkt
export const CalendarItemsResponseSchema = z.object({
  items: z.array(CalendarItemSchema),
  meta: z
    .object({
      generatedAt: z.string(),
      courseCount: z.number().optional(),
    })
    .optional(),
});

export type CalendarItem = z.infer<typeof CalendarItemSchema>;
export type CalendarItemsResponse = z.infer<typeof CalendarItemsResponseSchema>;
export type CalendarSource = z.infer<typeof CalendarSourceSchema>;
