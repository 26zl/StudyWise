/**
 * Notion eksport-provider.
 * Konverterer ExportDocument til Notion blocks og oppretter en side via Notion API.
 *
 * Krever miljøvariabler:
 *   NOTION_API_KEY — Intern integrasjons-token fra https://www.notion.so/my-integrations
 *
 * Brukeren må dele den ønskede parent-siden med integrasjonen i Notion.
 */

import type {
  ExportDocument,
  ExportBlock,
  TextSegment,
  ListItem,
} from "common/export";
import type { ExportProvider, RuntimeProviderOptions } from "../export-types.js";
import type { ExportResponse } from "common/export";
import { logger } from "../../../utils/logger.js";
import { normalizeNotionPageId } from "../notion-id.js";

const NOTION_API_VERSION = "2022-06-28";
const NOTION_BASE_URL = "https://api.notion.com/v1";

// Notion begrenser antall blokker per append-kall
const NOTION_MAX_BLOCKS_PER_REQUEST = 100;

function sanitizeNotionErrorBody(body: string): string {
  // Begrens lengde + maskér potensielle tokens/secrets i feilmeldinger.
  const truncated = body.slice(0, 220);
  return truncated.replace(
    /(secret_[A-Za-z0-9_-]+|Bearer\s+[A-Za-z0-9._-]+)/gi,
    "[redacted]",
  );
}

// --- Notion rik-tekst mapping ---

interface NotionRichText {
  type: "text";
  text: { content: string; link?: { url: string } | null };
  annotations: {
    bold: boolean;
    italic: boolean;
    code: boolean;
    underline: boolean;
    strikethrough: boolean;
    color: "default";
  };
}

function segmentToRichText(seg: TextSegment): NotionRichText {
  return {
    type: "text",
    text: {
      content: seg.text,
      link: seg.styles?.includes("link") && seg.href ? { url: seg.href } : null,
    },
    annotations: {
      bold: seg.styles?.includes("bold") ?? false,
      italic: seg.styles?.includes("italic") ?? false,
      code: seg.styles?.includes("code") ?? false,
      underline: false,
      strikethrough: false,
      color: "default",
    },
  };
}

function segmentsToRichText(segments: TextSegment[]): NotionRichText[] {
  return segments.map(segmentToRichText);
}

function listItemToRichText(item: ListItem): NotionRichText[] {
  return segmentsToRichText(item.segments);
}

function normalizeTableRowCells(
  cells: { segments: TextSegment[] }[],
  colCount: number,
): NotionRichText[][] {
  const normalized = cells.slice(0, colCount).map((cell) => segmentsToRichText(cell.segments));
  while (normalized.length < colCount) {
    normalized.push([]);
  }
  return normalized;
}

// --- Blokk-mapping ---

// Notion block type definisjon (forenklet)
type NotionBlock = Record<string, unknown> & { object: "block"; type: string };

