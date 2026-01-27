/*
 * zod schemas for Canvas API
 */

import { z } from "zod";

// zod schemas for Canvas API responses
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

export const CanvasCourseSchema = z.object({
  id: z.number(),
  name: z.string(),
  course_code: z.string().optional(),
  enrollment_term_id: z.number().optional(),
});

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

export const CanvasModuleItemSchema = z.object({
  id: z.number(),
  title: z.string(),
  type: z.string(),
  html_url: z.string().optional(),
});

export const CanvasModuleSchema = z.object({
  id: z.number(),
  name: z.string(),
  items: z.array(CanvasModuleItemSchema).optional(),
});

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

// Normaliserte schemas (for frontend/backend kommunikasjon)

export const BrukerSchema = z.object({
  id: z.number(),
  navn: z.string(),
  epost: z.string().nullable(),
  locale: z.string().optional(),
});

export const EmneSchema = z.object({
  id: z.number(),
  name: z.string(),
  course_code: z.string().optional(),
  enrollment_term_id: z.number().optional(),
});

export const ModuleSchema = CanvasModuleSchema;
export const AnnouncementSchema = CanvasAnnouncementSchema;

// Meta og Response Schemas 

export const MetaSchema = z.object({
  pagesFetched: z.number(),
  itemsCount: z.number(),
});

export const TestResponseSchema = z.object({
  suksess: z.boolean(),
  melding: z.string(),
  bruker: BrukerSchema.optional(),
});

export const EmnerResponseSchema = z.object({
  emner: z.array(EmneSchema),
  meta: MetaSchema.optional(),
});

export const AnnouncementsResponseSchema = z.object({
  announcements: z.array(AnnouncementSchema),
  meta: MetaSchema.optional(),
});

export const ModulesResponseSchema = z.object({
  modules: z.array(ModuleSchema),
  meta: MetaSchema.optional(),
});

// Type exports

export type CanvasUser = z.infer<typeof CanvasUserSchema>;
export type CanvasCourse = z.infer<typeof CanvasCourseSchema>;
export type CanvasModule = z.infer<typeof CanvasModuleSchema>;
export type CanvasAnnouncement = z.infer<typeof CanvasAnnouncementSchema>;
export type CanvasPlannerItem = z.infer<typeof CanvasPlannerItemSchema>;

export type Bruker = z.infer<typeof BrukerSchema>;
export type Emne = z.infer<typeof EmneSchema>;
export type Module = z.infer<typeof ModuleSchema>;
export type Announcement = z.infer<typeof AnnouncementSchema>;

export type TestResponse = z.infer<typeof TestResponseSchema>;
export type EmnerResponse = z.infer<typeof EmnerResponseSchema>;
export type AnnouncementsResponse = z.infer<typeof AnnouncementsResponseSchema>;
export type ModulesResponse = z.infer<typeof ModulesResponseSchema>;
