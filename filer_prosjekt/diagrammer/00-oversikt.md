# Diagrammer — oversikt

Denne mappen inneholder 20 mermaid-diagrammer som dokumenterer den tekniske arkitekturen, sentrale flyter, sikkerhets- og personvernarbeidet, og prosjektmetodikken til **StudyWise** — en KI-basert studieassistent integrert med Canvas LMS, utviklet som bacheloroppgave i IT ved USN (gruppe 3, 2026). Diagrammene er ment som et raskt orienteringsverktøy for lesere som vil få et inntrykk av løsningens omfang og kvalitet uten å lese all kildekoden først.

Hvert diagram finnes i to formater:

- **`.md`** — selve mermaid-kildekoden (kan åpnes i VS Code med Mermaid-utvidelsen, eller i nettleser via GitHub).
- **`png/`** — høyoppløselig PNG (2400 px bredde, scale 3) for innfelling i bacheloroppgaven (Word).

## Anbefalt leserekkefølge

For en rask oversikt (≈ 10 minutter) anbefaler vi denne rekkefølgen:

| Steg | Diagram | Hva du får ut av det |
|------|---------|----------------------|
| 1 | [01 – Overordnet arkitektur](01-arkitektur-overordnet.md) | Helhetsbildet: hvilke teknologier brukes, og hvordan henger de sammen. |
| 2 | [02 – Monorepo-struktur](02-monorepo-struktur.md) | Hvordan kodebasen er organisert i fem pnpm-pakker. |
| 3 | [10 – Deployment-arkitektur](10-deployment-arkitektur.md) | Hva kjører hvor i produksjon, med CI/CD og observabilitet. |
| 4 | [04 – KI-chat-pipeline](04-ki-chat-pipeline.md) | Hovedfunksjonen: RAG-arkitektur og kildekontroll via `<svarkilde>`-tag. |
| 5 | [11 – Sikkerhetslag](11-sikkerhetslag.md) | Defense-in-depth: 15 lag som beskytter løsningen. |

## Full diagramoversikt (20 diagrammer)

| # | Diagram | Hva diagrammet viser |
|---|---------|----------------------|
| 01 | [arkitektur-overordnet](01-arkitektur-overordnet.md) | Komponentdiagram: frontend, backend, datalag og 10+ eksterne tjenester (inkl. Grafana). |
| 02 | [monorepo-struktur](02-monorepo-struktur.md) | pnpm workspaces: `common`, `backend`, `frontend`, `docs`, `tests` — med byggrekkefølge og `common` som fullstack-kontrakt. |
| 03 | [autentiseringsflyt](03-autentiseringsflyt.md) | Sekvensdiagram: Clerk-innlogging + Cloudflare Turnstile + webhook-håndtering. |
| 04 | [ki-chat-pipeline](04-ki-chat-pipeline.md) | Sekvensdiagram for AI-svar: Canvas-kontekst + RAG (Pinecone + BM25 + Cohere) + Claude streaming. |
| 05 | [canvas-integrasjon](05-canvas-integrasjon.md) | Hvordan Canvas LMS-data hentes, caches og indekseres til vektorsøk. |
| 06 | [kunnskapsbase-rag](06-kunnskapsbase-rag.md) | Hybrid retrieval: vektor + nøkkelord, slått sammen og rerangert. PII-sanitering før Pinecone. |
| 07 | [database-modeller](07-database-modeller.md) | ER-diagram over Mongoose-modeller, med embedded vs referenced og TTL-indekser. |
| 08 | [middleware-stack](08-middleware-stack.md) | Express middleware-rekkefølge: 11 lag fra trust-proxy til feature-router. |
| 09 | [bruker-sletting](09-bruker-sletting.md) | GDPR-rettigheter: soft-delete + asynkron opprydding via BullMQ-jobber. |
| 10 | [deployment-arkitektur](10-deployment-arkitektur.md) | Hvor tjenestene kjører i produksjon: Vercel, Heroku, GitHub Pages og Cloudflare som DNS/CDN/WAF/TLS-edge. |
| 11 | [sikkerhetslag](11-sikkerhetslag.md) | 15 sikkerhetslag — fra HTTPS/HSTS til AES-256-GCM-kryptering og PII-grense. |
| 12 | [bullmq-koer](12-bullmq-koer.md) | Asynkron jobbkjøring: én unified BullMQ-kø erstatter tre separate. |
| 13 | [use-case-diagram](13-use-case-diagram.md) | UML-style use case: aktører (student, admin, system, Canvas, Clerk) og 18 use cases. |
| 14 | [brukerreise](14-brukerreise.md) | Journey-diagram: studentens reise fra registrering til daglig bruk. |
| 15 | [cicd-pipeline](15-cicd-pipeline.md) | GitHub Actions-pipelinen: CI, sikkerhetsskanning, tester og deploy. |
| 16 | [milepaeler-tidslinje](16-milepaeler-tidslinje.md) | Gantt-diagram over hele bacheloroppgaveløpet 2026, med 5 milepæler. |
| 17 | [uml-klassediagram](17-uml-klassediagram.md) | UML klassediagram for backend-tjenestene: ansvar, metoder, avhengigheter og designmønstre. |
| 18 | [wbs-work-breakdown](18-wbs-work-breakdown.md) | Work Breakdown Structure: hierarkisk dekomponering i 6 hovedpakker med eierskapsmatrise. |
| 19 | [test-strategi](19-test-strategi.md) | Test-pyramide + dekningsmatrise: 1100+ enhetstester, 120 auth-scenarier, Playwright E2E. |
| 20 | [stride-trusselmodell](20-stride-trusselmodell.md) | STRIDE-kategorier med konkrete trusler og tiltak (visualisering av compliance/THREAT_MODEL.md). |

