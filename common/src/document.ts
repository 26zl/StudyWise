/**
 * document – Zod-schema og typer for dokumentparsing (PDF, Word, OCR).
 */

import { z } from "zod";
// Schema for resultat av dokument parsing (f.eks. PDF, Word)
export const DocumentParseResultSchema = z.object({
  success: z.boolean(),
  text: z.string(),
  pages: z.number().int().min(0),
  fileType: z.string().trim().min(1),
  redacted: z.boolean(),
  truncated: z.boolean(),
  error: z.string().optional(),
  warning: z.string().optional(), // Advarsel om lav OCR-konfidens etc.
}).superRefine((data, ctx) => {
  if (!data.success && (data.error == null || data.error.trim() === "")) {
    ctx.addIssue({
      code: "custom",
      path: ["error"],
      message: "Feilresultat må inneholde en feilmelding",
    });
  }

  if (data.success && data.error !== undefined) {
    ctx.addIssue({
      code: "custom",
      path: ["error"],
      message: "Vellykket parsing kan ikke inneholde error-felt",
    });
  }
});

export type DocumentParseResult = z.infer<typeof DocumentParseResultSchema>;
