# Vedlegg M - Teknisk diagramkatalog

Dette vedlegget samler alle 21 tekniske diagrammene for StudyWise i én katalog. Hensikten er å gi sensor og videre utviklere full sporbarhet over arkitektur, sikkerhet, observabilitet og prosjektmetodikk uten at hovedrapporten blir tung. Hovedrapporten bruker Figur 1-13 (se `rapport-figurer/hovedrapport/`); resten ligger her som referansemateriale.

Hver oppføring under viser figurnummer for vedlegget (Figur M.N), PNG-fil til innsetting i Word, GitHub-lenke til ferdig PNG, og en kort forklaring av hva diagrammet viser. Mermaid-kildene ligger i `filer_prosjekt/diagrammer/*.md` som sporbar kilde, men sensor bør primært få PNG-lenkene fordi de viser ferdig rendret diagram.

## Slik bruker du katalogen

- Lim inn PNG-en fra `../../diagrammer/png/` til Word på riktig sted i vedlegget.
- Bruk figurteksten under "Bildetekst" som caption i Word.
- Bruk GitHub-lenken til PNG dersom diagrammet skal være klikkbart for sensor.
- Behold Mermaid-kilden som sporbar kilde. Hvis et diagram endres, oppdater både `.md`-kilden og generer ny PNG.

## Klikkbare PNG-lenker

For sensor er disse PNG-lenkene mest nyttige:

