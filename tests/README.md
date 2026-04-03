# Tests

Integrasjonstester og debug-verktøy for StudyWise, organisert etter kategori.

## Kjøre tester

```bash
# Hovedkommandoer
pnpm test              # Kjør alle kategorier
pnpm test:auth         # Kun auth-tester
pnpm test:ki           # Kun KI-tester
pnpm test:canvas       # Kun Canvas-tester

# Auth Matrix (120 scenarier definert, ~36 executable)
pnpm test:auth:matrix         # Kjør alle executable scenarier
pnpm test:auth:matrix:basic   # Gruppe A: Basic signup uniqueness
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
  auth/
    smoke.ts              # Auth-ruter (public + guard) smoke
    smoke-e2e.spec.ts     # Stabil Playwright smoke for auth-sider
    check-db.ts           # DB-invariantsjekk (indekser, duplikater, normalisering)
    repro-api.ts          # API-basert auth duplicate reproduksjon
    repro-matrix.ts       # Matrix-runner (A/B/C/D + evidence JSON)
    repro-e2e.spec.ts     # Diagnostisk Playwright repro for duplicate-signup
    global.setup.ts       # Clerk Playwright setup (Turnstile bypass)
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
- `smoke-e2e.spec.ts` er ment som gate i CI; `repro-e2e.spec.ts` er diagnostisk/evidence-test.

## Legge til nye tester

1. Opprett en mappe under `tests/` (f.eks. `tests/ki/`)
2. Legg til scripts i `tests/run.ts` i `SUITES`-arrayet
3. Legg til en snarvei-kommando i rot `package.json`
