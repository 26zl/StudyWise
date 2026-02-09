# Endringslogg

Daglig oversikt over endringer i StudyWise-prosjektet, basert på commit-historikk. Hver dag viser hva som ble gjort og av hvem.

::: info
Prosjektet er under aktiv utvikling. Denne loggen oppdateres fortløpende.
:::

---

## 9. februar 2026

### Laurent (26zl)

- Fikset CI/CD-pipeline: deploy kun ved vellykket build, ikke på feilede bygg (`if: always()` → `if: success()`)
- Lagt til Vercel-secrets-oppsett for automatisk produksjonsdeployment
- Opprettet komplett endringslogg i VitePress-docs med daglig struktur og kreditering per bidragsyter
- Oppdatert introduksjonsside med prosjektbeskrivelse, teknologitabell og teamoversikt
- Fikset kodekvalitet i `SmartSuggestions` og `exportChat` (dobbel regex, dupliserte typer, hardkodet URL)
- Rettet markdown-lint-feil i `CLAUDE.md` og `CONTRIBUTING.md`
- Forbedret `clean:install`-script til å også kjøre `pnpm -r update` etter install
- Oppdatert avhengigheter i alle pakker (pino, rate-limiter-flexible, typescript-eslint, vue, html-react-parser, isomorphic-dompurify m.fl.)
- Generalisert Dockerfile med separate targets for backend og frontend (erstatter GCP-spesifikk versjon)
- Ny `docker-compose.yml` for lokal kjøring av hele stacken (MongoDB, Redis, backend, frontend)
- Oppdatert README.md med Docker-kommandoer og korrekt deployment-beskrivelse (Render/Vercel/Cloudflare)
- Oppdatert AGENTS.md: fikset `NEXT_PUBLIC_API_URL` → `INTERNAL_API_URL`, "OpenAI" → "HuggingFace", konsistent `pnpm --filter`-bruk
- Oppdatert CONTRIBUTING.md med Docker-seksjon og manglende common-filer (`chat.ts`, `document.ts`, `calendar-ui.ts`)
- Oppdatert CLAUDE.md med Docker-seksjon, deployment-info og manglende common-schemas
- Fjernet utdatert `zeit-token` fra CI og oppgradert Vercel-action fra v20 til v25

---

## 7. februar 2026

### Laurent (26zl)

- Kommentert ut deler av CI-workflow for midlertidig fiks

### Anwar (Hersino)

- Lagt til eksport av chat-samtaler til Markdown-format
- Lagt til smarte oppfølgingsforslag basert på KI-responsens kontekst

---

## 6. februar 2026

### Laurent (26zl)

- Ytelsesforbedringer og oppdaterte avhengigheter

---

## 5. februar 2026

### Laurent (26zl)

- Store ytelsesforbedringer
- Fiks for produksjonsmiljø

---

## 4. februar 2026

### Laurent (26zl)

- Sikkerhetsfikser for caching-lag
- Sikkerhet- og personvernherding (Security/Privacy hardening)
- Fikset header-komponent for mobilvisning
- Oppdaterte avhengigheter og diverse fikser

---

## 3. februar 2026

### Laurent (26zl)

- **Store forbedringer** i feilhåndtering, sikkerhet og personvern på tvers av backend og frontend
- Strukturelle forbedringer i backend og frontend
- Bedre brukeropplevelse (UI/UX)
- Lagt til Vercel-varsling i CI-workflow
- Oppdatert README.md
- Rydding i kodebasen

---

## 2. februar 2026

### Laurent (26zl)

- **Gjort klar for deployment til Google Cloud** - Docker-oppsett, CI-tilpasninger
- Fikset corepack-signaturfeil - bruker npm install for pnpm i Docker
- Satt `CI=true` under Docker build for å hoppe over env-validering
- Fikset riktig sti til standalone server og konsistente start-scripts
- Fjernet `NEXT_PUBLIC_API_URL`-krav - bruker relative paths med rewrites
- Fjernet ikke-aktive emner fra KI-chat-svar
- Endret kalenderlogikk til å bruke Canvas-data, fikset masse kode og logikk
- Diverse debugging og fikser for backend-oppstart i sky

### Abdinasir (Abdinasir909)

- Lagt til filtrering av oppgaver og frister basert på semester i `fetchAssignments` og `kiCanvas`
- Oppdatert systemprompt for KI-assistenten med detaljer om tilgjengelige data og forbud mot hallusinerende svar

---

## 1. februar 2026

### Laurent (26zl)

- **Forbedret feilhåndtering** over hele applikasjonen med bedre logikk
- Forbedret sikkerhet og personvern med klarere tilbakemeldinger til bruker
- Fikset kode, dataflyt, struktur og logikk
- Forbedret dataflyt på tvers av hele prosjektet, fikset avhengighetsproblemer
- Fikset canvas-fetching og bildehåndtering for KI-analyse
- Fikset responsiv kalender
- Fikset feil i logikk flere steder
- Forbedret fil-nedlasting og frontpage-håndtering for Canvas
- Skip env-validering i CI-miljø
- Fikset samtalehistorikk og auth-håndteringsfeil
- Sårbarhetsfikser (vuln fix)

### Abdinasir (Abdinasir909)

