/**
 * Plain text eksport-provider.
 * Konverterer ExportDocument til ren tekst uten formatering.
 */

import type { ExportDocument, ExportBlock, TextSegment, ListItem } from "common/export";
import type { ExportProvider, ProviderOptions } from "../export-types.js";
import type { ExportResponse } from "common/export";

/** Henter ren tekst fra segmenter (ingen formatering) */
function renderSegments(segments: TextSegment[]): string {
  return segments.map((seg) => seg.text).join("");
}

function renderListItem(item: ListItem): string {
  return renderSegments(item.segments);
}

function renderBlock(block: ExportBlock): string {
  switch (block.type) {
    case "heading":
      return `${renderSegments(block.segments).toUpperCase()}\n${"=".repeat(40)}`;
    case "paragraph":
      return renderSegments(block.segments);
    case "bullet_list":
      return block.items.map((item) => `  • ${renderListItem(item)}`).join("\n");
    case "numbered_list":
      return block.items
        .map((item, idx) => `  ${idx + 1}. ${renderListItem(item)}`)
        .join("\n");
    case "checklist":
      return block.items
        .map((item) => `  [${item.checked ? "x" : " "}] ${renderListItem(item)}`)
        .join("\n");
    case "quote":
      return renderSegments(block.segments)
        .split("\n")
        .map((line) => `  | ${line}`)
        .join("\n");
    case "code_block":
      return block.code
        .split("\n")
        .map((line) => `    ${line}`)
        .join("\n");
    case "divider":
      return "-".repeat(40);
    case "callout": {
      const emoji = block.emoji ? `${block.emoji} ` : "";
      return `${emoji}${renderSegments(block.segments)}`;
    }
    case "table": {
      const allRows = [
        ...(block.headers ? [block.headers] : []),
        ...block.rows,
      ];
      if (allRows.length === 0) return "";

      // Beregn kolonnebredder
      const colCount = Math.max(...allRows.map((row) => row.length));
      const colWidths: number[] = Array(colCount).fill(0);
      for (const row of allRows) {
        for (let c = 0; c < row.length; c++) {
          const text = renderSegments(row[c].segments);
          if (text.length > colWidths[c]) colWidths[c] = text.length;
        }
      }

      const lines: string[] = [];
      for (let r = 0; r < allRows.length; r++) {
        const row = allRows[r];
        const cells = Array.from({ length: colCount }, (_, c) =>
          c < row.length ? renderSegments(row[c].segments).padEnd(colWidths[c]) : " ".repeat(colWidths[c]),
        );
        lines.push(cells.join("  |  "));
        // Separator etter header
        if (r === 0 && block.headers) {
          lines.push(colWidths.map((w) => "-".repeat(w)).join("--+--"));
        }
      }
      return lines.join("\n");
    }
    default:
      return "";
  }
}

export function renderText(doc: ExportDocument): string {
  const parts: string[] = [doc.title.toUpperCase(), "=".repeat(doc.title.length), ""];
  for (const block of doc.blocks) {
    parts.push(renderBlock(block));
    parts.push("");
  }
  return parts.join("\n").trimEnd() + "\n";
}

export const textProvider: ExportProvider = {
  target: "text",

  isConfigured(): boolean {
    return true;
  },

  async execute(doc: ExportDocument, _options?: ProviderOptions): Promise<ExportResponse> {
    const content = renderText(doc);
    return {
      kind: "serialized",
      data: {
        target: "text",
        content,
        mimeType: "text/plain",
        filename: `${doc.title.slice(0, 80).replace(/[^\w\sæøåÆØÅ-]/g, "").trim()}.txt`,
      },
    };
  },
};
