/**
 * Markdown eksport-provider.
 * Konverterer ExportDocument til Markdown-streng.
 */

import type { ExportDocument, ExportBlock, TextSegment, ListItem, TableCell } from "common/export";
import type { ExportProvider, ProviderOptions } from "../export-types.js";
import type { ExportResponse } from "common/export";

/** Rendrer inline-segmenter til Markdown-tekst */
function renderSegments(segments: TextSegment[]): string {
  return segments
    .map((seg) => {
      let text = seg.text;
      if (seg.styles?.includes("bold")) text = `**${text}**`;
      if (seg.styles?.includes("italic")) text = `*${text}*`;
      if (seg.styles?.includes("code")) text = `\`${text}\``;
      if (seg.styles?.includes("link") && seg.href) text = `[${text}](${seg.href})`;
      return text;
    })
    .join("");
}

function renderListItem(item: ListItem): string {
  return renderSegments(item.segments);
}

function renderTableCell(cell: TableCell): string {
  return renderSegments(cell.segments);
}

function renderBlock(block: ExportBlock): string {
  switch (block.type) {
    case "heading": {
      const prefix = "#".repeat(block.level);
      return `${prefix} ${renderSegments(block.segments)}`;
    }
    case "paragraph":
      return renderSegments(block.segments);
    case "bullet_list":
      return block.items.map((item) => `- ${renderListItem(item)}`).join("\n");
    case "numbered_list":
      return block.items
        .map((item, idx) => `${idx + 1}. ${renderListItem(item)}`)
        .join("\n");
    case "checklist":
      return block.items
        .map((item) => `- [${item.checked ? "x" : " "}] ${renderListItem(item)}`)
        .join("\n");
    case "quote":
      return renderSegments(block.segments)
        .split("\n")
        .map((line) => `> ${line}`)
        .join("\n");
    case "code_block":
      return `\`\`\`${block.language ?? ""}\n${block.code}\n\`\`\``;
    case "divider":
      return "---";
    case "callout": {
      const emoji = block.emoji ? `${block.emoji} ` : "";
      return renderSegments(block.segments)
        .split("\n")
        .map((line) => `> ${emoji}${line}`)
        .join("\n");
    }
    case "table": {
      const lines: string[] = [];
      if (block.headers && block.headers.length > 0) {
        const headerLine = block.headers.map(renderTableCell).join(" | ");
        lines.push(`| ${headerLine} |`);
        lines.push(`| ${block.headers.map(() => "---").join(" | ")} |`);
      }
      for (const row of block.rows) {
        const rowLine = row.map(renderTableCell).join(" | ");
        lines.push(`| ${rowLine} |`);
      }
      return lines.join("\n");
    }
    default:
      return "";
  }
}

export function renderMarkdown(doc: ExportDocument): string {
  const parts: string[] = [`# ${doc.title}`, ""];
  for (const block of doc.blocks) {
    parts.push(renderBlock(block));
    parts.push("");
  }
  return parts.join("\n").trimEnd() + "\n";
}

export const markdownProvider: ExportProvider = {
  target: "markdown",

  isConfigured(): boolean {
    return true;
  },

  async execute(doc: ExportDocument, _options?: ProviderOptions): Promise<ExportResponse> {
    const content = renderMarkdown(doc);
    return {
      kind: "serialized",
      data: {
        target: "markdown",
        content,
        mimeType: "text/markdown",
        filename: `${doc.title.slice(0, 80).replace(/[^\w\sæøåÆØÅ-]/g, "").trim()}.md`,
      },
    };
  },
};
