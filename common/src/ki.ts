/*
* Felles zod schemaer for KI API
*/


import { z } from "zod";

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

// Type exports
export type KIMessage = z.infer<typeof KIMessageSchema>;
export type KIChatRequest = z.infer<typeof KIChatRequestSchema>;
export type KIChatResponse = z.infer<typeof KIChatResponseSchema>;
