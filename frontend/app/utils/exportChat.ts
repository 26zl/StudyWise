interface Message {
  rolle: "user" | "assistant";
  innhold: string;
  tidsstempel: Date;
}

export function exportToMarkdown(messages: Message[], title?: string): void {
  let markdown = "# 💬 Samtale med StudyWise KI-Assistent\n\n";
  
  markdown += `**Dato:** ${new Date().toLocaleDateString("no-NO", {
    day: "numeric",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  })}\n\n`;

  if (title) {
    markdown += `**Tittel:** ${title}\n\n`;
  }

  markdown += `**Antall meldinger:** ${messages.length}\n\n`;
  markdown += "---\n\n";

  messages.forEach((m, index) => {
    const role = m.rolle === "user" ? "👤 **Deg**" : "🤖 **AI-Assistent**";
    const time = m.tidsstempel.toLocaleTimeString("no-NO", {
      hour: "2-digit",
      minute: "2-digit",
    });

    markdown += `### ${role} _(${time})_\n\n`;
    markdown += `${m.innhold}\n\n`;

    if (index < messages.length - 1) {
      markdown += "---\n\n";
    }
  });

  markdown += "\n\n*Generert av StudyWise - https://studywise.no*\n";

  // Last ned som fil
  const blob = new Blob([markdown], { type: "text/markdown;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  
  const timestamp = new Date().toISOString().slice(0, 10);
  link.download = `studywise-samtale-${timestamp}.md`;
  
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}  