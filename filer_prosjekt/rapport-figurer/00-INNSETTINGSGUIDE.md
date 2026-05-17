# Innsettingsguide for rapportfigurer

Denne mappen er ryddet slik:

- `hovedrapport/` - ferdige PNG-er som settes inn i hovedrapporten.
- `vedlegg/` - ferdige PNG-er og en teknisk diagramkatalog som settes inn i vedlegg.
- `kilder/` - kort underlag for Figur 7, SUS-beregningen og ferdig tekst som kan erstatte TODO-er i rapporten.

## Hovedrapport

Sett inn disse PNG-filene der rapportteksten har tilsvarende `[FIGUR ...]`-plassholder.

| Figur | Fil | Bildetekst |
|---|---|---|
| Figur 1 | `hovedrapport/figur-01-kanban-flyt-github-projects.png` | Figur 1: Vår Kanban-flyt med WIP-grenser. |
| Figur 2 | `hovedrapport/figur-02-use-case-diagram.png` | Figur 2: Use case-diagram for StudyWise. |
| Figur 3 | `hovedrapport/figur-03-monorepo-med-fem-pakker.png` | Figur 3: Monorepoet med fem pakker og build-rekkefølge. |
| Figur 4 | `hovedrapport/figur-04-overordnet-systemarkitektur.png` | Figur 4: Overordnet systemarkitektur. |
| Figur 5 | `hovedrapport/figur-05-er-diagram-mongoose-modeller.png` | Figur 5: Forenklet ER-diagram for de viktigste Mongoose-modellene. |
| Figur 6 | `hovedrapport/figur-06-cloudflare-i-tre-roller.png` | Figur 6: Cloudflare i tre roller - DNS+WAF, Turnstile, Worker. |
| Figur 7 | Mangler bilde | Figur 7: Wireframe vs. endelig implementasjon. |
| Figur 8 | `hovedrapport/figur-08-ki-chat-med-hybrid-retrieval.png` | Figur 8: Sekvensdiagram for KI-chat med hybrid retrieval. |
| Figur 9 | `hovedrapport/figur-09-canvas-token-lagring-bruk-rotasjon.png` | Figur 9: Canvas-token: lagring, bruk og rotasjon. |
| Figur 10 | `hovedrapport/figur-10-middleware-rekkefolge-backend.png` | Figur 10: Middleware-rekkefølge i backend. |
| Figur 11 | `hovedrapport/figur-11-ci-cd-pipeline-github-actions.png` | Figur 11: CI/CD-pipeline i GitHub Actions. |
| Figur 12 | `hovedrapport/figur-12-dataflyt-kryptering-og-pii-sanitering.png` | Figur 12: Dataflyt med kryptering og PII-sanitering. |
| Figur 13 | `hovedrapport/figur-13-sus-resultater-per-pastand.png` | Figur 13: SUS-resultater per påstand. |

Figur 7 må fortsatt lages manuelt fra Figma-wireframe og produksjonsskjermbilde. Notatet ligger i `kilder/MANGLER-figur-07-wireframe-vs-endelig-implementasjon.md`. Konkret framgangsmåte eller alternativ med å fjerne figuren ligger i `kilder/figur-07-anbefaling.md`.

## Vedlegg

| Vedlegg | Fil |
|---|---|
| Vedlegg I - Gantt-skjema | `vedlegg/vedlegg-i-gantt-skjema.png` |
| Vedlegg J - Arkitekturdiagram | `vedlegg/vedlegg-j-arkitekturdiagram.png` |
| Vedlegg K - Use case-diagram | `vedlegg/vedlegg-k-use-case-diagram.png` |
| Vedlegg M - Teknisk diagramkatalog (alle 21 diagrammer) | `vedlegg/vedlegg-m-teknisk-diagramkatalog.md` |

## Skal alle 21 diagrammene brukes?

Ja — vi har valgt å samle alle 21 diagrammene som full katalog i Vedlegg M (`vedlegg/vedlegg-m-teknisk-diagramkatalog.md`). Hovedrapporten bruker fortsatt bare Figur 1-13 slik teksten direkte refererer til dem, slik at hovedteksten ikke blir tung. Resten av diagrammene fungerer som sporbar teknisk referanse i vedlegget.

