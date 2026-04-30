# Diagrammer — oversikt

Denne mappen inneholder 23 mermaid-diagrammer som dokumenterer den tekniske arkitekturen, brukerreisen, prosjektmetodikken og sikkerhets- og personvernarbeidet til **StudyWise** — en KI-basert studieassistent integrert med Canvas LMS, utviklet som bacheloroppgave i IT ved USN (gruppe 3, 2026). Diagrammene er ment som et raskt orienteringsverktøy for lesere som vil få et inntrykk av løsningens omfang og kvalitet uten å lese all kildekoden først.

Hvert diagram finnes i tre formater:

- **`.md`** — selve mermaid-kildekoden (kan åpnes i VS Code med Mermaid-utvidelsen, eller i nettleser via GitHub).
- **`png/`** — høyoppløselig PNG (2400–15700 px bredde, scale 3–4) for utskrift og skjermlesning.
- **`svg/`** — vektorgrafikk for innfelling i bacheloroppgaven (LaTeX/Word) uten kvalitetstap.

## Anbefalt leserekkefølge

For en rask oversikt (≈ 10 minutter) anbefaler vi denne rekkefølgen:

| Steg | Diagram | Hva du får ut av det |
|------|---------|----------------------|
| 1 | [01 – Overordnet arkitektur](01-arkitektur-overordnet.md) | Helhetsbildet: hvilke teknologier brukes, og hvordan henger de sammen. |
| 2 | [02 – Monorepo-struktur](02-monorepo-struktur.md) | Hvordan kodebasen er organisert i fem pnpm-pakker med tydelige ansvarsområder. |
| 3 | [13 – Produksjonsmiljø](13-produksjonsmiljo.md) | Bekrefter at løsningen faktisk er deployet til produksjon, med profesjonell drift (CI/CD, observabilitet, helsestatus). |
| 4 | [04 – KI-chat-pipeline](04-ki-chat-pipeline.md) | Hovedfunksjonen i produktet. Viser RAG-arkitektur og kildekontroll via `<svarkilde>`-tag. |
| 5 | [11 – Sikkerhetslag](11-sikkerhetslag.md) | Demonstrerer modent sikkerhetsarbeid: 15 lag med "defense in depth". |

Resterende diagrammer dykker dypere i enkeltområder og kan leses ved behov.

## Full diagramoversikt

| # | Diagram | Hva diagrammet viser |
|---|---------|----------------------|
| 01 | [arkitektur-overordnet](01-arkitektur-overordnet.md) | Komponentdiagram: frontend, backend, datalag (MongoDB/Redis/Pinecone) og 9 eksterne tjenester. |
| 02 | [monorepo-struktur](02-monorepo-struktur.md) | pnpm workspaces: `common`, `backend`, `frontend`, `docs`, `tests` — med byggrekkefølge og delte typer. |
| 03 | [autentiseringsflyt](03-autentiseringsflyt.md) | Sekvensdiagram: Clerk-innlogging + Cloudflare Turnstile anti-bot, inkludert webhook-håndtering. |
| 04 | [ki-chat-pipeline](04-ki-chat-pipeline.md) | Sekvensdiagram for AI-svar: Canvas-kontekst + RAG (Pinecone + BM25 + Cohere) + Claude streaming + kildebadge. |
| 05 | [canvas-integrasjon](05-canvas-integrasjon.md) | Hvordan Canvas LMS-data hentes, caches (Redis 2t TTL) og indekseres til vektorsøk. |
| 06 | [kunnskapsbase-rag](06-kunnskapsbase-rag.md) | Hybrid retrieval: vektor + nøkkelord, slått sammen og rerangert. PII-sanitering før Pinecone. |
| 07 | [database-modeller](07-database-modeller.md) | ER-diagram over 20+ Mongoose-modeller med `User` som nav. |
| 08 | [middleware-stack](08-middleware-stack.md) | Express middleware-rekkefølge: 11 lag fra trust-proxy til feature-router. |
| 09 | [bruker-sletting](09-bruker-sletting.md) | GDPR-rettigheter: soft-delete + asynkron opprydding via BullMQ-jobber (Clerk + Pinecone). |
| 10 | [deployment-arkitektur](10-deployment-arkitektur.md) | Hvor de fire tjenestene kjører: Vercel, Heroku, GitHub Pages, Cloudflare Workers. |
| 11 | [sikkerhetslag](11-sikkerhetslag.md) | 15 sikkerhetslag — fra HTTPS/HSTS til AES-256-GCM-kryptering og PII-grense. |
| 12 | [bullmq-koer](12-bullmq-koer.md) | Asynkron jobbkjøring: én unified BullMQ-kø erstatter tre separate (reduserte Redis-tilkoblinger). |
| 13 | [produksjonsmiljo](13-produksjonsmiljo.md) | Full produksjonstopologi: DNS, CDN, dyno, datalag, observabilitet, hemmeligheter, CI/CD. |
| 14 | [use-case-diagram](14-use-case-diagram.md) | UML-style use case: aktører (student, admin, system, Canvas, Clerk) og 18 use cases. |
| 15 | [brukerreise](15-brukerreise.md) | Journey-diagram: studentens reise fra registrering til daglig bruk, med friksjonspunkter. |
| 16 | [cicd-pipeline](16-cicd-pipeline.md) | GitHub Actions-pipelinen: CI, sikkerhetsskanning, funksjonelle tester og deploy. |
| 17 | [test-strategi](17-test-strategi.md) | Test-pyramide + dekningsmatrise: 1100+ enhetstester, 120 auth-scenarier, Playwright E2E. |
| 18 | [stride-trusselmodell](18-stride-trusselmodell.md) | STRIDE-kategorier med konkrete trusler og tiltak (visualisering av compliance/THREAT_MODEL.md). |
| 19 | [gdpr-livssyklus](19-gdpr-livssyklus.md) | Datalivssyklus: innsamling → lagring → sletting/anonymisering, med retention-tabell og GDPR-rettigheter. |
| 20 | [milepaeler-tidslinje](20-milepaeler-tidslinje.md) | Gantt-diagram over hele bacheloroppgaveløpet 2026, med 5 milepæler og Kanban-metodikk. |
| 21 | [wbs-work-breakdown](21-wbs-work-breakdown.md) | Work Breakdown Structure: hierarkisk dekomponering av bacheloroppgaven i 6 hovedpakker med eierskap. |
| 22 | [nosql-document-modell](22-nosql-document-modell.md) | NoSQL-modell: embedded vs referenced, krypterte blobs, TTL-indekser, og eksterne stores (Pinecone, Redis). |
| 23 | [uml-klassediagram](23-uml-klassediagram.md) | UML klassediagram for backend-tjenestene: ansvar, metoder, avhengigheter og designmønstre. |

