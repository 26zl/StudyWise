# Rapport TODO — før innlevering

Samlet sjekkliste over alt som må fikses, legges til eller justeres i bacheloroppgaven før innlevering 19.05.2026. Strukturert som checkboxes — huk av etter hvert som du går gjennom i Word-dokumentet.

Filen er bygd opp i fem deler:

1. **Kritiske rester** (fiks først — 30 min, mest pinlig for sensor)
2. **Faktiske feil i tekst, tabell- og figurnummerering**
3. **Nytt innhold som skal legges inn** (pentest, compliance, AppSec, m.m.)
4. **Vedlegg som må fikses eller legges til**
5. **Språkvask** (kosmetisk, gjøres til slutt)

Ferdig-til-lim-inn-tekster ligger i `rapport-figurer/kilder/rapporttekst-manglende-tema-tillegg.md` for de temaene som allerede er skrevet ut.

---

## 1. Kritiske rester (30 min)

### TODO-rester som må slettes

- [ ] **§ 4.5.2, ca. s. 89**: slett `-----------------------REVIEW`
- [ ] **Litteraturlisten, s. 108**: slett `Markerer sketchy links med rød`
- [ ] **Under Figur 11, s. 71**: slett `Gjøre diagrammet litt mer tydelig kanskje?`
- [ ] **§ 4.4.2, første linje**: slett `Kan noen lese denne og evt justere på den`

### Tom/manglende innhold

- [ ] **§ 4.5.3 «Canvas hackerangrep, fikk oss til å tenke.»** — skriv ferdig seksjonen eller fjern overskriften. I dag bare en overskrift uten brødtekst.
- [ ] **Vedlegg E** — mangler helt. § 3.5.4 refererer til «Vedlegg E», men vedleggene hopper fra D til F. Enten lag Vedlegg E (SUS-rådata-tabell) eller fjern referansen i § 3.5.4.

---

## 2. Faktiske feil i tekst, tabell- og figurnummerering

### Datadog Session Replay (kritisk faktafeil)

- [ ] **§ 4.5.4** — feilaktig påstand «slått av som standard». Koden (`DatadogRum.tsx:127`) viser `sessionReplaySampleRate: 50`.

  Erstatt med:

  > Datadog Session Replay krever aktivt cookie-samtykke; når samtykke er gitt, samples 50 % av sesjonene med privacy-level `mask` (all tekst og bilder maskeres i replay).

### Figur 11 brukt to ganger

- [ ] **§ 3.4.5** + **§ 3.5.6** — samme figurnummer. Omnummerér:
  - Middleware = Figur 11 (behold)
  - CI/CD-pipeline = Figur **12** (var Figur 11)
  - Dataflyt med kryptering = Figur **13** (var Figur 12)
  - SUS-figur (§ 4.6.1) = Figur **14** (var Figur 13)

- [ ] **§ 3.4.5** — «Figur 10: visualiserer middleware-kjeden...» er feilformatert som bildetekst. Skal være brødtekst: «Figur 10 visualiserer middleware-kjeden...»

### Tabell-referanser i vedlegg peker feil

- [ ] **Vedlegg B**: «Tabell 2 i kapittel 3.2 viser et utdrag av MoSCoW» → MoSCoW er **Tabell 3**.
- [ ] **Vedlegg C**: «Tabell 1 i kapittel 3.1.5 viser et utdrag av risikoanalysen» → risikoanalyse er **Tabell 2**.

Faktisk tabellnummerering: 1 = Milepæler, 2 = Risikoanalyse, 3 = MoSCoW, 4 = Hovedteknologier, 5 = Testkommandoer, 6 = CI/CD, 7 = Sikkerhetstiltak.

### Tabell 6 har duplikater og manglende mellomrom

- [ ] **Tabell 6, s. 70** — fjern dupliseringen `OSV-Scanner OSV-Scanner` og `Trivy Trivy`, legg inn manglende mellomrom.

### To kulepunkter «Automatisert i CI» i § 3.5.6