function mapBlock(block: ExportBlock): NotionBlock[] {
  switch (block.type) {
    case "heading": {
      const key = `heading_${block.level}` as "heading_1" | "heading_2" | "heading_3";
      return [
        {
          object: "block",
          type: key,
          [key]: { rich_text: segmentsToRichText(block.segments) },
        },
      ];
    }
    case "paragraph":
      return [
        {
          object: "block",
          type: "paragraph",
          paragraph: { rich_text: segmentsToRichText(block.segments) },
        },
      ];
    case "bullet_list":
      return block.items.map((item) => ({
        object: "block" as const,
        type: "bulleted_list_item",
        bulleted_list_item: { rich_text: listItemToRichText(item) },
      }));
    case "numbered_list":
      return block.items.map((item) => ({
        object: "block" as const,
        type: "numbered_list_item",
        numbered_list_item: { rich_text: listItemToRichText(item) },
      }));
    case "checklist":
      return block.items.map((item) => ({
        object: "block" as const,
        type: "to_do",
        to_do: {
          rich_text: listItemToRichText(item),
          checked: item.checked ?? false,
        },
      }));
    case "quote":
      return [
        {
          object: "block",
          type: "quote",
          quote: { rich_text: segmentsToRichText(block.segments) },
        },
      ];
    case "code_block":
      return [
        {
          object: "block",
          type: "code",
          code: {
            rich_text: [
              {
                type: "text",
                text: { content: block.code.slice(0, 2000) },
                annotations: {
                  bold: false,
                  italic: false,
                  code: false,
                  underline: false,
                  strikethrough: false,
                  color: "default",
                },
              },
            ],
            language: mapNotionLanguage(block.language),
          },
        },
      ];
    case "divider":
      return [{ object: "block", type: "divider", divider: {} }];
    case "callout": {
      return [
        {
          object: "block",
          type: "callout",
          callout: {
            rich_text: segmentsToRichText(block.segments),
            icon: block.emoji ? { type: "emoji", emoji: block.emoji } : { type: "emoji", emoji: "💡" },
          },
        },
      ];
    }
    case "table": {
      const hasHeaders = !!block.headers && block.headers.length > 0;
      const colCount = hasHeaders
        ? block.headers!.length
        : block.rows[0]?.length ?? 0;

      if (colCount === 0) return [];

      const tableRows: NotionBlock[] = [];

      if (hasHeaders) {
        tableRows.push({
          object: "block",
          type: "table_row",
          table_row: {
            cells: normalizeTableRowCells(block.headers!, colCount),
          },
        });
      }

      for (const row of block.rows) {
        tableRows.push({
          object: "block",
          type: "table_row",
          table_row: {
            cells: normalizeTableRowCells(row, colCount),
          },
        });
      }

      return [
        {
          object: "block",
          type: "table",
          table: {
            table_width: colCount,
            has_column_header: hasHeaders,
            has_row_header: false,
            children: tableRows,
          },
        },
      ];
    }
    default:
      return [];
  }
}

/** Mapper vanlige språknavn til Notion-kompatible språkkoder */
function mapNotionLanguage(language?: string): string {
  if (!language) return "plain text";
  const normalized = language.toLowerCase().trim();
  const supported = new Set([
    "abap", "arduino", "bash", "basic", "c", "clojure", "coffeescript",
    "c++", "c#", "css", "dart", "diff", "docker", "elixir", "elm",
    "erlang", "flow", "fortran", "f#", "gherkin", "glsl", "go", "graphql",
    "groovy", "haskell", "html", "java", "javascript", "json", "julia",
    "kotlin", "latex", "less", "lisp", "livescript", "lua", "makefile",
    "markdown", "markup", "matlab", "mermaid", "nix", "objective-c",
    "ocaml", "pascal", "perl", "php", "plain text", "powershell",
    "prolog", "protobuf", "python", "r", "reason", "ruby", "rust",
    "sass", "scala", "scheme", "scss", "shell", "sql", "swift",
    "typescript", "vb.net", "verilog", "vhdl", "visual basic",
    "webassembly", "xml", "yaml", "java/c/c++/c#",
  ]);
  if (supported.has(normalized)) return normalized;
  if (normalized === "ts") return "typescript";
  if (normalized === "js") return "javascript";
  if (normalized === "py") return "python";
  if (normalized === "rb") return "ruby";
  if (normalized === "sh" || normalized === "zsh") return "bash";
  if (normalized === "yml") return "yaml";
  return "plain text";
}

/** Bygger Notion API-payload for å opprette en side med blokker */
export function buildNotionPayload(
  doc: ExportDocument,
  parentPageId: string,
): { createPageBody: Record<string, unknown>; childBlocks: NotionBlock[] } {
  const allBlocks: NotionBlock[] = [];
  for (const block of doc.blocks) {
    allBlocks.push(...mapBlock(block));
  }

  const initialChildren = allBlocks.slice(0, NOTION_MAX_BLOCKS_PER_REQUEST);
  const remainingBlocks = allBlocks.slice(NOTION_MAX_BLOCKS_PER_REQUEST);

  const createPageBody = {
    parent: { page_id: parentPageId },
    properties: {
      title: {
        title: [
          {
            type: "text",
            text: { content: doc.title },
          },
        ],
      },
    },
    children: initialChildren,
  };

  return { createPageBody, childBlocks: remainingBlocks };
}

