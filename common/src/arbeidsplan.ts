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

// Type exports
export type StudyBlock = z.infer<typeof StudyBlockSchema>;
export type CreateArbeidsplan = z.infer<typeof CreateArbeidsplanSchema>;
export type UpdateBlock = z.infer<typeof UpdateBlockSchema>;
