/**
 * Word Export Provider
 * Konverterer internt dokumentformat til DOCX via docx-biblioteket.
 */

import {
  Document,
  Paragraph,
  TextRun,
  HeadingLevel,
  AlignmentType,
  Packer,
  BorderStyle,
  TableCell,
  TableRow,
  Table,
  WidthType,
  CheckBox,
} from "docx";
import type { ExportProvider, ExportProviderResult } from "../export-types.js";
import type {
  ExportDocument,
  ExportBlock,
  TextSegment,
  ListItem,
  ExportResponse,
} from "common/export";

export class WordExportProvider implements ExportProvider {
  readonly target = "word" as const;
  readonly mimeType = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

  isConfigured(): boolean {
    return true;
  }

  async execute(doc: ExportDocument): Promise<ExportResponse> {
    const result = await this.export(doc);
    return {
      kind: "serialized",
      data: {
        target: this.target,
        content: result.content,
        mimeType: result.mimeType,
        filename: result.filename,
        base64: result.isBase64 ? result.content : undefined,
      },
    };
  }

  private async export(document: ExportDocument): Promise<ExportProviderResult> {
    const children: (Paragraph | Table)[] = [];

    // Tittel
    children.push(
      new Paragraph({
        text: document.title,
        heading: HeadingLevel.TITLE,
        spacing: { after: 200 },
      }),
    );

    // Metadata
    if (document.metadata) {
      children.push(
        new Paragraph({
          children: [
            new TextRun({
              text: `Generert av StudyWise · ${new Date().toLocaleDateString("nb-NO")}`,
              size: 20,
              color: "666666",
              italics: true,
            }),
          ],
          spacing: { after: 400 },
        }),
      );
    }

    // Blokker
    for (const block of document.blocks) {
      const rendered = this.renderBlock(block);
      if (Array.isArray(rendered)) {
        children.push(...rendered);
      } else {
        children.push(rendered);
      }
    }

    // Footer
    children.push(
      new Paragraph({
        children: [
          new TextRun({
            text: "Generert av StudyWise",
            size: 18,
            color: "999999",
          }),
        ],
        alignment: AlignmentType.CENTER,
        spacing: { before: 400 },
      }),
    );

    const doc = new Document({
      creator: "StudyWise",
      title: document.title,
      description: "Eksportert fra StudyWise",
      sections: [{ children }],
    });

    const buffer = await Packer.toBuffer(doc);
    return {
      content: buffer.toString("base64"),
      mimeType: this.mimeType,
      filename: this.generateFilename(document.title),
      isBase64: true,
    };
  }

  private renderBlock(block: ExportBlock): Paragraph | Paragraph[] | Table {
    switch (block.type) {
      case "heading":
        return this.renderHeading(block.level, block.segments);
      case "paragraph":
        return this.renderParagraph(block.segments);
      case "bullet_list":
        return this.renderList(block.items, "bullet");
      case "numbered_list":
        return this.renderList(block.items, "numbered");
      case "checklist":
        return this.renderChecklist(block.items);
      case "quote":
        return this.renderQuote(block.segments);
      case "code_block":
        return this.renderCodeBlock(block.code);
      case "divider":
        return this.renderDivider();
      case "callout":
        return this.renderCallout(block.segments, block.emoji);
      case "table":
        return this.renderTable(block.headers, block.rows);
    }
  }

  private renderHeading(level: 1 | 2 | 3, segments: TextSegment[]): Paragraph {
    const headingLevel =
      level === 1
        ? HeadingLevel.HEADING_1
        : level === 2
          ? HeadingLevel.HEADING_2
          : HeadingLevel.HEADING_3;
    return new Paragraph({
      children: this.segmentsToTextRuns(segments),
      heading: headingLevel,
      spacing: { before: level === 1 ? 400 : 200, after: 100 },
    });
  }

  private renderParagraph(segments: TextSegment[]): Paragraph {
    return new Paragraph({
      children: this.segmentsToTextRuns(segments),
      spacing: { after: 120 },
    });
  }