/** Oppretter en Notion-side via API. Returnerer side-ID og URL. */
async function createNotionPage(
  doc: ExportDocument,
  parentPageId: string,
  notionApiKey: string,
): Promise<{ pageId: string; url: string }> {
  const normalizedParentId = normalizeNotionPageId(parentPageId);
  if (!normalizedParentId) {
    throw new Error("Ugyldig Notion side-ID. Lim inn side-ID eller en full Notion-lenke.");
  }

  const { createPageBody, childBlocks } = buildNotionPayload(doc, normalizedParentId);

  const createRes = await fetch(`${NOTION_BASE_URL}/pages`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${notionApiKey}`,
      "Notion-Version": NOTION_API_VERSION,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(createPageBody),
  });

  if (!createRes.ok) {
    const body = await createRes.text();
    logger.error(
      { status: createRes.status },
      "Notion create page feilet",
    );
    if (createRes.status === 401) {
      throw new Error("Ugyldig Notion API-nøkkel. Lagre en ny nøkkel i innstillinger.");
    }
    if (createRes.status === 403) {
      throw new Error("Notion har avvist tilgang. Del parent-siden med integrasjonen din i Notion.");
    }
    if (createRes.status === 404) {
      throw new Error("Fant ikke Notion side-ID. Sjekk at page ID er riktig.");
    }
    throw new Error(`Notion API-feil (${createRes.status}): ${sanitizeNotionErrorBody(body)}`);
  }

  const pageData = (await createRes.json()) as { id: string; url: string };

  // Legg til ekstra blokker i batches hvis nødvendig
  for (let i = 0; i < childBlocks.length; i += NOTION_MAX_BLOCKS_PER_REQUEST) {
    const batch = childBlocks.slice(i, i + NOTION_MAX_BLOCKS_PER_REQUEST);
    const appendRes = await fetch(
      `${NOTION_BASE_URL}/blocks/${pageData.id}/children`,
      {
        method: "PATCH",
        headers: {
          Authorization: `Bearer ${notionApiKey}`,
          "Notion-Version": NOTION_API_VERSION,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ children: batch }),
      },
    );

    if (!appendRes.ok) {
      const body = await appendRes.text();
      logger.warn(
        { status: appendRes.status, pageId: pageData.id },
        "Notion append blocks feilet — siden er delvis opprettet",
      );
      if (appendRes.status === 401 || appendRes.status === 403) {
        throw new Error(
          "Notion avviste oppdatering av sideinnhold. Kontroller tilgang og del siden med integrasjonen.",
        );
      }
      if (appendRes.status >= 400 && appendRes.status < 500) {
        throw new Error(
          `Notion API-feil ved innsending av innhold (${appendRes.status}): ${sanitizeNotionErrorBody(body)}`,
        );
      }
    }
  }

  return { pageId: pageData.id, url: pageData.url };
}

export const notionProvider: ExportProvider = {
  target: "notion",

  isConfigured(): boolean {
    // Konfigureres per bruker via runtime options.
    return true;
  },

  async execute(doc: ExportDocument, options?: RuntimeProviderOptions): Promise<ExportResponse> {
    const notionApiKey = options?.notion?.apiKey?.trim();
    if (!notionApiKey) {
      throw new Error("Notion-eksport er ikke konfigurert. Legg til Notion API-nøkkel i innstillinger.");
    }

    const parentPageId = options?.notion?.parentPageId?.trim() || options?.notion?.defaultPageId?.trim();
    if (!parentPageId) {
      throw new Error("Notion parent page ID er påkrevd. Legg inn standard side-ID i innstillinger eller oppgi den i eksportdialogen.");
    }

    const { pageId, url } = await createNotionPage(doc, parentPageId, notionApiKey);

    return {
      kind: "external",
      data: {
        target: "notion",
        resourceId: pageId,
        url,
        title: doc.title,
      },
    };
  },
};
