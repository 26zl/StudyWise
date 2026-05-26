/**
 * Helpers for å vise og eksportere chat-kilder (KIChatSource).
 *
 * Brukes av:
 *   - ChatSection kopi-knapp (lim inn KI-svar i ekstern app)
 *   - ChatExportModal (inkluder kilder i eksportert dokument)
 *   - SharePage (vis kilder under hver melding i delt visning)
 *
 * Sentralisering unngår at tre ulike steder filtrerer/formaterer kilder ulikt —
 * brukeren skal se den samme kildelista uansett kanal.
 */
import type { KIChatSource } from "common/ki";

/**
 * Verifiserer at en URL trygt kan åpnes eller rendres som en anker-lenke —
 * bare http(s) tillates. Zod `z.url()` godtar også `javascript:`, `data:`,
 * `file:` m.fl., så vi filtrerer eksplisitt på klient-siden for å hindre
 * XSS via kompromitterte source-URLer (særlig viktig for offentlige
 * share-sider der kildene vises til uautentiserte brukere).
 */
export function isSafeExternalUrl(url: string | null | undefined): boolean {
  if (!url) return false;
  try {
    const parsed = new URL(url);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

/** Pretty-printer URL-encodet filnavn (Canvas bruker %-koding og +). */
export function visFilnavn(fileName: string | null | undefined): string {
  if (!fileName) return "";
  try {
    return decodeURIComponent(fileName.replace(/\+/g, " "));
  } catch {
    return fileName;
  }
}

/**
 * Filtrerer bort kilder uten klikkbar referanse og dedupliserer. Matcher
 * chat-UIets logikk (ChatSection.hentVisbareKilder) så brukeren ser nøyaktig
 * samme kilder ved kopi/eksport/deling som i panelet.
 */
export function visbareKilder(kilder: KIChatSource[] | undefined): KIChatSource[] {
  if (!kilder || kilder.length === 0) return [];
  const seen = new Set<string>();
  const filtered: KIChatSource[] = [];
  for (const kilde of kilder) {
    const hasCanvasFile = Number.isFinite(kilde.fileId);
    const hasUrl = typeof kilde.sourceUrl === "string" && kilde.sourceUrl.length > 0;
    const hasKbFile =
      kilde.sourceKind === "kb_file" &&
      typeof kilde.baseId === "string" &&
      typeof kilde.sourceId === "string";
    if (!hasCanvasFile && !hasUrl && !hasKbFile) continue;
    const key = `${kilde.sourceKind ?? "canvas_file"}:${kilde.courseId}:${kilde.fileId ?? "na"}:${kilde.fileName}:${kilde.sourceUrl ?? ""}:${kilde.sourceId ?? ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    filtered.push(kilde);
  }
  return filtered;
}

/**
 * Formaterer kilder som en markdown-snippet.
 * Returnerer tom streng hvis det ikke er noen klikkbare kilder.
 */
export function formatKilderAsMarkdown(
  kilder: KIChatSource[] | undefined,
  heading: string = "Kilder",
): string {
  const unique = visbareKilder(kilder);
  if (unique.length === 0) return "";
  const lines = unique.map((k) => {
    // Bruk kun sourceUrl som fallback-navn hvis den er trygg (http/https).
    // Ellers kan `javascript:`/`data:` slippe gjennom z.url() og havne i
    // kopiert/eksportert markdown der rendereren kan lenke dem ut.
    const urlErTrygg = isSafeExternalUrl(k.sourceUrl);
    const fallbackNavn = urlErTrygg ? k.sourceUrl : undefined;
    const navn = visFilnavn(k.fileName) || fallbackNavn || "(ukjent kilde)";
    const kurs = k.courseName ? ` — ${k.courseName}` : "";
    if (urlErTrygg) {
      return `- [${navn}](${k.sourceUrl})${kurs}`;
    }
    return `- ${navn}${kurs}`;
  });
  return `**${heading}:**\n${lines.join("\n")}`;
}

/**
 * Legger til en "---" + kildeseksjon nederst i en markdown-melding.
 * Returnerer originalteksten uendret hvis meldingen ikke har kilder.
 */
export function appendKilderToMarkdown(
  innhold: string,
  kilder: KIChatSource[] | undefined,
  heading: string = "Kilder",
): string {
  const kildeMarkdown = formatKilderAsMarkdown(kilder, heading);
  if (!kildeMarkdown) return innhold;
  return `${innhold}\n\n---\n\n${kildeMarkdown}`;
}