- [ ] **§ 3.5.6** — slå sammen til ett kulepunkt:

  > **Automatisert i CI:** OWASP Dependency-Check (ukentlig), OSV-Scanner mot pnpm-lock.yaml (ved hver push), TruffleHog (gjennom git-historikken), eslint-plugin-security (SAST), CycloneDX SBOM-generering, og Dependabot (security advisories umiddelbart via GitHub Advisory Database; ordinære versjonsoppdateringer i samle-PR via `update-dependencies.yml` som kjører typecheck, lint og build).

### Mindre tekstfeil

- [ ] **§ 2.3.2, linje ca. 578**: manglende mellomrom etter punktum — `s. 235–247).Samtidig` → `s. 235–247). Samtidig`
- [ ] **TOC + kapitteloverskrifter**: «1. Innledning» (med punktum) vs «4 Drøfting» (uten) — velg én stil og bruk den konsekvent
- [ ] **Forordet**: dobbeltsjekk «Sundbø»-stavning på veileder
- [ ] **Litteraturlisten**: Store norske leksikon × 2 med kun `(u.å.)` — legg på `u.å.-a` og `u.å.-b` for å skille
- [ ] **Litteraturlisten**: `m'Raihi` med inkonsistent apostrof — bruk samme tegn overalt

---

## 3. Nytt innhold som skal legges inn

Ferdige tekstblokker for de fleste av disse ligger i `rapport-figurer/kilder/rapporttekst-manglende-tema-tillegg.md`. Pentest-tekstene (3.I, 3.J, 3.K, 3.L) er skrevet ut nedenfor i seksjon **3.5**.

### 3.1 Branch protection / Rulesets

- [ ] **§ 3.1.4 slutt** — legg til avsnitt om GitHub Rulesets på `main` og `backup` (blokkerer force-push og sletting, bypass kun for definerte roller). Hvis dere slår på «Require PR + status checks» i GitHub *først*, kan dere også nevne det.
- [ ] **Tabell 7 (§ 3.6.1)** — ny rad: «Branch protection (Rulesets) | Blokkerer force-push og sletting på main og backup; bypass kun for definerte roller og automatiseringer | Beskytter integriteten til produksjonsgrenen og sporbar historikk»

### 3.2 Security Headers A+ skann

- [ ] **§ 3.5.6** — legg til avsnitt om at produksjonsmiljøet ble testet med Security Headers-skann (resultat A+), med skjermbilde i Vedlegg K (figur K1).

### 3.3 Snyk og DeepScan som utviklingsnære skann

- [ ] **§ 3.5.6** — legg til avsnitt om at Snyk og DeepScan ble brukt som utviklingsnære verktøy via IDE/GitHub App-integrasjon, supplerende til CI-skannene. Konkret bevis: `.vscode/settings.json` har Snyk-organisasjons-ID konfigurert.

### 3.4 Henvisninger til Vedlegg J og K

- [ ] **§ 3.3.2** — legg inn henvisning til Vedlegg J (Teknisk diagramkatalog) for de detaljerte tekniske diagrammene.
- [ ] **§ 3.5.6 eller § 3.4.4** — legg inn henvisning til Vedlegg J for observability-diagrammet og Vedlegg K for skjermbilder fra observability-verktøy.

### 3.5 Pentest-utvidelse (største enkeltforbedring)

#### 3.5.0 Obligatorisk MFA og backup codes må inn i rapporten

- [ ] **§ 2.6.1** — presiser at StudyWise ikke bare støtter MFA, men at MFA er obligatorisk for alle brukere via identitetsleverandøren. Bruk denne formuleringen, men tilpass dersom håndhevingen ligger i Clerk Dashboard/task-konfigurasjon og ikke i egen backend-middleware:

  > I StudyWise er MFA obligatorisk for alle brukere. Identitetsleverandøren håndhever TOTP-faktor ved innlogging, mens applikasjonen synkroniserer MFA-status (`mfaEnabled`) og backup-code-status (`backupCodesEnabled`) til lokal User-modell for visning, audit og administrative formål. Backup codes støttes som recovery-mekanisme dersom brukeren mister tilgang til autentiseringsappen. StudyWise lagrer ikke TOTP-hemmeligheter eller backup-koder selv; dette håndteres av identitetsleverandøren.

