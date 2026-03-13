/*
 * Felles Zod-skjemaer og typer for Arbeidsplan (Work Plan)
 */

import { z } from "zod";

/** Ukedager i rekkefølge */
export const UKEDAGER = ["Mandag", "Tirsdag", "Onsdag", "Torsdag", "Fredag", "Lørdag", "Søndag"] as const;

/** Zod-skjema for en enkelt studieblokk */
export const StudyBlockSchema = z.object({
  day: z.enum(UKEDAGER),
  timeSlot: z.string(),
  task: z.string(),
  duration: z.string(),
  priority: z.enum(["high", "medium", "low"]),
  courseName: z.string(),
  assignmentId: z.string().optional(),
  completed: z.boolean().default(false),
  completedAt: z.string().optional(),
});

/** Zod-skjema for å opprette/oppdatere arbeidsplan */
export const CreateArbeidsplanSchema = z.object({
  week: z.string(),
  weekNumber: z.number().int().min(1).max(53),
  year: z.number().int().min(2020).max(2100),
  blocks: z.array(StudyBlockSchema),
  totalHours: z.number(),
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
