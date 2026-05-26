/**
 * Excel Export Provider
 * Konverterer internt dokumentformat til XLSX via exceljs.
 * Optimalisert for tabelldata — tabeller rendres som ekte Excel-tabeller
 * med autobredde, filtre og formatering.
 */

import ExcelJS from "exceljs";
import type { ExportProvider, ExportProviderResult } from "../export-types.js";
import type {
  ExportDocument,
  ExportBlock,
  TextSegment,
  ListItem,
  ExportResponse,
} from "common/export";

const COLORS = {
  heading: "0F172A",
  muted: "64748B",
  codeBg: "F1F5F9",
  headerBg: "E2E8F0",
  calloutBg: "FEF3C7",
  divider: "CBD5E1",
  tableBorder: "CBD5E1",
};

export class ExcelExportProvider implements ExportProvider {
  readonly target = "excel" as const;
  readonly mimeType = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

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
    const workbook = new ExcelJS.Workbook();
    workbook.creator = "StudyWise";
    workbook.created = new Date();

    // Finn alle tabellblokker og ikke-tabellblokker
    const tables = document.blocks.filter((b) => b.type === "table");
    const hasNonTableContent = document.blocks.some((b) => b.type !== "table");

    // Hoveddark med alt innhold
    if (hasNonTableContent || tables.length === 0) {
      const sheet = workbook.addWorksheet(this.sanitizeSheetName(document.title).slice(0, 31));

      // Tittel
      const titleRow = sheet.addRow([document.title]);
      titleRow.font = { size: 16, bold: true, color: { argb: COLORS.heading } };
      titleRow.height = 28;

      if (document.metadata) {
        const metaRow = sheet.addRow([
          `Generert av StudyWise - ${new Date().toLocaleDateString("nb-NO")}`,
        ]);
        metaRow.font = { size: 10, italic: true, color: { argb: COLORS.muted } };
      }
      sheet.addRow([]);

      for (const block of document.blocks) {
        this.renderBlock(sheet, block);
      }

      // Autobredde for kolonne A (tekstinnhold)
      this.autoFitColumns(sheet);
    }

    // Separate ark for hver tabell (for enkel kopiering/filtrering)
    if (tables.length > 0) {
      tables.forEach((block, idx) => {
        if (block.type !== "table") return;
        const sheetName = this.getTableSheetName(block, idx, tables.length);
        const tableSheet = workbook.addWorksheet(sheetName);
        this.renderTableSheet(tableSheet, block.headers, block.rows);
        this.autoFitColumns(tableSheet);
      });
    }

    const buffer = await workbook.xlsx.writeBuffer();
    const base64 = Buffer.from(buffer).toString("base64");

