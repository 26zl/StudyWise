/*
 * Delte typer for kalender/frist data brukt mellom backend og frontend.
 * Samler Canvas-oppgaver, kommende hendelser, todo-elementer og TimeEdit-timeplan i ett format.
 */

import { z } from "zod";

// Kilde/type for kalender-element
export const CalendarSourceSchema = z.enum(["assignment", "event", "todo", "timetable"]);

// Et normalisert kalender-element med kurs-info
export const CalendarItemSchema = z.object({
  id: z.string(),
  title: z.string(),
  due_at: z.string(), // ISO dato/tid (startpunkt)
  end_at: z.string().nullable().optional(), // ISO dato/tid (sluttpunkt) - for TimeEdit
  course_id: z.number().nullable().optional(),
  course_code: z.string().nullable().optional(),
  course_name: z.string().nullable().optional(),
  source: CalendarSourceSchema,
  html_url: z.string().nullable().optional(),
  raw_type: z.string().optional(),
  // TimeEdit-spesifikke felter
  location: z.string().nullable().optional(), // Rom/lokasjon
  teacher: z.string().nullable().optional(), // Foreleser
  activity_type: z.string().nullable().optional(), // Type aktivitet
});

// TimeEdit reservasjon (rådata fra TimeEdit API)
export const TimeEditReservationSchema = z.object({
  id: z.string(),
  startdate: z.string(), // Format: YYYY-MM-DD
  starttime: z.string(), // Format: HH:mm
  enddate: z.string(),
  endtime: z.string(),
  columns: z.array(z.string()), // [kursKode, aktivitetsType, lokasjon, foreleser, etc.]
});

// Respons for TimeEdit-endepunkt
export const TimeEditResponseSchema = z.object({
  reservations: z.array(TimeEditReservationSchema),
  meta: z.object({
    generatedAt: z.string(),
    semesterStart: z.string().optional(),
    semesterEnd: z.string().optional(),
    courseCodesUsed: z.array(z.string()).optional(),
  }).optional(),
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

// TypeScript typer zod eksportering
export type CalendarItem = z.infer<typeof CalendarItemSchema>;
export type CalendarItemsResponse = z.infer<typeof CalendarItemsResponseSchema>;
export type CalendarSource = z.infer<typeof CalendarSourceSchema>;
export type TimeEditReservation = z.infer<typeof TimeEditReservationSchema>;
export type TimeEditResponse = z.infer<typeof TimeEditResponseSchema>;
