---
layout: home

hero:
  name: "StudyWise"
  text: "KI-basert studieassistent"
  tagline: Smidigere studiedag med Canvas-integrasjon og kunstig intelligens

features:
  - title: Canvas LMS-integrasjon
    details: Henter emner, oppgaver, frister, moduler, kunngjøringer og ressurser direkte fra Canvas ved ditt lærested. Alt samlet i ett dashboard.
  - title: KI-studieassistent
    details: Still spørsmål om pensum, last opp PDF-er og bilder for analyse, få quiz, flashcards og oppgavenedbrytning. KI-genererte ukeplaner tilpasset dine frister.
  - title: Eksport og deling
    details: Eksporter KI-innhold til PDF, Word, Excel eller Notion. Del samtaler med andre via sikre lenker med utløpstid.
  - title: Kalender og frister
    details: Kombinert kalendervisning med Canvas-frister og oppgaver, filtrert per semester og emne.
  - title: Sikkerhet og personvern
    details: Ende-til-ende-kryptering av chat-historikk (AES-256-GCM), Clerk-autentisering, rate-limiting, CSRF-beskyttelse og GDPR-bevisst dataflyt.
---

# Om prosjektet

**StudyWise** er en KI-basert studieassistent utviklet som bacheloroppgave i IT ved Universitetet i Sørøst-Norge (USN), 2026. Målet med prosjektet er å gi studenter ett samlet verktøy som kobler sammen læringsplattformen Canvas med kunstig intelligens, slik at studenter kan jobbe smartere og mer effektivt med studiene sine.

Prosjektet kombinerer datainnhenting fra Canvas LMS med KI-drevet analyse og interaksjon, alt tilgjengelig gjennom et moderne og responsivt dashboard. Studenter kan blant annet få oversikt over emner og frister, stille spørsmål til en KI-assistent, og analysere dokumenter — uten å måtte veksle mellom flere verktøy.

::: warning Prosjektet er under aktiv utvikling
StudyWise er et pågående bachelorprosjekt (2026). Funksjonalitet, design og tekniske løsninger kan endres. Dokumentasjonen holdes så oppdatert som mulig; ved avvik sjekk kildekoden.
:::

## Arkitektur

StudyWise er bygd som et **pnpm-monorepo** med fire pakker: `frontend`, `backend`, `common` (delte Zod-skjemaer og TypeScript-typer) og `docs`. Frontend og backend deler datakontrakter gjennom `common`, som sikrer konsistens i validering og typer på tvers av hele stacken.

All kommunikasjon mellom bruker og backend går via frontend — frontend kaller aldri eksterne tjenester direkte. Next.js proxyer alle `/api/*`-forespørsler videre til Express-backendens. Backend er den autoritative sikkerhetsgrensen: autentisering, autorisering, validering og datahenting skjer alltid server-side.

### Dataflyt

```text
Canvas LMS → Backend (henter og validerer) → MongoDB/Redis (lagring og cache) → Frontend (viser til bruker)
Bruker → Frontend → Backend → KI-tjenester (Claude, Pinecone, Cohere) → Frontend (streamer svar)
```

## Teknologi

| Område | Teknologi |
| --- | --------- |
| **Frontend** | Next.js 16, React 19, TypeScript, Tailwind CSS v4, TanStack Query, Zustand, nuqs, react-hook-form, Zod, Lucide React, Sonner, next-themes |
| **Backend** | Express 5, Node.js 20+, TypeScript, Mongoose/MongoDB, undici (HTTP connection pooling) |
| **Auth** | Clerk (innlogging, SSO med Google/Microsoft, brukersynk) |
| **KI** | Anthropic Claude API, Cohere rerank (rerank-v3.5) for hybrid søk |
| **Cache** | Redis Cloud (Canvas API-cache, sync-struktur, KI-sesjonskontekst, rate limiting) |
| **Job-køer** | BullMQ (Clerk-sletting, Pinecone-cleanup, web-push m/ retry og dead-letter), integrert kø-admin i admin-panelet |
| **Vektorsøk** | Pinecone (serverless, integrated embedding); chunk-tekst i MongoDB som sannhetskilde |
| **Filer/dokumenter** | Multer, unpdf (PDF), mammoth (Word), tesseract.js + sharp (OCR) |
| **API** | Swagger UI + swagger-jsdoc, Helmet, CORS, compression, rate-limiter-flexible |
| **Logging/Observability** | Pino + pino-http, Datadog APM (backend) og RUM (frontend) |
| **Tooling** | syncpack (versjons-drift), knip (død kode), size-limit (bundle-budsjett) |
| **CI/CD** | GitHub Actions, Heroku (backend), Vercel (frontend), Cloudflare (CDN/WAF), GitHub Pages (docs) |
| **Dokumentasjon** | VitePress; bygges og publiseres til GitHub Pages ved endringer i `docs/` |

## Funksjonalitet

### Canvas-integrasjon

Studenter kobler til Canvas med et personlig API-token. Backend henter emner, oppgaver, frister, moduler, kunngjøringer, kalender, filer og ressurser fra Canvas-installasjonen ved brukerens lærested. Data caches i Redis for rask respons. En web crawler indekserer også eksterne lenker i Canvas-emner for å gjøre innholdet søkbart via KI-assistenten.

### KI-assistent

KI-assistenten lar studenter stille spørsmål om pensum, få forklaringer, og jobbe med studieinnhold interaktivt. Funksjoner inkluderer:

