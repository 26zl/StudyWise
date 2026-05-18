# Vedlegg G - Teknisk diagramkatalog

Dette vedlegget samler de tekniske diagrammene som dokumenterer StudyWise. Hovedrapporten bruker bare utvalgte og forenklede figurer, mens denne katalogen gir en mer komplett oversikt over arkitektur, sikkerhet, dataflyt, testing, drift og prosjektmetodikk.

For sensor er PNG-lenkene mest relevante, fordi de viser ferdig rendret diagram. Mermaid-kildene ligger i `filer_prosjekt/diagrammer/` for sporbarhet og videre redigering.

## Hvordan lese katalogen

- Start med Figur G.1, G.2, G.4, G.8 og G.11 for rask teknisk oversikt.
- Bruk PNG-lenkene for lesing og vurdering.
- Bruk Mermaid-kildene hvis du vil se hvordan diagrammene er laget.
- Full oversikt ligger også i [`diagrammer/00-oversikt.md`](../../diagrammer/00-oversikt.md).

## Klikkbare PNG-lenker

| Figur | Diagram | PNG | Mermaid-kilde | Hva diagrammet dokumenterer |
|---|---|---|---|---|
| G.1 | Overordnet systemarkitektur | [PNG](https://github.com/26zl/StudyWise/blob/main/filer_prosjekt/diagrammer/png/01-arkitektur-overordnet.png) | [`01-arkitektur-overordnet.md`](../../diagrammer/01-arkitektur-overordnet.md) | Frontend, backend, datalagre og eksterne tjenester. |
| G.2 | Monorepo-struktur | [PNG](https://github.com/26zl/StudyWise/blob/main/filer_prosjekt/diagrammer/png/02-monorepo-struktur.png) | [`02-monorepo-struktur.md`](../../diagrammer/02-monorepo-struktur.md) | pnpm-workspace med `common`, `backend`, `frontend`, `docs` og `tests`. |
| G.3 | Autentiseringsflyt | [PNG](https://github.com/26zl/StudyWise/blob/main/filer_prosjekt/diagrammer/png/03-autentiseringsflyt.png) | [`03-autentiseringsflyt.md`](../../diagrammer/03-autentiseringsflyt.md) | Clerk, Turnstile, sesjon og backend-autentisering. |
| G.4 | KI-chat-pipeline | [PNG](https://github.com/26zl/StudyWise/blob/main/filer_prosjekt/diagrammer/png/04-ki-chat-pipeline.png) | [`04-ki-chat-pipeline.md`](../../diagrammer/04-ki-chat-pipeline.md) | Canvas-kontekst, RAG, reranking og streaming av KI-svar. |
| G.5 | Canvas-integrasjon | [PNG](https://github.com/26zl/StudyWise/blob/main/filer_prosjekt/diagrammer/png/05-canvas-integrasjon.png) | [`05-canvas-integrasjon.md`](../../diagrammer/05-canvas-integrasjon.md) | Tokenbruk, caching, Canvas-data og indeksering. |
| G.6 | Kunnskapsbase og RAG | [PNG](https://github.com/26zl/StudyWise/blob/main/filer_prosjekt/diagrammer/png/06-kunnskapsbase-rag.png) | [`06-kunnskapsbase-rag.md`](../../diagrammer/06-kunnskapsbase-rag.md) | Dokumentopplasting, chunking, Pinecone, MongoDB og Cohere-rerank. |
| G.7 | Database-modeller | [PNG](https://github.com/26zl/StudyWise/blob/main/filer_prosjekt/diagrammer/png/07-database-modeller.png) | [`07-database-modeller.md`](../../diagrammer/07-database-modeller.md) | Viktige Mongoose-modeller og relasjoner. |
| G.8 | Middleware-stack | [PNG](https://github.com/26zl/StudyWise/blob/main/filer_prosjekt/diagrammer/png/08-middleware-stack.png) | [`08-middleware-stack.md`](../../diagrammer/08-middleware-stack.md) | Backend-middleware, sikkerhetskontroller og avvisningspunkter. |
| G.9 | Bruker-sletting | [PNG](https://github.com/26zl/StudyWise/blob/main/filer_prosjekt/diagrammer/png/09-bruker-sletting.png) | [`09-bruker-sletting.md`](../../diagrammer/09-bruker-sletting.md) | GDPR-flyt for kontosletting og opprydding i eksterne tjenester. |
| G.10 | Deployment-arkitektur | [PNG](https://github.com/26zl/StudyWise/blob/main/filer_prosjekt/diagrammer/png/10-deployment-arkitektur.png) | [`10-deployment-arkitektur.md`](../../diagrammer/10-deployment-arkitektur.md) | Vercel, Heroku, Cloudflare, GitHub Pages og deployflyt. |
| G.11 | Sikkerhetslag | [PNG](https://github.com/26zl/StudyWise/blob/main/filer_prosjekt/diagrammer/png/11-sikkerhetslag.png) | [`11-sikkerhetslag.md`](../../diagrammer/11-sikkerhetslag.md) | Defense-in-depth: TLS, CSP, CSRF, rate limits, auth, kryptering og PII-tiltak. |
| G.12 | BullMQ-køer | [PNG](https://github.com/26zl/StudyWise/blob/main/filer_prosjekt/diagrammer/png/12-bullmq-koer.png) | [`12-bullmq-koer.md`](../../diagrammer/12-bullmq-koer.md) | Bakgrunnsjobber, retry og asynkron prosessering. |
| G.13 | Use case-diagram | [PNG](https://github.com/26zl/StudyWise/blob/main/filer_prosjekt/diagrammer/png/13-use-case-diagram.png) | [`13-use-case-diagram.md`](../../diagrammer/13-use-case-diagram.md) | Aktører og sentrale brukstilfeller. |
| G.14 | Brukerreise | [PNG](https://github.com/26zl/StudyWise/blob/main/filer_prosjekt/diagrammer/png/14-brukerreise.png) | [`14-brukerreise.md`](../../diagrammer/14-brukerreise.md) | Studentens reise fra registrering til daglig bruk. |
| G.15 | CI/CD-pipeline | [PNG](https://github.com/26zl/StudyWise/blob/main/filer_prosjekt/diagrammer/png/15-cicd-pipeline.png) | [`15-cicd-pipeline.md`](../../diagrammer/15-cicd-pipeline.md) | Kvalitetskontroller, sikkerhetsskann og deploy. |
| G.16 | Milepæler og tidslinje | [PNG](https://github.com/26zl/StudyWise/blob/main/filer_prosjekt/diagrammer/png/16-milepaeler-tidslinje.png) | [`16-milepaeler-tidslinje.md`](../../diagrammer/16-milepaeler-tidslinje.md) | Prosjektets milepæler og tidslinje. |
| G.17 | UML-klassediagram | [PNG](https://github.com/26zl/StudyWise/blob/main/filer_prosjekt/diagrammer/png/17-uml-klassediagram.png) | [`17-uml-klassediagram.md`](../../diagrammer/17-uml-klassediagram.md) | Backend-tjenester, avhengigheter og designmønstre. |
| G.18 | Work Breakdown Structure | [PNG](https://github.com/26zl/StudyWise/blob/main/filer_prosjekt/diagrammer/png/18-wbs-work-breakdown.png) | [`18-wbs-work-breakdown.md`](../../diagrammer/18-wbs-work-breakdown.md) | Prosjektarbeidet brutt ned i leveranser og arbeidspakker. |
| G.19 | Teststrategi | [PNG](https://github.com/26zl/StudyWise/blob/main/filer_prosjekt/diagrammer/png/19-test-strategi.png) | [`19-test-strategi.md`](../../diagrammer/19-test-strategi.md) | Testnivåer, testpyramide og kvalitetssikring. |
| G.20 | STRIDE-trusselmodell | [PNG](https://github.com/26zl/StudyWise/blob/main/filer_prosjekt/diagrammer/png/20-stride-trusselmodell.png) | [`20-stride-trusselmodell.md`](../../diagrammer/20-stride-trusselmodell.md) | Trusler og tiltak etter STRIDE. |
| G.21 | Observability-stack | [PNG](https://github.com/26zl/StudyWise/blob/main/filer_prosjekt/diagrammer/png/21-observability-stack.png) | [`21-observability-stack.md`](../../diagrammer/21-observability-stack.md) | Datadog, Grafana, LangSmith, PostHog, tracing, metrics og logs. |

Hele PNG-mappen kan også åpnes samlet:
[`filer_prosjekt/diagrammer/png/`](https://github.com/26zl/StudyWise/tree/main/filer_prosjekt/diagrammer/png)

## Kobling til hovedrapport og øvrige vedlegg

| Diagram | Bruk i rapportmaterialet |
|---|---|
| G.1 Overordnet arkitektur | Hovedrapport Figur 4 / Vedlegg E |
| G.2 Monorepo-struktur | Hovedrapport Figur 3 |
| G.4 KI-chat-pipeline | Hovedrapport Figur 8, forenklet variant |
| G.7 Database-modeller | Hovedrapport Figur 5 bruker forenklet variant: `07-database-modeller-forenklet.png` |
| G.8 Middleware-stack | Hovedrapport Figur 10 |
| G.13 Use case-diagram | Hovedrapport Figur 2 / Vedlegg F |
| G.15 CI/CD-pipeline | Hovedrapport Figur 11 |
| G.16 Milepæler og tidslinje | Vedlegg D |
| G.21 Observability-stack | Støtter Vedlegg H om observability |

## Kontrollnotat

PNG-eksportene er laget i høy oppløsning for innsetting i Word og lesing i GitHub. Dersom et diagram endres, bør både Mermaid-kilden og tilsvarende PNG oppdateres samtidig.
