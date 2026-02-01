import { z } from "zod";

export const DocumentParseResultSchema = z.object({
  success: z.boolean(),
  text: z.string(),
  pages: z.number(),
  fileType: z.string(),
  redacted: z.boolean(),
  truncated: z.boolean(),
  error: z.string().optional(),
});

export type DocumentParseResult = z.infer<typeof DocumentParseResultSchema>;
