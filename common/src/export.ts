/*
 * Skjemaer og typer for eksportfunksjonalitet.
 * Definerer eksportmål, request/response-format og internt dokumentformat.
 */

import { z } from "zod";

// Støttede eksportmål
export const EXPORT_TARGETS = ["markdown", "pdf", "text", "word", "excel", "notion"] as const;

export const ExportTargetSchema = z.enum(EXPORT_TARGETS);
export type ExportTarget = z.infer<typeof ExportTargetSchema>;

// Internt dokumentformat (mellomformat)

export const InlineStyleSchema = z.enum(["bold", "italic", "code", "link"]);
export type InlineStyle = z.infer<typeof InlineStyleSchema>;

const ExportHrefSchema = z
  .string()
  .trim()
  .max(2000, "Lenke er for lang")
  .pipe(z.url("Ugyldig lenke"))
  .refine((value) => /^https?:\/\//i.test(value), "Lenke må bruke http eller https");

/** Tekstsegment med valgfri inline-formatering */
export const TextSegmentSchema = z
  .object({
    text: z.string(),
    styles: z.array(InlineStyleSchema).optional(),
    href: ExportHrefSchema.optional(),
  })
  .superRefine((segment, ctx) => {
    const hasLinkStyle = segment.styles?.includes("link") ?? false;
    const hasHref = segment.href !== undefined;

    if (hasLinkStyle && !hasHref) {
      ctx.addIssue({
        code: "custom",
        path: ["href"],
        message: "Lenkesegmenter må ha href",
      });
    }

    if (hasHref && !hasLinkStyle) {
      ctx.addIssue({
        code: "custom",
        path: ["styles"],
        message: "href krever at segmentet er markert som lenke",
      });
    }
  });
export type TextSegment = z.infer<typeof TextSegmentSchema>;

/** Listelement — kan inneholde rik tekst */
export const ListItemSchema = z.object({
  segments: z.array(TextSegmentSchema),
  checked: z.boolean().optional(),
});
export type ListItem = z.infer<typeof ListItemSchema>;

/** Tabellcelle */
export const TableCellSchema = z.object({
  segments: z.array(TextSegmentSchema),
});
export type TableCell = z.infer<typeof TableCellSchema>;

export const ExportBlockTypeSchema = z.enum([
  "heading",
  "paragraph",
  "bullet_list",
  "numbered_list",
  "checklist",
  "quote",
  "code_block",
  "divider",
  "callout",
  "table",
]);
export type ExportBlockType = z.infer<typeof ExportBlockTypeSchema>;

/** Enkeltblokk i eksportdokumentet */
export const ExportBlockSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("heading"),
    level: z.union([z.literal(1), z.literal(2), z.literal(3)]),
    segments: z.array(TextSegmentSchema),
  }),
  z.object({
    type: z.literal("paragraph"),
    segments: z.array(TextSegmentSchema),
  }),
  z.object({
    type: z.literal("bullet_list"),
    items: z.array(ListItemSchema),
  }),
  z.object({
    type: z.literal("numbered_list"),
    items: z.array(ListItemSchema),
  }),
  z.object({
    type: z.literal("checklist"),
    items: z.array(ListItemSchema),
  }),
  z.object({
    type: z.literal("quote"),
    segments: z.array(TextSegmentSchema),
  }),
  z.object({
    type: z.literal("code_block"),
    language: z.string().optional(),
    code: z.string(),
  }),
  z.object({
    type: z.literal("divider"),
  }),
  z.object({
    type: z.literal("callout"),
    emoji: z.string().optional(),
    segments: z.array(TextSegmentSchema),
  }),
  z.object({
    type: z.literal("table"),
    headers: z.array(TableCellSchema).optional(),
    rows: z.array(z.array(TableCellSchema)),
  }),
]);
export type ExportBlock = z.infer<typeof ExportBlockSchema>;

const EXPORT_TITLE_MAX_LENGTH = 200;

// Maks 16 KB for å unngå at en klient kan blåse opp eksport-payload via metadata.
const EXPORT_METADATA_MAX_BYTES = 16_000;

const BoundedMetadataSchema = z
  .record(z.string(), z.unknown())
  .refine(
    (m) => JSON.stringify(m ?? {}).length <= EXPORT_METADATA_MAX_BYTES,
    `Metadata kan ikke overstige ${EXPORT_METADATA_MAX_BYTES} bytes`,
  );

