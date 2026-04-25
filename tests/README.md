# Tests

Integrasjonstester og debug-verktøy for StudyWise, organisert etter kategori.

## Kjøre tester

```bash
# Hovedkommandoer
pnpm test              # Kjør alle kategorier
pnpm test:auth         # Kun auth-tester
pnpm test:ki           # Kun KI-tester
pnpm test:canvas       # Kun Canvas-tester

# Auth Matrix (54 scenarier definert i scenario-definitions.ts)
pnpm test:auth:matrix         # Kjør alle executable scenarier
pnpm test:auth:matrix:basic   # Gruppe A: Basic signup uniqueness
pnpm test:auth:matrix:oauth   # OAuth-scenarier
pnpm test:auth:matrix:update  # Gruppe G: Username updates
pnpm test:auth:matrix:delete  # Gruppe I: Deletion/reuse
pnpm test:auth:matrix:session # Gruppe J: Session/cross-tab
pnpm test:auth:matrix:race    # Gruppe L: Race conditions

# Auth verktøy
pnpm test:auth:db      # DB-invariantsjekk (indekser, duplikater)
pnpm test:auth:smoke   # Auth HTTP smoke

# Playwright E2E (krever frontend + backend)
pnpm test:auth:e2e                        # Alle nettlesere
pnpm test:auth:e2e --project=chromium     # Kun Chromium
pnpm test:auth:e2e --project=firefox      # Kun Firefox
pnpm test:auth:e2e --project=webkit       # Kun WebKit

# Smoke-tester
pnpm test:ki:smoke     # KI HTTP smoke
pnpm test:canvas:smoke # Canvas HTTP smoke
```

## Struktur

``` text
tests/
  run.ts                  # Unified test runner
  playwright.config.ts    # Playwright config for E2E-tester
  tsconfig.json           # TypeScript-konfig for testfiler
  package.json            # Workspace-pakke med test-avhengigheter
  README.md               # Denne filen
  helpers/
    env.ts                # Felles env-lasting (backend/.env + frontend/.env)
    log.ts                # Felles logg-hjelpere
    a11y.ts               # Tilgjengelighets-hjelpere for axe-core
    verbose-logger.ts     # Detaljert logg-utdata for diagnostiske kjøringer
  auth/
    smoke.ts              # Auth-ruter (public + guard) smoke
    smoke-e2e.spec.ts     # Stabil Playwright smoke for auth-sider (CI-gate)
    login-signup-e2e.spec.ts  # Innlogging/registrering E2E (CI-gate)
    session-e2e.spec.ts       # Sesjons-håndtering E2E (CI-gate)
    late-conflict-e2e.spec.ts # Sen konfliktdeteksjon E2E (diagnostisk)
    email-update-e2e.spec.ts  # E-post-oppdatering E2E (diagnostisk)
    repro-e2e.spec.ts     # Diagnostisk Playwright repro for duplicate-signup
    check-db.ts           # DB-invariantsjekk (indekser, duplikater, normalisering)
    repro-api.ts          # API-basert auth duplicate reproduksjon
    repro-matrix.ts       # Matrix-runner (A/B/C/D + evidence JSON)
    global.setup.ts       # Clerk Playwright setup (Turnstile bypass)
  app/
    smoke-e2e.spec.ts         # Generell Playwright smoke for offentlige app-sider (CI-gate)
    navigation-e2e.spec.ts    # Navigasjon mellom sider og lenker (CI-gate)
    accessibility-e2e.spec.ts # @axe-core/playwright mot sentrale sider (CI-gate)
    api-security-e2e.spec.ts  # Sikkerhetsheadere, CSRF, CORS på /api/* (CI-gate)
    contact-e2e.spec.ts       # Kontaktskjema-flyt inkl. validering (CI-gate)
  ki/
    smoke.ts              # KI auth/public endpoint smoke
  canvas/
    smoke.ts              # Canvas endpoint smoke
```

## Forutsetninger

- **DB-sjekk** (`check-db.ts`): Krever `MONGO_URI` i `backend/.env`
- **Auth/KI/Canvas smoke**: Krever backend kjørende på `http://localhost:4000`
- **API-repro** (`repro-api.ts`): Krever backend kjørende med `ENABLE_DIAGNOSTICS=true` + `CLERK_SECRET_KEY`
- **E2E** (`repro-e2e.spec.ts`): Krever backend + frontend kjørende + Clerk publishable key
- **Valgfritt for KI dypere test**: Sett `TEST_AUTH_BEARER` for å teste `GET /api/ki/models` autentisert

## E2E-prinsipper

- Playwright er konfigurert med `trace/video/screenshot` kun ved feil.
- `headless: true` er default for mer stabil automatisk kjøring.
- `retries` aktiveres i CI (`CI=true`) for å redusere flaky kjøringer.
- **Fast funksjonell gate i CI**: kjører `auth/check-db.ts`, `auth/smoke.ts`, `ki/smoke.ts`, `canvas/smoke.ts` og Playwright-spesifikasjonene `auth/smoke-e2e.spec.ts`, `app/smoke-e2e.spec.ts`, `app/accessibility-e2e.spec.ts`, `app/api-security-e2e.spec.ts`, `app/navigation-e2e.spec.ts` og `app/contact-e2e.spec.ts`.
- **Tilgjengelighet i gate**: `app/accessibility-e2e.spec.ts` kjører `@axe-core/playwright` på sentrale offentlige sider og feiler kun på `serious`/`critical` funn for å holde signalet høyt og støyen lav.
- **Dypere auth-E2E**: `login-signup-e2e.spec.ts`, `session-e2e.spec.ts`, `repro-e2e.spec.ts`, `late-conflict-e2e.spec.ts` og `email-update-e2e.spec.ts` beholdes som lokale/manuelle eller diagnostiske tester fordi de er tregere og mer Clerk-avhengige.
- **Firefox/WebKit**: Definert i playwright.config.ts men kjøres kun lokalt. CI installerer bare Chromium for raskere pipeline.

## Legge til nye tester

1. Opprett en mappe under `tests/` (f.eks. `tests/ki/`)
2. Legg til scripts i `tests/run.ts` i `SUITES`-arrayet
3. Legg til en snarvei-kommando i rot `package.json`