    return {
      content: base64,
      mimeType: this.mimeType,
      filename: this.generateFilename(document.title),
      isBase64: true,
    };
  }

  /** Oppretter et dedikert tabellark med autofilter og riktig formatering */
  private renderTableSheet(
    sheet: ExcelJS.Worksheet,
    headers: { segments: TextSegment[] }[] | undefined,
    rows: { segments: TextSegment[] }[][],
  ): void {
    const colCount = Math.max(headers?.length ?? 0, ...rows.map((r) => r.length));

    if (headers && headers.length > 0) {
      const headerTexts = headers.map((h) => this.segmentsToText(h.segments));
      const headerRow = sheet.addRow(headerTexts);
      headerRow.font = { size: 11, bold: true, color: { argb: "FFFFFF" } };
      headerRow.height = 22;
      headerRow.eachCell((cell) => {
        cell.fill = {
          type: "pattern",
          pattern: "solid",
          fgColor: { argb: "334155" },
        };
        cell.border = {
          bottom: { style: "medium", color: { argb: COLORS.tableBorder } },
        };
        cell.alignment = { vertical: "middle", wrapText: true };
      });

      // Autofilter på header-raden
      sheet.autoFilter = {
        from: { row: 1, column: 1 },
        to: { row: 1, column: colCount },
      };
    }

    for (const [rowIdx, row] of rows.entries()) {
      const cellTexts = row.map((cell) => this.segmentsToText(cell.segments));
      const dataRow = sheet.addRow(cellTexts);
      dataRow.font = { size: 11 };
      const isEven = rowIdx % 2 === 0;
      dataRow.eachCell((cell) => {
        if (isEven) {
          cell.fill = {
            type: "pattern",
            pattern: "solid",
            fgColor: { argb: "F8FAFC" },
          };
        }
        cell.border = {
          bottom: { style: "hair", color: { argb: COLORS.tableBorder } },
        };
        cell.alignment = { vertical: "top", wrapText: true };
      });
    }
  }

  private renderBlock(sheet: ExcelJS.Worksheet, block: ExportBlock): void {
    switch (block.type) {
      case "heading":
        this.renderHeading(sheet, block.level, block.segments);
        break;
      case "paragraph":
        this.renderParagraph(sheet, block.segments);
        break;
      case "bullet_list":
        this.renderList(sheet, block.items, "bullet");
        break;
      case "numbered_list":
        this.renderList(sheet, block.items, "numbered");
        break;
      case "checklist":
        this.renderChecklist(sheet, block.items);
        break;
      case "quote":
        this.renderQuote(sheet, block.segments);
        break;
      case "code_block":
        this.renderCodeBlock(sheet, block.code);
        break;
      case "divider":
        sheet.addRow([]);
        break;
      case "callout":
        this.renderCallout(sheet, block.segments, block.emoji);
        break;
      case "table":
        this.renderInlineTable(sheet, block.headers, block.rows);
        break;
    }
  }

  private renderHeading(sheet: ExcelJS.Worksheet, level: 1 | 2 | 3, segments: TextSegment[]): void {
    const text = this.segmentsToText(segments);
    const row = sheet.addRow([text]);
    const fontSize = level === 1 ? 14 : level === 2 ? 12 : 11;
    row.font = { size: fontSize, bold: true, color: { argb: COLORS.heading } };
  }

  private renderParagraph(sheet: ExcelJS.Worksheet, segments: TextSegment[]): void {
    const text = this.segmentsToText(segments);
    if (!text.trim()) return;
    const row = sheet.addRow([text]);
    row.font = { size: 11 };
    row.alignment = { wrapText: true };
  }

  private renderList(
    sheet: ExcelJS.Worksheet,
    items: ListItem[],
    type: "bullet" | "numbered",
  ): void {
    items.forEach((item, index) => {
      const prefix = type === "bullet" ? "  - " : `  ${index + 1}. `;
      const text = prefix + this.segmentsToText(item.segments);
      const row = sheet.addRow([text]);
      row.font = { size: 11 };
    });
  }

  private renderChecklist(sheet: ExcelJS.Worksheet, items: ListItem[]): void {
    for (const item of items) {
      const check = item.checked ? "[x]" : "[ ]";
      const row = sheet.addRow([`  ${check} ${this.segmentsToText(item.segments)}`]);
      row.font = { size: 11 };
    }
  }

  private renderQuote(sheet: ExcelJS.Worksheet, segments: TextSegment[]): void {
    const row = sheet.addRow([`"${this.segmentsToText(segments)}"`]);
    row.font = { size: 11, italic: true, color: { argb: COLORS.muted } };
  }

  private renderCodeBlock(sheet: ExcelJS.Worksheet, code: string): void {
    const row = sheet.addRow([code]);
    row.font = { size: 10, name: "Courier New" };
    const cell = row.getCell(1);
    cell.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: COLORS.codeBg },
    };
    row.alignment = { wrapText: true };
  }

  private renderCallout(sheet: ExcelJS.Worksheet, segments: TextSegment[], emoji?: string): void {
    const prefix = emoji ? `${emoji} ` : "[!] ";
    const row = sheet.addRow([prefix + this.segmentsToText(segments)]);
    row.font = { size: 11 };
    const cell = row.getCell(1);
    cell.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: COLORS.calloutBg },
    };
  }

  /** Rendrer tabell inline i hovedarket */
  private renderInlineTable(
    sheet: ExcelJS.Worksheet,
    headers: { segments: TextSegment[] }[] | undefined,
    rows: { segments: TextSegment[] }[][],
  ): void {
    if (headers && headers.length > 0) {
      const headerTexts = headers.map((h) => this.segmentsToText(h.segments));
      const headerRow = sheet.addRow(headerTexts);
      headerRow.font = { size: 11, bold: true };
      headerRow.eachCell((cell) => {
        cell.fill = {
          type: "pattern",
          pattern: "solid",
          fgColor: { argb: COLORS.headerBg },
        };
        cell.border = { bottom: { style: "thin" } };
      });
    }

    for (const row of rows) {
      const cellTexts = row.map((cell) => this.segmentsToText(cell.segments));
      const dataRow = sheet.addRow(cellTexts);
      dataRow.font = { size: 11 };
      dataRow.eachCell((cell) => {
        cell.border = { bottom: { style: "hair" } };
      });
    }

    sheet.addRow([]);
  }

  /** Beregn og sett kolonnebredder basert på innhold */
  private autoFitColumns(sheet: ExcelJS.Worksheet): void {
    sheet.columns.forEach((column) => {
      let maxLength = 10;
      column.eachCell?.({ includeEmpty: false }, (cell) => {
        const cellValue = cell.value?.toString() ?? "";
        const length = Math.min(cellValue.length + 2, 60);
        if (length > maxLength) maxLength = length;
      });
      column.width = maxLength;
    });
  }

  /** Saniterer streng for bruk som Excel-arknavn (fjerner ugyldige tegn, sikrer ikke-tomt) */
  private sanitizeSheetName(name: string): string {
    // ExcelJS kaster på: / \ * ? [ ] og tomme navn
    return (
      name
        .replace(/[/\\*?[\]:]/g, " ")
        .replace(/\s+/g, " ")
        .trim() || "Ark"
    );
  }

  /** Generer arknavn for tabellark */
  private getTableSheetName(
    block: ExportBlock & { type: "table" },
    index: number,
    totalTables: number,
  ): string {
    // Bruk header-tekst som arknavn om mulig
    if (block.headers && block.headers.length > 0) {
      const firstHeader = this.segmentsToText(block.headers[0].segments);
      if (firstHeader.trim()) {
        const name = this.sanitizeSheetName(firstHeader).slice(0, 28);
        return totalTables > 1 ? `${name} (${index + 1})` : name;
      }
    }
    return totalTables > 1 ? `Tabell ${index + 1}` : "Tabell";
  }

  private segmentsToText(segments: TextSegment[]): string {
    return segments.map((s) => s.text).join("");
  }

  private generateFilename(title: string): string {
    const slug = title
      .toLowerCase()
      .replace(/[^a-z0-9æøå]+/gi, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 50);
    const date = new Date().toISOString().slice(0, 10);
    return `${slug || "studywise-eksport"}-${date}.xlsx`;
  }
}
