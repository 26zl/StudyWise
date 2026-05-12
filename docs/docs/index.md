---
layout: home

hero:
  name: "StudyWise"
  text: "KI-basert studieassistent"
  tagline: Smidigere studiedag med Canvas-integrasjon og kunstig intelligens

features:
  - title: Canvas LMS-integrasjon
    details: Demonstrerer innhenting av emner, oppgaver, frister, moduler, kunngjøringer og ressurser fra Canvas. Dagens personlige API-token er en prototype-løsning, ikke en offisiell institusjonsintegrasjon.
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
StudyWise er et pågående bachelorprosjekt (2026) og en teknisk prototype. Det er ikke en offisiell tjeneste fra USN, Canvas/Instructure eller andre læresteder. Funksjonalitet, design og tekniske løsninger kan endres. Dokumentasjonen holdes så oppdatert som mulig; ved avvik sjekk kildekoden.
:::

## Arkitektur

StudyWise er bygd som et **pnpm-monorepo** med fem pakker: `frontend`, `backend`, `common` (delte Zod-skjemaer og TypeScript-typer), `docs` og `tests` (integrasjons-/E2E-testkjøring). Frontend og backend deler datakontrakter gjennom `common`, som sikrer konsistens i validering og typer på tvers av hele stacken.

All kommunikasjon mellom bruker og backend går via frontend og Cloudflare-edge — frontend kaller aldri eksterne tjenester direkte. Next.js proxyer alle `/api/*`-forespørsler videre til `https://api.studwize.page`, som går gjennom Cloudflare før Express-backenden på Heroku nås. Backend er den autoritative sikkerhetsgrensen: autentisering, autorisering, validering og datahenting skjer alltid server-side.

### Dataflyt

```text
Canvas LMS → Backend (henter og validerer) → MongoDB/Redis (lagring og cache) → Frontend (viser til bruker)
Bruker → Cloudflare → Frontend → Cloudflare API-edge → Backend → KI-tjenester (Claude, Pinecone, Cohere) → Frontend (streamer svar)
```

### Fullstack-kontrakt

`common`-pakken fungerer som kontrakt mellom frontend, backend og tester. Endringer i API-skjemaer starter der, valideres med Zod og importeres av begge applikasjonene. Dette reduserer risikoen for at frontend forventer et annet dataformat enn backend faktisk leverer.

### Arkitekturvalg

| Valg                                    | Begrunnelse                                                                                             |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| pnpm-monorepo                           | Samler applikasjoner, delte typer, dokumentasjon og tester i ett repo med tydelige workspace-grenser.   |
| Vercel + Next.js                        | Gir rask frontend-deploy, god støtte for App Router og enkel intern proxying av `/api/*`.               |
| Heroku + Express                        | Samler server-side integrasjoner, kryptering, autorisering og RAG-flyt i ett backend-lag.               |
| Cloudflare foran de offentlige domenene | Gir DNS, TLS, WAF, DDoS-beskyttelse, bot-beskyttelse og cache-kontroll før trafikken treffer origin.    |
| Clerk                                   | Håndterer innlogging, SSO og sesjonsflyt uten at prosjektet må implementere egen auth-stack fra bunnen. |
| MongoDB, Redis og Pinecone              | Deler ansvar mellom varig lagring, hurtig cache/køtilstand og semantisk søk.                            |

## Teknologi

