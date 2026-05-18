# Innsettingsguide for rapportfigurer

Denne guiden viser hvilke bildefiler som hører til hovedrapporten og vedleggene. Filene er samlet her for at sensor og videre utviklere raskt skal kunne finne originalfigurene uten å lete gjennom hele repositoryet.

## Hovedrapport

PNG-filene under ligger i `filer_prosjekt/rapport-figurer/hovedrapport/` og er klare for innsetting i Word.

| Figur | Fil | Brukes i rapporten |
|---|---|---|
| Figur 1 | `figur-01-kanban-flyt-github-projects.png` | Kanban-flyt i GitHub Projects |
| Figur 2 | `figur-02-use-case-diagram.png` | Forenklet bruksmønsterdiagram |
| Figur 3 | `figur-03-monorepo-med-fem-pakker.png` | Monorepo med fem pakker |
| Figur 4 | `figur-04-overordnet-systemarkitektur.png` | Overordnet systemarkitektur |
| Figur 5 | `figur-05-er-diagram-mongoose-modeller.png` | Forenklet datamodell |
| Figur 6 | `figur-06-cloudflare-i-tre-roller.png` | Cloudflare som DNS/WAF, Turnstile og Worker |
| Figur 8 | `figur-08-ki-chat-med-hybrid-retrieval.png` | KI-chat med hybrid retrieval |
| Figur 9 | `figur-09-canvas-token-lagring-bruk-rotasjon.png` | Lagring, bruk og rotasjon av Canvas-token |
| Figur 10 | `figur-10-middleware-rekkefolge-backend.png` | Middleware-rekkefølge i backend |
| Figur 11 | `figur-11-ci-cd-pipeline-github-actions.png` | CI/CD-pipeline i GitHub Actions |
| Figur 12 | `figur-12-dataflyt-kryptering-og-pii-sanitering.png` | Dataflyt med kryptering og PII-sanitering |
| Figur 13 | `figur-13-sus-resultater-per-pastand.png` | SUS-resultater per påstand |

Merk: Figur 7 i hovedrapporten er wireframe/endelig design og ligger ikke som repo-generert Mermaid-PNG. Den må derfor hentes fra Word-dokumentet, Figma-eksporten eller skjermbildematerialet som gruppen bruker i rapporten.

## Vedlegg

Disse filene ligger i `filer_prosjekt/rapport-figurer/vedlegg/`.

| Vedlegg | Fil | Innhold |
|---|---|---|
| Vedlegg I | `vedlegg-i-gantt-skjema.png` | Gantt-/milepælstidslinje |
| Vedlegg J | `vedlegg-j-arkitekturdiagram.png` | Deployment-/arkitekturdiagram |
| Vedlegg K | `vedlegg-k-use-case-diagram.png` | Fullstendig use case-diagram |
| Vedlegg M | `vedlegg-m-teknisk-diagramkatalog.md` | Teknisk diagramkatalog med Figur M.1-M.21 |

## Tekniske diagrammer

Alle Mermaid-kilder ligger i `filer_prosjekt/diagrammer/`. De høyoppløselige PNG-eksportene ligger i `filer_prosjekt/diagrammer/png/`.

Bruk `filer_prosjekt/diagrammer/00-oversikt.md` for full katalog over de 21 hoveddiagrammene. I tillegg finnes `07-database-modeller-forenklet.md` og `png/07-database-modeller-forenklet.png` som en forenklet variant av datamodelldiagrammet for hovedrapporten.

## Regenerering av Mermaid-PNG

Hvis en Mermaid-kilde endres, regenerer tilsvarende PNG med Mermaid CLI:

```powershell
mmdc -i filer_prosjekt/diagrammer/21-observability-stack.md -o filer_prosjekt/diagrammer/png/21-observability-stack.png -w 2400 -s 3 -b transparent
```

Bytt input- og output-fil for andre diagrammer. Etter regenerering bør både `.md`-kilden og PNG-filen sjekkes inn sammen.
