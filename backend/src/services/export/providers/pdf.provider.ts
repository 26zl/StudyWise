/**
 * PDF Export Provider
 * Konverterer internt dokumentformat til PDF via pdfkit.
 */

import PDFDocument from "pdfkit";
import type { ExportProvider, ExportProviderResult } from "../export-types.js";
import type {
  ExportDocument,
  ExportBlock,
  TextSegment,
  ListItem,
  ExportResponse,
} from "common/export";

/**
 * Fjerner emoji-tegn fra tekst — standard PDF-fonter (Helvetica, Courier) støtter ikke Unicode-emoji,
 * og de rendres som uleselige tegn (f.eks. "Ø>Ý"). Fjerner også eventuelle doble mellomrom som oppstår.
 */
function stripEmoji(text: string): string {
  return (
    text
      // eslint-disable-next-line no-misleading-character-class -- Bevisst: fjerner emoji + ZWJ + variation selector
      .replace(/[\p{Emoji_Presentation}\p{Extended_Pictographic}\u200D\uFE0F]/gu, "")
      .replace(/\s{2,}/g, " ")
      .trim()
  );
}

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
          .text(stripEmoji(document.title), { align: "left" });
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
    // Tabeller bruker absolutt posisjonering og kan etterlate doc.x i
    // høyre kolonne. Reset venstre marg før hvert nytt blokk slik at
    // overskrifter og avsnitt ikke wrappes i en smal kolonne.
    doc.x = doc.page?.margins.left ?? 50;
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

  private renderHeading(doc: PDFKit.PDFDocument, level: 1 | 2 | 3, segments: TextSegment[]): void {
    const fontSize = level === 1 ? FONT_SIZES.h1 : level === 2 ? FONT_SIZES.h2 : FONT_SIZES.h3;
    doc.moveDown(level === 1 ? 1 : 0.5);
    // Sørg for at overskriften alltid starter på venstre marg med full
    // bredde, ellers kan pdfkit wrappe overskriften midt i et ord når
    // tidligere innhold (typisk tabell) har etterlatt doc.x langt til høyre.
    doc.x = doc.page?.margins.left ?? 50;
    doc.fontSize(fontSize).fillColor(COLORS.heading).font("Helvetica-Bold");
    this.renderSegments(doc, segments);
    doc.font("Helvetica");
    doc.moveDown(0.3);
  }

  private renderParagraph(doc: PDFKit.PDFDocument, segments: TextSegment[]): void {
    doc.fontSize(FONT_SIZES.body).fillColor(COLORS.text);
    this.renderSegments(doc, segments);
    doc.moveDown(0.5);
  }

  private renderSegments(doc: PDFKit.PDFDocument, segments: TextSegment[]): void {
    for (let i = 0; i < segments.length; i++) {
      const seg = segments[i];
      const isLast = i === segments.length - 1;
      const styles = seg.styles || [];

      // Velg font basert på stil
      if (styles.includes("code")) {
        doc.font("Courier");
      } else if (styles.includes("bold") && styles.includes("italic")) {
        doc.font("Helvetica-BoldOblique");
      } else if (styles.includes("bold")) {
        doc.font("Helvetica-Bold");
      } else if (styles.includes("italic")) {
        doc.font("Helvetica-Oblique");
      } else {
        doc.font("Helvetica");
      }

      // Lenker: bruk blå farge og understreking
      const cleanText = stripEmoji(seg.text);
      if (styles.includes("link") && seg.href) {
        doc.fillColor(COLORS.link);
        doc.text(cleanText, { continued: !isLast, underline: true, link: seg.href });
      } else {
        doc.text(cleanText, { continued: !isLast });
      }

      // Tilbakestill farge og font
      if (styles.includes("link") && seg.href) doc.fillColor(COLORS.text);
      if (styles.includes("code")) doc.font("Helvetica");
    }
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
        prefix = "- ";
      } else if (type === "numbered") {
        prefix = `${index + 1}. `;
      } else {
        // Unngå Unicode-emoji (☑/☐) som standard PDF-fonter ikke støtter
        prefix = item.checked ? "[x] " : "[ ] ";
      }
      const text = stripEmoji(item.segments.map((s) => s.text).join(""));
      doc.text(`${prefix}${text}`, { indent: 20 });
    });
    doc.moveDown(0.5);
  }

  private renderQuote(doc: PDFKit.PDFDocument, segments: TextSegment[]): void {
    const text = stripEmoji(segments.map((s) => s.text).join(""));
    doc.fontSize(FONT_SIZES.body).fillColor(COLORS.quote).text(`"${text}"`, { indent: 20 });
    doc.moveDown(0.5);
  }

  private renderCodeBlock(doc: PDFKit.PDFDocument, code: string, _language?: string): void {
    doc
      .fontSize(FONT_SIZES.code)
      .fillColor(COLORS.code)
      .font("Courier")
      .text(stripEmoji(code), { indent: 10 })
      .font("Helvetica");
    doc.moveDown(0.5);
  }

  private renderDivider(doc: PDFKit.PDFDocument): void {
    doc.moveDown(0.5);
    const y = doc.y;
    doc.strokeColor(COLORS.muted).lineWidth(0.5).moveTo(50, y).lineTo(545, y).stroke();
    doc.moveDown(0.5);
  }

  private renderCallout(doc: PDFKit.PDFDocument, segments: TextSegment[], _emoji?: string): void {
    const text = stripEmoji(segments.map((s) => s.text).join(""));
    const prefix = "[!] ";
    doc.fontSize(FONT_SIZES.body).fillColor(COLORS.text).text(`${prefix}${text}`, { indent: 10 });
    doc.moveDown(0.5);
  }

  private renderTable(
    doc: PDFKit.PDFDocument,
    headers: { segments: TextSegment[] }[] | undefined,
    rows: { segments: TextSegment[] }[][],
  ): void {
    const allRows = [...(headers ? [headers] : []), ...rows];
    if (allRows.length === 0) return;

    const colCount = Math.max(...allRows.map((r) => r.length));
    const marginLeft = doc.page?.margins.left ?? 50;
    const marginRight = doc.page?.margins.right ?? 50;
    const pageWidth = (doc.page?.width ?? 595) - marginLeft - marginRight;
    const cellPadding = 6;
    // Fordel kolonnene jevnt og bruk eksakt bredde (ikke floor) slik at
    // siste kolonne ikke kollapser til 2–3 tegn pga. avrundingsfeil.
    const colWidth = pageWidth / colCount;
    const rowHeight = 24;
    const startX = marginLeft;

    doc.fontSize(FONT_SIZES.body - 1);

    for (let r = 0; r < allRows.length; r++) {
      const row = allRows[r];
      const isHeader = headers && r === 0;
      const y = doc.y;

      // Beregn radhøyde basert på innhold
      let maxCellHeight = rowHeight;
      const cellTexts = Array.from({ length: colCount }, (_, c) =>
        c < row.length ? stripEmoji(row[c].segments.map((s) => s.text).join("")) : "",
      );
      // Sett font/størrelse FØR høydeberegning slik at heightOfString
      // bruker samme metrikk som faktisk rendering.
      doc.fontSize(FONT_SIZES.body - 1).font(isHeader ? "Helvetica-Bold" : "Helvetica");
      for (const text of cellTexts) {
        const h =
          doc.heightOfString(text, {
            width: colWidth - cellPadding * 2,
            lineBreak: true,
          }) +
          cellPadding * 2;
        if (h > maxCellHeight) maxCellHeight = h;
      }

      // Ny side hvis det ikke er plass
      if (y + maxCellHeight > (doc.page?.height ?? 842) - 60) {
        doc.addPage();
      }

      const cellY = doc.y;

      // Bakgrunnsfarge for header
      if (isHeader) {
        doc.rect(startX, cellY, pageWidth, maxCellHeight).fill("#E2E8F0");
      } else if (r % 2 === 0) {
        doc.rect(startX, cellY, pageWidth, maxCellHeight).fill("#F8FAFC");
      }

      // Celleinnhold
      for (let c = 0; c < colCount; c++) {
        const cellX = startX + c * colWidth;
        const text = cellTexts[c];

        doc.fillColor(COLORS.text);
        if (isHeader) doc.font("Helvetica-Bold");
        else doc.font("Helvetica");

        doc.text(text, cellX + cellPadding, cellY + cellPadding, {
          width: colWidth - cellPadding * 2,
          height: maxCellHeight - cellPadding * 2,
          lineBreak: true,
        });
      }

      // Vertikale linjer for kolonner og horisontal linje under raden
      doc.strokeColor("#CBD5E1").lineWidth(0.5);
      for (let c = 0; c <= colCount; c++) {
        const x = startX + c * colWidth;
        doc
          .moveTo(x, cellY)
          .lineTo(x, cellY + maxCellHeight)
          .stroke();
      }
      doc
        .moveTo(startX, cellY + maxCellHeight)
        .lineTo(startX + pageWidth, cellY + maxCellHeight)
        .stroke();
      if (r === 0) {
        // Topplinje på første rad
        doc
          .moveTo(startX, cellY)
          .lineTo(startX + pageWidth, cellY)
          .stroke();
      }

      // Flytt doc.y manuelt fordi vi bruker absolutt posisjonering
      doc.y = cellY + maxCellHeight;
    }

    // Reset doc.x til venstre marg slik at neste blokk (overskrift,
    // avsnitt) ikke fortsetter inne i siste kolonne og wrappes smalt.
    doc.x = startX;
    doc.y += 4; // Litt luft etter tabell
    doc.moveDown(0.3);
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
