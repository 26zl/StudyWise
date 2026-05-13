# Innsettingsguide for figurer i bachelorrapporten

Denne mappen inneholder rapport-klare filnavn for figurene i hovedteksten. Bruk PNG-filene direkte i Word der de finnes. Mermaid-filene (`.md`) er kildefiler som kan eksporteres til PNG via Mermaid Live Editor eller VS Code dersom PNG mangler eller er markert som kilde.

## Figurer i hovedteksten

| Figur | Plassering i rapport | Fil som skal settes inn | Bildetekst i Word | Status |
|---|---|---|---|---|
| Figur 1 | 3.1.1 Valg av Kanban over Scrum | `figur-01-kanban-flyt-github-projects.png` | Figur 1: Vår Kanban-flyt med WIP-grenser. | Klar som PNG. |
| Figur 2 | 3.2.4 Bruksmønsterdiagram | `figur-02-use-case-diagram.png` | Figur 2: Use case-diagram for StudyWise. | Klar som forenklet PNG. Full variant ligger i Vedlegg K. |
| Figur 3 | 3.3.1 Monorepo med fem pakker | `figur-03-monorepo-med-fem-pakker.png` | Figur 3: Monorepoet med fem pakker og build-rekkefølge. | Klar som PNG. |
| Figur 4 | 3.3.2 Overordnet systemarkitektur | `figur-04-overordnet-systemarkitektur.png` | Figur 4: Overordnet systemarkitektur. | Klar som PNG. |
| Figur 5 | 3.3.3 Datalag - MongoDB, Redis, Pinecone | `figur-05-er-diagram-mongoose-modeller.png` | Figur 5: ER-diagram for Mongoose-modellene. | Klar som PNG, men se kontrollmerknad under. |
| Figur 6 | 3.3.4 Cloudflare-laget | `figur-06-cloudflare-i-tre-roller.png` | Figur 6: Cloudflare i tre roller - DNS+WAF, Turnstile, Worker. | Klar som PNG. |
| Figur 7 | 3.3.5 Utformende design | `figur-07-wireframe-vs-endelig-implementasjon.PLASSHOLDER.md` | Figur 7: Wireframe vs. endelig implementasjon. | Krever skjermbilde fra Figma + produksjon. |
| Figur 8 | 3.4.2 Sentrale funksjoner, KI-pipeline | `figur-08-ki-chat-med-hybrid-retrieval.png` | Figur 8: Sekvensdiagram for KI-chat med hybrid retrieval. | Klar som PNG. |
| Figur 9 | 3.4.2 Sentrale funksjoner, Canvas-token og kryptering | `figur-09-canvas-token-lagring-bruk-rotasjon.png` | Figur 9: Canvas-token: lagring, bruk og rotasjon. | Klar som PNG. |
| Figur 10 | 3.4.5 Middleware-rekkefølge i backend | `figur-10-middleware-rekkefolge-backend.png` | Figur 10: Middleware-rekkefølge i backend. | Klar som PNG. |
| Figur 11 | 3.5.6 Pentesting og sårbarhetsskann | `figur-11-ci-cd-pipeline-github-actions.png` | Figur 11: CI/CD-pipeline i GitHub Actions. | Klar som PNG. |
| Figur 12 | 3.6.2 GDPR i praksis | `figur-12-dataflyt-kryptering-og-pii-sanitering.png` | Figur 12: Dataflyt med kryptering og PII-sanitering. | Klar som PNG. |
| Figur 13 | 4.6.1 Resultater fra SUS og åpne tilbakemeldinger | `figur-13-sus-resultater-per-pastand.PLASSHOLDER.md` | Figur 13: SUS-resultater per påstand. | Krever endelige SUS-tall. |

## Kontrollmerknader

- Figur 2 i hovedteksten er forenklet slik rapporten beskriver. Den fullstendige use case-figuren brukes i Vedlegg K.
- Figur 3 er justert til rapportens build-rekkefølge: `common` først, deretter `backend`, `frontend` og `docs` parallelt, og `tests` sist.
- Figur 5 bruker faktiske modellnavn fra kodebasen. Rapportutkastet nevner noen eldre/generiske navn (`KnowledgeBaseEntry`, `Notification`, `Bookmark`, `ChatShare`, `BullMqJob`) som ikke finnes som egne Mongoose-modeller. Dersom dere bruker Figur 5 slik den er, bør teksten oppdateres til faktiske modeller som `KnowledgeBase`, `KBContentChunk`, `SharedChat`, `WebPushSubscription`, `Arbeidsplan`, `LagretQuiz` og `LagretFlashcardSett`.
- Figur 8 er justert til å vise hvor TLS-grenser, PII-sanitering og AES-kryptering ligger i KI-flyten.

## Vedlegg

| Vedlegg | Plassering i rapport | Fil | Status |
|---|---|---|---|
| Vedlegg I | Gantt-skjema | `vedlegg-i-gantt-skjema.png` | Klar som PNG. |
| Vedlegg J | Arkitekturdiagram | `vedlegg-j-arkitekturdiagram.png` | Klar som PNG, basert på overordnet arkitekturdiagram. |
| Vedlegg K | Use case-diagram | `vedlegg-k-use-case-diagram.png` | Klar som PNG. |

## Diagrammer som finnes, men ikke har fast figurplass ennå

Disse ligger fortsatt i `filer_prosjekt/diagrammer/png/` og kan brukes i vedlegg eller drøfting ved behov:

| Originalfil | Passer best i |
|---|---|
| `../diagrammer/png/03-autentiseringsflyt.png` | 3.4.2 Auth / 3.6 Sikkerhet |
| `../diagrammer/png/05-canvas-integrasjon.png` | 3.4.2 Canvas-integrasjon |
| `../diagrammer/png/06-kunnskapsbase-rag.png` | 3.4.4 Hybrid retrieval i detalj |
| `../diagrammer/png/09-bruker-sletting.png` | 3.6.2 GDPR i praksis |
| `../diagrammer/png/10-deployment-arkitektur.png` | 3.3.2 Overordnet arkitektur eller Vedlegg J |
| `../diagrammer/png/11-sikkerhetslag.png` | 3.6.1 Sikkerhetsoversikt |
| `../diagrammer/png/12-bullmq-koer.png` | 3.4.2 Web-push / bakgrunnsjobber |
| `../diagrammer/png/14-brukerreise.png` | 3.3.5 Utformende design eller vedlegg |
| `../diagrammer/png/17-uml-klassediagram.png` | Vedlegg J eller teknisk appendix |
| `../diagrammer/png/18-wbs-work-breakdown.png` | 3.1 Planlegging / Vedlegg I |
| `../diagrammer/png/19-test-strategi.png` | 3.5 Testing eller 4.7 Drøfting av testing |
| `../diagrammer/png/20-stride-trusselmodell.png` | 2.6.2 eller 3.6 Sikkerhet |

## Praktisk bruk i Word

1. Sett inn PNG-filen rett under avsnittet der rapporten har `[FIGUR ...]`.
2. Bruk Word sin innebygde bildetekstfunksjon med teksten fra tabellen over.
3. Når alle figurer er satt inn: oppdater figurliste via `Referanser -> Sett inn figurliste`.
4. For Mermaid-filer uten PNG: eksporter først diagrammet til PNG, og gi PNG-en samme filnavn uten `.md`.
