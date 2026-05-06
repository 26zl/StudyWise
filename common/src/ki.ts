/**
 * KI – felles Zod-schemas og typer for KI API (chat, dokumentanalyse, oppgavedeling, oppsummering).
 */

import { z } from "zod";
import { UKEDAGER } from "./arbeidsplan.js";

// Meldingslengde-grenser
export const KI_MAX_MESSAGE_LENGTH_BACKEND = 50000; // Absolutt grense i backend
export const KI_MAX_MESSAGE_LENGTH_FRONTEND = 45000; // Frontend-grense (buffer under backend)

const KIClientContentSchema = z
  .string()
  .max(KI_MAX_MESSAGE_LENGTH_BACKEND, `Meldingen kan være maks ${KI_MAX_MESSAGE_LENGTH_BACKEND} tegn`)
  .refine((value) => value.trim().length > 0, "Meldingen kan ikke være tom");

// zod schemas for KI API
export const KIMessageSchema = z.object({
  role: z.enum(["user", "assistant"]),
  content: z.string().min(1, "Meldingsinnhold kan ikke være tomt").max(KI_MAX_MESSAGE_LENGTH_BACKEND),
  timestamp: z.string().optional(),
});

// Klienten kan kun sende user/assistant. System-meldinger styres kun av backend (prompt-injection-sikring).
export const KIChatClientMessageSchema = z.object({
  role: z.enum(["user", "assistant"]),
  content: KIClientContentSchema,
  timestamp: z.string().optional(),
});

/** Forklaringsnivå for KI-svar — styrer dybde og kompleksitet */
export const ExplanationLevelSchema = z.enum(["simple", "standard", "detailed", "expert"]);
export type ExplanationLevel = z.infer<typeof ExplanationLevelSchema>;

// Request-schema for KI chat API
export const KIChatRequestSchema = z.object({
  messages: z.array(KIChatClientMessageSchema).min(1, "Minst én melding må sendes inn").max(200, "Maks 200 meldinger kan sendes inn"),
  model: z.string().trim().min(1).max(100).optional(),
  temperature: z.number().min(0).max(1).optional(),
  explanationLevel: ExplanationLevelSchema.optional(),
  /**
   * Stabil ID for samtalen (ChatHistory._id). Brukes til å skope session-state
   * (courseHint-lås, aktiv kunnskapsbase, kontekst-cache) per chat slik at
   * state ikke lekker mellom samtaler. Valgfri for bakoverkompatibilitet —
   * backend faller tilbake til en hash-basert identifikator når den mangler.
   */
  chatId: z.string().trim().min(1).max(100).optional(),
});

// Felles token-bruk schema (delt mellom chat og dokumentanalyse)
const UsageSchema = z.object({
  prompt_tokens: z.number().int().nonnegative(),
  completion_tokens: z.number().int().nonnegative(),
  total_tokens: z.number().int().nonnegative(),
});

/** Kildereferanse til en fil/kurs som ble brukt i et KI-svar. */
export const KIChatSourceSchema = z.object({
  courseId: z.string(),
  courseName: z.string(),
  /** Canvas-filens numeriske ID (for canvas_file). */
  fileId: z.number().int().optional(),
  fileName: z.string(),
  /** Navigerbar URL (for kb_link og live_url). */
  sourceUrl: z.url().optional(),
  sourceKind: z.enum(["canvas_file", "kb_link", "kb_file", "live_url"]).optional(),
  /**
   * KB-identifikator for kb_file/kb_link — MongoDB ObjectId-string. Lar frontend
   * navigere til riktig base/fil på KB-siden siden originalfilen ikke lagres.
   */
  sourceId: z.string().optional(),
  /** Tilhørende kunnskapsbase-ID (for kb_file/kb_link). */
  baseId: z.string().optional(),
  /** Hvor stor del av relevansen denne kilden bidro med (0-1). Brukes til sortering. */
  score: z.number().min(0).max(1).optional(),
  /** Antall chunks fra denne filen som ble brukt i konteksten. */
  chunkCount: z.number().int().nonnegative().optional(),
});
export type KIChatSource = z.infer<typeof KIChatSourceSchema>;

/**
 * Kategorisering av hvor svaret kommer fra. Brukes til å vise et tydelig
 * "kilde-merke" over assistent-svaret, slik at studenten ikke forveksler
 * et generelt KI-svar med et svar forankret i eget kursmateriale.
 *
 * - `kursmateriale`: forankret i PDF-/dokumentinnhold fra Canvas-pensum
 * - `canvas`:        forankret i Canvas-metadata (frister, moduler, kunngjøringer)
 * - `kunnskapsbase`: forankret i brukerens egen kunnskapsbase
 * - `generell`:      ren KI-kunnskap — ingen forankring i pensum eller KB (fallback)
 * - `blandet`:       kombinasjon av forankret materiale og generell KI-kunnskap
 */
export const SVAR_KILDER = [
  "kursmateriale",
  "canvas",
  "kunnskapsbase",
  "generell",
  "blandet",
] as const;
export const SvarKildeSchema = z.enum(SVAR_KILDER);
export type SvarKilde = z.infer<typeof SvarKildeSchema>;

// Svar-schema for KI chat API
export const KIChatResponseSchema = z.object({
  suksess: z.boolean(),
  melding: z.string().optional(),
  response: z.string(),
  model: z.string().optional(),
  usage: UsageSchema.optional(),
  /** Kilder (Canvas-filer) som ble brukt i svaret — vises som klikkbar liste under svaret. */
  kilder: z.array(KIChatSourceSchema).optional(),
  /**
   * Hvor svaret kommer fra. Settes hvis modellen emitterer en `<svarkilde>`-tag
   * (se systemPrompt.ts). Brukes til UI-badge — "generell" må vises tydelig
   * for å hindre at studenten forveksler et fritt KI-svar med pensum.
   */
  svarKilde: SvarKildeSchema.optional(),
});

