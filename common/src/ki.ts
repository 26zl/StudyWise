/*
* Felles zod schemaer for KI API
* Ment for visning nå på hvordan det gjøres, må endres etter hvert som vi implementerer KI
*/


import { z } from "zod";

// zod schemas for KI API

export const KIMessageSchema = z.object({
  role: z.enum(["user", "assistant", "system"]),
  content: z.string(),
  timestamp: z.string().optional(),
});

export const KIChatRequestSchema = z.object({
  messages: z.array(KIMessageSchema),
  model: z.string().optional(),
  temperature: z.number().min(0).max(2).optional(),
});

export const KIChatResponseSchema = z.object({
  suksess: z.boolean(),
  melding: z.string().optional(),
  response: z.string(),
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
