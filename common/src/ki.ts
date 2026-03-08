/*
 * Felles zod schemaer for KI API
 */

import { z } from "zod";

// Meldingslengde-grenser
export const KI_MAX_MESSAGE_LENGTH_BACKEND = 50000; // Backend hard limit
export const KI_MAX_MESSAGE_LENGTH_FRONTEND = 45000; // Frontend limit (buffer under backend)

// zod schemas for KI API
export const KIMessageSchema = z.object({
  role: z.enum(["user", "assistant", "system"]),
  content: z.string(),
  timestamp: z.string().optional(),
});

// Request-schema for KI chat API
export const KIChatRequestSchema = z.object({
  messages: z.array(KIMessageSchema),
  model: z.string().optional(),
  temperature: z.number().min(0).max(2).optional(),
});

// Svar-schema for KI chat API
export const KIChatResponseSchema = z.object({
  suksess: z.boolean(),
  melding: z.string().optional(),
  response: z.string(),
  model: z.string().optional(),
  usage: z
    .object({
      prompt_tokens: z.number(),
      completion_tokens: z.number(),
      total_tokens: z.number(),
    })
    .optional(),
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

// Request-body for dokumentanalyse (question/sporsmaal, model) – multer sender ofte string eller string[]
const documentAnalyseBodySchema = z.object({
  question: z
    .union([z.string(), z.array(z.string())])
    .optional()
    .transform((v) => (Array.isArray(v) ? v[0] : v)),
  sporsmaal: z
    .union([z.string(), z.array(z.string())])
    .optional()
    .transform((v) => (Array.isArray(v) ? v[0] : v)),
  model: z
    .union([z.string(), z.array(z.string())])
    .optional()
    .transform((v) => (Array.isArray(v) ? v[0] : v)),
});
export const KIDocumentAnalyseRequestSchema = documentAnalyseBodySchema;

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
  usage: z
    .object({
      prompt_tokens: z.number(),
      completion_tokens: z.number(),
      total_tokens: z.number(),
    })
    .optional(),
});

// Subtask schema for task breakdown API.
// SubTaskSchema og TaskBreakdownResponseSchema brukes av backend for validering (taskBreakdown.ts)
// og skal brukes av en dedikert frontend-hook for å validere API-svar når AI-integrasjonen er ferdig.
// I frontend-komponenter importeres kun typen (SubTask), ikke skjemaet.
export const SubTaskSchema = z.object({
  id: z.string(),
  title: z.string().max(200),
  description: z.string().max(1000),
  estimatedTime: z.string(),
  priority: z.enum(["low", "medium", "high"]),
  completed: z.boolean(),
});

// Task breakdown response schema for KI task breakdown API
export const TaskBreakdownResponseSchema = z.object({
  subtasks: z.array(SubTaskSchema),
});

// KI Oppsummering (kunngjøringer)
export const KIOppsummeringRequestSchema = z.object({
  tekst: z.string().min(1).max(50000),
  type: z.enum(["tldr", "handlinger", "begge"]).optional().default("begge"),
});

// Saniteringsregler for HTML-innhold i Canvas-data
export const KIOppsummeringResponseSchema = z.object({
  suksess: z.boolean(),
  oppsummering: z.string().optional(),
  handlinger: z.array(z.string()).optional(),
  melding: z.string().optional(),
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
export type KIDocumentAnalyseResponse = z.infer<
  typeof KIDocumentAnalyseResponseSchema
>;
export type SubTask = z.infer<typeof SubTaskSchema>;
export type TaskBreakdownResponse = z.infer<typeof TaskBreakdownResponseSchema>;