- [01 - Overordnet systemarkitektur](https://github.com/26zl/StudyWise/blob/main/filer_prosjekt/diagrammer/png/01-arkitektur-overordnet.png)
- [02 - Monorepo-struktur og pakker](https://github.com/26zl/StudyWise/blob/main/filer_prosjekt/diagrammer/png/02-monorepo-struktur.png)
- [03 - Autentisering og brukerflyt](https://github.com/26zl/StudyWise/blob/main/filer_prosjekt/diagrammer/png/03-autentiseringsflyt.png)
- [04 - KI-chat og modellkall](https://github.com/26zl/StudyWise/blob/main/filer_prosjekt/diagrammer/png/04-ki-chat-pipeline.png)
- [05 - Integrasjon mot Canvas LMS](https://github.com/26zl/StudyWise/blob/main/filer_prosjekt/diagrammer/png/05-canvas-integrasjon.png)
- [06 - Kunnskapsbase og RAG-flyt](https://github.com/26zl/StudyWise/blob/main/filer_prosjekt/diagrammer/png/06-kunnskapsbase-rag.png)
- [07 - Datamodeller og datalagring](https://github.com/26zl/StudyWise/blob/main/filer_prosjekt/diagrammer/png/07-database-modeller.png)
- [08 - Backend middleware-rekkefølge](https://github.com/26zl/StudyWise/blob/main/filer_prosjekt/diagrammer/png/08-middleware-stack.png)
- [09 - Sletting av bruker og tilhørende data](https://github.com/26zl/StudyWise/blob/main/filer_prosjekt/diagrammer/png/09-bruker-sletting.png)
- [10 - Deployment og infrastruktur](https://github.com/26zl/StudyWise/blob/main/filer_prosjekt/diagrammer/png/10-deployment-arkitektur.png)
- [11 - Sikkerhetslag i løsningen](https://github.com/26zl/StudyWise/blob/main/filer_prosjekt/diagrammer/png/11-sikkerhetslag.png)
- [12 - Jobbkøer og bakgrunnsprosesser (BullMQ)](https://github.com/26zl/StudyWise/blob/main/filer_prosjekt/diagrammer/png/12-bullmq-koer.png)
- [13 - Fullstendig use case-diagram](https://github.com/26zl/StudyWise/blob/main/filer_prosjekt/diagrammer/png/13-use-case-diagram.png)
- [14 - Brukerreise gjennom løsningen](https://github.com/26zl/StudyWise/blob/main/filer_prosjekt/diagrammer/png/14-brukerreise.png)
- [15 - CI/CD-pipeline](https://github.com/26zl/StudyWise/blob/main/filer_prosjekt/diagrammer/png/15-cicd-pipeline.png)
- [16 - Milepæler og tidslinje](https://github.com/26zl/StudyWise/blob/main/filer_prosjekt/diagrammer/png/16-milepaeler-tidslinje.png)
- [17 - UML-klassediagram](https://github.com/26zl/StudyWise/blob/main/filer_prosjekt/diagrammer/png/17-uml-klassediagram.png)
- [18 - Work Breakdown Structure](https://github.com/26zl/StudyWise/blob/main/filer_prosjekt/diagrammer/png/18-wbs-work-breakdown.png)
- [19 - Teststrategi](https://github.com/26zl/StudyWise/blob/main/filer_prosjekt/diagrammer/png/19-test-strategi.png)
- [20 - STRIDE-basert trusselmodell](https://github.com/26zl/StudyWise/blob/main/filer_prosjekt/diagrammer/png/20-stride-trusselmodell.png)
- [21 - Observability-stack](https://github.com/26zl/StudyWise/blob/main/filer_prosjekt/diagrammer/png/21-observability-stack.png)

## Sammendrag av plassering

| # | Diagram | Også brukt i |
|---|---|---|
| M.1 | Overordnet arkitektur | Hovedrapport figur 4 |
| M.2 | Monorepo-struktur | Hovedrapport figur 3 |
| M.3 | Autentiseringsflyt | Kun Vedlegg M |
| M.4 | KI-chat-pipeline | Hovedrapport figur 8 (forenklet) |
| M.5 | Canvas-integrasjon | Kun Vedlegg M |
| M.6 | Kunnskapsbase-RAG | Kun Vedlegg M |
| M.7 | Database-modeller (full) | Hovedrapport figur 5 (forenklet) |
| M.8 | Middleware-stack | Hovedrapport figur 10 |
| M.9 | Bruker-sletting | Kun Vedlegg M |
| M.10 | Deployment-arkitektur | Vedlegg J |
| M.11 | Sikkerhetslag | Kun Vedlegg M |
| M.12 | BullMQ-køer | Kun Vedlegg M |
| M.13 | Use case-diagram | Hovedrapport figur 2 / Vedlegg K |
| M.14 | Brukerreise | Kun Vedlegg M |
| M.15 | CI/CD-pipeline | Hovedrapport figur 11 |
| M.16 | Milepæler-tidslinje | Vedlegg I |
| M.17 | UML-klassediagram | Kun Vedlegg M |
| M.18 | WBS - Work Breakdown Structure | Kun Vedlegg M |
| M.19 | Test-strategi | Kun Vedlegg M |
| M.20 | STRIDE-trusselmodell | Kun Vedlegg M |
| M.21 | Observability-stack (Datadog/Grafana) | Kun Vedlegg M |

---

## Figur M.1 - Overordnet arkitektur

**PNG:** `../../diagrammer/png/01-arkitektur-overordnet.png`
**Mermaid-kilde:** `../../diagrammer/01-arkitektur-overordnet.md`

Komponentdiagram for hele løsningen: Next.js-frontend på Vercel, Express-backend på Heroku, MongoDB Atlas + Redis Cloud + Pinecone som datalag, og 10+ eksterne tjenester (Clerk, Anthropic, Cohere, Canvas LMS, Cloudflare Turnstile, PostHog, Datadog, LangSmith, Grafana). Brukes som inngangspunkt for å forstå hvilke teknologier som inngår og hvordan de henger sammen.

**Bildetekst:** *Figur M.1: Overordnet komponentdiagram for StudyWise med datalag og eksterne tjenester.*

---

## Figur M.2 - Monorepo-struktur

**PNG:** `../../diagrammer/png/02-monorepo-struktur.png`
**Mermaid-kilde:** `../../diagrammer/02-monorepo-struktur.md`

pnpm-workspace med fem pakker: `common/`, `backend/`, `frontend/`, `docs/`, `tests/`. Viser hvorfor `common/` må bygges først (fullstack-kontrakt via Zod-skjemaer eksportert som både runtime-validering og TypeScript-typer), og hvordan de andre pakkene importerer fra `common/`-subpath-eksportene.

**Bildetekst:** *Figur M.2: Monorepoet med fem pakker og build-rekkefølge.*

---

## Figur M.3 - Autentiseringsflyt

**PNG:** `../../diagrammer/png/03-autentiseringsflyt.png`
**Mermaid-kilde:** `../../diagrammer/03-autentiseringsflyt.md`

Sekvensdiagram for innlogging: bruker → Clerk-widget → Cloudflare Turnstile-verifisering → Clerk session → backend `requireAuth` → første gangs synkronisering via Clerk-webhook. Viser hvor TOTP/backup-koder delegeres til Clerk, og hvor StudyWise-backenden tar over og oppretter sin egen `User`-record.

**Bildetekst:** *Figur M.3: Sekvensdiagram for autentisering med Clerk og Cloudflare Turnstile.*

---

## Figur M.4 - KI-chat-pipeline

**PNG:** `../../diagrammer/png/04-ki-chat-pipeline.png`
**Mermaid-kilde:** `../../diagrammer/04-ki-chat-pipeline.md`

Sekvensdiagram for et KI-svar: frontend → backend `/api/ki/chat` → henting av Canvas-kontekst (hvis aktivert) → kunnskapsbase-RAG (Pinecone-vektorsøk + MongoDB BM25-keyword + Cohere-rerank) → Anthropic SSE-streaming → `<svarkilde>`-parsing → lagring i `ChatHistory`. Hovedrapportens figur 8 viser en forenklet versjon; denne er den fulle tekniske varianten.

**Bildetekst:** *Figur M.4: Full sekvensdiagram for KI-chat med hybrid retrieval, Cohere-rerank og svarkilde-tagg.*

---

## Figur M.5 - Canvas-integrasjon

**PNG:** `../../diagrammer/png/05-canvas-integrasjon.png`
**Mermaid-kilde:** `../../diagrammer/05-canvas-integrasjon.md`

Hvordan Canvas LMS-data hentes via brukerens lagrede token (AES-256-GCM-kryptert), caches i Redis (2 timers TTL for sync-strukturer), og hvordan emnerinnhold sendes videre til vektorindeksering i Pinecone.

**Bildetekst:** *Figur M.5: Canvas-integrasjon: token-bruk, caching og indeksering til vektorsøk.*

---

## Figur M.6 - Kunnskapsbase-RAG

**PNG:** `../../diagrammer/png/06-kunnskapsbase-rag.png`
**Mermaid-kilde:** `../../diagrammer/06-kunnskapsbase-rag.md`

Egen RAG-pipeline for personlig kunnskapsbase: dokument-opplasting → tekst-ekstraksjon → PII-maskering → chunking → embedding → indeksering i Pinecone + `KBContentChunk` i MongoDB. Spørretid: hybrid søk med `userId`-filter, Cohere-rerank, og fallback til keyword/recent ved tomme treff.

**Bildetekst:** *Figur M.6: Kunnskapsbase-RAG med personlig dokumentindeksering og keyword/recent-fallback.*

---

## Figur M.7 - Database-modeller (full)

**PNG:** `../../diagrammer/png/07-database-modeller.png`
**Mermaid-kilde:** `../../diagrammer/07-database-modeller.md`

Komplett ER-diagram for alle Mongoose-modeller med felt og typer. Inkluderer brukerrelasjoner, soft-delete (`DeletedUserTombstone` med TTL), audit-log-pseudonymisering, og ContentEmbedding som source-of-truth for chunk-tekst. Hovedrapportens figur 5 viser en forenklet variant.

**Bildetekst:** *Figur M.7: Full ER-modell for Mongoose-modellene med hard-delete og tombstone.*

---

## Figur M.8 - Middleware-stack

**PNG:** `../../diagrammer/png/08-middleware-stack.png`
**Mermaid-kilde:** `../../diagrammer/08-middleware-stack.md`

Express middleware-rekkefølge fra trust-proxy til feature-router: host/origin-validering → Cloudflare-only enforcement (prod) → Helmet med CSP-nonce → body parsers → Clerk-webhook (rå body) → CORS → CSRF → public routers → `requireAuth` → terms-sjekk → feature-routers med route-spesifikke rate-limits.

**Bildetekst:** *Figur M.8: Middleware-rekkefølge i backend med sikkerhetsgrenser markert.*

---

## Figur M.9 - Bruker-sletting

**PNG:** `../../diagrammer/png/09-bruker-sletting.png`
**Mermaid-kilde:** `../../diagrammer/09-bruker-sletting.md`

GDPR-flyten for kontosletting: `kontoSlett.ts` → soft-delete + `DeletedUserTombstone` → `clerkDeletion.queue.ts` (sletting i Clerk) + `pineconeCleanup.queue.ts` (vektorsletting) → audit-log-pseudonymisering. Viser retry-mekanikk og hvor TTL på tombstone tar over.

**Bildetekst:** *Figur M.9: Hard delete med tombstone og asynkron opprydding i Clerk og Pinecone.*

---

## Figur M.10 - Deployment-arkitektur

**PNG:** `../../diagrammer/png/10-deployment-arkitektur.png`
**Mermaid-kilde:** `../../diagrammer/10-deployment-arkitektur.md`

Produksjonsoppsettet: Vercel (frontend), Heroku (backend), GitHub Pages (docs), Cloudflare (DNS/CDN/WAF/TLS-edge), Cloudflare Worker for Resend e-post. Viser `requireCloudflare`-håndhevelsen som krever at trafikken faktisk kommer via Cloudflare-edge til Heroku origin.

**Bildetekst:** *Figur M.10: Deployment-arkitektur med Cloudflare som DNS/CDN/WAF/TLS-edge.*

---

## Figur M.11 - Sikkerhetslag

**PNG:** `../../diagrammer/png/11-sikkerhetslag.png`
**Mermaid-kilde:** `../../diagrammer/11-sikkerhetslag.md`

15 lag med defense-in-depth: fra HTTPS/HSTS, CSP med nonce, CSRF, rate limiting, `requireAuth`, `requireRecentAuth` (step-up) til AES-256-GCM-kryptering av Canvas-tokens, PII-maskering før Pinecone-indeksering, og prompt-injection-sanitering for KB-kontekst.

**Bildetekst:** *Figur M.11: Defense-in-depth med 15 sikkerhetslag fra TLS-edge til kryptografi.*

---

## Figur M.12 - BullMQ-køer

**PNG:** `../../diagrammer/png/12-bullmq-koer.png`
**Mermaid-kilde:** `../../diagrammer/12-bullmq-koer.md`

Asynkron jobbkjøring: én unified BullMQ-kø (`studywise-jobs`) håndterer alle bakgrunnsjobber — sletting i Clerk, opprydding i Pinecone, web-push, dokumentprosessering. Erstatter tidligere tre separate køer.

**Bildetekst:** *Figur M.12: Unified BullMQ-arkitektur med én kø for alle bakgrunnsjobber.*

---

## Figur M.13 - Use case-diagram

**PNG:** `../../diagrammer/png/13-use-case-diagram.png`
**Mermaid-kilde:** `../../diagrammer/13-use-case-diagram.md`

UML-style use case-diagram med seks aktører (student, admin, system, Canvas, Clerk, Pinecone) og 17 use cases gruppert etter funksjonsområde. Vedlegg K viser samme fullstendige diagram, mens hovedrapportens Figur 2 er en forenklet variant.

**Bildetekst:** *Figur M.13: Use case-diagram med aktører og hovedfunksjoner.*

---

## Figur M.14 - Brukerreise

**PNG:** `../../diagrammer/png/14-brukerreise.png`
**Mermaid-kilde:** `../../diagrammer/14-brukerreise.md`

Journey-diagram fra registrering via Canvas-tilkobling og kunnskapsbase-opplasting til daglig bruk: spørsmål i chat, generering av quiz og flashcards, og bruk av ukeplan. Markerer følelsesmessige høydepunkter og friksjon.

**Bildetekst:** *Figur M.14: Brukerreise for student fra registrering til daglig bruk.*

---

## Figur M.15 - CI/CD-pipeline

**PNG:** `../../diagrammer/png/15-cicd-pipeline.png`
**Mermaid-kilde:** `../../diagrammer/15-cicd-pipeline.md`

GitHub Actions: kvalitetsgates (lint, typecheck, unit-tester, build) → sikkerhetsskann (TruffleHog, SBOM, Trivy, OSV-Scanner) → integrasjons-/E2E-tester → deploy-gates (auto-deploy frontend til Vercel + docs til GitHub Pages; backend deployes via Heroku auto-deploys fra `main`).

**Bildetekst:** *Figur M.15: CI/CD-pipeline med kvalitets-, sikkerhets- og deploy-gates.*

---

## Figur M.16 - Milepæler-tidslinje

**PNG:** `../../diagrammer/png/16-milepaeler-tidslinje.png`
**Mermaid-kilde:** `../../diagrammer/16-milepaeler-tidslinje.md`

Gantt-diagram for hele bacheloroppgaveløpet 2026 med fem milepæler. Dupliseres i Vedlegg I.

**Bildetekst:** *Figur M.16: Gantt-tidslinje for prosjektgjennomføringen 2026.*

---

## Figur M.17 - UML-klassediagram

**PNG:** `../../diagrammer/png/17-uml-klassediagram.png`
**Mermaid-kilde:** `../../diagrammer/17-uml-klassediagram.md`

UML-klassediagram for backend-tjenestelaget: ansvarsfordeling mellom service-klasser, metode-signaturer, avhengigheter og designmønstre (Repository, Strategy, Adapter).

**Bildetekst:** *Figur M.17: UML-klassediagram for backend-tjenestelaget.*

---

## Figur M.18 - WBS (Work Breakdown Structure)

**PNG:** `../../diagrammer/png/18-wbs-work-breakdown.png`
**Mermaid-kilde:** `../../diagrammer/18-wbs-work-breakdown.md`

Hierarkisk dekomponering av prosjektarbeidet i seks hovedpakker (planlegging, krav, design, implementasjon, testing, dokumentasjon) med eierskapsmatrise på arbeidspakke-nivå.

**Bildetekst:** *Figur M.18: Work Breakdown Structure for bacheloroppgaven med eierskapsmatrise.*

---

## Figur M.19 - Test-strategi

**PNG:** `../../diagrammer/png/19-test-strategi.png`
**Mermaid-kilde:** `../../diagrammer/19-test-strategi.md`

Test-pyramide med dekningsmatrise: 1192 unit-tester (60 filer), 120 auth-scenarier i auth-matrix, og 11 Playwright E2E-spec-filer. Viser hvilke lag som testes hvor.

**Bildetekst:** *Figur M.19: Test-pyramide og dekningsmatrise for StudyWise.*

---

## Figur M.20 - STRIDE-trusselmodell

**PNG:** `../../diagrammer/png/20-stride-trusselmodell.png`
**Mermaid-kilde:** `../../diagrammer/20-stride-trusselmodell.md`

STRIDE-kategorier (Spoofing, Tampering, Repudiation, Information disclosure, Denial of service, Elevation of privilege) med konkrete trusler og motvirkende tiltak. Visualisering av `compliance/THREAT_MODEL.md`.

**Bildetekst:** *Figur M.20: STRIDE-trusselmodell med kategorier, trusler og tiltak.*

---

## Figur M.21 - Observability-stack (Datadog/Grafana)

**PNG:** `../../diagrammer/png/21-observability-stack.png`
**Mermaid-kilde:** `../../diagrammer/21-observability-stack.md`

Hvordan signaler fra frontend (`@datadog/browser-rum` v6.33.0, `studywise-frontend`) og backend (`dd-trace` v5.102.0, `studywise-backend` inkl. BullMQ-worker i samme prosess) flyter til Datadog (APM, RUM, Infrastructure, Logs, Profiling), og hvordan Grafana-dashboardet `/d/fbrdskw/studywize-observability` henter data via Datadog-plugin. Inkluderer Heroku log drain og dyno-integrasjon som eksternt oppsett, og parallelle observabilitetsløp (LangSmith for LLM-tracing, PostHog for produktanalyse) som ikke går via Datadog.

**Bildetekst:** *Figur M.21: Observability-stack med Datadog som sentral signal-mottaker og Grafana som dashboard-front.*