- [ ] **Tabell 7 (§ 3.6.1)** — legg inn ny rad:

  | Tiltak | Detalj | Relevans |
  |---|---|---|
  | Obligatorisk MFA for alle brukere | MFA håndheves for alle nye og eksisterende brukere via identitetsleverandøren. Backup codes støttes som recovery-mekanisme. Lokal User-modell synkroniserer `mfaEnabled` og `backupCodesEnabled` fra identitetsleverandøren. | Reduserer risiko for kontoovertakelse betydelig, spesielt fordi kontoer kan ha koblet til Canvas-token og tilgang til chat-historikk, dokumenter og Canvas-data. |

- [ ] **Sammendraget** — legg inn MFA i setningen som oppsummerer sikkerhetstiltakene, f.eks.:

  > Sikkerhetsarbeidet omfattet blant annet obligatorisk MFA for alle brukere, backup codes som recovery-mekanisme, kryptering av Canvas-tokens og chat-historikk med AES-256-GCM, nonce-basert CSP i frontend via Next.js proxy, sikkerhetsheadere via Helmet i backend, CSRF-beskyttelse, rate limiting per endepunkt og pseudonymisering av audit-logger ved kontosletting.

- [ ] **§ 5.1.3 (F3 — Sikkerhet og personvern)** — ta med obligatorisk MFA i listen over konkrete sikkerhetstiltak:

  > ... obligatorisk MFA for alle brukere med backup codes som recovery-mekanisme, kryptering av sensitive data med AES-256-GCM, TLS i transitt, CSRF-beskyttelse ...

- [ ] **§ 4.5.5** — F-29 skal omtales som mitigert pentest-funn, ikke som akseptert risiko. Se ferdig omskrevet tekst i punkt 3.5.2 under.

- [ ] **Bevisgrunnlag** — siden obligatorisk MFA håndheves via identitetsleverandøren, legg gjerne inn et skjermbilde i Vedlegg K/L eller en kort verifikasjonslinje fra pentestrapporten som viser at nye/eksisterende brukere faktisk tvinges gjennom `setup-mfa` før de får bruke applikasjonen.

#### 3.5.1 Erstatt enslig «Manuell pentest»-kulepunkt i § 3.5.6

- [ ] Erstatt dagens kulepunkt med følgende lengre beskrivelse:

  > **Manuell pentest.** Som en del av sikkerhetsarbeidet gjennomførte vi en strukturert manuell penetrasjonstest av StudyWise i produksjon. Testen var organisert i tre faser etter en grey-box-tilnærming inspirert av OWASP Web Security Testing Guide: (1) rekognosering av angrepsflate, infrastruktur, headere og eksponerte endepunkter; (2) uautoriserte bypass- og injeksjonstester mot autentisering, kontoopprettelse, filopplasting, KI-pipeline og rate limiting; og (3) authenticated grey-box-testing av forretningslogikk, IDOR, BFLA, mass assignment og prompt injection som innlogget bruker.
  >
  > Totalt ble 35 funn dokumentert (F-01 til F-35). Pentesten dekket blant annet known-CVE-verifisering (CVE-2025-29927 Next.js middleware bypass og CVE-2025-55182 React Server Actions RCE — løsningen var ikke sårbar), NoSQL-injeksjon, prototype pollution, HTTP request smuggling, XSS, SQL injection, IDOR/BFLA og både direkte og indirekte prompt injection mot KI-pipelinen. Resultatet, inkludert reproduserbare kommando-logger og verifisering av mitigeringer, ligger i Vedlegg L (Pentestrapport).
  >
  > Verktøy brukt i pentesten inkluderte blant annet curl, httpie, jq, Burp Suite Community, ffuf og egne skript for repeterbar testing av API-endepunkter.

#### 3.5.2 Ny § 4.5.5 «Funn fra pentesten»

