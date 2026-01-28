/*
 * Auth.ts
 *
 * zod schemas for auth API
 */

import { z } from "zod";

export const CanvasTokenRequestSchema = z.object({
  token: z.string().min(1, "Token kan ikke vaere tom"),
});

export const CanvasTokenResponseSchema = z.object({
  melding: z.string().optional(),
  success: z.boolean().optional(),
  feil: z.string().optional(),
});

export type CanvasTokenRequest = z.infer<typeof CanvasTokenRequestSchema>;
export type CanvasTokenResponse = z.infer<typeof CanvasTokenResponseSchema>;
