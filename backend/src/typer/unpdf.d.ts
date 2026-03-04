/**
 * Typedeklarasjoner for unpdf-funksjoner som TypeScript ikke kan resolve
 * fra .d.mts med moduleResolution: "NodeNext" (manglende filendelser i interne imports).
 *
 * Disse funksjonene eksisterer i unpdf runtime og er verifisert manuelt.
 * @see https://github.com/unjs/unpdf
 */
declare module "unpdf" {
    /** PDFDocumentProxy returnert av getDocumentProxy */
    interface PDFDocumentProxy {
        numPages: number;
        cleanup: () => void;
    }

    /**
     * Returnerer en PDFDocumentProxy fra binærdata.
     * Brukes for å hente sideantall og gjenbruke proxy for rendering.
     */
    export function getDocumentProxy(
        data: Uint8Array | ArrayBuffer,
        options?: Record<string, unknown>,
    ): Promise<PDFDocumentProxy>;

    /**
     * Rasteriserer en PDF-side til et PNG-bilde (ArrayBuffer).
     * I Node.js må canvasImport alltid oppgis, f.eks:
     *   canvasImport: () => import("@napi-rs/canvas")
     */
    export function renderPageAsImage(
        data: Uint8Array | ArrayBuffer | PDFDocumentProxy,
        pageNumber: number,
        options?: {
            /** Påkrevd i Node.js. Dynamisk import av canvas-implementasjon. */
            canvasImport?: () => Promise<unknown>;
            /** @default 1.0 */
            scale?: number;
            width?: number;
            height?: number;
        },
    ): Promise<ArrayBuffer>;
}
