# Konkret fix-liste for selve bachelor-rapporten (Word)

Denne filen samler alle endringene du må gjøre i selve Word-dokumentet før innlevering. Repo-filene (diagrammer, leseguide, CLAUDE.md) er allerede oppdatert.

Bruk denne som sjekkliste. Gå seksjon for seksjon.

---

## 1. Brukertest-tall (SUS og NPS) — fjern alle TODO-er

Bruk teksten fra [`rapporttekst-brukertest-todo-erstatninger.md`](rapporttekst-brukertest-todo-erstatninger.md) og lim inn følgende verdier:

- **SUS-gjennomsnitt: 80,5**
- **Standardavvik: 13,4**
- **NPS: 10**
- **n = 10** (7 IT-relaterte, 3 andre)
- **Promotører: 3, Passive: 5, Kritikere: 2**
- **Gjennomsnittlig anbefalingsskår: 7,8 / 10**

Steder å oppdatere:

- [ ] Sammendrag (siste avsnitt)
- [ ] Kapittel 4.6.1
- [ ] Kapittel 5.1.4
- [ ] Vedlegg E

---

## 2. Node-versjon: 22+ → 24

I kapittel 3.4.1 (Tabell 5, raden "Backend"):

- **Før:** `Express 5, Node.js 22+, TypeScript ES modules, Pino, Helmet`
- **Etter:** `Express 5, Node.js 24, TypeScript ES modules, Pino, Helmet`

Sjekk også om Node-versjonen nevnes andre steder i kapittel 3.3.1 eller 3.4 — bytt overalt.

---

## 3. Figur 3 (monorepo) — bytt feilaktig parallell-tekst

Figur 3-beskrivelsen i kapittel 3.3.1 sier feilaktig at backend/frontend/docs bygges parallelt.

- **Før:** «backend, frontend, docs parallelt → tests sist»
- **Etter:** «common bygges først, deretter bygges backend, frontend og docs sekvensielt av rotens build-script. Testene kjøres med egne testkommandoer (pnpm test:unit, pnpm test:auth osv.), ikke som del av build.»

---

## 4. Figur 5 (datamodeller) — bruk faktiske modellnavn

Den nåværende rapporten kan nevne modeller som ikke finnes som egne Mongoose-modeller (`KnowledgeBaseEntry`, `Notification`, `Bookmark`, `ChatShare`, `BullMqJob`).

Erstatt setningen i 3.3.3 med:

> Figur 5 viser de sentrale Mongoose-modellene: `User`, `CanvasUser`, `CanvasStructure`, `ChatHistory`, `ChatFeedback`, `SharedChat`, `Kunnskapsbase`, `KBContentChunk`, `ContentEmbedding`, `LagretQuiz`, `LagretFlashcardSett`, `Arbeidsplan`, `TaskBreakdown`, `StudyContext`, `AuditLog`, `ActivityLog`, `DeletedUserTombstone`, `WebPushSubscription`, `SystemAnnouncement`, `ContactMessage` og `FileExtractionStatus`.

---

## 5. Vedlegg L — docs-URL

Vedlegg L sier `https://docs.studwize.page`. Det riktige er GitHub Pages.

- **Før:** «En komplett brukerveiledning for StudyWise er publisert på prosjektets dokumentasjonsside (`https://docs.studwize.page`).»
- **Etter:** «En komplett dokumentasjonsside for StudyWise er publisert via GitHub Pages (`https://26zl.github.io/StudyWise/`).»

(Hvis du har satt opp DNS for `docs.studwize.page` og det faktisk svarer på den URL-en, behold den. Sjekk i Cloudflare DNS før innlevering.)

---

## 6. Tekst-fiks i kapittel 4.5.1 — PII-sanitering

Du nevner at PII-sanitering skjer «før den indekseres i Pinecone». Det er korrekt, men hvis du peker på spesifikk filsti, så bruk denne:

- Best-effort PII-maskering ligger i `backend/src/services/document.ts` (regex for e-post, telefonnummer, fødselsnummer, studentnummer og adresser)
- Prompt-tag-sanitering ligger i `backend/src/services/kunnskapsbase-indeksering.service.ts` (fjerner HTML-tagger og null-bytes for å hindre prompt-injection)

---

## 7. Kapittel 3.5.3 — "120 scenarier"

Bra påstand, men presiser at det er Grupper A-P:

