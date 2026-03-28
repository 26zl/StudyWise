/**
 * KI – felles Zod-schemas og typer for KI API (chat, dokumentanalyse, oppgavedeling, oppsummering).
 */

import { z } from "zod";
import { UKEDAGER } from "./arbeidsplan.js";

// Meldingslengde-grenser
export const KI_MAX_MESSAGE_LENGTH_BACKEND = 50000; // Backend hard limit
export const KI_MAX_MESSAGE_LENGTH_FRONTEND = 45000; // Frontend limit (buffer under backend)

const KIClientContentSchema = z
  .string()
  .max(KI_MAX_MESSAGE_LENGTH_BACKEND, `Meldingen kan være maks ${KI_MAX_MESSAGE_LENGTH_BACKEND} tegn`)
  .refine((value) => value.trim().length > 0, "Meldingen kan ikke være tom");

// zod schemas for KI API
export const KIMessageSchema = z.object({
  role: z.enum(["user", "assistant", "system"]),
  content: z.string(),
  timestamp: z.string().optional(),
});

// Klienten kan kun sende user/assistant. System-meldinger styres kun av backend (prompt-injection-sikring).
export const KIChatClientMessageSchema = z.object({
  role: z.enum(["user", "assistant"]),
  content: KIClientContentSchema,
  timestamp: z.string().optional(),
});

// Request-schema for KI chat API
export const KIChatRequestSchema = z.object({
  messages: z.array(KIChatClientMessageSchema).min(1, "Minst én melding må sendes inn").max(200, "Maks 200 meldinger kan sendes inn"),
  model: z.string().trim().min(1).max(100).optional(),
  temperature: z.number().min(0).max(1).optional(),
});

// Felles token-bruk schema (delt mellom chat og dokumentanalyse)
const UsageSchema = z.object({
  prompt_tokens: z.number().int().nonnegative(),
  completion_tokens: z.number().int().nonnegative(),
  total_tokens: z.number().int().nonnegative(),
});

// Svar-schema for KI chat API
export const KIChatResponseSchema = z.object({
  suksess: z.boolean(),
  melding: z.string().optional(),
  response: z.string(),
  model: z.string().optional(),
  usage: UsageSchema.optional(),
});

// Modell-liste (for KI modellvalg i frontend)
export const KIModelsResponseSchema = z.object({
  models: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      description: z.string(),
      isDefault: z.boolean(),
    }),
  ),
  defaultModel: z.string(),
});

/** Multer sender ofte formdata-felter som string eller string[] — normaliser til første string */
const multerStringField = z
  .union([z.string(), z.array(z.string())])
  .optional()
  .transform((value) => {
    const firstValue = Array.isArray(value) ? value[0] : value;
    if (typeof firstValue !== "string") {
      return undefined;
    }
    const trimmed = firstValue.trim();
    return trimmed === "" ? undefined : trimmed;
  });

const optionalNullableDateSchema = z.preprocess(
  (value) => (value == null || value === "" ? undefined : value),
  z.coerce.date().optional(),
);

// Request-body for dokumentanalyse (question/sporsmaal, model) – multer sender ofte string eller string[]
export const KIDocumentAnalyseRequestSchema = z.object({
  question: multerStringField,
  sporsmaal: multerStringField,
  model: multerStringField,
});

// Dokumentanalyse respons (støtter PDF, Word, TXT, etc.)
export const KIDocumentAnalyseResponseSchema = z.object({
  suksess: z.boolean(),
  melding: z.string().optional(),
  response: z.string(),
  model: z.string().optional(),
  dokumentInfo: z
    .object({
      sider: z.number(),
      tegn: z.number(),
      fileType: z.string().optional(),
      redacted: z.boolean(),
      truncated: z.boolean(),
    })
    .optional(),
  usage: UsageSchema.optional(),
});

