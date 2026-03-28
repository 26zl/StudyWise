import type { ChatMessage } from "common/chat";

export type ConversationDisplayMessage = Pick<ChatMessage, "rolle" | "innhold"> & {
  vedleggNavn?: string[];
};

const VEDLEGG_PATTERN = /\n?\n?\[Vedlagt:\s*(.+?)\]\s*$/;
const DOKUMENT_METADATA_PATTERN = /\n+\s*---\s*_?(?:Dokument|Document):[\s\S]*$/i;
const MARKDOWN_LINK_PATTERN = /\[([^\]]+)\]\((?:https?:\/\/[^\s)]+)\)/g;
const URL_PATTERN = /https?:\/\/\S+/g;
const MARKDOWN_HEADING_PATTERN = /(^|\s)#{1,6}\s*/gm;
const MARKDOWN_FORMATTING_PATTERN = /[*`~]/g;
const WHITESPACE_PATTERN = /\s+/g;
const MAX_FORHANDSVISNING_LENGDE = 220;

export function parseVedlegg(innhold: string): { tekst: string; filer: string[] } {
  const vedleggMatch = innhold.match(VEDLEGG_PATTERN);
  if (!vedleggMatch) return { tekst: innhold, filer: [] };
  const tekst = innhold.slice(0, vedleggMatch.index).trim();
  const filnavn = vedleggMatch[1]
    .split(",")
    .map((del) => del.trim())
    .filter(Boolean);
  return { tekst, filer: filnavn };
}

export function erBildefil(navn: string): boolean {
  return /\.(jpg|jpeg|png|gif|webp|svg|bmp)$/i.test(navn);
}

export function hentSamtaleinnhold(
  melding: ConversationDisplayMessage,
): { tekst: string; filer: string[] } {
  if (melding.vedleggNavn && melding.vedleggNavn.length > 0) {
    return { tekst: melding.innhold, filer: melding.vedleggNavn };
  }

  return parseVedlegg(melding.innhold);
}

function kortNedTekst(tekst: string, maksLengde: number): string {
  if (tekst.length <= maksLengde) return tekst;
  const kuttet = tekst.slice(0, maksLengde);
  const sisteMellomrom = kuttet.lastIndexOf(" ");
  const base = sisteMellomrom > maksLengde * 0.6 ? kuttet.slice(0, sisteMellomrom) : kuttet;
  return `${base.trimEnd()}...`;
}

function rensMarkdownTilForhandsvisning(tekst: string): string {
  return tekst
    .replace(DOKUMENT_METADATA_PATTERN, "")
    .replace(/^Fra Canvas-dataene dine:\s*/i, "")
    .replace(MARKDOWN_LINK_PATTERN, "$1")
    .replace(URL_PATTERN, "")
    .replace(MARKDOWN_HEADING_PATTERN, "$1")
    .replace(MARKDOWN_FORMATTING_PATTERN, "")
    .replace(WHITESPACE_PATTERN, " ")
    .trim();
}

export function lagSamtaleForhandsvisning(
  meldinger: Pick<ChatMessage, "rolle" | "innhold">[],
  fallback = "",
): string {
  const sisteMelding = [...meldinger].reverse().find((melding) => melding.innhold.trim().length > 0);
  if (!sisteMelding) return fallback;

  const { tekst } = hentSamtaleinnhold(sisteMelding);
  const rensetTekst = rensMarkdownTilForhandsvisning(tekst);

  if (!rensetTekst) return fallback;

  return kortNedTekst(rensetTekst, MAX_FORHANDSVISNING_LENGDE);
}
