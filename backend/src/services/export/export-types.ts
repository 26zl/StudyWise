/**
 * Interne typer for eksportpipeline.
 * Re-eksporterer felles typer fra common og definerer provider-grensesnitt.
 */

import type {
  ExportDocument,
  ExportTarget,
  ExportResponse,
  ExportProviderOptions,
} from "common/export";

export type RuntimeProviderOptions = Omit<ExportProviderOptions, "notion"> & {
  notion?: {
    parentPageId?: string;
    /** Runtime-injisert Notion API-nøkkel fra brukerinnstillinger. */
    apiKey?: string;
    /** Runtime-injisert default parent page id fra brukerinnstillinger. */
    defaultPageId?: string;
  };
};

/** Resultat fra en provider som genererer fil-innhold */
export interface ExportProviderResult {
  content: string;
  mimeType: string;
  filename: string;
  /** Indikerer at content er base64-kodet binærdata (for PDF/Word) */
  isBase64?: boolean;
}

/** Felles grensesnitt for alle eksport-providers */
export interface ExportProvider {
  readonly target: ExportTarget;

  /**
   * Sjekker om provideren er konfigurert og klar til bruk.
   * For serialiserbare providers returnerer denne alltid true.
   * For eksterne providers sjekker den at nødvendige credentials finnes.
   */
  isConfigured(): boolean;

  /**
   * Eksporterer dokumentet til målformatet.
   * Kaster feil hvis provideren ikke er konfigurert.
   */
  execute(
    doc: ExportDocument,
    options?: RuntimeProviderOptions,
  ): Promise<ExportResponse>;
}