- Forbedret fargepalett for emner med unike farger per emne
- Lagt til hooks for TimeEdit og kombinert kalenderdata med filtre
- Forbedret `SettingsSection` med campusvalg og TimeEdit-informasjon
- Forbedret kalenderlogikk og lagt til API for kalender
- Lagt til OCR-støtte for bilder og skannede PDF-er

### Anwar (Hersino)

- Forbedret samtalehistorikk-logikk med kryptering (AES-256-GCM) og databaselagring

---

## 31. januar 2026

### Laurent (26zl)

- Lagt til funksjonalitet for å vise ressurser for emner som ikke bruker moduler
- Splittet opp logikk i frontend for bedre struktur
- Merge av `testinglaurent`-branch
- Dark mode-fiks
- Fikset kode og oppdatert avhengigheter

### Abdinasir (Abdinasir909)

- Forbedret Canvas-kontekst-håndtering i KI-chat
- La til kalenderkomponenter i egen mappe
- Implementert kalenderfunksjon med `CalendarHeader`, `CalendarGrid` og `CalendarSection`
- Oppdatert import av DOMPurify fra `isomorphic-dompurify` til `dompurify`
- Diverse fikser

### Anwar (Hersino)

- Lagre chat i databasen
- Lagt til logg-funksjon
- Lagt til chat-historikk med localStorage
- Lagt til kunngjøringsvisning
- Kalenderkomponent

---

## 30. januar 2026

### Laurent (26zl)

- **Lagt til JWT-autentisering og lokal auth** (e-post/passord)
- Mulighet for bruk av personlig Canvas-token
- Forbedret sikkerhet og personvern
- Endret UI/UX-logikk og pyntet på landing page
- Fikset Docker og avhengighetsproblemer
- Forbedret feilhåndtering på server
- Oppdatert README.md

### Abdinasir (Abdinasir909)

- **Ny funksjon: last opp PDF-er og få AI til å analysere dem**
- Lagt til PDF-opplasting, Markdown-rendering og typography-styling

### Anwar (Hersino)

- Implementert KI-chat-funksjonalitet (AI chat endpoint)

---

## 29. januar 2026

### Laurent (26zl)

- Lagt til visning og nedlasting av Canvas-modulers innhold (eksternt innhold)
- La til flere API-endepunkter for Canvas-kall
- Lagt til VitePress-docs for lettere dokumentasjon av endringer
- Fikset CI: setup pnpm før node for å aktivere caching
- Fikset docs: lagt til base path for GitHub Pages deployment
- Fjernet dependabot (ikke fungerende)
- Oppdatert avhengigheter og diverse fikser

---

## 28. januar 2026

### Laurent (26zl)

- Endringer i navnekonvensjoner, ryddet i kode
- Fikset bruk av Zod-schema for common-dataflyt
- Kommentert kode
- Fjernet prosjektstrukturbeskrivelse (under aktiv utvikling)
- Dark mode-fiks
- Merge av `testinglaurent`-branch og diverse fikser
- Oppdatert avhengigheter

### Abdinasir (Abdinasir909)

- Lagt til OpenAI-avhengighet
- Oppdatert rate limiter til å bruke Redis
- Implementert chat-endpoint for KI-interaksjoner
- Forbedret `ChatSection`-komponent med ny chat-funksjonalitet
- Lagt til `useKIChat`-hook for chat-API-interaksjoner
- Oppdatert `DashboardPage` med dynamic import for ytelse

---

## 27. januar 2026

### Laurent (26zl)

- Endret struktur i backend, forbedret Canvas API-håndtering
- Lagt til backend-kode for håndtering av Canvas-token
- Optimalisert API-kall
- **Lagt til rate-limiting** for API-endepunkter
- UI/UX-prototype
- Lint og diverse fikser

---

## 26. januar 2026

### Laurent (26zl)

- Bruker global default-pakke for ESLint
- Lagt til HTML React-parsing og rettet opp sårbarheter
- **Lagt til Redis** for optimaliserte kall mot Canvas API
- Oppdatert pnpm og lagt til Redis i `.env.example`
- Ryddet i kode, bedre feilhåndtering og logging med Pino for debugging
- Lagt til kommentarer og fikset `docker-compose.dev`
- Fikset Docker, lagt til støtte for POSIX-systemer
- Konfigurasjonsendring, lagt til Turbopack
- Diverse endringer og navnendringer

### Abdinasir (Abdinasir909)

- Ny KiChat UI med animerte gradient-orbs og støtte for light/dark mode
- Revert av KiChat UI-endring

---

## 25. januar 2026

### Laurent (26zl)

- **Lagt til CI/CD** for automatisk build/lint/typecheck og installering av pakker
- **Lagt til grunnstruktur for integrert KI** med forklaringer og endringer
- La til Dependabot for hjelp til oppdatering av pakker
- Nye kommentarer, små endringer i struktur og kode i frontend
- Endring i kommentarer, fjernet hardkodede fallbacks
- Endret `docker-compose`, lagt til `agent.md` for sikker AI-bruk
- Filnavnendringer og små endringer

---

## 24. januar 2026

### Laurent (26zl)

- **Grunnstruktur** for hele prosjektet lagt på plass

---

## 12. januar 2026

### Laurent (26zl)

- **Initial commit** - første versjon av prosjektet
- Endret struktur
- Lagt til workflow for Discord-varsling
- Testing av oppsett
