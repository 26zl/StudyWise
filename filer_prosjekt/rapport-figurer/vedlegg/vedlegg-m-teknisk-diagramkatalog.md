# Vedlegg M - Teknisk diagramkatalog

Dette vedlegget er laget for å gi sensor og videre utviklere full oversikt over diagrammene uten at hovedrapporten blir tung. Hovedrapporten bør fortsatt bare bruke figurene som teksten faktisk forklarer. Resten av diagrammene kan ligge her som teknisk dokumentasjon.

## Anbefalt bruk

- Bruk `rapport-figurer/hovedrapport/` for figurene som allerede er nummerert i hovedrapporten.
- Bruk denne katalogen som et samlet teknisk vedlegg for diagrammene som ikke bør presse seg inn i hovedkapitlene.
- Bruk PNG-filene fra `filer_prosjekt/diagrammer/png/` når diagrammene skal settes inn i Word.
- Behold Mermaid-kildene i `filer_prosjekt/diagrammer/` som sporbar kilde for senere endringer.

## Full diagramkatalog

| # | Diagram | Anbefalt plassering | Hvorfor det er relevant |
|---|---|---|---|
| 01 | [Overordnet arkitektur](../../diagrammer/png/01-arkitektur-overordnet.png) | Hovedrapport figur 4 | Viser helheten: frontend, backend, datalag og eksterne tjenester. |
| 02 | [Monorepo-struktur](../../diagrammer/png/02-monorepo-struktur.png) | Hovedrapport figur 3 | Viser fem pnpm-pakker og hvorfor `common/` må bygges først. |
| 03 | [Autentiseringsflyt](../../diagrammer/png/03-autentiseringsflyt.png) | Vedlegg M | God støtte til sikkerhetsdelen, men for detaljert for hovedrapporten. |
| 04 | [KI-chat-pipeline](../../diagrammer/png/04-ki-chat-pipeline.png) | Hovedrapport figur 8 / Vedlegg M | Dokumenterer RAG-flyten, reranking og streaming mot klient. |
| 05 | [Canvas-integrasjon](../../diagrammer/png/05-canvas-integrasjon.png) | Vedlegg M | Viser hvordan Canvas-data hentes, caches og brukes videre. |
| 06 | [Kunnskapsbase-RAG](../../diagrammer/png/06-kunnskapsbase-rag.png) | Vedlegg M | Utdyper forskjellen mellom Canvas-kontekst og personlig kunnskapsbase. |
| 07 | [Database-modeller](../../diagrammer/png/07-database-modeller.png) | Hovedrapport figur 5 | Viser faktiske Mongoose-modeller og relasjoner. |
| 08 | [Middleware-stack](../../diagrammer/png/08-middleware-stack.png) | Hovedrapport figur 10 | Underbygger forklaringen av Express-rekkefølge og sikkerhetsgrenser. |
| 09 | [Bruker-sletting](../../diagrammer/png/09-bruker-sletting.png) | Vedlegg M | Støtter GDPR-drøftingen om sletting, tombstone og eksterne oppryddingsjobber. |
| 10 | [Deployment-arkitektur](../../diagrammer/png/10-deployment-arkitektur.png) | Vedlegg J / Vedlegg M | Viser hva som kjører på Vercel, Heroku, GitHub Pages og Cloudflare. |
| 11 | [Sikkerhetslag](../../diagrammer/png/11-sikkerhetslag.png) | Vedlegg M | Gir en samlet defense-in-depth-oversikt for kapittel 3.6 og 4.5. |
| 12 | [BullMQ-koer](../../diagrammer/png/12-bullmq-koer.png) | Vedlegg M | Forklarer bakgrunnsjobber som sletting, Pinecone-cleanup og web-push. |
| 13 | [Use case-diagram](../../diagrammer/png/13-use-case-diagram.png) | Hovedrapport figur 2 / Vedlegg K | Viser aktører og hovedfunksjoner i systemet. |
| 14 | [Brukerreise](../../diagrammer/png/14-brukerreise.png) | Vedlegg M | Passer som støtte til UX- og brukertestdrøftingen. |
| 15 | [CI/CD-pipeline](../../diagrammer/png/15-cicd-pipeline.png) | Hovedrapport figur 11 | Dokumenterer kvalitetssikring, skann og deploy-gates. |
| 16 | [Milepaeler-tidslinje](../../diagrammer/png/16-milepaeler-tidslinje.png) | Vedlegg I | Gantt-/tidslinjegrunnlag for prosjektgjennomføringen. |
| 17 | [UML-klassediagram](../../diagrammer/png/17-uml-klassediagram.png) | Vedlegg M | Gir teknisk dybde uten å gjøre hovedrapporten for kodeorientert. |
| 18 | [WBS - Work Breakdown Structure](../../diagrammer/png/18-wbs-work-breakdown.png) | Vedlegg M | Dokumenterer prosjektets arbeidsnedbryting og eierskap. |
| 19 | [Test-strategi](../../diagrammer/png/19-test-strategi.png) | Vedlegg M | Passer som støtte til kapittel 3.5 og 4.7. |
| 20 | [STRIDE-trusselmodell](../../diagrammer/png/20-stride-trusselmodell.png) | Vedlegg M | Gir sikkerhetsfaglig tyngde og knytter tiltak til trusselkategorier. |

## Kort anbefaling til rapporten

Legg ikke alle 20 diagrammene inn i hovedrapporten. Det vil gjøre teksten tung og gi sensor mindre lyst til å lese forklaringene rundt dem. Den beste løsningen er:

- Hovedrapport: figur 1-13 slik de allerede er nummerert i `rapport-figurer/hovedrapport/`.
- Vedlegg I, J og K: Gantt, full arkitektur og full use case.
- Vedlegg M: resten av de tekniske diagrammene, samlet som katalog.

Da får dere både en ryddig hovedrapport og full sporbarhet for alt teknisk arbeid.
