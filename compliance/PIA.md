# Privacy Impact Assessment — StudyWise

> **Internt dokument.** Ikke publisert til brukere. Dokumenterer at vi har
> identifisert, vurdert og dokumentert personvern-risikoene i tjenesten i
> tråd med GDPR Art. 35 (Data Protection Impact Assessment) og ISO/IEC 27701.
>
> Revideres når ny funksjonalitet endrer risikoprofilen, eller minimum årlig.
>
> **Sist oppdatert:** 2026-05-08
> **Versjon:** 1.1
> **Ansvarlig:** Bachelor-teamet, StudyWise (USN)

## 1. Tjenestebeskrivelse

StudyWise er en KI-drevet studieassistent for høyere utdanning med Canvas
LMS-integrasjon. Brukeren kan chatte med Claude (Anthropic), laste opp egne
dokumenter til en kunnskapsbase, generere quiz/flashcards fra Canvas-pensum,
og se kalender/oppgaver fra sin Canvas-konto.

Tjenesten er utviklet som bacheloroppgave ved USN (2026), driftes av
studentene som behandlingsansvarlige, og er tilgjengelig på
<https://www.studwize.page>.

StudyWise er en bachelorprototype og teknisk demonstrator, ikke en offisiell
tjeneste fra USN, Canvas/Instructure eller andre læresteder. Se
[`PROTOTYPE_SCOPE.md`](./PROTOTYPE_SCOPE.md) for avgrensning av Canvas-token,
KI-bruk, testpersoner og krav før eventuell institusjonsutrulling.

Status per 2026-05-08: avgrenset testing med ca. 10 testpersoner er avsluttet,
og tilhørende kontoer/data er slettet. Videre testing med eksterne
testpersoner skal vurderes med veileder/personvernfunksjon og eventuelt Sikt
før ny behandling starter.

## 2. Personopplysninger vi behandler

| Kategori                   | Formål                | Lagringssted                  | Kryptering                        | Retention                                 |
| -------------------------- | --------------------- | ----------------------------- | --------------------------------- | ----------------------------------------- |
| E-post, navn, brukernavn   | Identifisering        | Clerk + MongoDB               | Transit + at-rest hos Clerk       | Inntil kontosletting                      |
| Canvas API-token           | Hente Canvas-data     | MongoDB                       | AES-256-GCM                       | Inntil bruker fjerner eller sletter konto |
| Chat-historikk             | Kjernefunksjon        | MongoDB                       | AES-256-GCM (kryptert blob)       | Inntil bruker sletter samtale eller konto |
| Kunnskapsbase (tekst)      | RAG-kontekst          | MongoDB + Pinecone (vektorer) | Transit + at-rest hos leverandør  | Inntil bruker sletter base eller konto    |
| Canvas-data cache          | Ytelse                | Redis                         | Transit + at-rest hos Redis Cloud | 2 timer TTL                               |
| Preferanser (UI, varsler)  | Personalisering       | MongoDB                       | Ukryptert (ikke-sensitiv)         | Inntil kontosletting                      |
| Audit logs                 | Sikkerhet, compliance | MongoDB                       | Pseudonymisert ved kontosletting  | Begrenset retention                       |
| IP, user-agent, request-ID | Misbruksdeteksjon     | MongoDB audit logs            | Pseudonymisert                    | Begrenset retention                       |

**Vi samler IKKE inn:**

- Passord (Clerk håndterer)
- Betalingsinformasjon (tjenesten er gratis)
- Sensitive kategorier iht. GDPR Art. 9 (helse, etnisitet, osv.)
- Barn under 13 år (aldersgrense på sign-up)

## 3. Rettsgrunnlag

- **Kontrakt (GDPR Art. 6(1)(b))** — for kjernefunksjonalitet (konto, chat,
  Canvas-integrasjon, kunnskapsbase).
- **Berettiget interesse (Art. 6(1)(f))** — for sikkerhet, misbruksdeteksjon,
  teknisk logging.
- **Samtykke (Art. 6(1)(a))** — for valgfri Datadog Session Replay, PostHog
  analytics, web-push-varsler.

## 4. Identifiserte risikoer

### 4.1 Canvas-token-lekkasje

**Sannsynlighet:** Lav · **Alvorlighet:** Høy · **Risk score:** Middels

Canvas-tokens gir lesetilgang til brukerens Canvas-konto. Lekkasje kan
eksponere kurs, oppgaver og karakterer.

**Tiltak:**

- Tokens krypteres med AES-256-GCM før lagring.
- ENCRYPTION_KEY lagres separat fra database (Heroku config vars).
- Tokens brukes kun server-side — eksponeres aldri til nettleser.
- Brukeren kan tilbakekalle token fra Canvas umiddelbart.
- Tokens er read-only på vår side (ingen skriveoperasjoner mot Canvas).