| Område                    | Teknologi                                                                                                                                 |
| ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| **Frontend**              | Next.js 16, React 19, TypeScript, Tailwind CSS v4, TanStack Query, Zustand, nuqs, react-hook-form, Zod, Lucide React, Sonner, next-themes |
| **Backend**               | Express 5, Node.js 24, TypeScript, Mongoose/MongoDB, undici (HTTP connection pooling)                                                     |
| **Auth**                  | Clerk (innlogging, SSO med Google/Microsoft, brukersynk)                                                                                  |
| **KI**                    | Anthropic Claude API, Cohere rerank (rerank-v3.5) for hybrid søk                                                                          |
| **Cache**                 | Redis Cloud (Canvas API-cache, sync-struktur, KI-sesjonskontekst, rate limiting)                                                          |
| **Job-køer**              | BullMQ (Clerk-sletting, Pinecone-cleanup, web-push m/ retry og dead-letter), integrert kø-admin i admin-panelet                           |
| **Vektorsøk**             | Pinecone (serverless, integrated embedding); chunk-tekst i MongoDB som sannhetskilde                                                      |
| **Filer/dokumenter**      | Multer, unpdf (PDF), mammoth (Word), tesseract.js + sharp (OCR)                                                                           |
| **API**                   | Swagger UI + swagger-jsdoc, Helmet, CORS, compression, rate-limiter-flexible                                                              |
| **Logging/Observability** | Pino + pino-http, Datadog APM (backend) og RUM (frontend), PostHog (produktanalyse, cookieless), LangSmith (KI-feilsøking)                |
| **E-postlevering**        | Resend (via Cloudflare Worker-relay for kontaktskjema)                                                                                    |
| **Tooling**               | syncpack (versjons-drift), knip (død kode)                                                                                                |
| **CI/CD**                 | GitHub Actions, Heroku (backend), Vercel (frontend), Cloudflare (CDN/WAF), GitHub Pages (docs)                                            |
| **Dokumentasjon**         | VitePress; bygges og publiseres til GitHub Pages ved endringer i `docs/`                                                                  |

## Funksjonalitet

### Canvas-integrasjon

I prototypen kobler studenter til Canvas med et personlig API-token. Backend henter emner, oppgaver, frister, moduler, kunngjøringer, kalender, filer og ressurser fra Canvas-installasjonen ved brukerens lærested. Data caches i Redis for rask respons. En web crawler indekserer også eksterne lenker i Canvas-emner for å gjøre innholdet søkbart via KI-assistenten.

Denne tokenflyten er ment for demonstrasjon og avgrenset testing. En produksjonsvariant bør bruke institusjonsgodkjent Canvas OAuth, LTI eller developer key, eventuelt kombinert med Feide/FS for identitet og studiedata der det er relevant.

### KI-assistent

KI-assistenten lar studenter stille spørsmål om pensum, få forklaringer, og jobbe med studieinnhold interaktivt. Funksjoner inkluderer:

- **Chat med Canvas-kontekst** — spør om egne emner, oppgaver og kursinnhold
- **Dokumentanalyse** — last opp PDF, Word, PowerPoint, Excel, bilder og kodefiler for analyse og oppsummering
- **Kunnskapsbase** — egne samlinger av lenker og filer som KI-en kan bruke som kontekst
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

Innlogging via Clerk med støtte for e-post/passord, Google og Microsoft SSO. Brukere kan administrere profil, preferanser og Canvas-tilkobling. Full kontosletting sikrer at data slettes eller anonymiseres. Ved oppdaterte vilkår bes brukere om å bekrefte på nytt, og aksepten logges som juridisk bevis. Sensitive handlinger revisjonslogges.

### Admin og drift

