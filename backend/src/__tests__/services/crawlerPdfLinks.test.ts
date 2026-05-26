import { describe, expect, it } from "vitest";
import { findPdfLinks } from "../../services/crawler.js";

describe("findPdfLinks", () => {
  it("fanger flere presentasjons-PDF-er fra windowsnett-lignende side", () => {
    const html = `
      <html>
        <body>
          <table>
            <tr><td><a class="btn" href="1a Introduksjon til nettverk.pdf">Presentasjon (pdf)</a></td></tr>
            <tr><td><a class="btn" href="1b Virtualisering.pdf">Presentasjon (pdf)</a></td></tr>
            <tr><td><a class="btn" href="Demo Oracle VirtualBox.pdf">Presentasjon (pdf)</a></td></tr>
            <tr><td><a class="btn" href="Demo VMware Fusion.pdf">Presentasjon (pdf)</a></td></tr>
            <tr><td><a class="btn" href="Laboving 1a Lage virtuell maskin med VirtualBox.pdf">pdf</a></td></tr>
            <tr><td><a class="btn" href="Laboving 1b Installere og konfigurere Windows Server.pdf">pdf</a></td></tr>
            <tr><td><a class="btn" href="Laboving 1c Installere Windows 10 paa ny VM.pdf">pdf</a></td></tr>
            <tr><td><a class="btn" href="Laboving 1c Installere Windows 11 paa ny VM.pdf">pdf</a></td></tr>
          </table>
        </body>
      </html>
    `;

    const links = findPdfLinks(
      html,
      "https://www.windowsnett.no/leksjoner/L01/Leksjon%201%20beskrivelse.htm",
    );
    const urls = links.map((link) => link.url);

    expect(urls).toContain(
      "https://www.windowsnett.no/leksjoner/L01/1a%20Introduksjon%20til%20nettverk.pdf",
    );
    expect(urls).toContain("https://www.windowsnett.no/leksjoner/L01/1b%20Virtualisering.pdf");
    expect(links.length).toBeGreaterThanOrEqual(8);
  });

  it("støtter knappelenker via data-url og dedupliserer samme PDF", () => {
    const html = `
      <html>
        <body>
          <button data-url="/leksjoner/L01/1a Introduksjon til nettverk.pdf">Presentasjon (pdf)</button>
          <a href="/leksjoner/L01/1a Introduksjon til nettverk.pdf">Presentasjon (pdf)</a>
        </body>
      </html>
    `;

    const links = findPdfLinks(
      html,
      "https://www.windowsnett.no/leksjoner/L01/Leksjon%201%20beskrivelse.htm",
    );

    expect(links).toHaveLength(1);
    expect(links[0]?.url).toBe(
      "https://www.windowsnett.no/leksjoner/L01/1a%20Introduksjon%20til%20nettverk.pdf",
    );
  });
});