- **Før:** «pnpm test:auth:matrix — Auth-scenarier som dekker uniqueness, OAuth-kobling, kontosletting og race conditions»
- **Etter:** «pnpm test:auth:matrix — 120 auth-scenarier organisert i Grupper A–P som dekker uniqueness, OAuth-kobling, kontosletting og race conditions»

---

## 8. Kapittel 3.5 og 4.7 — antall enhetstester

Hvis du vil nevne et konkret tall: **1192 enhetstester på tvers av common (438), backend (441) og frontend (313).**

E2E: **11 Playwright spec-filer** i `tests/auth/` og `tests/app/`.

---

## 9. Middleware-rekkefølge (3.4.5) — gjør den litt mer presis

Den nåværende listen mangler `pinoHttp`-logger og `compression`. Bytt den ut mot dette:

1. Trust proxy (TRUST_PROXY_HOPS)
2. Host- og origin-validering (kun i prod)
3. Cloudflare-only enforcement (kun i prod, hvis aktivert via `ENFORCE_CLOUDFLARE_ONLY=true`)
4. Helmet (CSP, HSTS, X-Frame-Options)
5. `express.urlencoded`
6. Request-ID middleware (for korrelasjon)
7. `pino-http` (strukturert logging)
8. `compression` (med SSE-bypass)
9. **Clerk webhook med rå body** (`express.raw`) før JSON-parser
10. `express.json({ limit: "10mb" })`
11. Request timeout
12. CORS-reject + `cors()` med allowlist
13. CSRF-beskyttelse
14. Offentlige API-ruter (kontakt, auth-turnstile, shared chat, public-status)
15. `requireAuth` (Clerk Bearer-token)
16. `requireAcceptedTerms`
17. Rute-spesifikk rate limiting + admin-rolle-sjekk
18. Feature-rutere (canvas, ki, kb, quiz osv.)
19. 404-handler + global error handler

---

## 10. CLAUDE.md-referansen i sikkerhetsdrøftingen

Hvis rapporten i 4.5 eller 4.8 viser til at `CLAUDE.md` styrer KI-assistert utvikling: bra. Den ble nylig oppdatert slik at PII-sanitering-referansen peker til riktig fil (`backend/src/services/document.ts`). Ingen handling kreves utover dette.

---

## 11. Tabell 7 (CI/CD) — Trivy-detaljer

Tabell 7 sier «Trivy: Skanner etter kjente sårbarheter der dette er konfigurert». Mer presist:

- **Trivy** skanner både Dockerfile-konfigurasjon og det bygde backend-imaget. Setter `severity: CRITICAL,HIGH`, `exit-code: 1`.

---

## 12. Avsnitt om compliance-dokumentene (3.6 eller drøftingen)

Vurder å legge til i 3.6.2 (GDPR i praksis), rett før «Personvernkonsekvensvurderingen er dokumentert...»:

> Personvern- og sikkerhetsarbeidet er videre dokumentert i `compliance/`-mappen i prosjektets repository, som inneholder `PIA.md` (Privacy Impact Assessment), `THREAT_MODEL.md` (STRIDE-modell), `DATA_RETENTION.md` (retention-policy), `ACCESS_CONTROL.md`, `INCIDENT_RESPONSE.md`, `SUBPROCESSORS.md` og `PROTOTYPE_SCOPE.md`. Disse fungerer som styrende dokumenter for det praktiske sikkerhetsarbeidet.

---

## 13. Vedleggsreferanser

- [ ] Vedlegg A (gruppekontrakt) — lim inn signert versjon eller henvis til fil i repoet
- [ ] Vedlegg B (MoSCoW) — ekspandere Tabell 4 til komplett matrise
- [ ] Vedlegg C (risikoanalyse) — ekspandere Tabell 2 til full risikoliste
- [ ] Vedlegg E (SUS-resultater) — bruk tallene i punkt 1
- [ ] Vedlegg F (skjermbilder) — se `filer_prosjekt/skjermbilder/README.md`
- [ ] Vedlegg G (repo + commit-hash) — sett `git tag bachelor-levering-2026-05-19` like før innlevering og lim inn hashen
- [ ] Vedlegg H (møtereferater) — sjekk antall faktiske møter mot påstanden «ca. 6–10»
- [ ] Vedlegg I (Gantt) — bruk `vedlegg-i-gantt-skjema.png` fra `rapport-figurer/vedlegg/`
- [ ] Vedlegg J (arkitekturdiagram) — bruk `vedlegg-j-arkitekturdiagram.png`
- [ ] Vedlegg K (use case) — bruk `vedlegg-k-use-case-diagram.png`
- [ ] Vedlegg L (brukerveiledning) — fiks URL (punkt 5 over)
- [ ] Vedlegg M (teknisk diagramkatalog) — fra `rapport-figurer/vedlegg/vedlegg-m-teknisk-diagramkatalog.md`