- [ ] Legg inn nytt underkapittel mellom § 4.5.4 og § 4.6:

  > ### 4.5.5 Funn fra pentesten
  >
  > Den manuelle penetrasjonstesten beskrevet i 3.5.6 avdekket primært to konkrete svakheter som er verdt å drøfte: F-14 (medium) og F-29 (lav). Begge funnene ble fulgt opp med konkrete mitigeringer i etterkant av testen.
  >
  > **F-14 — Cloudflare WAF-bypass via direkte Heroku-hostname.** Det viste seg at API-et kunne nås direkte mot Heroku-applikasjonens hostname utenom Cloudflare-edge. Konsekvensen var at WAF-regler, bot-beskyttelse og DDoS-mitigering kunne omgås ved å sende forespørsler rett til opprinnelsesserveren. Selv om Heroku-hostnamnet ikke er offentlig annonsert, må slike adresser anses som funnbare gjennom passiv rekognosering. Mitigeringen var å innføre en `requireCloudflare`-middleware tidlig i backendkjeden, som verifiserer at innkommende forespørsler kommer via Cloudflare før de slipper videre. Tiltaket ble verifisert med en ny test som bekreftet at direkte forespørsler nå returnerer 403. Dette er et godt eksempel på hvorfor edge-baserte sikkerhetsmekanismer må håndheves av opprinnelsesserveren i tillegg — edge alene gir falsk trygghet hvis backend godtar trafikk direkte.
  >
  > **F-29 — Multifaktorautentisering ikke obligatorisk.** Pentesten observerte i fase 2.5 at MFA ikke var håndhevet for nye brukere. Registrering og innlogging kunne fullføres uten at brukeren satte opp en TOTP-faktor. Etter pentesten ble dette mitigert: MFA er nå obligatorisk for alle brukere, og identitetsleverandøren krever oppsett av TOTP-faktor ved første innlogging. Backup codes ble samtidig lagt til som recovery-mekanisme for brukere som mister tilgang til autentiseringsappen. StudyWise synkroniserer MFA-status (`mfaEnabled`) og backup-code-status (`backupCodesEnabled`) fra identitetsleverandøren til lokal User-modell, men lagrer ikke TOTP-hemmeligheter eller backup-koder selv.
  >
  > Dette gjør F-29 til et eksempel nummer to, sammen med F-14, på hvordan pentesten drev fram arkitektoniske sikkerhetsforbedringer. F-14 reduserte risikoen for bypass av Cloudflare-laget, mens F-29 reduserte risikoen for kontoovertakelse. Begge tiltakene er særlig relevante fordi en kompromittert konto kan ha koblet til Canvas-token og tilgang til chat-historikk, dokumenter og Canvas-data.
  >
  > I tillegg ble tre lavnivå-funn dokumentert som akseptert restrisiko, mens de øvrige funnene i F-01 til F-35 var positive verifikasjoner av at vanlige angrep (NoSQL-injeksjon, prototype pollution, HTTP smuggling, IDOR, BFLA og direkte/indirekte prompt injection) ikke gikk gjennom. At pentesten kunne dokumentere et større antall negative funn er ikke uvesentlig: det viser at sentrale klasser av angrep faktisk ble forsøkt, ikke bare antatt mitigert.
  >
  > Pentesten illustrerer også et generelt poeng om sikkerhetstesting. Automatiserte skann (3.5.6) er gode til å fange kjente sårbarheter i avhengigheter og standardmønstre. Manuell pentest fanger det skannene ikke ser — arkitektoniske antakelser som F-14, hvor selve sikkerhetsmodellen, ikke koden, var svakheten, og baseline-svakheter som F-29, der identitetsflyten var funksjonell, men ikke sterk nok. Pentesten drev dermed ikke bare verifikasjon, men også to konkrete arkitektoniske endringer: `requireCloudflare` og obligatorisk MFA. De to tilnærmingene er komplementære, ikke alternativer.

#### 3.5.3 Korrigert § 4.7.2

- [ ] Erstatt dagens setning *«I prosjektperioden ble det ikke avdekket kritiske sårbarheter...»* med:

  > Pentesten avdekket én sårbarhet med medium alvorlighetsgrad (F-14: Cloudflare WAF-bypass via direkte Heroku-hostname), som ble mitigert ved å innføre `requireCloudflare`-middleware som avviser API-trafikk som ikke kommer via Cloudflare-edge. Den avdekket også ett funn med lav alvorlighetsgrad (F-29: MFA ikke obligatorisk), som ble mitigert ved å gjøre MFA obligatorisk for alle brukere og legge til backup codes som recovery-mekanisme. Begge tiltakene ble verifisert etter implementering. Ingen kritiske sårbarheter ble avdekket. Detaljer ligger i Vedlegg L (Pentestrapport). I tillegg fungerte de automatiserte CI-skannene som en viktig kontrollmekanisme, særlig for kjente sårbarheter i avhengigheter, lekkede hemmeligheter og Dockerfile-konfigurasjon.