/** Tommel opp/ned-feedback på et KI-svar. */
export const ChatFeedbackRequestSchema = z.object({
  messageId: z.string().trim().min(1).max(100),
  chatId: z.string().trim().min(1).max(100).optional(),
  rating: z.enum(["up", "down"]),
  question: z.string().trim().max(2000).optional(),
  answer: z.string().trim().max(5000).optional(),
});
export type ChatFeedbackRequest = z.infer<typeof ChatFeedbackRequestSchema>;

export const ChatFeedbackResponseSchema = z.object({
  suksess: z.boolean(),
});

/** Aggregert oversikt over hva KI har indeksert for et kurs (filer + chunks). */
export const CourseKnowledgeFileSchema = z.object({
  fileId: z.number().int(),
  fileName: z.string(),
  chunkCount: z.number().int().nonnegative(),
  charCount: z.number().int().nonnegative().optional(),
  lastUpdated: z.string().optional(),
});

export const CourseKnowledgeResponseSchema = z.object({
  courseId: z.string(),
  courseName: z.string(),
  fileCount: z.number().int().nonnegative(),
  totalChunks: z.number().int().nonnegative(),
  files: z.array(CourseKnowledgeFileSchema),
});
export type CourseKnowledgeResponse = z.infer<typeof CourseKnowledgeResponseSchema>;
export type CourseKnowledgeFile = z.infer<typeof CourseKnowledgeFileSchema>;

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
).optional();

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
  moduleNames: z.array(z.string().trim().min(1).max(200)).max(50).optional(),
  fileNames: z.array(z.string().trim().min(1).max(200)).max(50).optional(),
  questionCount: z.number().int().min(1).max(50).default(10),
}).refine(
  (d) => (d.moduleNames && d.moduleNames.length > 0) || (d.fileNames && d.fileNames.length > 0),
  { message: "Minst én modul eller fil må velges" },
);

export const QuizQuestionSchema = z.object({
  id: z.uuid(),
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
  moduleNames: z.array(z.string().trim().min(1).max(200)).max(50).optional(),
  fileNames: z.array(z.string().trim().min(1).max(200)).max(50).optional(),
  cardCount: z.number().int().min(1).max(50).default(10),
}).refine(
  (d) => (d.moduleNames && d.moduleNames.length > 0) || (d.fileNames && d.fileNames.length > 0),
  { message: "Minst én modul eller fil må velges" },
);

export const FlashcardSchema = z.object({
  id: z.uuid(),
  front: z.string().min(1),
  back: z.string().min(1),
});

export const FlashcardsGenerateResponseSchema = z.object({
  flashcards: z.array(FlashcardSchema).min(1).max(50),
});

// --- Async jobb-mønster for quiz/flashcards (unngår Heroku 30s timeout) ---

/** Respons fra POST /generate — returnerer jobId umiddelbart */
export const AsyncJobAcceptedSchema = z.object({
  jobId: z.uuid(),
});

/** Status for en bakgrunnsjobb */
export const AsyncJobStatusSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("pending") }),
  z.object({
    status: z.literal("completed"),
    result: z.unknown(),
  }),
  z.object({
    status: z.literal("failed"),
    error: z.string(),
  }),
]);

export type AsyncJobAccepted = z.infer<typeof AsyncJobAcceptedSchema>;
export type AsyncJobStatus = z.infer<typeof AsyncJobStatusSchema>;

// Skjema for deloppgave i oppgaveoppdelings-API-et.
// SubTaskSchema og TaskBreakdownResponseSchema brukes av både backend og frontend-hooker
// for å holde generering, lagring og visning i sync.
export const SubTaskSchema = z.object({
  id: z.string().min(1),
  title: z.string().trim().min(1, "Tittel kan ikke være tom").max(200, "Tittel må være maks 200 tegn"),
  description: z.string().max(1000, "Beskrivelse må være maks 1000 tegn").default(""),
  estimatedTime: z.string().trim().min(1, "Tidsestimat kan ikke være tomt").max(50, "Tidsestimat for langt"),
  priority: z.enum(["low", "medium", "high"]),
  completed: z.boolean(),
  completedAt: z.coerce.date().optional().nullable(),
  approved: z.boolean().default(false),
});

/** AI-generert subtask (uten id, completed, approved - disse legges til ved lagring). */
export const GeneratedSubTaskSchema = z.object({
  title: z.string().trim().min(1).max(200),
  description: z.string().max(1000).default(""),
  estimatedTime: z.string().trim().min(1).max(50),
  priority: z.enum(["low", "medium", "high"]),
});
export type GeneratedSubTask = z.infer<typeof GeneratedSubTaskSchema>;

// Responsskjema for KI-oppgaveoppdeling
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
  courseName: z.string().trim().max(200, "Emnenavn må være maks 200 tegn").optional(),
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
  timeSlot: z.string().trim().min(1).max(50),
  task: z.string().trim().min(1).max(300),
  duration: z.string().trim().min(1).max(50),
  priority: z.enum(["high", "medium", "low"]),
  courseName: z.string().trim().min(1).max(200),
  assignmentId: z.string().trim().min(1).max(200).optional(),
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
  type: z.enum(["tldr", "handlinger", "begge"]).default("begge"),
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

// Typeeksporter
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
