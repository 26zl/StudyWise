declare module "unpdf" {
  export function extractText(
    data: Uint8Array,
    options?: { mergePages?: boolean }
  ): Promise<{ text: string; totalPages?: number }>;
}

declare module "mammoth" {
  export interface MammothResult {
    value: string;
    messages: unknown[];
  }
  export function extractRawText(input: { buffer: Buffer }): Promise<MammothResult>;
  const mammothDefault: { extractRawText: typeof extractRawText };
  export default mammothDefault;
}

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
