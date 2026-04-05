/**
 * PDF Export Provider
 * Konverterer internt dokumentformat til PDF via pdfkit.
 */

import PDFDocument from "pdfkit";
import type { ExportProvider, ExportProviderResult, ProviderOptions } from "../export-types.js";
import type { ExportDocument, ExportBlock, TextSegment, ListItem, ExportResponse } from "common/export";

const FONT_SIZES = {
  h1: 24,
  h2: 20,
  h3: 16,
  body: 12,
  code: 10,
};

const COLORS = {
  text: "#1e293b",
  heading: "#0f172a",
  muted: "#64748b",
  code: "#334155",
  quote: "#475569",
  link: "#2563eb",
};

export class PdfExportProvider implements ExportProvider {
  readonly target = "pdf" as const;
  readonly mimeType = "application/pdf";

  isConfigured(): boolean {
    return true;
  }

  async execute(doc: ExportDocument, _options?: ProviderOptions): Promise<ExportResponse> {
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

  async export(document: ExportDocument): Promise<ExportProviderResult> {
    return new Promise((resolve, reject) => {
      try {
        const doc = new PDFDocument({
          size: "A4",
          margins: { top: 50, bottom: 50, left: 50, right: 50 },
          info: {
            Title: document.title,
            Author: "StudyWise",
            Creator: "StudyWise Export",
          },
        });

        const chunks: Buffer[] = [];
        doc.on("data", (chunk: Buffer) => chunks.push(chunk));
        doc.on("end", () => {
          const buffer = Buffer.concat(chunks);
          resolve({
            content: buffer.toString("base64"),
            mimeType: this.mimeType,
            filename: this.generateFilename(document.title),
            isBase64: true,
          });
        });
        doc.on("error", reject);

        // Tittel
        doc
          .fontSize(FONT_SIZES.h1)
          .fillColor(COLORS.heading)
          .text(document.title, { align: "left" });
        doc.moveDown(0.5);

        // Metadata
        if (document.metadata) {
          doc
            .fontSize(FONT_SIZES.body - 2)
            .fillColor(COLORS.muted)
            .text(`Generert av StudyWise · ${new Date().toLocaleDateString("nb-NO")}`);
          doc.moveDown(1);
        }

        // Blokker
        for (const block of document.blocks) {
          this.renderBlock(doc, block);
        }

        // Footer
        doc.moveDown(2);
        doc
          .fontSize(FONT_SIZES.body - 2)
          .fillColor(COLORS.muted)
          .text("Generert av StudyWise", { align: "center" });

        doc.end();
      } catch (error) {
        reject(error);
      }
    });
  }

  private renderBlock(doc: PDFKit.PDFDocument, block: ExportBlock): void {
    switch (block.type) {
      case "heading":
        this.renderHeading(doc, block.level, block.segments);
        break;
      case "paragraph":
        this.renderParagraph(doc, block.segments);
        break;
      case "bullet_list":
        this.renderList(doc, block.items, "bullet");
        break;
      case "numbered_list":
        this.renderList(doc, block.items, "numbered");
        break;
      case "checklist":
        this.renderList(doc, block.items, "checklist");
        break;
      case "quote":
        this.renderQuote(doc, block.segments);
        break;
      case "code_block":
        this.renderCodeBlock(doc, block.code, block.language);
        break;
      case "divider":
        this.renderDivider(doc);
        break;
      case "callout":
        this.renderCallout(doc, block.segments, block.emoji);
        break;
      case "table":
        this.renderTable(doc, block.headers, block.rows);
        break;
    }
  }

  private renderHeading(
    doc: PDFKit.PDFDocument,
    level: 1 | 2 | 3,
    segments: TextSegment[],
  ): void {
    const fontSize = level === 1 ? FONT_SIZES.h1 : level === 2 ? FONT_SIZES.h2 : FONT_SIZES.h3;
    doc.moveDown(level === 1 ? 1 : 0.5);
    doc.fontSize(fontSize).fillColor(COLORS.heading);
    this.renderSegments(doc, segments);
    doc.moveDown(0.3);
  }

  private renderParagraph(doc: PDFKit.PDFDocument, segments: TextSegment[]): void {
    doc.fontSize(FONT_SIZES.body).fillColor(COLORS.text);
    this.renderSegments(doc, segments);
    doc.moveDown(0.5);
  }

  private renderSegments(doc: PDFKit.PDFDocument, segments: TextSegment[]): void {
    const text = segments.map((s) => s.text).join("");
    doc.text(text, { continued: false });
  }

  private renderList(
    doc: PDFKit.PDFDocument,
    items: ListItem[],
    type: "bullet" | "numbered" | "checklist",
  ): void {
    doc.fontSize(FONT_SIZES.body).fillColor(COLORS.text);
    items.forEach((item, index) => {
      let prefix: string;
      if (type === "bullet") {
        prefix = "• ";
      } else if (type === "numbered") {
        prefix = `${index + 1}. `;
      } else {
        prefix = item.checked ? "☑ " : "☐ ";
      }
      const text = item.segments.map((s) => s.text).join("");
      doc.text(`${prefix}${text}`, { indent: 20 });
    });
    doc.moveDown(0.5);
  }

  private renderQuote(doc: PDFKit.PDFDocument, segments: TextSegment[]): void {
    const text = segments.map((s) => s.text).join("");
    doc
      .fontSize(FONT_SIZES.body)
      .fillColor(COLORS.quote)
      .text(`"${text}"`, { indent: 20 });
    doc.moveDown(0.5);
  }

  private renderCodeBlock(
    doc: PDFKit.PDFDocument,
    code: string,
    _language?: string,
  ): void {
    doc
      .fontSize(FONT_SIZES.code)
      .fillColor(COLORS.code)
      .font("Courier")
      .text(code, { indent: 10 })
      .font("Helvetica");
    doc.moveDown(0.5);
  }

  private renderDivider(doc: PDFKit.PDFDocument): void {
    doc.moveDown(0.5);
    const y = doc.y;
    doc
      .strokeColor(COLORS.muted)
      .lineWidth(0.5)
      .moveTo(50, y)
      .lineTo(545, y)
      .stroke();
    doc.moveDown(0.5);
  }

  private renderCallout(
    doc: PDFKit.PDFDocument,
    segments: TextSegment[],
    emoji?: string,
  ): void {
    const text = segments.map((s) => s.text).join("");
    const prefix = emoji ? `${emoji} ` : "💡 ";
    doc
      .fontSize(FONT_SIZES.body)
      .fillColor(COLORS.text)
      .text(`${prefix}${text}`, { indent: 10 });
    doc.moveDown(0.5);
  }

  private renderTable(
    doc: PDFKit.PDFDocument,
    headers: { segments: TextSegment[] }[] | undefined,
    rows: { segments: TextSegment[] }[][],
  ): void {
    doc.fontSize(FONT_SIZES.body).fillColor(COLORS.text);

    if (headers && headers.length > 0) {
      const headerText = headers.map((h) => h.segments.map((s) => s.text).join("")).join(" | ");
      doc.text(headerText, { underline: true });
    }

    for (const row of rows) {
      const rowText = row.map((cell) => cell.segments.map((s) => s.text).join("")).join(" | ");
      doc.text(rowText);
    }
    doc.moveDown(0.5);
  }

  private generateFilename(title: string): string {
    const slug = title
      .toLowerCase()
      .replace(/[^a-z0-9æøå]+/gi, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 50);
    const date = new Date().toISOString().slice(0, 10);
    return `${slug || "studywise-eksport"}-${date}.pdf`;
  }
}
