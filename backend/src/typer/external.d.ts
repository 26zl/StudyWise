/*
* Type definisjoner for eksterne biblioteker uten egne typer
*/


// Typings for unpdf
declare module "unpdf" {
  export function extractText(
    data: Uint8Array,
    options?: { mergePages?: boolean }
  ): Promise<{ text: string; totalPages?: number }>;
}

// Typings for mammoth
declare module "mammoth" {
  export interface MammothResult {
    value: string;
    messages: unknown[];
  }

  export interface MammothImageElement {
    read(encoding: "base64"): Promise<string>;
    read(encoding: "buffer"): Promise<Buffer>;
    read(encoding: string): Promise<string | Buffer>;
    contentType: string;
    altText?: string;
  }

  export type ImageConverter = (
    element: MammothImageElement,
    messages: unknown[],
  ) => Promise<{ src: string }> | { src: string };

  export interface MammothImages {
    inline(handler: (element: MammothImageElement) => Promise<{ src: string }> | { src: string }): ImageConverter;
    imgElement(handler: (element: MammothImageElement) => Promise<{ src: string }> | { src: string }): ImageConverter;
    dataUri: ImageConverter;
  }

  export interface ConvertOptions {
    convertImage?: ImageConverter;
    styleMap?: string | string[];
  }

  export function extractRawText(input: { buffer: Buffer }): Promise<MammothResult>;
  export function convertToHtml(input: { buffer: Buffer }, options?: ConvertOptions): Promise<MammothResult>;

  export const images: MammothImages;

  const mammothDefault: {
    extractRawText: typeof extractRawText;
    convertToHtml: typeof convertToHtml;
    images: MammothImages;
  };
  export default mammothDefault;
}
// Typings for tesseract.js
declare module "tesseract.js" {
  interface RecognizeResult {
    data: { text: string; confidence: number };
  }
  interface LoggerInfo {
    status?: string;
    progress?: number;
  }
  export function recognize(
    image: Buffer | string,
    langs: string,
    options?: { logger?: (info: LoggerInfo) => void }
  ): Promise<RecognizeResult>;
  const tesseractDefault: { recognize: typeof recognize };
  export default tesseractDefault;
}
