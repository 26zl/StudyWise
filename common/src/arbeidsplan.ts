/**
 * Arbeidsplan – felles Zod-skjemaer og typer for ukeplan/studieblokker.
 */

import { z } from "zod";

/** Ukedager i rekkefølge */
export const UKEDAGER = ["Mandag", "Tirsdag", "Onsdag", "Torsdag", "Fredag", "Lørdag", "Søndag"] as const;

const IkkeTomTekstSchema = z.string().trim().min(1, "Feltet kan ikke være tomt");
const IsoDateStringSchema = z
  .string()
  .trim()
  .refine((value) => !Number.isNaN(Date.parse(value)), "Ugyldig dato");

/** Zod-skjema for en enkelt studieblokk */
export const StudyBlockSchema = z.object({
  day: z.enum(UKEDAGER),
  timeSlot: IkkeTomTekstSchema.max(50, "Tidsluke må være maks 50 tegn"),
  task: IkkeTomTekstSchema.max(300, "Oppgave må være maks 300 tegn"),
  duration: IkkeTomTekstSchema.max(50, "Varighet må være maks 50 tegn"),
  priority: z.enum(["high", "medium", "low"]),
  courseName: IkkeTomTekstSchema.max(200, "Emnenavn må være maks 200 tegn"),
  assignmentId: IkkeTomTekstSchema.max(200, "Oppgave-ID må være maks 200 tegn").optional(),
  completed: z.boolean().default(false),
  completedAt: IsoDateStringSchema.optional(),
});

/** Zod-skjema for å opprette/oppdatere arbeidsplan */
export const CreateArbeidsplanSchema = z.object({
  week: IkkeTomTekstSchema.max(40, "Uke må være maks 40 tegn"),
  weekNumber: z.number().int().min(1).max(53),
  year: z.number().int().min(2020).max(2100),
  blocks: z.array(StudyBlockSchema).max(200, "Maks 200 studieblokker per uke"),
  totalHours: z.number().min(0).max(300),
});

/** Zod-skjema for å oppdatere en enkelt blokk */
export const UpdateBlockSchema = z.object({
  blockIndex: z.number().int().min(0),
  completed: z.boolean(),
});

export const ArbeidsplanSchema = z.object({
  _id: z.string(),
  userId: z.string(),
  week: z.string(),
  weekNumber: z.number().int().min(1).max(53),
  year: z.number().int().min(2020).max(2100),
  blocks: z.array(StudyBlockSchema),
  totalHours: z.number().min(0).max(300),
  createdAt: IsoDateStringSchema,
  updatedAt: IsoDateStringSchema,
});

export const ArbeidsplanResponseSchema = z.object({
  suksess: z.literal(true),
  data: ArbeidsplanSchema.nullable(),
  melding: z.string().optional(),
});

export const ArbeidsplanProgressSchema = z.object({
  totalBlocks: z.number().int().min(0),
  completedBlocks: z.number().int().min(0),
  percentage: z.number().min(0).max(100),
  totalHours: z.number().min(0),
  completedHours: z.number().min(0),
});

export const ArbeidsplanProgressResponseSchema = z.object({
  suksess: z.literal(true),
  data: ArbeidsplanProgressSchema,
});

export const ArbeidsplanDeleteResponseSchema = z.object({
  suksess: z.literal(true),
  melding: z.string(),
});

// Type exports
export type StudyBlock = z.infer<typeof StudyBlockSchema>;
export type CreateArbeidsplan = z.infer<typeof CreateArbeidsplanSchema>;
export type UpdateBlock = z.infer<typeof UpdateBlockSchema>;
export type Arbeidsplan = z.infer<typeof ArbeidsplanSchema>;
export type ArbeidsplanResponse = z.infer<typeof ArbeidsplanResponseSchema>;
export type ArbeidsplanProgress = z.infer<typeof ArbeidsplanProgressSchema>;
export type ArbeidsplanProgressResponse = z.infer<typeof ArbeidsplanProgressResponseSchema>;
export type ArbeidsplanDeleteResponse = z.infer<typeof ArbeidsplanDeleteResponseSchema>;
