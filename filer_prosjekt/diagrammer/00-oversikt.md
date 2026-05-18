# Diagrammer - oversikt

Denne mappen inneholder tekniske diagrammer for StudyWise. Diagrammene viser arkitektur, sentrale flyter, sikkerhet, testing og prosjektmetodikk.

For sensor er **PNG-lenkene** mest relevante, fordi de viser ferdig rendret diagram. Mermaid-kildene (`.md`) ligger i samme mappe for sporbarhet og videre redigering.

## Anbefalt leserekkefølge

Hvis du bare vil få en rask teknisk oversikt, les disse først:

| Steg | Diagram | Hvorfor lese det |
|---|---|---|
| 1 | [01 - Overordnet arkitektur](png/01-arkitektur-overordnet.png) | Viser hovedkomponentene i StudyWise. |
| 2 | [02 - Monorepo-struktur](png/02-monorepo-struktur.png) | Viser hvordan kodebasen er delt i pakker. |
| 3 | [04 - KI-chat-pipeline](png/04-ki-chat-pipeline.png) | Viser hvordan KI-svar henter Canvas- og kunnskapsbasekontekst. |
| 4 | [08 - Middleware-stack](png/08-middleware-stack.png) | Viser backendens sikkerhets- og kontrollflyt. |
| 5 | [11 - Sikkerhetslag](png/11-sikkerhetslag.png) | Viser sentrale sikkerhetstiltak i løsningen. |

## Full oversikt

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
| 13 | [Use case-diagram](png/13-use-case-diagram.png) | Aktører og 17 sentrale brukstilfeller. |
| 14 | [Brukerreise](png/14-brukerreise.png) | Studentens reise gjennom løsningen. |
| 15 | [CI/CD-pipeline](png/15-cicd-pipeline.png) | Bygg, tester, sikkerhetsskann og deploy. |
| 16 | [Milepæler og tidslinje](png/16-milepaeler-tidslinje.png) | Prosjektets viktigste milepæler. |
| 17 | [UML-klassediagram](png/17-uml-klassediagram.png) | Utvalgte backend-klasser og tjenester. |
| 18 | [WBS](png/18-wbs-work-breakdown.png) | Work Breakdown Structure for prosjektet. |
| 19 | [Teststrategi](png/19-test-strategi.png) | Testnivåer og hovedområder for kvalitetssikring. |
| 20 | [STRIDE-trusselmodell](png/20-stride-trusselmodell.png) | Trusler og tiltak etter STRIDE. |
| 21 | [Observability-stack](png/21-observability-stack.png) | Logging, målinger, tracing og analyseverktøy. |

## Merknad

Diagram `07-database-modeller-forenklet.png` finnes også som en enklere variant av datamodelldiagrammet, men hovedkatalogen bruker den fullstendige versjonen `07-database-modeller.png`.
