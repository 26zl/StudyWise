/**
 * Sentral eksport-service.
 *
 * Tar inn kildeinnhold (Markdown-tekst), bygger internt eksportdokument,
 * velger provider basert på target og returnerer resultatet.
 */

import type { ExportTarget, ExportResponse, ExportDocument } from "common/export";
import { EXPORT_TARGETS } from "common/export";
import type {
  ExportProvider,
  RuntimeProviderOptions,
} from "./export-types.js";
import { buildExportDocument } from "./export-builder.js";
import { markdownProvider } from "./providers/markdown.provider.js";
import { PdfExportProvider } from "./providers/pdf.provider.js";
import { textProvider } from "./providers/text.provider.js";
import { WordExportProvider } from "./providers/word.provider.js";
import { ExcelExportProvider } from "./providers/excel.provider.js";
import { notionProvider } from "./providers/notion.provider.js";
import { logger } from "../../utils/logger.js";

// --- Provider-register ---

const providerMap = new Map<ExportTarget, ExportProvider>();

function registerProvider(provider: ExportProvider): void {
  providerMap.set(provider.target, provider);
}

// Registrer alle innebygde providers
registerProvider(markdownProvider);
registerProvider(new PdfExportProvider());
registerProvider(textProvider);
registerProvider(new WordExportProvider());
registerProvider(new ExcelExportProvider());
registerProvider(notionProvider);

/** Returner liste over alle registrerte mål med konfigurasjonsstatus. */
export function getAvailableTargets(): Array<{
  target: ExportTarget;
  configured: boolean;
}> {
  return EXPORT_TARGETS.map((target) => {
    const provider = providerMap.get(target);
    return {
      target,
      configured: provider?.isConfigured() ?? false,
    };
  });
}

/** Eksport-parametere */
export interface ExportParams {
  target: ExportTarget;
  title: string;
  content: string;
  metadata?: Record<string, unknown>;
  options?: RuntimeProviderOptions;
}

/**
 * Utfør eksport: bygg dokument → velg provider → eksporter.
 *
 * Kaster feil hvis:
 * - Ukjent target
 * - Provider ikke konfigurert (manglende credentials)
 * - Provider-spesifikk feil (API-feil fra Notion/Google)
 */
export async function executeExport(params: ExportParams): Promise<ExportResponse> {
  const { target, title, content, metadata, options } = params;

  const provider = providerMap.get(target);
  if (!provider) {
    throw new Error(`Ukjent eksportmål: ${target}`);
  }

  if (!provider.isConfigured()) {
    throw new Error(
      `Eksport til ${target} er ikke konfigurert. Sjekk at nødvendige miljøvariabler er satt.`,
    );
  }

  // Bygg internt dokument fra Markdown-innhold
  const doc: ExportDocument = buildExportDocument(title, content, metadata);

  logger.info(
    { target, blockCount: doc.blocks.length },
    "Starter eksport",
  );

  const result = await provider.execute(doc, options);

  logger.info(
    { target, kind: result.kind },
    "Eksport fullført",
  );

  return result;
}