#### 3.5.4 Nytt Vedlegg L (Pentestrapport)

- [ ] Se seksjon 4.3 nedenfor.

### 3.6 Underrepresenterte tekniske bidrag (nytt — ikke nevnt før)

Disse er konkrete artefakter i kodebasen som er kraftig undersolgt i rapporten.

#### 3.6.1 Konkrete tall i § 3.5.1 (enhetstester)

- [ ] **§ 3.5.1** — erstatt mild formulering «Enhetstester på tvers av pakkene» med konkrete tall:

  > Prosjektet har **1192 enhetstester fordelt på 60 testfiler** på tvers av common, backend og frontend. Testene dekker blant annet skjemavalidering, feilhåndtering, kryptering, datoformatering, språkfunksjoner, varsler, circuit breakers, SSRF-beskyttelse og sanitering. Testene kjøres med Vitest og inngår i den automatiserte CI-pipelinen.

  *(Tall fra diagram 19 — test-strategi. Bekreftet i kodebasen.)*

- [ ] **§ 3.5.2** — nevn også at det er **11 Playwright E2E-spec-filer** og **120 auth-scenarioer** i auth-matrisen.

#### 3.6.2 Compliance-dokumenter som artefakter (§ 3.6.2)

- [ ] **§ 3.6.2** — utvid eksisterende kortliste til faktisk beskrivelse. Compliance-mappa er **901 linjer fordelt på 7 dokumenter**:

  | Dokument | Linjer | Tema |
  |---|---|---|
  | PIA.md | 290 | Personvernkonsekvensvurdering med risikomatriser |
  | INCIDENT_RESPONSE.md | 144 | Hendelseshåndteringsplan |
  | ACCESS_CONTROL.md | 128 | Tilgangsstyring (rolle, segregation of duties) |
  | THREAT_MODEL.md | 113 | STRIDE-trusselmodell |
  | PROTOTYPE_SCOPE.md | 85 | Avgrensninger i prototypen |
  | DATA_RETENTION.md | 71 | Lagringstider per datatype |
  | SUBPROCESSORS.md | 70 | Liste over databehandlere |

  Forslag til ny formulering:

  > Prosjektet har en strukturert compliance-mappe på 901 linjer fordelt på sju dokumenter. `PIA.md` (290 linjer) er en personvernkonsekvensvurdering med risikomatriser per datatype og behandlingsformål. `INCIDENT_RESPONSE.md` (144 linjer) beskriver hendelseshåndteringsplan for kategorier som datalekkasje, kontokompromittering og leverandørbrudd. `ACCESS_CONTROL.md` (128 linjer) dokumenterer tilgangsstyring og segregation of duties. `THREAT_MODEL.md` (113 linjer) er en STRIDE-basert trusselmodell. `PROTOTYPE_SCOPE.md` (85 linjer) avgrenser hva bachelorprototypen ikke dekker som en produksjonsmoden tjeneste ville krevd. `DATA_RETENTION.md` (71 linjer) angir lagringstider per datatype. `SUBPROCESSORS.md` (70 linjer) lister alle eksterne databehandlere med formål og lokasjon. Dokumentene viser hvordan personvern og sikkerhet er vurdert som en del av utviklingsprosessen, ikke bare beskrevet i etterkant.

#### 3.6.3 CLAUDE.md som metodisk bidrag (§ 4.8.2 + § 5.2.1)