export const QuizGenerateRequestSchema = z.object({
  courseId: z.number().int().positive(),
  courseName: z.string().trim().min(1).max(200),
  moduleNames: z.array(z.string().trim().min(1).max(200)).min(1).max(50),
  questionCount: z.number().int().min(1).max(50).default(10),
});

export const QuizQuestionSchema = z.object({
  id: z.string().uuid(),
  question: z.string().min(1),
  options: z.array(z.string().min(1)).length(4),
  correctIndex: z.number().int().min(0).max(3),
  explanation: z.string().min(1),
});

export const QuizGenerateResponseSchema = z.object({
  questions: z.array(QuizQuestionSchema).min(1).max(50),
});

export const FlashcardsGenerateRequestSchema = z.object({
  courseId: z.number().int().positive(),
  courseName: z.string().trim().min(1).max(200),
  moduleNames: z.array(z.string().trim().min(1).max(200)).min(1).max(50),
  cardCount: z.number().int().min(1).max(50).default(10),
});

export const FlashcardSchema = z.object({
  id: z.string().uuid(),
  front: z.string().min(1),
  back: z.string().min(1),
});

export const FlashcardsGenerateResponseSchema = z.object({
  flashcards: z.array(FlashcardSchema).min(1).max(50),
});

// Subtask schema for task breakdown API.
// SubTaskSchema og TaskBreakdownResponseSchema brukes av både backend og frontend-hooker
// for å holde generering, lagring og visning i sync.
export const SubTaskSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1, "Tittel kan ikke være tom").max(200, "Tittel må være maks 200 tegn"),
  description: z.string().max(1000, "Beskrivelse må være maks 1000 tegn").default(""),
  estimatedTime: z.string().min(1, "Tidsestimat kan ikke være tomt"),
  priority: z.enum(["low", "medium", "high"]),
  completed: z.boolean(),
  approved: z.boolean().optional().default(true),
});

// Task breakdown response schema for KI task breakdown API
export const TaskBreakdownResponseSchema = z.object({
  subtasks: z.array(SubTaskSchema),
});

export const TaskBreakdownGenerateRequestSchema = z.object({
  assignmentTitle: z
    .string()
    .trim()
    .min(1, "Oppgavetittel kan ikke være tom")
    .max(200, "Oppgavetittel må være maks 200 tegn"),
  assignmentDescription: z
    .string()
    .trim()
    .max(5000, "Oppgavebeskrivelse må være maks 5000 tegn")
    .optional()
    .default(""),
  dueDate: optionalNullableDateSchema,
});

export const WeeklyPlanAssignmentSchema = z.object({
  id: z.string().min(1, "Oppgave-ID mangler"),
  name: z
    .string()
    .min(1, "Oppgavenavn kan ikke være tomt")
    .max(200, "Oppgavenavn må være maks 200 tegn"),
  dueAt: optionalNullableDateSchema,
  courseName: z.string().max(200, "Emnenavn må være maks 200 tegn").optional(),
  description: z
    .string()
    .max(5000, "Oppgavebeskrivelse må være maks 5000 tegn")
    .optional(),
  pointsPossible: z.number().min(0).max(1000).optional(),
});

export const WeeklyPlanGenerateRequestSchema = z.object({
  assignments: z
    .array(WeeklyPlanAssignmentSchema)
    .min(1, "Minst én oppgave må sendes inn")
    .max(20, "Maks 20 oppgaver kan brukes til ukeplan"),
});

export const WeeklyPlanSuggestionBlockSchema = z.object({
  day: z.enum(UKEDAGER),
  timeSlot: z.string().min(1).max(50),
  task: z.string().min(1).max(200),
  duration: z.string().min(1).max(50),
  priority: z.enum(["high", "medium", "low"]),
  courseName: z.string().min(1).max(200),
  assignmentId: z.string().min(1).max(200).optional(),
  completed: z.boolean(),
});

export const WeeklyPlanSuggestionDraftSchema = z.object({
  blocks: z
    .array(WeeklyPlanSuggestionBlockSchema)
    .min(1, "Responsen må inneholde minst én studieblokk"),
  tips: z.array(z.string().min(1)).min(1).max(5).optional(),
});

