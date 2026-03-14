/**
 * document – Zod-schema og typer for dokumentparsing (PDF, Word, OCR).
 */

import { z } from "zod";
// Schema for resultat av dokument parsing (f.eks. PDF, Word)
export const DocumentParseResultSchema = z.object({
  success: z.boolean(),
  text: z.string(),
  pages: z.number(),
  fileType: z.string(),
  redacted: z.boolean(),
  truncated: z.boolean(),
  error: z.string().optional(),
  warning: z.string().optional(), // Advarsel om lav OCR-konfidens etc.
});

export type DocumentParseResult = z.infer<typeof DocumentParseResultSchema>;
