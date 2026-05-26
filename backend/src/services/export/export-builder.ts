/**
 * Bygger et ExportDocument fra rå Markdown-innhold.
 *
 * Parsing av Markdown til blokker er bevisst enkel og dekker de vanligste
 * formateringselementene AI-svar inneholder (headings, lister, kodeblokker,
 * quotes, tabeller, skillelinjer, callouts).
 */

import type { ExportDocument, ExportBlock, TextSegment, ListItem, TableCell } from "common/export";

// --- Rensing av interne XML-tagger ---

/**
 * AI-svar kan inneholde interne wrapper-tagger som <svar>...</svar> eller
 * <answer>...</answer>. Disse er kun ment for intern parsing og skal aldri
 * vises til brukeren — verken i UI eller i eksport. Funksjonen fjerner alle
 * enkle XML-lignende tagger (åpning og lukking) fra teksten.
 */
export function stripInternalTags(text: string): string {
  return text.replace(/<\/?[a-z_][a-z0-9_-]*>/gi, "").trim();
}

// --- Inline-parsing ---

/**
 * Parser inline-formatering: **bold**, *italic*, `code`, [lenke](url).
 * Returnerer en liste med TextSegment.
 */
/** Maks lengde per linje for inline-parsing (hindrer ReDoS ved ondartet input) */
const MAX_INLINE_PARSE_LENGTH = 10_000;

export function parseInlineSegments(text: string): TextSegment[] {
  // Begrens lengde for å forhindre katastrofal backtracking i regex
  if (text.length > MAX_INLINE_PARSE_LENGTH) {
    return [{ text }];
  }

  const segments: TextSegment[] = [];
  // Regex for bold, italic, inline-kode og lenker
  const inlineRegex = /(\*\*(.+?)\*\*|\*(.+?)\*|`(.+?)`|\[([^\]]+)\]\(([^)]+)\))/g;

  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = inlineRegex.exec(text)) !== null) {
    // Tekst mellom forrige match og denne
    if (match.index > lastIndex) {
      segments.push({ text: text.slice(lastIndex, match.index) });
    }

    if (match[2]) {
      // **bold**
      segments.push({ text: match[2], styles: ["bold"] });
    } else if (match[3]) {
      // *italic*
      segments.push({ text: match[3], styles: ["italic"] });
    } else if (match[4]) {
      // `code`
      segments.push({ text: match[4], styles: ["code"] });
    } else if (match[5] && match[6]) {
      // [tekst](url) — kun http/https-lenker
      const href = match[6];
      if (/^https?:\/\//i.test(href) && href.length <= 2000) {
        segments.push({ text: match[5], styles: ["link"], href });
      } else {
        segments.push({ text: match[5] });
      }
    }

    lastIndex = match.index + match[0].length;
  }

  // Resten av teksten etter siste match
  if (lastIndex < text.length) {
    segments.push({ text: text.slice(lastIndex) });
  }

  // Hvis ingen match, returner hele teksten som ett segment
  if (segments.length === 0) {
    segments.push({ text });
  }

  return segments;
}

// --- Blokk-parsing ---

function parseListItem(line: string): ListItem {
  return { segments: parseInlineSegments(line) };
}

function parseChecklistItem(line: string): ListItem {
  const checked = line.startsWith("[x]") || line.startsWith("[X]");
  const content = line.replace(/^\[[ xX]\]\s*/, "");
  return { segments: parseInlineSegments(content), checked };
}

function parseTableRow(line: string): TableCell[] {
  return line
    .split("|")
    .filter((cell) => cell.trim().length > 0)
    .map((cell) => ({ segments: parseInlineSegments(cell.trim()) }));
}

function isTableSeparator(line: string): boolean {
  return /^\|?[\s-:|]+\|?$/.test(line) && line.includes("-");
}

/**
 * Parser Markdown-innhold til en liste med ExportBlock.
 */