## Tematisk gruppering

| Tema | Diagrammer som dokumenterer det |
|------|----------------------------------|
| **Teknisk omfang og kompleksitet** | 01, 04, 06, 07, 13 — løsningen integrerer 10+ eksterne tjenester og 3 datalag. |
| **Arkitekturell modenhet** | 02, 08, 10, 12 — separasjon av ansvar, middleware-pipeline, deploy-strategi, asynkron jobbkjøring. |
| **Sikkerhet og personvern** | 03, 09, 11, 18, 19 — autentisering, GDPR-sletting, defense-in-depth, STRIDE-trusselmodell, retention. |
| **AI-integrasjon** | 04, 06 — RAG-pipeline, hybrid retrieval, kildekontroll via `<svarkilde>`-tag for å hindre AI-hallusinering. |
| **Drift og leveranse** | 10, 13, 16 — løsningen kjører i produksjon på <https://www.studwize.page> med CI/CD og helsestatus. |
| **Brukersentrert utvikling** | 14, 15 — use cases og brukerreise. |
| **Prosjektmetodikk** | 20, 21 — Gantt-tidslinje og WBS med arbeidspakker. |
| **Kvalitetssikring** | 16, 17 — pipeline med 6 kvalitetsporter, test-pyramide. |
| **UML-modeller** | 03, 04, 14, 23 — sekvens, use case, klassediagram. |
| **Datamodell (relasjonell + NoSQL)** | 07 (ER), 22 (NoSQL document-modell). |

## Visningstips

- **VS Code**: `Cmd+K V` åpner Markdown Preview side-by-side. Mermaid rendres direkte med utvidelsen "Markdown Preview Mermaid Support".
- **Nettleser**: Åpne `.md`-filen på GitHub — Mermaid rendres automatisk.
- **Trykk / rapport**: Bruk `svg/`-versjonene for vektorgrafikk uten pikselering. PNG-filer i `png/`-mappen er rendret i opptil 15692 × 6944 px.
- **Live-redigering**: <https://mermaid.live> — lim inn ```` ```mermaid ````-blokken.

## Konvensjoner

- All tekst og labels er på norsk, i samsvar med variabelnavn og kommentarer i kildekoden.
- Fargekoding: eksterne tjenester gult, datalag blått, applikasjon grønt, sikkerhetslag rødt, observabilitet lilla.
- Pildretninger speiler dataflyten, ikke bare modulavhengigheter — slik at leseren kan følge en faktisk forespørsel gjennom systemet.
