/**
 * Canvas – Zod-schemas for Canvas API (1:1 med Canvas feltnavn). Deles av frontend og backend.
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
  primary_email: z.email().nullable().optional(),
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
  workflow_state: z.string().optional(), // "available", "unpublished", etc.
  syllabus_body: z.string().nullable().optional(), // HTML-innhold fra syllabus/kursplan
  public_description: z.string().nullable().optional(), // Offentlig kursbeskrivelse
  default_view: z.string().optional(), // "feed", "wiki", "modules", "syllabus", "assignments"
});

// Valgfri submission fra Canvas (når include[]=submission brukes)
const CanvasAssignmentSubmissionSchema = z
  .object({
    workflow_state: z.string().optional(), // "submitted" | "graded" | "pending_review" | "unsubmitted"
    submitted_at: z.string().nullable().optional(),
    score: z.number().nullable().optional(),
    grade: z.string().nullable().optional(),
  })
  .loose()
  .optional()
  .nullable();

// Schema for Canvas oppgave
export const CanvasAssignmentSchema = z.object({
  id: z.number(),
  name: z.string(),
  due_at: z.string().nullable(),
  description: z.string().nullable().optional(),
  points_possible: z.number().nullable(),
  html_url: z.string().optional(),
  course_id: z.number().optional(),
  submission: CanvasAssignmentSubmissionSchema,
});

/** Sjekk om en oppgave er innlevert (submitted, graded eller pending_review). */
export function isCanvasAssignmentSubmitted(assignment: {
  submission?: { workflow_state?: string | null; submitted_at?: string | null } | null;
}): boolean {
  const sub = assignment?.submission;
  if (!sub) return false;
  const state = sub.workflow_state;
  if (state === "submitted" || state === "graded" || state === "pending_review") return true;
  return Boolean(sub.submitted_at);
}

// Schema for Canvas kunngjøring
export const CanvasAnnouncementSchema = z.object({
  id: z.number(),
  title: z.string(),
  message: z.string().nullable().optional(),
  posted_at: z.string().nullable().optional(),
  context_code: z.string().optional(), // f.eks. "course_12345"
  author: z
    .object({
      id: z.number().optional(),
      display_name: z.string().nullable().optional(),
    })
    .loose()
    .nullable()
    .optional(),
  html_url: z.string().nullable().optional(),
});

// Schema for Canvas moduler og modul-innhold
export const CanvasModuleItemSchema = z.object({
  id: z.number(),
  title: z.string(),
  type: z.string(),
  updated_at: z.string().nullable().optional(),
  html_url: z.string().optional(),
  page_url: z.string().optional(),
  url: z.string().optional(),
  external_url: z.string().optional(),
  content_id: z.number().optional(),
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
      end_at: z.string().nullable().optional(), // Sluttid for calendar_events
      points_possible: z.number().nullable().optional(),
      location_name: z.string().nullable().optional(), // Lokasjon for calendar_events
    })
    .optional(),
});

