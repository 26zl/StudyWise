import type { ChatMessage } from "common/chat";
import { formaterDatoOgTid, formaterKlokkeslett } from "../lib/dato";

// Denne funksjonen eksporterer en samtale til Markdown-format, som kan åpnes i tekstredigerere eller vises på plattformer som støtter Markdown. 
// Den inkluderer dato, tid, roller (bruker og KI-assistent), og innholdet i meldingene.
// Meldinger må ha en tidsstempel for å kunne vises i eksporten, så vi utvider ChatMessage med en tidsstempel.
interface EksporterbarMelding extends ChatMessage {
  tidsstempel: Date;
}

function lastNedMarkdown(markdown: string, filnavnBase: string): void {
  const blob = new Blob([markdown], { type: "text/markdown;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  const timestamp = new Date().toISOString().slice(0, 10);
  link.download = `${filnavnBase}-${timestamp}.md`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

// Eksportering 
export function exportToMarkdown(
  meldinger: EksporterbarMelding[],
  tittel?: string,
  filnavnBase = "studywise-samtale",
): void {
  let markdown = "#💬 Samtale med StudyWise KI-Assistent\n\n";
  // Legg til dato og tid for eksporten
  markdown += `**Dato:** ${formaterDatoOgTid(new Date())}\n\n`;
// Legg til tittel hvis den finnes
  if (tittel) {
    markdown += `**Tittel:** ${tittel}\n\n`;
  }
// Legg til antall meldinger
  markdown += `**Antall meldinger:** ${meldinger.length}\n\n`;
  markdown += "---\n\n";
// Legg til hver melding i Markdown-format
  meldinger.forEach((m, index) => {
    const rolle = m.rolle === "user" ? "**Deg**" : "🤖 **KI-Assistent**";
    const tid = formaterKlokkeslett(m.tidsstempel);
    // Legg til meldingens rolle, tid og innhold
    markdown += `### ${rolle} _(${tid})_\n\n`;
    markdown += `${m.innhold}\n\n`;
    // Legg til en horisontal linje mellom meldinger, unntatt etter den siste meldingen
    if (index < meldinger.length - 1) {
      markdown += "---\n\n";
    }
  });
// Legg til en avsluttende linje som indikerer at eksporten er generert av StudyWise
  markdown += "\n\n*Generert av StudyWise*\n";
  lastNedMarkdown(markdown, filnavnBase);
}