  private segmentsToTextRuns(segments: TextSegment[]): TextRun[] {
    return segments.map((segment) => {
      const styles = segment.styles || [];
      return new TextRun({
        text: segment.text,
        bold: styles.includes("bold"),
        italics: styles.includes("italic"),
        font: styles.includes("code") ? "Courier New" : undefined,
        color: segment.href ? "2563EB" : undefined,
        underline: segment.href ? {} : undefined,
      });
    });
  }

  private renderList(items: ListItem[], type: "bullet" | "numbered"): Paragraph[] {
    return items.map(
      (item, index) =>
        new Paragraph({
          children: [
            new TextRun({
              text: type === "bullet" ? "• " : `${index + 1}. `,
            }),
            ...this.segmentsToTextRuns(item.segments),
          ],
          indent: { left: 720 },
          spacing: { after: 60 },
        }),
    );
  }

  private renderChecklist(items: ListItem[]): Paragraph[] {
    return items.map(
      (item) =>
        new Paragraph({
          children: [
            new CheckBox({ checked: item.checked ?? false }),
            new TextRun({ text: " " }),
            ...this.segmentsToTextRuns(item.segments),
          ],
          indent: { left: 720 },
          spacing: { after: 60 },
        }),
    );
  }

  private renderQuote(segments: TextSegment[]): Paragraph {
    return new Paragraph({
      children: [
        new TextRun({ text: '"' }),
        ...this.segmentsToTextRuns(segments),
        new TextRun({ text: '"' }),
      ],
      indent: { left: 720 },
      spacing: { before: 100, after: 100 },
      border: {
        left: { style: BorderStyle.SINGLE, size: 12, color: "CCCCCC" },
      },
    });
  }

  private renderCodeBlock(code: string): Paragraph {
    return new Paragraph({
      children: [
        new TextRun({
          text: code,
          font: "Courier New",
          size: 20,
        }),
      ],
      shading: { fill: "F1F5F9" },
      spacing: { before: 100, after: 100 },
    });
  }

  private renderDivider(): Paragraph {
    return new Paragraph({
      children: [new TextRun({ text: "─".repeat(50), color: "CCCCCC" })],
      alignment: AlignmentType.CENTER,
      spacing: { before: 200, after: 200 },
    });
  }

  private renderCallout(segments: TextSegment[], emoji?: string): Paragraph {
    return new Paragraph({
      children: [
        new TextRun({ text: emoji ? `${emoji} ` : "💡 " }),
        ...this.segmentsToTextRuns(segments),
      ],
      shading: { fill: "FEF3C7" },
      indent: { left: 360 },
      spacing: { before: 100, after: 100 },
    });
  }

  private renderTable(
    headers: { segments: TextSegment[] }[] | undefined,
    rows: { segments: TextSegment[] }[][],
  ): Table {
    const tableRows: TableRow[] = [];

    if (headers && headers.length > 0) {
      tableRows.push(
        new TableRow({
          children: headers.map(
            (h) =>
              new TableCell({
                children: [new Paragraph({ children: this.segmentsToTextRuns(h.segments) })],
                shading: { fill: "E2E8F0" },
              }),
          ),
        }),
      );
    }

    for (const row of rows) {
      tableRows.push(
        new TableRow({
          children: row.map(
            (cell) =>
              new TableCell({
                children: [new Paragraph({ children: this.segmentsToTextRuns(cell.segments) })],
              }),
          ),
        }),
      );
    }

    return new Table({
      rows: tableRows,
      width: { size: 100, type: WidthType.PERCENTAGE },
    });
  }

  private generateFilename(title: string): string {
    const slug = title
      .toLowerCase()
      .replace(/[^a-z0-9æøå]+/gi, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 50);
    const date = new Date().toISOString().slice(0, 10);
    return `${slug || "studywise-eksport"}-${date}.docx`;
  }
}