---

## 14. Roller og bidrag i 3.1.3

Erstatt TODO-er for Abdinasir, Anwar og Ylli med faktiske bidrag fra GitHub Insights. Sjekk:

```bash
git log --author="Abdinasir" --oneline | wc -l
git log --author="Anwar" --oneline | wc -l
git log --author="Ylli" --oneline | wc -l
```

eller bruk <https://github.com/26zl/StudyWise/graphs/contributors>.

---

## 15. Litteraturliste

Alle `[KILDE HER]`-plassholdere må erstattes med faktiske kilder før innlevering. Sortér alfabetisk på første forfatters etternavn, følg APA 7.

Sentrale kilder å vurdere (gruppene må selv slå opp og bekrefte):

- **Smidig utvikling**: Beck et al. (2001) — *Manifesto for Agile Software Development*
- **Scrum**: Schwaber & Sutherland (2020) — *The Scrum Guide*
- **Kanban**: Anderson (2010) — *Kanban: Successful Evolutionary Change for Your Technology Business*
- **Cone of Uncertainty**: McConnell (2006) — *Software Estimation: Demystifying the Black Art*
- **Cohen (2004)**: *User Stories Applied* — story points
- **MoSCoW**: Clegg & Barker (1994) — eller DSDM Consortium
- **REST**: Fielding (2000) — doktoravhandling om REST
- **UML use case**: Cockburn (2001) — *Writing Effective Use Cases*
- **Brukervennlighet (Nielsen)**: Nielsen (1994) — *Usability Engineering*
- **WCAG 2.1**: W3C (2018) — direkte fra w3.org
- **SUS**: Brooke (1996) — *SUS: A "quick and dirty" usability scale*
- **NPS**: Reichheld (2003) — *The One Number You Need to Grow*
- **SEQ**: Sauro & Lewis (2016) — *Quantifying the User Experience*
- **STRIDE**: Shostack (2014) — *Threat Modeling: Designing for Security*
- **OWASP Top 10**: OWASP (2021)
- **NSM grunnprinsipper**: NSM (2020) — *Grunnprinsipper for IKT-sikkerhet 2.0*
- **GDPR Art. 25**: EU (2016) — direkte sitering
- **RAG**: Lewis et al. (2020) — *Retrieval-Augmented Generation for Knowledge-Intensive NLP Tasks*
- **BM25**: Robertson et al. (1995) — *Okapi at TREC-3*
- **Hybrid retrieval / Cohere Rerank**: Cohere (2024) — produkt-dokumentasjon
- **Cross-encoder reranker**: Nogueira & Cho (2019)
- **Datatilsynet**: <https://www.datatilsynet.no/personvern-pa-ulike-omrader/>
- **EU AI Act**: EU (2024)

---

## Sjekkliste før levering

Når du har gått gjennom alle punktene over:

- [ ] Alle `[TODO]` og `[KILDE HER]` er borte fra hovedteksten
- [ ] Brukertest-tall er på plass (4 steder)
- [ ] Node 24 alle steder
- [ ] Figur 3-tekst er fikset
- [ ] Figur 5-modellnavn matcher koden
- [ ] Figur 7 er laget eller fjernet (se `figur-07-anbefaling.md`)
- [ ] Vedlegg L docs-URL er fikset
- [ ] Compliance-dokumentene er nevnt i 3.6.2
- [ ] Vedleggsreferanser er fylt ut
- [ ] Litteraturlisten er komplett, alfabetisert og i APA 7
- [ ] Roller/bidrag i 3.1.3 er konkrete
- [ ] Skjermbilder for Vedlegg F er tatt og satt inn
- [ ] Git-tag `bachelor-levering-2026-05-19` er opprettet og commit-hash er limt inn i Vedlegg G