Admin har et eget panel for vedlikehold, brukerhåndtering og publisering av globale systemmeldinger (banner til brukere og/eller melding på driftsstatussiden). Offentlig [statusside](https://www.studwize.page/status) viser overordnet driftsstatus for kjernetjenestene slik at brukere kan sjekke at alt fungerer før de logger inn.

## Sikkerhet og personvern

Sikkerhet er integrert i hele stacken:

- **Kryptering**: Canvas API-tokens og chat-historikk krypteres med AES-256-GCM
- **Autentisering**: Clerk Bearer-token med valgfri 2FA; sesjoner håndteres via sikre cookies
- **CSRF**: State-endrende forespørsler krever en egen header og origin-validering
- **Rate limiting**: Per IP og per tjeneste (innlogging, KI, Canvas, kontaktskjema)
- **HTTPS og sikkerhetsheadere**: Helmet med nonce-basert CSP, HSTS preload og Cloudflare Full (strict) TLS til origin i offentlig demo / produksjonslik deploy
- **Personvern (GDPR)**: Dokumentert underleverandørbruk, best-effort PII-sanitering før KI-/søketjenester der det er mulig, cookie-samtykke for valgfrie målinger og full kontosletting med dataminimering
- **Infrastruktur**: Cloudflare (DDoS, WAF, SSL/TLS, cache-bypass for API, bot-beskyttelse via Turnstile), Vercel og Heroku med tilgangskontroll. Backend avviser direkte origin-trafikk som ikke kommer via Cloudflare-edge.
- **Åpen kildekode**: All kildekode er offentlig tilgjengelig på [GitHub](https://github.com/26zl/StudyWise)

### Avgrensninger og videre hardening

StudyWise er en bachelorprototype i produksjonslik drift. Videre arbeid bør prioritere institusjonsgodkjent Canvas-integrasjon (OAuth/LTI/developer key), avklaring av Sikt/personvern ved videre brukertesting, ny autentisert penetrasjonstest etter siste sikkerhetsendringer, videre optimalisering av Heroku-minnebruk og sterkere standardkrav til MFA/passkeys for administrative kontoer. Tredjepartsavhengigheter som Cloudflare, Vercel, Heroku, Clerk og KI-leverandører er bevisste arkitekturvalg og må vurderes videre i risiko- og personvernarbeid.

## Testing og kvalitetssikring

Prosjektet har et flerlagsoppsett for testing og kvalitetssikring som kjøres både lokalt og i CI.

### Enhetstester

Over 50 testfiler med 1190+ tester (Vitest) fordelt på `common`, `backend` og `frontend`. Testene dekker skjemavalidering, feilhåndtering, kryptering, datoformatering, i18n, varsler, circuit breakers, SSRF-guards, sanitization og mer.

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
- **GitHub Actions guardrail** nekter `pull_request_target` og delte package-manager-cacher i deploy/publish/privilegerte workflows
- **pnpm minimum release age** krever at nye npm-publiseringer er minst 5 dager gamle før de kan løses inn og håndheves med `pnpm lint:pnpm-security`
- **Trivy container-scan** skanner Dockerfile og backend-image for HIGH/CRITICAL funn
- **Vercel CLI** kjøres fra pnpm-locken via `pnpm exec`, ikke global `npm install`
- **Ukentlig dependency-update** kjører `pnpm update:safe` innenfor semver-rangene og `minimumReleaseAge`, slik at patch/minor-oppdateringer fortsatt tas inn etter release-age-vinduet

## Deploy

| Tjeneste      | Plattform                      | Trigger                           |
| ------------- | ------------------------------ | --------------------------------- |
| Backend       | Heroku (Node.js, tuned memory) | Auto-deploy fra `main`            |
| Frontend      | Vercel                         | Deploy-workflow etter CI er grønn |
| Dokumentasjon | GitHub Pages                   | Ved endringer i `docs/`           |
| CDN/WAF       | Cloudflare                     | Alltid aktiv                      |

Offentlig demo / produksjonslik deploy er tilgjengelig på [studwize.page](https://www.studwize.page).

## Dokumentasjon og policyer

Prosjektet har offentlige policyer og intern dokumentasjon: [`SECURITY.md`](https://github.com/26zl/StudyWise/blob/main/.github/SECURITY.md) (sårbarhetsrapportering), [`PROTOTYPE_SCOPE.md`](https://github.com/26zl/StudyWise/blob/main/compliance/PROTOTYPE_SCOPE.md) (prototypeavgrensning), [`PIA.md`](https://github.com/26zl/StudyWise/blob/main/compliance/PIA.md) (personvernvurdering), [`INCIDENT_RESPONSE.md`](https://github.com/26zl/StudyWise/blob/main/compliance/INCIDENT_RESPONSE.md) (hendelseshåndtering) og [`CODE_OF_CONDUCT.md`](https://github.com/26zl/StudyWise/blob/main/.github/CODE_OF_CONDUCT.md) (adferdskodeks).

## Teamet

| Medlem            | GitHub                                          | Rolle                                                                                            |
| ----------------- | ----------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| **Laurent Zogaj** | [26zl](https://github.com/26zl)                 | Prosjektleder / Fullstack / KI, Canvas-integrasjon & Brukerhåndtering / Arkitekt / UI/UX / CI/CD |
| **Abdinasir**     | [Abdinasir909](https://github.com/Abdinasir909) | Fullstack / KI-integrasjon og tjenester / UI/UX                                                  |
| **Anwar**         | [Hersino](https://github.com/Hersino)           | Fullstack / KI-integrasjon og tjenester / UI/UX                                                  |
| **Ylli Ujkani**   | [yujk7](https://github.com/yujk7)               | Dokumentasjon / Oversettelse                                                                     |
