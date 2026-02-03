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
    })
  ),
  defaultModel: z.string(),
});

// PDF-analyse respons (legacy - bruk KIDocumentAnalyseResponseSchema)
export const KIPdfAnalyseResponseSchema = z.object({
  suksess: z.boolean(),
  melding: z.string().optional(),
  response: z.string(),
  model: z.string().optional(),
  dokumentInfo: z
    .object({
      sider: z.number(),
      tegn: z.number(),
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

// Type exports
export type KIMessage = z.infer<typeof KIMessageSchema>;
export type KIChatRequest = z.infer<typeof KIChatRequestSchema>;
export type KIChatResponse = z.infer<typeof KIChatResponseSchema>;
export type KIModelsResponse = z.infer<typeof KIModelsResponseSchema>;
export type KIPdfAnalyseResponse = z.infer<typeof KIPdfAnalyseResponseSchema>;
export type KIDocumentAnalyseResponse = z.infer<typeof KIDocumentAnalyseResponseSchema>;
