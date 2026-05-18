# Trusselmodell — StudyWise

> **STRIDE-basert trusselmodell.** Identifiserer potensielle angrep mot
> kjernekomponenter og dokumenterer hvilke tiltak som finnes. Ikke
> uttømmende — supplerer `PIA.md` (risikovurdering) og `/sikkerhet`
> (brukerrettet).
>
> **Sist oppdatert:** 2026-04-18

## Scope

Dekker hovedangrep mot: Canvas-integrasjonen, AI-chatten, kunnskapsbase,
auth-flyten, admin-panelet, API-laget, og tredjeparts-avhengigheter.
Fysiske angrep og sosial manipulering behandles separat i
`INCIDENT_RESPONSE.md`.

## Aktivakartlegging

**Kritiske aktiva:**

1. **Canvas API-tokens** — gir lesetilgang til brukerens Canvas-konto. Kryptert AES-256-GCM.
2. **Chat-historikk** — kan inneholde PII og akademisk innhold. Kryptert blob per samtale.
3. **Kunnskapsbase-innhold** — brukerens dokumenter og notater.
4. **Brukerkontoer** — e-post, hashet passord (hos Clerk), 2FA-state.
5. **Admin-tilgang** — elevated privileges til systemmeldinger, sletting, audit-logger.
6. **`ENCRYPTION_KEY`** — AES-nøkkelen lagret i Heroku config vars.
7. **Audit-logger** — sikkerhets- og etterlevelsesspor.

## STRIDE-analyse

### S — Spoofing (identitetsforfalskning)

| Trussel | Vektor | Tiltak |
| ------- | ------ | ------ |
| Angriper logger inn som annen bruker | Stjålne credentials, session hijacking | Clerk-håndtert auth med obligatorisk MFA, backup codes som recovery-mekanisme, sikre cookies, Turnstile mot bot, rate-limiting på innlogging, step-up auth for sensitive ops |
| OAuth-konto-konflikt / account takeover | Samme Google/Microsoft-konto kobles til to brukere | `oauth_account_conflict`-logikk avviser nye signups som kolliderer, tombstone-sporing 90 dager |
| CSRF / forfalskede requests | Ondsinnet nettside sender requests i brukerens navn | Origin-validering, CSRF-token på state-endrende endepunkter |
| Falsk webhook | Spoofed Clerk webhook | Signatur-verifisering av Clerk webhook-secret, rå body-parsing |

### T — Tampering (endring av data)

| Trussel | Vektor | Tiltak |
| ------- | ------ | ------ |
| Angriper modifiserer data via injection | NoSQL injection, SQL injection, command injection | Mongoose (parametriserte queries), ingen raw eval, Zod-validering på alle input-grenser |
| Bypass av vilkår-aksept | Fjerner DOM-modal, kaller API direkte | Backend `requireAcceptedTerms`-middleware håndhever 403 for alle ikke-essensielle endepunkter; forsøk audit-logges |
| Tukling med rate-limit-tellere | Redis-manipulasjon | Redis i lukket VPC, ikke offentlig eksponert; nøkler er server-side generert |
| Opplastede filer med skjult innhold | Polyglot-filer, zip-bomber | Magic-byte-validering, file-type-sjekk, zip-bombe-deteksjon |
| XSS via systemmelding | Admin injiserer HTML | Zod avviser HTML-tagger ved input, React auto-escape ved rendering |

### R — Repudiation (fornektelse av handling)

| Trussel | Vektor | Tiltak |
| ------- | ------ | ------ |
| Bruker fornekter å ha akseptert vilkår | "Jeg godtok aldri" | `TERMS_ACCEPTED`-audit-logg med versjon, tidsstempel, IP, user-agent |
| Admin fornekter sensitive handlinger | "Jeg slettet aldri kontoen hans" | Alle admin-handlinger audit-logges; `ADMIN_ANNOUNCEMENT_PUBLISHED`, `ACCOUNT_DELETED`, osv. |
| Sletting blir angret | "Slettet ved uhell" | Step-up auth (45 min) + bekreftelse før kontosletting; delvis tombstone (90 dager) for OAuth-konflikter |

### I — Information Disclosure (datalekkasje)

