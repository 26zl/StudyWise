/**
 * Hjelpere for å lese Notion page IDs fra enten rå ID eller full Notion-URL.
 */

/**
 * Returnerer normalisert Notion page ID (32 hex uten bindestrek), eller null ved ugyldig input.
 */
export function normalizeNotionPageId(raw: string): string | null {
  const value = raw.trim();
  if (!value) return null;

  // Direkte page-id med/uten bindestrek
  const directMatch = value.match(
    /^([0-9a-fA-F]{32}|[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})$/,
  );
  if (directMatch) {
    return directMatch[1].replace(/-/g, "").toLowerCase();
  }

  // Full Notion-lenke (slug-pageid, /{pageid}, querystrings, etc.)
  const urlMatch = value.match(
    /[0-9a-fA-F]{32}|[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/,
  );
  if (urlMatch?.[0]) {
    return urlMatch[0].replace(/-/g, "").toLowerCase();
  }

  return null;
}