Vedlegg M er strukturert som Figur M.1 til M.21 med PNG-referanse, kort beskrivelse og ferdig bildetekst for hver oppføring. Det er klart til innsetting i Word-vedlegget med ett bilde per oppføring.

Diagram 21 (Observability-stack med Datadog/Grafana) er nytt — Mermaid-kilden ligger i `../diagrammer/21-observability-stack.md`, men PNG-en må genereres separat. Se note nederst i Vedlegg M for tre måter å gjøre det på.

## Samsvar med originaldiagrammene

Disse rapportfilene er direkte kopier av originaldiagrammer fra `../diagrammer/png/`:

| Rapportfil | Original |
|---|---|
| `hovedrapport/figur-03-monorepo-med-fem-pakker.png` | `../diagrammer/png/02-monorepo-struktur.png` |
| `hovedrapport/figur-04-overordnet-systemarkitektur.png` | `../diagrammer/png/01-arkitektur-overordnet.png` |
| `hovedrapport/figur-05-er-diagram-mongoose-modeller.png` | Forenklet versjon laget for hovedrapporten (kilde: `../diagrammer/07-database-modeller-forenklet.md`). |
| `hovedrapport/figur-10-middleware-rekkefolge-backend.png` | `../diagrammer/png/08-middleware-stack.png` |
| `hovedrapport/figur-11-ci-cd-pipeline-github-actions.png` | `../diagrammer/png/15-cicd-pipeline.png` |
| `vedlegg/vedlegg-i-gantt-skjema.png` | `../diagrammer/png/16-milepaeler-tidslinje.png` |
| `vedlegg/vedlegg-j-arkitekturdiagram.png` | `../diagrammer/png/10-deployment-arkitektur.png` |
| `vedlegg/vedlegg-k-use-case-diagram.png` | `../diagrammer/png/13-use-case-diagram.png` |

Disse er rapporttilpassede forenklinger, men stemmer tematisk med originalene:

| Rapportfil | Grunnlag |
|---|---|
| `hovedrapport/figur-02-use-case-diagram.png` | Forenklet fra `../diagrammer/png/13-use-case-diagram.png`. Full versjon ligger i Vedlegg K. |
| `hovedrapport/figur-08-ki-chat-med-hybrid-retrieval.png` | Forenklet fra `../diagrammer/png/04-ki-chat-pipeline.png`. Full teknisk variant kan brukes i Vedlegg M. |

Disse er egne rapportfigurer uten direkte original i 20-diagrammappen: Figur 1, 6, 9, 12 og 13. Figur 13 er basert på Google Forms-PDF-en, ikke Mermaid.

## Kontrollnotater

- Figur 13 er generert fra Google Forms-PDF-en. Råverdier ligger i `kilder/brukertest-resultater-fra-pdf.md`.
- Ferdig tekst for SUS/NPS-TODO-ene ligger i `kilder/rapporttekst-brukertest-todo-erstatninger.md`.
- Figur 5 bruker faktiske modellnavn fra kodebasen. Hvis rapportteksten nevner `KnowledgeBaseEntry`, `Notification`, `Bookmark`, `ChatShare` eller `BullMqJob` som egne Mongoose-modeller, bør den teksten justeres.
- Figur 3 er nå byttet til originaldiagrammet for monorepo-struktur. Det matcher `package.json` bedre: rot-scriptet `pnpm build` kjører `common`, `backend`, `frontend` og `docs` sekvensielt. Tester kjøres som egne testkommandoer, ikke som del av rotens `build`-script.

## Fullstendig fix-liste for selve Word-rapporten

Alle endringer som må gjøres i selve bachelor-rapporten (TODO-er, Node-versjon, figur-tekster, vedleggsreferanser osv.) er samlet i [`kilder/rapport-fix-list.md`](kilder/rapport-fix-list.md). Bruk den som sjekkliste når du går gjennom Word-dokumentet før innlevering.
