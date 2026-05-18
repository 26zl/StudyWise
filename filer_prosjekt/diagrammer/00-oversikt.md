# Diagrammer - samlet oversikt

Denne mappen inneholder de tekniske diagrammene for StudyWise. Mermaid-filene (`.md`) er kildene, mens filene i [`png/`](png/) er ferdig rendret og enklest å lese i GitHub eller i rapportvedlegg.

For sensor er PNG-filene mest relevante. Mermaid-kildene ligger med for sporbarhet, slik at det er mulig å se og videreutvikle diagramnotasjonen.

## Rask leserute

Hvis du bare vil få teknisk oversikt uten å lese alle diagrammene, start her:

| Steg | Diagram | Hvorfor lese det |
|---|---|---|
| 1 | [01 - Overordnet arkitektur](png/01-arkitektur-overordnet.png) | Viser hovedkomponentene og eksterne tjenester. |
| 2 | [02 - Monorepo-struktur](png/02-monorepo-struktur.png) | Viser hvordan kodebasen er delt i pakker. |
| 3 | [04 - KI-chat-pipeline](png/04-ki-chat-pipeline.png) | Viser hvordan KI-svar bruker Canvas- og kunnskapsbasekontekst. |
| 4 | [05 - Canvas-integrasjon](png/05-canvas-integrasjon.png) | Viser tokenbruk, caching og Canvas-dataflyt. |
| 5 | [08 - Middleware-stack](png/08-middleware-stack.png) | Viser backendens sikkerhets- og kontrollflyt. |
| 6 | [11 - Sikkerhetslag](png/11-sikkerhetslag.png) | Oppsummerer sentrale sikkerhetstiltak. |
| 7 | [21 - Observability-stack](png/21-observability-stack.png) | Viser logging, tracing, målinger og analyseverktøy. |

## Full diagramkatalog

| # | Diagram | Kort beskrivelse |
|---|---|---|
| 01 | [Overordnet arkitektur](png/01-arkitektur-overordnet.png) | Frontend, backend, datalagre og eksterne tjenester. |
| 02 | [Monorepo-struktur](png/02-monorepo-struktur.png) | pnpm-monorepo med `common`, `backend`, `frontend`, `docs` og `tests`. |
| 03 | [Autentiseringsflyt](png/03-autentiseringsflyt.png) | Innlogging, Clerk, Turnstile og backend-autentisering. |
| 04 | [KI-chat-pipeline](png/04-ki-chat-pipeline.png) | Canvas-kontekst, RAG, reranking og streaming av KI-svar. |
| 05 | [Canvas-integrasjon](png/05-canvas-integrasjon.png) | Henting, caching og bruk av Canvas-data. |
| 06 | [Kunnskapsbase og RAG](png/06-kunnskapsbase-rag.png) | Dokumentbehandling, søk og kontekst til KI-modellen. |
| 07 | [Database-modeller](png/07-database-modeller.png) | Viktige datamodeller og relasjoner. |
| 08 | [Middleware-stack](png/08-middleware-stack.png) | Rekkefølge på backend-middleware og avvisningspunkter. |
| 09 | [Bruker-sletting](png/09-bruker-sletting.png) | Sletting av brukerdata og opprydding i eksterne tjenester. |
| 10 | [Deployment-arkitektur](png/10-deployment-arkitektur.png) | Vercel, Heroku, Cloudflare og GitHub Actions. |
| 11 | [Sikkerhetslag](png/11-sikkerhetslag.png) | Oversikt over sikkerhetstiltak i løsningen. |
| 12 | [BullMQ-køer](png/12-bullmq-koer.png) | Bakgrunnsjobber og asynkron prosessering. |
| 13 | [Use case-diagram](png/13-use-case-diagram.png) | Aktører og sentrale brukstilfeller. |
| 14 | [Brukerreise](png/14-brukerreise.png) | Studentens reise gjennom løsningen. |
| 15 | [CI/CD-pipeline](png/15-cicd-pipeline.png) | Bygg, tester, sikkerhetsskann og deploy. |
| 16 | [Milepæler og tidslinje](png/16-milepaeler-tidslinje.png) | Prosjektets viktigste milepæler. |
| 17 | [UML-klassediagram](png/17-uml-klassediagram.png) | Utvalgte backend-klasser og tjenester. |
| 18 | [WBS](png/18-wbs-work-breakdown.png) | Work Breakdown Structure for prosjektet. |
| 19 | [Teststrategi](png/19-test-strategi.png) | Testnivåer og hovedområder for kvalitetssikring. |
| 20 | [STRIDE-trusselmodell](png/20-stride-trusselmodell.png) | Trusler og tiltak etter STRIDE. |
| 21 | [Observability-stack](png/21-observability-stack.png) | Logging, målinger, tracing og analyseverktøy. |

## Bruk i rapporten

Hovedrapporten bruker utvalgte, forenklede figurer fra `rapport-figurer/hovedrapport/`. Vedlegg G fungerer som teknisk diagramkatalog og peker videre til PNG-filene i denne mappen.

`07-database-modeller-forenklet.png` er en enklere variant av datamodelldiagrammet brukt i rapportkontekst. Den fullstendige varianten er `07-database-modeller.png`.