- **Chat med Canvas-kontekst** — spør om egne emner, oppgaver og kursinnhold
- **Dokumentanalyse** — last opp PDF, Word, PowerPoint, Excel, bilder og kodefiler for analyse og oppsummering
- **Quiz og flashcards** — KI-genererte øvingsverktøy basert på pensum
- **Oppgavenedbrytning** — store oppgaver brytes ned i håndterbare deloppgaver
- **Ukentlig studieplan** — KI-genererte studieplaner tilpasset frister og arbeidsmengde
- **Eksport** — alt KI-innhold kan eksporteres til PDF, Word, Excel, tekst eller Notion
- **Samtalehistorikk** — kryptert lagring av samtaler med mulighet for å dele via sikre lenker

Chat-historikk krypteres med AES-256-GCM i MongoDB. Studenter kan velge hvilke Canvas-data KI-en skal ha tilgang til per samtale.

### Kalender og oversikt

Et samlet dashboard viser alt som skjer i dag og de kommende dagene: frister, kunngjøringer, KI-generert ukeplan og studiestatistikk. Kalendervisningen kombinerer Canvas-frister og -oppgaver, filtrert per semester og emne.

### Brukeropplevelse

- Norsk (bokmål) og engelsk grensesnitt
- Responsivt design (mobil-først) med mørk modus
- Web push-varsler for frister og kunngjøringer
- Mulighet for å skjule emner man ikke følger aktivt

### Brukeradministrasjon

Innlogging via Clerk med støtte for e-post/passord, Google og Microsoft SSO. Brukere kan administrere profil, preferanser og Canvas-tilkobling. Full kontosletting med GDPR-tombstone sikrer at data slettes eller anonymiseres. Sensitive handlinger loggføres i et strukturert audit-system.

## Sikkerhet og personvern

Sikkerhet er integrert i hele stacken:

- **Kryptering**: Canvas API-tokens og chat-historikk krypteres med AES-256-GCM
- **Autentisering**: Clerk Bearer-token med valgfri 2FA; sesjoner håndteres via sikre cookies
- **CSRF**: State-endrende forespørsler krever en egen header og origin-validering
- **Rate limiting**: Per IP og per tjeneste (innlogging, KI, Canvas, kontaktskjema)
- **HTTPS og sikkerhetsheadere**: Helmet med nonce-basert CSP i produksjon
- **Personvern (GDPR)**: Ingen personidentifiserbar informasjon sendes til KI-tjenester uten anonymisering; cookie-samtykke for valgfrie målinger; full kontosletting med dataminimering
- **Infrastruktur**: Cloudflare (DDoS, SSL/TLS, bot-beskyttelse via Turnstile), Vercel og Heroku med tilgangskontroll
- **Åpen kildekode**: All kildekode er offentlig tilgjengelig på [GitHub](https://github.com/26zl/StudyWise)

## Testing og kvalitetssikring

Prosjektet har et flerlagsoppsett for testing og kvalitetssikring som kjøres både lokalt og i CI.

### Enhetstester

25 testfiler med ~714 tester (Vitest) fordelt på `common`, `backend` og `frontend`. Testene dekker skjemavalidering, feilhåndtering, kryptering, datoformatering, i18n, varsler, circuit breakers og mer.

### E2E og funksjonelle tester

Playwright brukes for ende-til-ende-tester av autentiseringsflyt, innlogging/registrering og sesjonshåndtering. CI kjører kun Chromium for rask pipeline; Firefox og WebKit kjøres lokalt.

En egen auth-scenariomatrise dekker 120 scenarier — signup uniqueness, OAuth-koblinger, brukernavn-oppdateringer, kontosletting og gjenbruk, sesjoner på tvers av faner, og race conditions. I tillegg kjøres HTTP-smoketester for auth-, KI- og Canvas-endepunkter.

### Sikkerhetsskanning

Sikkerheten er automatisert i CI-pipelinen:

- **TruffleHog** skanner git-historikk for lekkede hemmeligheter
- **OWASP Dependency-Check** kjøres ukentlig for sårbarheter i avhengigheter
- **eslint-plugin-security** (SAST) kjøres via `pnpm lint` i både frontend og backend
- **OSV-Scanner** skanner `pnpm-lock.yaml` mot OSV-databasen ved hver CI-kjøring
- **CycloneDX SBOM** genereres og lastes opp som artefakt ved hver build

## Deploy

| Tjeneste | Plattform | Trigger |
| -------- | --------- | ------- |
| Backend | Heroku (Professional dyno) | Auto-deploy fra `main` |
| Frontend | Vercel | Deploy-workflow etter CI er grønn |
| Dokumentasjon | GitHub Pages | Ved endringer i `docs/` |
| CDN/WAF | Cloudflare | Alltid aktiv |

Produksjon er tilgjengelig på [studwize.page](https://www.studwize.page).

## Teamet

| Medlem | GitHub | Rolle |
| ------ | ------ | ----- |
| **Laurent Zogaj** | [26zl](https://github.com/26zl) | Prosjektleder / Fullstack / KI, Canvas-integrasjon & Brukerhåndtering / Arkitekt / UI/UX / CI/CD |
| **Abdinasir** | [Abdinasir909](https://github.com/Abdinasir909) | Fullstack / KI-integrasjon og tjenester / UI/UX |
| **Anwar** | [Hersino](https://github.com/Hersino) | Fullstack / KI-integrasjon og tjenester / UI/UX |
| **Ylli Ujkani** | [yujk7](https://github.com/yujk7) | Dokumentasjon / Oversettelse |
