import type { ChatMessage } from "common/chat";

// Denne funksjonen eksporterer en samtale til Markdown-format, som kan åpnes i tekstredigerere eller vises på plattformer som støtter Markdown. 
// Den inkluderer dato, tid, roller (bruker og KI-assistent), og innholdet i meldingene.
// Meldinger må ha en tidsstempel for å kunne vises i eksporten, så vi utvider ChatMessage med en tidsstempel.
interface EksporterbarMelding extends ChatMessage {
  tidsstempel: Date;
}
// Eksportering 
export function exportToMarkdown(meldinger: EksporterbarMelding[], tittel?: string): void {
  let markdown = "#💬 Samtale med StudyWise KI-Assistent\n\n";
  // Legg til dato og tid for eksporten
  markdown += `**Dato:** ${new Date().toLocaleDateString("no-NO", {
    day: "numeric",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  })}\n\n`;
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
    const tid = m.tidsstempel.toLocaleTimeString("no-NO", {
      hour: "2-digit",
      minute: "2-digit",
    });
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
// Opprett en Blob med Markdown-innholdet og last ned filen
  const blob = new Blob([markdown], { type: "text/markdown;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
// Bruk dagens dato i filnavnet for å gjøre det unikt og lett å identifisere
  const timestamp = new Date().toISOString().slice(0, 10);
  link.download = `studywise-samtale-${timestamp}.md`;
// Legg til lenken i dokumentet, klikk for å starte nedlastingen, og fjern deretter lenken
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}