## Tematisk gruppering

| Tema | Diagrammer som dokumenterer det |
|------|----------------------------------|
| **Teknisk arkitektur** | 01, 02, 10 — system, monorepo, deployment. |
| **Kjerneflyter (sekvens)** | 03, 04, 05 — auth, KI-chat, Canvas-data. |
| **Data og persistens** | 06, 07, 12 — RAG, database (ER + NoSQL), asynkrone jobber. |
| **Sikkerhet og personvern** | 08, 09, 11, 20 — middleware, GDPR-sletting, defense-in-depth, STRIDE. |
| **Brukersentrert design** | 13, 14 — use cases og brukerreise. |
| **Kvalitet og leveranse** | 15, 19 — CI/CD og test-pyramide. |
| **Prosjektmetodikk** | 16, 18 — Gantt-tidslinje og WBS. |
| **UML-modeller** | 03, 04, 13, 17 — sekvens, use case, klasse. |

## Hva ble konsolidert

Tidligere hadde dokumentasjonen 26 mer granulære diagrammer. For å gi en mer overordnet oversikt er disse temaene slått sammen i bredere diagrammer:

- **Produksjonsmiljø-detaljer** er flettet inn i diagram 10 (deployment).
- **GDPR-livssyklus** er dekket av diagram 9 (bruker-sletting) og `compliance/DATA_RETENTION.md`.
- **NoSQL document-modell-detaljer** er dekket av diagram 7 (database-modeller).
- **Admin-dashboard** og **frontend-sitemap** er dekket av diagram 13 (use cases) og diagram 11 (admin-tilgang).
- **Dokumentprosessering** er dekket av diagram 6 (RAG-pipelinen).

Bevart fordi de er sentrale for bacheloroppgavens vurderingskriterier:

- **UML klassediagram (17)** — UML-modellering kreves for IT-bacheloroppgaver.
- **WBS (18)** — Work Breakdown Structure for prosjektmetodikk.
- **Test-strategi (19)** — Test-pyramide for QA-kapittelet.
- **STRIDE-trusselmodell (20)** — Standardrammeverk for sikkerhetsanalyse.

For dypere detaljer på spesifikke områder, se de tilhørende compliance-dokumentene i `compliance/`-mappa og kildekoden direkte.

## Visningstips

- **VS Code**: `Cmd+K V` åpner Markdown Preview side-by-side. Mermaid rendres direkte med utvidelsen "Markdown Preview Mermaid Support".
- **Nettleser**: Åpne `.md`-filen på GitHub — Mermaid rendres automatisk.
- **Word-rapport**: Bruk `png/`-versjonene som er ferdig rendret i høy oppløsning (2400 px bredde, scale 3).
- **Live-redigering**: <https://mermaid.live> — lim inn ```` ```mermaid ````-blokken.

## Konvensjoner

- All tekst og labels er på norsk, i samsvar med variabelnavn og kommentarer i kildekoden.
- Fargekoding: eksterne tjenester gult, datalag blått, applikasjon grønt, sikkerhetslag rødt, observabilitet lilla.
- Pildretninger speiler dataflyten, ikke bare modulavhengigheter.