export const WeeklyPlanSuggestionResponseSchema = WeeklyPlanSuggestionDraftSchema.extend({
  week: z.string(),
  weekNumber: z.number().int().min(1).max(53),
  year: z.number().int().min(2020).max(2100),
  totalHours: z.number().min(0),
  tips: z.array(z.string().min(1)).min(1).max(5),
});

// KI Oppsummering (kunngjøringer)
export const KIOppsummeringRequestSchema = z.object({
  tekst: z
    .string()
    .trim()
    .min(1, "Tekst kan ikke være tom")
    .max(50000, "Tekst kan være maks 50 000 tegn"),
  type: z.enum(["tldr", "handlinger", "begge"]).optional().default("begge"),
});

// Respons-schema for KI oppsummering
export const KIOppsummeringResponseSchema = z
  .object({
    suksess: z.boolean(),
    oppsummering: z.string().optional(),
    handlinger: z.array(z.string()).optional(),
    melding: z.string().optional(),
  })
  .superRefine((data, ctx) => {
    if (!data.suksess && (data.melding == null || data.melding.trim() === "")) {
      ctx.addIssue({
        code: "custom",
        message: "Feilrespons (suksess: false) må inneholde en melding",
      });
    }

    if (
      data.suksess &&
      (data.oppsummering == null || data.oppsummering.trim() === "") &&
      (data.handlinger == null || data.handlinger.length === 0)
    ) {
      ctx.addIssue({
        code: "custom",
        message: "Suksessrespons må inneholde oppsummering eller handlinger",
      });
    }
  });

// Type exports
export type KIOppsummeringRequest = z.infer<typeof KIOppsummeringRequestSchema>;
export type KIOppsummeringResponse = z.infer<
  typeof KIOppsummeringResponseSchema
>;
export type KIMessage = z.infer<typeof KIMessageSchema>;
export type KIChatRequest = z.infer<typeof KIChatRequestSchema>;
export type KIChatResponse = z.infer<typeof KIChatResponseSchema>;
export type KIModelsResponse = z.infer<typeof KIModelsResponseSchema>;
export type KIDocumentAnalyseRequest = z.infer<typeof KIDocumentAnalyseRequestSchema>;
export type KIDocumentAnalyseResponse = z.infer<
  typeof KIDocumentAnalyseResponseSchema
>;
export type QuizGenerateRequest = z.infer<typeof QuizGenerateRequestSchema>;
export type QuizQuestion = z.infer<typeof QuizQuestionSchema>;
export type QuizGenerateResponse = z.infer<typeof QuizGenerateResponseSchema>;
export type FlashcardsGenerateRequest = z.infer<typeof FlashcardsGenerateRequestSchema>;
export type Flashcard = z.infer<typeof FlashcardSchema>;
export type FlashcardsGenerateResponse = z.infer<typeof FlashcardsGenerateResponseSchema>;
export type SubTask = z.infer<typeof SubTaskSchema>;
export type TaskBreakdownResponse = z.infer<typeof TaskBreakdownResponseSchema>;
export type TaskBreakdownGenerateRequest = z.infer<
  typeof TaskBreakdownGenerateRequestSchema
>;
export type WeeklyPlanAssignment = z.infer<typeof WeeklyPlanAssignmentSchema>;
export type WeeklyPlanGenerateRequest = z.infer<
  typeof WeeklyPlanGenerateRequestSchema
>;
export type WeeklyPlanSuggestionBlock = z.infer<
  typeof WeeklyPlanSuggestionBlockSchema
>;
export type WeeklyPlanSuggestionDraft = z.infer<
  typeof WeeklyPlanSuggestionDraftSchema
>;
export type WeeklyPlanSuggestionResponse = z.infer<
  typeof WeeklyPlanSuggestionResponseSchema
>;