- [ ] **§ 4.8.2** — utvid beskrivelsen av CLAUDE.md fra «styringsdokument» til konkret innhold:

  > CLAUDE.md fungerer som en kontrakt mellom utviklere og KI-verktøy. Dokumentet er på omtrent 280 linjer og inneholder 12 «hard prohibitions» (eksplisitte forbud mot å svekke kryptografi, logge hemmeligheter eller PII, omgå validering, deaktivere sikkerhetsmiddleware eller migrasjoner, kjøre destruktive operasjoner uten godkjenning) og 10 «required practices» (typer-først, bruk av `apiError`-helpers, audit-logging av sensitive handlinger, Mongoose-only mot databasen, m.fl.). I tillegg har dokumentet en eksplisitt liste over filer og konfigurasjoner som ikke skal endres uten menneskelig godkjenning. Dette gir en strukturert mellomposisjon mellom ukritisk bruk av KI i utvikling og blank avvisning, og dokumentet er etterprøvbart både for sensor og for andre studentgrupper som vil bruke det som mal.

- [ ] **§ 5.2.1** — løft CLAUDE.md som ett av tre **metodiske hovedbidrag** (sammen med hybrid retrieval og praktisk sikkerhetsarkitektur). I dag er det nevnt, men ikke fremhevet som et substansielt eget bidrag.

#### 3.6.4 Datadog AppSec + IAST i Tabell 7 (§ 3.6.1)

- [ ] **Tabell 7** — ny rad:

  | Tiltak | Detalj | Relevans |
  |---|---|---|
  | Datadog Application Security + IAST | `DD_APPSEC_ENABLED` og `DD_IAST_ENABLED` er obligatoriske env-vars i produksjon (`validateEnv.ts:325-357`). Gir runtime attack detection (SQL injection, XSS, command injection) og Interactive Application Security Testing | Produksjons-grade sikkerhet utover statiske skann i CI |

#### 3.6.5 `requireCloudflare`-middleware (§ 3.3.4 eller § 3.6)

- [ ] **§ 3.3.4 Cloudflare-laget** — utvid med fjerde rolle/avsnitt:

  > I tillegg håndhever backend at API-trafikk faktisk kommer via Cloudflare. `requireCloudflare`-middleware verifiserer at peer-IP er innenfor Cloudflares offisielle IPv4/IPv6-ranges og at `CF-Connecting-IP`-headeren er satt. Trafikk som ikke oppfyller kravene returneres med 403. Dette tiltaket ble innført som mitigering for et pentest-funn (F-14, drøftet i 4.5.5), der det viste seg at API-et kunne nås direkte mot Heroku-hostnamnet utenom Cloudflare-edge.

#### 3.6.6 Prompt-injection-vern på indekseringstidspunkt (§ 3.6 eller § 4.4.2)

- [ ] **§ 3.6** eller **§ 4.4.2** — legg til avsnitt:

  > Prompt-injection-vern er implementert i to lag. På chat-input valideres og saniteres brukerens spørsmål før det inngår i prompten. På indekseringstidspunkt for kunnskapsbasen kjøres `sanitizeKBBodyText` og `sanitizeForPromptTag` (i `backend/src/services/kunnskapsbase-indeksering.service.ts`) som nøytraliserer prompt-injection-mønstre i dokumenter brukeren laster opp, før innholdet indekseres i Pinecone og senere brukes som kontekst. Dette er en bevisst forsvarsdybde mot indirekte prompt injection via opplastede filer — et angrep der en bruker kan plante instruksjoner i et dokument som senere brukes som kontekst av andre brukeres KI-spørsmål.

#### 3.6.7 Egendefinert soft-delete-lint (§ 3.5.6 eller § 3.6)

- [ ] Legg til at `scripts/lint-soft-delete.mjs` er en egen lint-regel som håndhever soft-delete-pattern (ingen direkte `User.deleteOne`, alltid via `kontoSlett.ts`). Dette er en uvanlig presis kvalitetskontroll på GDPR-flyten.

#### 3.6.8 Cloudflare Origin Certificate + Full strict TLS (§ 3.3.4)

- [ ] **§ 3.3.4** — legg til detalj om TLS-håndtering:

  > Transportlaget er delt i to krypterte ledd: bruker til Cloudflare termineres med Cloudflares Universal SSL (minimum TLS 1.2 på edge), mens Cloudflare til Heroku-origin kjøres med Full (strict) TLS mot et installert Cloudflare Origin Certificate (wildcard, gyldig til 2041). Dette gir end-to-end TLS, ikke bare frem til Cloudflare.

#### 3.6.9 Health-endepunkter (§ 3.4 eller § 3.6)

