/*
 * HTML-verktøy for tekstutvinning
 * Strippping av HTML-tagger for ren tekst
 */

/** Fjerner HTML-tagger og dekoder vanlige HTML-entiteter */
export const stripHtml = (html: string): string => {
  return html
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
