/*
 * HTML-verktøy for tekstutvinning
 * Stripping av HTML-tagger for ren tekst
 */

/** Fjerner HTML-tagger og dekoder vanlige HTML-entiteter */
export const stripHtml = (html: string, options?: { removeStyles?: boolean }): string => {
  let cleaned = html;

  // Fjern <link rel="stylesheet"> og <style> tags hvis ønsket
  if (options?.removeStyles) {
    cleaned = cleaned.replace(/<link[^>]*rel=["']stylesheet["'][^>]*>/gi, "");
    cleaned = cleaned.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "");
  }

  return cleaned
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
};