- [ ] Nevn at backend har dedikerte helse-endepunkter for produksjonsdrift: `/health` (liveness, fast, ingen eksterne kall), `/ready` (readiness, krever MongoDB-tilkobling), `/health/dependencies` (admin-only, detaljert status). Standard for produksjonsklar drift.

#### 3.6.10 Swagger UI / OpenAPI

- [ ] Nevn at backend-API-et er dokumentert som OpenAPI-spec og eksponert via Swagger UI på `/api-docs` i utviklingsmiljø.

#### 3.6.11 Migrasjoner append-only og idempotent (§ 3.3.3)

- [ ] **§ 3.3.3** — legg til avsnitt om at databasemigrasjoner er append-only og idempotente (kjøres én gang basert på unik ID, dokumentert i `backend/src/database/migrations.ts`). Eksisterende migrasjoner endres aldri; nye migrasjoner legges til. Dette er en hard guardrail i CLAUDE.md.

#### 3.6.12 PostHog som tredjepartstjeneste i § 4.4.4

- [ ] **§ 4.4.4 Leverandøravhengighet** — utvid listen over tredjepartstjenester til også å inkludere **PostHog**. I dag nevnes Anthropic, Pinecone, Cohere og Clerk, men PostHog (frontend-analytics) er også en tredjepartstjeneste som kan behandle klient-events utenfor EØS. Bør med i personvern- og leverandørdrøftingen for å være fullstendig.

### 3.7 Omskrevet sammendrag

- [ ] Skriv om åpningen av sammendraget slik at det leser mer som en pitch og mindre som tekniske spesifikasjoner:

  > StudyWise er en KI-basert studieassistent for høyere utdanning, utviklet våren 2026 som bacheloroppgave ved IT og informasjonssystemer, Universitetet i Sørøst-Norge. Løsningen samler Canvas-data, studentens egne dokumenter og en stor språkmodell i én flate, slik at studenten kan stille spørsmål, generere quiz, planlegge studieuken og holde oversikt over emner og frister på samme sted. Brukertesten med 10 studenter ga en SUS-skår på 80,5 av 100, og tilbakemeldingene førte til 11 konkrete kodeforbedringer i produksjon.

  Flytt deretter de tekniske detaljene (AES-256-GCM, CSP, monorepo osv.) lenger ned.

### 3.8 Nevne metodekapittelet i § 1.5

- [ ] **§ 1.5** — legg til ett kulepunkt:

  > Kapittel 3.5.7 beskriver det metodiske grunnlaget for evalueringen, inkludert kvalitative og kvantitative tilnærminger.

---

## 4. Vedlegg som må fikses eller legges til

- [ ] **4.1 Vedlegg E** — mangler helt. Lag (SUS-rådata-tabell anbefales) eller fjern referansen i § 3.5.4.

- [ ] **4.2 Vedlegg K** — eksisterer. Legg inn K1 (Security Headers A+ skjermbilde). Evt K2/K3 for Snyk/DeepScan-bilder hvis dere har dem.

- [ ] **4.3 Vedlegg L (nytt) — Pentestrapport**. Lim inn:

  > ### Vedlegg L — Pentestrapport
  >
  > Som en del av sikkerhetsarbeidet gjennomførte gruppa en strukturert manuell penetrasjonstest av StudyWise i produksjon. Den fullstendige pentestrapporten ligger i prosjektets repo som `filer_prosjekt/pentest-studwize.md` og dokumenterer 35 nummererte funn (F-01 til F-35), inkludert metodikk i tre faser (rekognosering, uautoriserte bypass- og injeksjonstester, authenticated grey-box-testing), reproduserbare kommando-logger, verifisering av kjente CVE-er (CVE-2025-29927, CVE-2025-55182), og verifikasjon av mitigeringen som ble innført etter at F-14 ble avdekket. Et utdrag er drøftet i kap. 4.5.5.

- [ ] **4.4 Vedlegg M (vurdér å legge til) — Compliance-dokumenter**. Kort sammendrag (≤ 1 side) av hva som ligger i `compliance/`-mappa, med henvisning til de syv dokumentene. Alternativt kan compliance-omtalen i § 3.6.2 utvides (se 3.6.2 ovenfor) uten eget vedlegg.