// Meta-informasjon for paginerte svar
const MetaSchema = z.object({
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
export type CoursesResponse = z.infer<typeof CoursesResponseSchema>;
export type AnnouncementsResponse = z.infer<typeof AnnouncementsResponseSchema>;
export type ModulesResponse = z.infer<typeof ModulesResponseSchema>;
export type AssignmentsResponse = z.infer<typeof AssignmentsResponseSchema>;

// Schema for Canvas Page (Wiki Page)
export const CanvasPageSchema = z.object({
  page_id: z.union([z.number(), z.string()]).optional(), // Noen ganger string i URL, men ID i respons
  url: z.string(),
  title: z.string(),
  created_at: z.string().optional(),
  updated_at: z.string().optional(),
  body: z.string().optional(), // HTML innholdet
});

// Schema for Canvas File
export const CanvasFileSchema = z.object({
  id: z.number(),
  display_name: z.string(),
  filename: z.string(),
  url: z.string(), // Download URL
  size: z.number(),
  created_at: z.string(),
  updated_at: z.string(),
  mime_class: z.string().optional(),
  mime_type: z.string().optional(),
});

// Schema for Canvas Discussion Topic
export const CanvasDiscussionTopicSchema = z.object({
  id: z.number(),
  title: z.string(),
  message: z.string().nullable(), // HTML innhold
  html_url: z.string(),
  posted_at: z.string().nullable(),
  author: z.object({
    id: z.number(),
    display_name: z.string().optional(),
    avatar_image_url: z.string().optional(),
    html_url: z.string().optional(),
  }).optional(),
});

// Schema for Calendar Event (Upcoming Events)
// Brukes for /api/v1/calendar_events og /api/v1/users/self/upcoming_events
export const CanvasCalendarEventSchema = z.object({
  id: z.coerce.number(), // Canvas kan sende ID som string - koer til number
  title: z.string(),
  start_at: z.string().nullable(),
  end_at: z.string().nullable(),
  description: z.string().nullable().optional(),
  location_name: z.string().nullable().optional(),
  location_address: z.string().nullable().optional(),
  context_code: z.string().optional(), // e.g. "course_123" eller "user_456" eller "course_section_*"
  workflow_state: z.string().optional(), // "active", "locked", "deleted"
  all_day: z.boolean().optional(), // Heldagshendelse
  all_day_date: z.string().nullable().optional(), // Dato for heldagshendelse (YYYY-MM-DD)
  html_url: z.string().optional(),
  url: z.string().optional(), // API url
  // Felter for duplikat-filtrering (parent vs child events)
  hidden: z.boolean().optional(), // true = parent-event (skal filtreres bort)
  effective_context_code: z.string().nullable().optional(), // Reell context_code (f.eks. course_123)
  all_context_codes: z.string().nullable().optional(), // Komma-separert liste med context_codes
  context_name: z.string().nullable().optional(), // Kursnavn
  // Felter for repeterende events (rrule/series) - viktig for TimeEdit
  rrule: z.string().nullable().optional(), // iCalendar RRULE for repeterende events
  series_uuid: z.string().nullable().optional(), // UUID for event-serie
  series_natural_language: z.string().nullable().optional(), // Menneskelesbar beskrivelse av serie
  child_events_count: z.number().optional(), // Antall child-events (0 = ingen, >0 = har children)
  parent_event_id: z.coerce.number().nullable().optional(), // ID til parent-event hvis dette er child
  // Assignment-spesifikke felter (kan være med når type=assignment)
  assignment: z.object({
    id: z.number(),
    name: z.string(),
    due_at: z.string().nullable().optional(),
    points_possible: z.number().nullable().optional(),
    html_url: z.string().optional(),
  }).optional(),
}).loose(); // Tillat ukjente felt fra Canvas API

// Schema for Todo Item
// Todo items kan være assignments eller quizzes som må gjøres
export const CanvasTodoItemSchema = z.object({
  type: z.string(), // "grading", "submitting", etc
  assignment: CanvasAssignmentSchema.optional(),
  ignore: z.string().optional(), // url to ignore
  ignore_permanently: z.string().optional(),
  html_url: z.string().optional(),
  context_type: z.string().optional(), // "Course"
  context_name: z.string().optional(), // Kursnavn
  course_id: z.number().optional(),
  quiz: z.object({
    id: z.number(),
    title: z.string(),
    due_at: z.string().nullable(),
    html_url: z.string().optional(),
  }).optional(),
});


// Utvidet modul-item schema for å inkludere content details felter (base-felter kommer fra CanvasModuleItemSchema)
export const CanvasModuleItemDetailSchema = CanvasModuleItemSchema.extend({
  new_tab: z.boolean().optional(),
  completion_requirement: z.object({
    type: z.string(),
    min_score: z.number().optional(),
    completed: z.boolean().optional(),
  }).optional(),
  content_details: z.object({
    points_possible: z.number().optional(),
    due_at: z.string().nullable().optional(),
    unlock_at: z.string().nullable().optional(),
    lock_at: z.string().nullable().optional(),
    locked_for_user: z.boolean().optional(),
    lock_explanation: z.string().optional(),
  }).optional(),
});

// Svar-schema for kommende hendelser
export const UpcomingEventsResponseSchema = z.object({
  events: z.array(CanvasCalendarEventSchema),
  meta: MetaSchema.optional(),
});


// Svar-schema for todo liste
export const TodoResponseSchema = z.object({
  todos: z.array(CanvasTodoItemSchema),
  meta: MetaSchema.optional(),
});


// Svar-schema for filer i et kurs
export const FilesResponseSchema = z.object({
  files: z.array(CanvasFileSchema),
  meta: MetaSchema.optional(),
});

// Svar-schema for sider i et kurs
export const PagesResponseSchema = z.object({
  pages: z.array(CanvasPageSchema),
  meta: MetaSchema.optional(),
});

// Svar-schema for frontpage i et kurs
export const FrontPageResponseSchema = z.object({
  page: CanvasPageSchema,
  meta: MetaSchema.optional(),
});

// Typer eksportering
export type CanvasPage = z.infer<typeof CanvasPageSchema>;
export type CanvasFile = z.infer<typeof CanvasFileSchema>;
export type CanvasDiscussionTopic = z.infer<typeof CanvasDiscussionTopicSchema>;
export type CanvasCalendarEvent = z.infer<typeof CanvasCalendarEventSchema>;
export type CanvasTodoItem = z.infer<typeof CanvasTodoItemSchema>;
export type CanvasModuleItemDetail = z.infer<typeof CanvasModuleItemDetailSchema>;
export type UpcomingEventsResponse = z.infer<typeof UpcomingEventsResponseSchema>;
export type FrontPageResponse = z.infer<typeof FrontPageResponseSchema>;

// Schema for modul-item "open" respons
export const ModuleItemOpenResponseSchema = z.union([
  z.object({ type: z.literal("File"), downloadPath: z.string() }),
  z.object({ type: z.literal("ExternalUrl"), url: z.string() }),
  z.object({
    type: z.literal("Page"),
    page_url: z.string(),
    html_url: z.string().optional(),
  }),
]);

export type ModuleItemOpenResponse = z.infer<typeof ModuleItemOpenResponseSchema>;

// Schema for innholds-metadata per emne
export const CourseContentMetadataSchema = z.object({
  hasFrontPage: z.boolean(),
  hasModules: z.boolean(),
  hasFiles: z.boolean(),
  hasPages: z.boolean().default(false),
  modulesCount: z.number(),
  filesCount: z.number(),
  pagesCount: z.number().default(0),
});

export type CourseContentMetadata = z.infer<typeof CourseContentMetadataSchema>;

// Schema for samlet emner-metadata respons
export const CoursesMetadataResponseSchema = z.object({
  metadata: z.record(z.string(), CourseContentMetadataSchema),
  courseCount: z.number(),
  generatedAt: z.string(),
});

export type CoursesMetadataResponse = z.infer<typeof CoursesMetadataResponseSchema>;