**Restrisiko:** Akseptabel for bachelor-scope. Ved lekkasje: breach-varsling
innen 72 timer, brukere informeres om å rotere tokens.

### 4.2 Eksponering av chat-historikk

**Sannsynlighet:** Lav · **Alvorlighet:** Middels · **Risk score:** Lav

Chat-historikk kan inneholde akademisk innhold, spørsmål om fag, og
indirekte PII brukeren har skrevet inn.

**Tiltak:**

- Chat-meldinger krypteres som én blob per samtale (AES-256-GCM).
- Bruker kan slette enkelt-samtaler eller hele historikken.
- Ved kontosletting slettes alt.

### 4.3 PII i opplastede dokumenter til Pinecone

**Sannsynlighet:** Middels · **Alvorlighet:** Middels · **Risk score:** Middels

Brukere laster opp dokumenter som kan inneholde PII (e-post, telefon,
studentnummer, navn i signaturer).

**Tiltak:**

- Automatisk PII-sanitering før Pinecone-indeksering (regex for e-post,
  telefon, fødselsnummer, studentnummer, norske adresser, signatur-navn).
- Dokument-innhold anonymisert i Pinecone (vektorer + tekstbiter uten ID).
- Ved sletting av kunnskapsbase eller konto slettes alt i Pinecone.
- Systemprompt instruerer KI-en om ikke å gjengi personnavn fra dokumenter.

**Restrisiko:** Ustrukturerte personnavn i løpende tekst kan slippe gjennom.
Dokumentert i `/personvern` som "best-effort".

### 4.4 AI-tjenesten (Anthropic) misbruker data

**Sannsynlighet:** Svært lav · **Alvorlighet:** Høy · **Risk score:** Lav

Anthropic kunne i teorien bruke input til modelltrening.

**Tiltak:**

- Anthropic har publisert DPA som forbyr trening på API-data.
- Vi sender minimalt — aldri e-post/navn/passord.
- EU-US DPF-sertifisert for lovlig overføring.

### 4.5 Session replay (Datadog) eksponerer innhold

**Sannsynlighet:** Lav · **Alvorlighet:** Middels · **Risk score:** Lav

Datadog Session Replay kunne i teorien ta opp sensitive data.

**Tiltak:**

- `defaultPrivacyLevel: "mask"` — all tekst erstattes med "xxx", bilder
  blurres.
- Kun aktivert for ~50 % av sesjoner, og kun etter samtykke i cookie-banner.
- Brukere kan trekke samtykke når som helst.

### 4.6 Admin-misbruk / innvendig trussel

**Sannsynlighet:** Lav · **Alvorlighet:** Høy · **Risk score:** Middels

Administratorer har utvidet tilgang i admin-panelet.

**Tiltak:**

- RBAC — `requireRole("admin")` på alle sensitive endepunkter.
- Step-up auth for kontosletting — admin må logge inn nylig.
- Alle admin-handlinger audit-logges.
- Prinsippet om minst tilstrekkelig tilgang.
- Bachelor-teamet er et lite, kjent team — lav baseline-risiko.

### 4.7 Databrudd hos tredjepart (Clerk, Pinecone, Cohere, MongoDB Atlas)

**Sannsynlighet:** Svært lav · **Alvorlighet:** Variabel · **Risk score:** Lav

**Tiltak:**

- Vi støtter oss på leverandørens egne sikkerhetsrutiner + DPA.
- Clerk er SOC 2 Type II-sertifisert.
- MongoDB Atlas, Pinecone og Cohere har egne compliance-sertifiseringer.
- Ved tredjepart-brudd: vi varsler egne brukere i tråd med GDPR Art. 33/34.

### 4.8 Misbruk av KI-funksjoner / akademisk uredelighet

**Sannsynlighet:** Middels · **Alvorlighet:** Middels · **Risk score:** Middels

Brukere kan bruke KI-svar, oppsummeringer, quiz, eksport eller
oppgavenedbrytning på en måte som bryter emne-, eksamens- eller
innleveringsregler.

**Tiltak:**

- Anthropic har innebygde modereringsmekanismer.
- Rate-limiting per bruker for å begrense misbruk.
- Logging for å kunne stoppe gjentatt misbruk.
- Brukervilkår forbyr juks, plagiat og akademisk uredelighet.
- Produkttekst i Canvas-kontekst og eksport minner brukere om å følge emnets
  regler og dokumentere KI-bruk der det kreves.

### 4.9 Canvas personlig API-token som prototypeflyt

**Sannsynlighet:** Høy ved bred bruk · **Alvorlighet:** Middels/Høy ·
**Risk score:** Middels/Høy

I prototypen kobler brukeren Canvas ved å opprette og lime inn et personlig
Canvas API-token. Dette gir StudyWise lesetilgang til samme Canvas-data brukeren
selv har tilgang til. For avgrenset demonstrasjon er dette praktisk, men det er
ikke riktig langsiktig modell for en flerbruker-/institusjonsintegrasjon.

