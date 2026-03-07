/**
 * Typedeklarasjoner for unpdf (samlet her; tidligere også i external.d.ts).
 * @see https://github.com/unjs/unpdf
 */
declare module "unpdf" {
    /** PDFDocumentProxy returnert av getDocumentProxy */
    interface PDFDocumentProxy {
        numPages: number;
        cleanup: () => void;
    }

    export function extractText(
        data: Uint8Array,
        options?: { mergePages?: boolean },
    ): Promise<{ text: string; totalPages?: number }>;

    export function getDocumentProxy(
        data: Uint8Array | ArrayBuffer,
        options?: Record<string, unknown>,
    ): Promise<PDFDocumentProxy>;

    export function renderPageAsImage(
        data: Uint8Array | ArrayBuffer | PDFDocumentProxy,
        pageNumber: number,
        options?: {
            canvasImport?: () => Promise<unknown>;
            scale?: number;
            width?: number;
            height?: number;
        },
    ): Promise<ArrayBuffer>;
}
