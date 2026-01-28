/*
 * Zod schemas for Canvas API (1:1 with Canvas field names)
 */

import { z } from "zod";

// Schema for Canvas bruker
export const CanvasUserSchema = z.object({
  id: z.number(),
  name: z.string(),
  sortable_name: z.string().optional(),
  short_name: z.string().optional(),
  avatar_url: z.string().optional(),
  first_name: z.string().optional(),
  last_name: z.string().optional(),
  primary_email: z.string().email().nullable().optional(),
  locale: z.string().nullable().optional(),
  effective_locale: z.string().optional(),
  permissions: z
    .object({
      can_update_name: z.boolean().default(false),
      can_update_avatar: z.boolean().default(false),
      limit_parent_app_web_access: z.boolean().default(false),
    })
    .optional(),
  created_at: z.string().optional(),
});

// Schema for Canvas kurs
export const CanvasCourseSchema = z.object({
  id: z.number(),
  name: z.string(),
  course_code: z.string().optional(),
  enrollment_term_id: z.number().optional(),
});

// Schema for Canvas oppgave
export const CanvasAssignmentSchema = z.object({
  id: z.number(),
  name: z.string(),
  due_at: z.string().nullable(),
  points_possible: z.number().nullable(),
  html_url: z.string(),
});

// Schema for Canvas kunngjøring
export const CanvasAnnouncementSchema = z.object({
  id: z.number(),
  title: z.string(),
  message: z.string().nullable().optional(),
  posted_at: z.string().nullable().optional(),
  author: z
    .object({
      id: z.number(),
      display_name: z.string(),
    })
    .optional(),
  html_url: z.string().optional(),
});

// Schema for Canvas moduler og modul-innhold
export const CanvasModuleItemSchema = z.object({
  id: z.number(),
  title: z.string(),
  type: z.string(),
  html_url: z.string().optional(),
});

// Schema for Canvas moduler
export const CanvasModuleSchema = z.object({
  id: z.number(),
  name: z.string(),
  items: z.array(CanvasModuleItemSchema).optional(),
});

// Schema for Canvas planleggingsobjekter
export const CanvasPlannerItemSchema = z.object({
  context_type: z.string().optional(),
  course_id: z.number().optional(),
  plannable_id: z.number(),
  plannable_type: z.string(),
  plannable_date: z.string().nullable().optional(),
  html_url: z.string().optional(),
  plannable: z
    .object({
      id: z.number(),
      title: z.string(),
      due_at: z.string().nullable().optional(),
      points_possible: z.number().nullable().optional(),
    })
    .optional(),
});

// Meta-informasjon for paginerte svar
export const MetaSchema = z.object({
  pagesFetched: z.number(),
  itemsCount: z.number(),
});

// Svar-schemas for ulike Canvas API endepunkter
export const CoursesResponseSchema = z.object({
  courses: z.array(CanvasCourseSchema),
  meta: MetaSchema.optional(),
});

// Svar-schema for kunngjøringer
export const AnnouncementsResponseSchema = z.object({
  announcements: z.array(CanvasAnnouncementSchema),
  meta: MetaSchema.optional(),
});

// Svar-schema for moduler
export const ModulesResponseSchema = z.object({
  modules: z.array(CanvasModuleSchema),
  meta: MetaSchema.optional(),
});

// Svar-schema for planleggingsobjekter
export const PlannerItemsResponseSchema = z.object({
  items: z.array(CanvasPlannerItemSchema),
  meta: MetaSchema.optional(),
});

// Svar-schema for oppgaver
export const AssignmentsResponseSchema = z.object({
  assignments: z.array(CanvasAssignmentSchema),
  meta: MetaSchema.optional(),
});

// TypeScript typer eksportering
export type CanvasUser = z.infer<typeof CanvasUserSchema>;
export type CanvasCourse = z.infer<typeof CanvasCourseSchema>;
export type CanvasAssignment = z.infer<typeof CanvasAssignmentSchema>;
export type CanvasAnnouncement = z.infer<typeof CanvasAnnouncementSchema>;
export type CanvasModule = z.infer<typeof CanvasModuleSchema>;
export type CanvasModuleItem = z.infer<typeof CanvasModuleItemSchema>;
export type CanvasPlannerItem = z.infer<typeof CanvasPlannerItemSchema>;
export type Meta = z.infer<typeof MetaSchema>;
export type CoursesResponse = z.infer<typeof CoursesResponseSchema>;
export type AnnouncementsResponse = z.infer<typeof AnnouncementsResponseSchema>;
export type ModulesResponse = z.infer<typeof ModulesResponseSchema>;
export type PlannerItemsResponse = z.infer<typeof PlannerItemsResponseSchema>;
export type AssignmentsResponse = z.infer<typeof AssignmentsResponseSchema>;
