/*
* Type definisjoner for pdf-parse biblioteket
*/

declare module "pdf-parse" {
  export interface PdfParseOptions {
    pagerender?: (page: unknown) => string | Promise<string>;
    max?: number;
    version?: string;
  }

  export interface PdfParseResult {
    text: string;
    numpages?: number;
    numrender?: number;
    info?: unknown;
    metadata?: unknown;
    version?: string;
    pages?: string[];
  }

  const pdfParse: (data: Buffer | Uint8Array, options?: PdfParseOptions) => Promise<PdfParseResult>;
  export default pdfParse;
}