/** Komplett eksportdokument */
export const ExportDocumentSchema = z.object({
  title: z.string().max(EXPORT_TITLE_MAX_LENGTH),
  metadata: BoundedMetadataSchema.optional(),
  blocks: z.array(ExportBlockSchema),
});
export type ExportDocument = z.infer<typeof ExportDocumentSchema>;

// --- API Request / Response ---

const EXPORT_CONTENT_MAX_LENGTH = 500_000;

/** Notion-spesifikke alternativer */
export const NotionExportOptionsSchema = z.object({
  parentPageId: z.string().min(1, "Notion parent page ID er påkrevd"),
});
export type NotionExportOptions = z.infer<typeof NotionExportOptionsSchema>;

/** Provider-alternativer (kun Notion nå) */
export const ExportProviderOptionsSchema = z.object({
  notion: NotionExportOptionsSchema.optional(),
});
export type ExportProviderOptions = z.infer<typeof ExportProviderOptionsSchema>;

/** Eksport-request */
export const ExportRequestSchema = z.object({
  target: ExportTargetSchema,
  title: z.string().trim().min(1, "Tittel er påkrevd").max(EXPORT_TITLE_MAX_LENGTH),
  content: z.string().trim().min(1, "Innhold er påkrevd").max(EXPORT_CONTENT_MAX_LENGTH),
  metadata: BoundedMetadataSchema.optional(),
  options: ExportProviderOptionsSchema.optional(),
});
export type ExportRequest = z.infer<typeof ExportRequestSchema>;

// Serialiserbare mål (fil-eksport)
const SERIALIZED_TARGETS = ["markdown", "pdf", "text", "word", "excel"] as const;
const SerializedTargetSchema = z.enum(SERIALIZED_TARGETS);

// Eksterne mål (tredjepart-integrasjon)
const EXTERNAL_TARGETS = ["notion"] as const;
const ExternalTargetSchema = z.enum(EXTERNAL_TARGETS);

/** Respons for serialiserbare mål (markdown/pdf/text/word/excel) */
export const SerializedExportResponseSchema = z.object({
  target: SerializedTargetSchema,
  content: z.string(),
  mimeType: z.string(),
  filename: z.string().optional(),
  /** Base64-kodet binærdata for PDF/Word */
  base64: z.string().optional(),
});
export type SerializedExportResponse = z.infer<typeof SerializedExportResponseSchema>;

/** Respons for eksterne mål (notion) */
export const ExternalExportResponseSchema = z.object({
  target: ExternalTargetSchema,
  resourceId: z.string(),
  url: z.string().optional(),
  title: z.string(),
});
export type ExternalExportResponse = z.infer<typeof ExternalExportResponseSchema>;

/** Samlet eksport-respons */
export const ExportResponseSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("serialized"),
    data: SerializedExportResponseSchema,
  }),
  z.object({
    kind: z.literal("external"),
    data: ExternalExportResponseSchema,
  }),
]);
export type ExportResponse = z.infer<typeof ExportResponseSchema>;

// --- Eksport-target discovery (GET /export/targets) ---

/** Info om et tilgjengelig eksportmål og om det er konfigurert. */
export const ExportTargetInfoSchema = z.object({
  target: ExportTargetSchema,
  configured: z.boolean(),
});
export type ExportTargetInfo = z.infer<typeof ExportTargetInfoSchema>;

export const ExportTargetsResponseSchema = z.object({
  targets: z.array(ExportTargetInfoSchema),
});
export type ExportTargetsResponse = z.infer<typeof ExportTargetsResponseSchema>;

// --- Notion-innstillinger (GET/PUT /user/notion) ---

export const NotionSettingsResponseSchema = z.object({
  melding: z.string(),
  hasApiKey: z.boolean(),
  defaultPageId: z.string().nullable(),
});
export type NotionSettingsResponse = z.infer<typeof NotionSettingsResponseSchema>;

export const NotionSettingsRequestSchema = z.object({
  // .trim() må kjøre først så lagret verdi ikke inneholder whitespace, ellers har
  // refine-sjekken trim-et en midlertidig verdi uten at det fikk effekt på output.
  apiKey: z
    .string()
    .trim()
    .min(1, "API-nøkkel er påkrevd")
    .max(200, "API-nøkkel er for lang")
    .refine((key) => /^(ntn_|secret_)/.test(key), {
      message: "Ugyldig Notion API-nøkkel. Nøkkelen skal starte med 'ntn_' eller 'secret_'.",
    })
    .optional(),
  defaultPageId: z.string().trim().max(100, "Side-ID er for lang").optional(),
  clearApiKey: z.boolean().optional(),
});
export type NotionSettingsRequest = z.infer<typeof NotionSettingsRequestSchema>;