- [ ] **4.5 (Valgfritt) Vedlegg N — Prosjektartefakter**. Kort henvisning til:
  - `filer_prosjekt/manus-milepael-3.md` (286 linjer presentasjonsmanus)
  - `filer_prosjekt/kanban-brukerhistorier.txt` (114 linjer brukerhistorier)
  - `filer_prosjekt/teknisk-kanban-issues.txt` (287 linjer teknisk backlog)

  Viser at prosjektorganiseringen faktisk er dokumentert utenfor GitHub Projects.

---

## 5. Språkvask (kosmetisk)

- [ ] **«Lærdommen er at...» × 8** i kapittel 4 — bytt ut 4–5 med varianter (f.eks. «Vi sitter igjen med...», «I ettertid ser vi at...», «Dette bekrefter at...»)
- [ ] **«For det første / for det andre...» × 18+** — variér med «Først...», «Videre...», «I tillegg...», «Til slutt...»
- [ ] **«X handler ikke bare om Y, men også om Z» × 6+** — omformulér 2–3 av disse
- [ ] **Discord-redundans** (linje ~1798) — fjern dupliserende setning
- [ ] Sjekk at alle Vedlegg-referanser i brødteksten faktisk samsvarer med vedleggsnummer etter du har lagt til Vedlegg L (og evt. M, N)

---

## 6. Anbefalt arbeidsrekkefølge

For å unngå at endringer skygger for hverandre, gjør i denne rekkefølgen:

1. **Slett TODO-rester** (1.1–1.4) — 5 min, mest pinlig
2. **Fyll inn eller fjern § 4.5.3** — 5 min
3. **Datadog Session Replay-formuleringen** (2.1 Datadog) — 5 min
4. **Fiks Tabell 6-duplikater** og «Automatisert i CI»-bullet — 10 min
5. **Tabell-referanser i Vedlegg B og C** — 2 min
6. **Slå på Require PR + status checks i GitHub Rulesets** (gjør 3.1 sannferdig) — 10 min
7. **Bestem hvor Security Headers-bildet skal ligge** (Vedlegg K)
8. **Lim inn de tre pentest-blokkene** (3.5.1, 3.5.2, 3.5.3) — størst enkeltforbedring
9. **Lag Vedlegg L** (4.3) med henvisning til pentestrapporten
10. **Lim inn de andre tekstblokkene** (3.1–3.4, 3.6, 3.7, 3.8)
11. **Renummerér Figur 11/12/13/14** — krever søk gjennom dokumentet
12. **Korriger § 4.7.2** (3.5.3)
13. **Lag Vedlegg E** eller fjern referansen
14. **Konkrete tall i § 3.5.1** (3.6.1)
15. **Utvid § 3.6.2 compliance-omtalen** (3.6.2)
16. **Resten av de underrepresenterte temaene** (3.6.3 til 3.6.12)
17. **Skriv om sammendrag-åpningen** (3.7)
18. **Språkvask kap. 4** (seksjon 5)
19. **Siste leserunde:** TOC mot kapittelnummer, alle figur-/tabell-/vedlegg-referanser

**Total estimert tid:** 6–8 timer for én person, eller 3–4 timer fordelt på flere i parallell.

---

## 7. Hovedpoeng

Etter disse fiksene vil rapporten vise det arbeidet som faktisk er gjort:

- **Pentest** med 35 dokumenterte funn, ikke ett kulepunkt
- **Compliance** som 901 linjer reell dokumentasjon, ikke en filsti-liste
- **Tall** som viser ambisjonsnivå — 1192 tester, 120 auth-scenarioer, 11 E2E-spec-filer
- **Sikkerhetsarkitektur** som henger sammen — `requireCloudflare` som mitigering av F-14, AppSec + IAST som produksjons-lag, prompt-injection-vern i to lag, Origin Certificate til 2041
- **Metodisk bidrag** med CLAUDE.md som strukturert KI-kontrakt, ikke bare et notat
- **Produksjonsmodenhet** med health-endepunkter, Swagger, append-only migrasjoner

Det er en mye sterkere historie enn dagens versjon, og alt er forankret i kodebasen.