export function parseMarkdownToBlocks(markdown: string): ExportBlock[] {
  const lines = markdown.split("\n");
  const blocks: ExportBlock[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trimEnd();

    // Tom linje — hopp over
    if (trimmed.length === 0) {
      i++;
      continue;
    }

    // Kodeblokk (```)
    if (trimmed.startsWith("```")) {
      const language = trimmed.slice(3).trim() || undefined;
      const codeLines: string[] = [];
      i++;
      while (i < lines.length && !lines[i].trimEnd().startsWith("```")) {
        codeLines.push(lines[i]);
        i++;
      }
      blocks.push({ type: "code_block", language, code: codeLines.join("\n") });
      i++; // hopp over avsluttende ```
      continue;
    }

    // Skillelinje (---, ***, ___)
    if (/^[-*_]{3,}\s*$/.test(trimmed)) {
      blocks.push({ type: "divider" });
      i++;
      continue;
    }

    // Heading (# ## ###)
    const headingMatch = trimmed.match(/^(#{1,3})\s+(.+)/);
    if (headingMatch) {
      const level = headingMatch[1].length as 1 | 2 | 3;
      blocks.push({
        type: "heading",
        level,
        segments: parseInlineSegments(headingMatch[2]),
      });
      i++;
      continue;
    }

    // Callout (> 💡 eller > ⚠️ etc. — emoji-prefiks i sitat) — må sjekkes FØR vanlig sitat
    if (/^>\s*[\p{Emoji_Presentation}\p{Extended_Pictographic}]/u.test(trimmed)) {
      const calloutLines: string[] = [];
      while (i < lines.length && lines[i].trimEnd().startsWith(">")) {
        calloutLines.push(lines[i].trimEnd().replace(/^>\s*/, ""));
        i++;
      }
      const joined = calloutLines.join("\n");
      const emojiMatch = joined.match(/^([\p{Emoji_Presentation}\p{Extended_Pictographic}])\s*/u);
      const emoji = emojiMatch?.[1];
      const content = emoji ? joined.slice(emojiMatch[0].length) : joined;
      blocks.push({
        type: "callout",
        emoji,
        segments: parseInlineSegments(content),
      });
      continue;

      // Sitat (> tekst)
    } else if (trimmed.startsWith("> ")) {
      const quoteLines: string[] = [];
      while (i < lines.length && lines[i].trimEnd().startsWith("> ")) {
        quoteLines.push(lines[i].trimEnd().slice(2));
        i++;
      }
      blocks.push({
        type: "quote",
        segments: parseInlineSegments(quoteLines.join("\n")),
      });
      continue;
    }

    // Tabell (|---|---|)
    if (
      trimmed.includes("|") &&
      i + 1 < lines.length &&
      isTableSeparator(lines[i + 1]?.trimEnd() ?? "")
    ) {
      const headers = parseTableRow(trimmed);
      i += 2; // hopp over header + separator
      const rows: TableCell[][] = [];
      while (i < lines.length && lines[i].trimEnd().includes("|")) {
        rows.push(parseTableRow(lines[i].trimEnd()));
        i++;
      }
      blocks.push({
        type: "table",
        headers,
        rows,
      });
      continue;
    }

    // Sjekkliste (- [ ] / - [x])
    if (/^[-*]\s+\[[ xX]\]/.test(trimmed)) {
      const items: ListItem[] = [];
      while (i < lines.length && /^[-*]\s+\[[ xX]\]/.test(lines[i].trimEnd())) {
        const itemText = lines[i].trimEnd().replace(/^[-*]\s+/, "");
        items.push(parseChecklistItem(itemText));
        i++;
      }
      blocks.push({ type: "checklist", items });
      continue;
    }

    // Punktliste (- element / * element)
    if (/^[-*]\s+/.test(trimmed)) {
      const items: ListItem[] = [];
      while (i < lines.length && /^[-*]\s+/.test(lines[i].trimEnd())) {
        const itemText = lines[i].trimEnd().replace(/^[-*]\s+/, "");
        items.push(parseListItem(itemText));
        i++;
      }
      blocks.push({ type: "bullet_list", items });
      continue;
    }

    // Nummerert liste (1. element)
    if (/^\d+\.\s+/.test(trimmed)) {
      const items: ListItem[] = [];
      while (i < lines.length && /^\d+\.\s+/.test(lines[i].trimEnd())) {
        const itemText = lines[i].trimEnd().replace(/^\d+\.\s+/, "");
        items.push(parseListItem(itemText));
        i++;
      }
      blocks.push({ type: "numbered_list", items });
      continue;
    }

    // Vanlig avsnitt (fallback)
    blocks.push({
      type: "paragraph",
      segments: parseInlineSegments(trimmed),
    });
    i++;
  }

  return blocks;
}

/**
 * Bygger et ExportDocument fra tittel og Markdown-innhold.
 */
export function buildExportDocument(
  title: string,
  markdownContent: string,
  metadata?: Record<string, unknown>,
): ExportDocument {
  return {
    title: stripInternalTags(title),
    metadata,
    blocks: parseMarkdownToBlocks(stripInternalTags(markdownContent)),
  };
}