| Trussel | Vektor | Tiltak |
| ------- | ------ | ------ |
| Canvas-token lekker | Logging, XSS, DB-dump | AES-256-GCM kryptering, kun server-side bruk, ingen logging av tokenet |
| Chat-innhold lekker | DB-dump, backup-komprimering | AES-256-GCM-blob per samtale; dekrypteres server-side kun for autorisert brukerflyt |
| PII i kunnskapsbase lekker til Pinecone | Brukerens egne dokumenter | Best-effort PII-sanitering før indeksering der det er relevant (e-post, telefon, fødselsnummer, studentnummer, norske adresser, signatur-navn) |
| Intern teknologi-lekkasje via status-side | Offentlig status avslører stack | Public `/status` mapper til brukerfokuserte buckets ("Innlogging", "KI-chat"); interne detaljer bak admin-gated `/health/dependencies` |
| Audit-logger eksponerer PII | IP/UA koblet til bruker | Pseudonymisering ved kontosletting; 24-måneders TTL; admin-only tilgang |
| SSRF mot intern infrastruktur | Web-crawler leser interne URL-er | SSRF-guard avviser lokale IP-er, link-local, metadata-endepunkter |

### D — Denial of Service

| Trussel | Vektor | Tiltak |
| ------- | ------ | ------ |
| Brute-force mot innlogging | Automatiserte login-forsøk | Clerk-rate-limit, Turnstile på registrering, lockout ved gjentatte feil |
| API-flooding | Høy request-rate mot en endpoint | Rate-limit per IP + per bruker; fail-closed i prod for auth-endepunkter |
| Tungt KI-kall spam | Mange dyre Claude-kall | Per-bruker rate-limit på chat; Anthropic har egen modereringsrate |
| Stor fil-upload | DoS via minne/disk | Multer-limit (10MB), zip-bombe-deteksjon, timeout på parsing |
| Redis-nedetid | Cache-stampede, database-overbelastning | Fallback til direkte DB-lesing; 30s TTL absorberer polling |

### E — Elevation of Privilege

| Trussel | Vektor | Tiltak |
| ------- | ------ | ------ |
| Regular bruker får admin-privilegier | IDOR, role-spoofing via klientside | Rolle lagres server-side kun; `requireRole("admin")`-middleware på alle admin-ruter; ikke lest fra klientinput |
| Admin-takeover via stjålet sesjon | Session fixation, XSS | Step-up auth (sensitive operasjoner krever reauth innen 45 min); sikre cookies; kort sesjonsløpetid |
| Bypass av `requireAuth` | Missing middleware | Global middleware på alle `/api/*` bortsett fra eksplisitte public-paths (whitelist) |
| Canvas-token gir uautorisert skrivetilgang | Token misbruk | Vi bruker kun read-only mot Canvas; token-scope begrenset av bruker i Canvas |

## Tredjeparts-risiko

Alle leverandører i [`SUBPROCESSORS.md`](./SUBPROCESSORS.md) er SOC 2 Type II
eller tilsvarende sertifisert. Primære trusler:

- **Leverandør-brudd**: vi støtter oss på deres egne sikkerhetstiltak + DPA. Ved brudd: GDPR Art. 33-varsling til våre brukere innen 72 timer.
- **Supply-chain**: pinnede versjoner i `pnpm-lock.yaml`, OSV-Scanner + TruffleHog i CI.
- **Tilgang til brukerdata**: leverandører ser kun de data vi sender; vi sender minimalt (sanitert PII, anonyme IDer).

## Restrisiko

Akseptert av bachelor-teamet per PIA.md §8:

- Ingen formell 24/7 SOC — små team, incident-response baserer seg på at team-medlemmer følger med
- Ingen cyber-forsikring — uforholdsmessig dyrt for bachelor-scope
- PII-sanitering er best-effort — ustrukturerte personnavn kan slippe gjennom
- Enkelt-dyno-deploy — ingen formell DR-plan utover Heroku/MongoDB Atlas backup

## Revidering

Denne trusselmodellen revideres:

- Ved ny funksjonalitet som endrer angrepsflaten
- Ved endring av leverandører eller arkitektur
- Minst én gang per år
- Etter sikkerhetshendelser