**Tiltak:**

- Token lagres kryptert med AES-256-GCM og brukes kun server-side.
- StudyWise skriver ikke tilbake til Canvas.
- Bruker kan tilbakekalle tokenet i Canvas når som helst.
- Brukerrettet tekst og dokumentasjon markerer tokenflyten som
  prototype-/demo-løsning.
- Produksjonsvariant skal bruke institusjonsgodkjent Canvas OAuth, LTI eller
  developer key.

### 4.10 Canvas-/pensuminnhold til KI- og søketjenester

**Sannsynlighet:** Middels · **Alvorlighet:** Middels/Høy ·
**Risk score:** Middels/Høy

Canvas-innhold kan inneholde personopplysninger, opphavsbeskyttet materiale,
forelesningsnotater, oppgavetekster, kunngjøringer eller annet innhold brukeren
har tilgang til, men ikke nødvendigvis rett til å videresende til eksterne
tjenester.

**Tiltak:**

- Brukeren velger hvilke Canvas-datasett KI-en får tilgang til.
- Produkttekst og vilkår advarer mot bruk med sensitivt, taushetsbelagt eller
  opphavsbeskyttet materiale man ikke har rett til å behandle.
- PII-sanitering brukes der det er mulig, men dokumenteres som best-effort.
- Underleverandører og dataflyt er dokumentert i `SUBPROCESSORS.md`.
- Videre brukertesting eller produksjonsbruk krever ny vurdering av
  behandlingsansvar, databehandleravtaler, opphavsrett og institusjonsgodkjenning.

## 5. Overføring utenfor EØS

Flere leverandører har servere i USA:

- Anthropic (Claude) — EU-US DPF
- Pinecone — SCC + EU-US DPF
- Cohere — SCC
- Clerk — SCC + EU-US DPF
- Datadog — SCC + EU-US DPF
- PostHog — SCC
- LangSmith — SCC
- Resend (epost-levering) — SCC + EU-US DPF

Overføringene er basert på EU-kommisjonens Standard Contractual Clauses (SCCs)
og, der mulig, EU-US Data Privacy Framework.

## 6. Brukerrettigheter (GDPR Kap. III)

Alle rettigheter er implementert:

- **Innsyn (Art. 15)** — kontakt via skjema
- **Retting (Art. 16)** — via Innstillinger
- **Sletting (Art. 17)** — kontosletting med step-up auth; cascade-sletting
  via BullMQ
- **Dataportabilitet (Art. 20)** — eksport via kontaktskjema
- **Innsigelse (Art. 21)** — trekk samtykke i cookie-banner
- **Rett til klage (Art. 77)** — til Datatilsynet

## 7. Sikkerhetsarkitektur — oppsummering

- TLS 1.3 overalt
- AES-256-GCM for sensitive felt
- CSP, Helmet, CSRF-beskyttelse
- Rate limiting (per-IP og per-bruker)
- Magic-byte-validering av opplastede filer
- Sjekk av opplastede filer mot zip-bombe
- RBAC + step-up auth for sensitive operasjoner
- Audit logging med pseudonymisering ved sletting
- CI: OSV-Scanner, TruffleHog, SBOM-generering
- MFA-støtte via Clerk (brukervalgt)

Se `/sikkerhet`-siden for brukerrettet versjon.

## 8. Restrisiko og aksept

**Identifiserte restrisikoer som bachelor-teamet aksepterer:**

1. **Ingen cyber-forsikring** — bachelor-prosjekt uten inntekter; forsikring
   er uforholdsmessig dyrt relativt til risiko.
2. **PII-sanitering er best-effort** — dokumentert åpent i personvern.
3. **Manuelle DPA-forhandlinger med tredjeparter mangler** — vi bruker deres
   standard-DPA. Akseptabelt for vårt skala.
4. **Ingen utpekt DPO** — ikke påkrevd for vår skala iht. GDPR Art. 37.
5. **Enkelt-dyno-deploy** — ingen formell DR-plan utover Heroku/MongoDB Atlas
   sine egne backups.
6. **Canvas-token er prototypeflyt** — akseptabelt for bachelordemo og
   avgrenset testing, men må erstattes med institusjonsgodkjent OAuth/LTI eller
   developer key før reell utrulling.
7. **Institusjonell avklaring mangler for bred bruk** — videre testing med
   eksterne brukere må avklares med veileder/personvernfunksjon og eventuelt
   Sikt etter USNs retningslinjer.

## 9. Revisjon

Dette dokumentet gjennomgås:

- Ved ny funksjonalitet som endrer risikoprofilen
- Ved endring av leverandører eller tredjepartstjenester
- Ved databrudd
- Minimum én gang per år
