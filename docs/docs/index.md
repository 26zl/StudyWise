---
layout: home

hero:
  name: "StudyWise"
  text: "KI-basert studieassistent"
  tagline: Smidigere studiedag med Canvas-integrasjon og kunstig intelligens

features:
  - title: Canvas LMS-integrasjon
    details: Henter emner, oppgaver, frister, moduler og ressurser direkte fra Canvas ved ditt lærested. Alt samlet i ett dashboard.
  - title: KI-studieassistent
    details: Still spørsmål om pensum, last opp PDF-er og bilder for analyse, og få smarte oppfølgingsforslag basert på kontekst.
  - title: Kalender og frister
    details: Kombinert kalendervisning med Canvas-frister og oppgaver, filtrert per semester og emne.
  - title: Sikkerhet og personvern
    details: Ende-til-ende-kryptering av chat-historikk (AES-256-GCM), Clerk-autentisering, rate-limiting og GDPR-bevisst dataflyt.
---

# Om prosjektet

**StudyWise** er en KI-basert studieassistent utviklet som bacheloroppgave i IT ved Universitetet i Sørøst-Norge (USN), 2026. Målet med prosjektet er å gi studenter ett samlet verktøy som kobler sammen læringsplattformen Canvas med kunstig intelligens, slik at studenter kan jobbe smartere og mer effektivt med studiene sine.

Prosjektet kombinerer datainnhenting fra Canvas LMS med KI-drevet analyse og interaksjon, alt tilgjengelig gjennom et moderne og responsivt dashboard. Studenter kan blant annet få oversikt over emner og frister, stille spørsmål til en KI-assistent, og analysere dokumenter - uten å måtte veksle mellom flere verktøy.

::: warning Prosjektet er under aktiv utvikling
StudyWise er et pågående bachelorprosjekt (2026). Funksjonalitet, design og tekniske løsninger kan endres. Dokumentasjonen holdes så oppdatert som mulig; ved avvik sjekk kildekoden.
:::

## Teknologi

Komplett oversikt over teknologier og tjenester som brukes i StudyWise:

| Område | Teknologi |
| --- | --------- |
| **Frontend** | Next.js 16, React 19, TypeScript, Tailwind CSS v4, TanStack Query, Zustand, nuqs, react-hook-form, Zod, Lucide React, Sonner, next-themes, Vercel Speed Insights |
| **Backend** | Express 5, Node.js 20+, TypeScript, Mongoose/MongoDB |
| **Auth** | Clerk (innlogging og brukersynk) |
| **KI** | Anthropic Claude API, Cohere rerank (rerank-v3.5) for hybrid søk |
| **Cache** | Redis Cloud (Canvas API, sync-struktur 2t TTL, KI-sesjon, rate limiting; anbefalt eviction `allkeys-lru`) |
| **Vektorsøk** | **Pinecone** (serverless, integrated embedding); chunk-tekst i MongoDB som sannhetskilde |
| **Filer/dokumenter** | Multer, unpdf (PDF), mammoth (Word), tesseract.js + sharp (OCR) |
| **API** | Swagger UI + swagger-jsdoc, Helmet, CORS, compression, rate-limiter-flexible |
| **Logging** | Pino + pino-http |
| **Monorepo** | pnpm workspaces med `frontend`, `backend`, `common`, `docs` |
| **CI/CD** | GitHub Actions (actionlint → quality → dependency-scan → secret-scan → sbom), Heroku (backend), Vercel (frontend), Cloudflare, GitHub Pages (docs) |
| **Observability** | Datadog APM (påkrevd i prod), RUM i frontend ved `NEXT_PUBLIC_DD_RUM_*` |
| **Dokumentasjon** | VitePress; bygges og publiseres til GitHub Pages ved endringer i `docs/` |

## Nåværende funksjonalitet

- **Canvas**: Emner, oppgaver, frister, moduler, kunngjøringer, kalender, filer og ressurser (hentes via backend, cache i Redis).
- **KI**: Generell chat, Canvas-kontekst-chat, dokumentanalyse (PDF/Word/bilder), oppsummering, task breakdown; chat-historikk kryptert i MongoDB.
- **Bruker**: Clerk-innlogging, profil, preferanser, kryptert Canvas-token, kontosletting; audit logging for sensitive handlinger.
- **Deploy**: Produksjon på [studwize.page](https://www.studwize.page); backend (Heroku), frontend (Vercel), dokumentasjon (GitHub Pages fra denne mappen).

## Teamet

| Medlem | GitHub | Rolle |
| ------ | ------ | ----- |
| **Laurent Zogaj** | [26zl](https://github.com/26zl) | Prosjektleder / Fullstack / Canvas-integrasjon / Arkitekt / UI/UX / CI/CD |
| **Abdinasir** | [Abdinasir909](https://github.com/Abdinasir909) | Fullstack / KI-integrasjon og tjenester / UI/UX |
| **Anwar** | [Hersino](https://github.com/Hersino) | Fullstack / KI-integrasjon og tjenester / UI/UX |
| **Ylli Ujkani** | [yujk7](https://github.com/yujk7) | Dokumentasjon / Oversettelse |
