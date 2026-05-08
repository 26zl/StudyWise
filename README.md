# StudyWise

[![CI](https://github.com/26zl/StudyWise/actions/workflows/ci.yml/badge.svg)](https://github.com/26zl/StudyWise/actions/workflows/ci.yml)
[![Functional Testing](https://github.com/26zl/StudyWise/actions/workflows/func-testing.yml/badge.svg)](https://github.com/26zl/StudyWise/actions/workflows/func-testing.yml)
[![Deploy](https://github.com/26zl/StudyWise/actions/workflows/deploy.yml/badge.svg)](https://github.com/26zl/StudyWise/actions/workflows/deploy.yml)
[![Deploy Docs](https://github.com/26zl/StudyWise/actions/workflows/deploy.docs.yml/badge.svg)](https://github.com/26zl/StudyWise/actions/workflows/deploy.docs.yml)
[![OWASP Dependency-Check](https://github.com/26zl/StudyWise/actions/workflows/owasp-dependency-check.yml/badge.svg)](https://github.com/26zl/StudyWise/actions/workflows/owasp-dependency-check.yml)

En KI-basert studieassistent for høyere utdanning med integrasjon mot Canvas LMS.
Bacheloroppgave i IT ved Universitetet i Sørøst-Norge (USN), 2026 — gruppe 3.

- **Produksjon:** <https://www.studwize.page>
- **Dokumentasjon:** <https://26zl.github.io/StudyWise/>
- **Statusside:** <https://www.studwize.page/status>

> For en raskere orientering i prosjektet, se `filer_prosjekt/00-LESEGUIDE.md` og diagrammene i `filer_prosjekt/diagrammer/`.

## Teknologi

Monorepo med fem pakker (`common`, `backend`, `frontend`, `docs`, `tests`) administrert med pnpm workspaces.

| Lag      | Teknologi                                    |
| -------- | -------------------------------------------- |
| Frontend | Next.js, React, Tailwind CSS                 |
| Backend  | Node.js, Express, TypeScript                 |
| Database | MongoDB, Redis, Pinecone                     |
| KI       | Anthropic Claude, Cohere, LangSmith          |
| Auth     | Clerk, Cloudflare Turnstile                  |
| Infra    | Heroku, Vercel, Datadog, PostHog, Cloudflare |

## Produksjonsarkitektur

Frontend kjører på Vercel bak Cloudflare, mens backend kjører på Heroku bak `api.studwize.page`. Next.js proxyer `/api/*` videre til Cloudflare API-edge, og Express-backenden avviser direkte origin-trafikk som ikke kommer via Cloudflare. `common`-pakken er kontrakten mellom frontend, backend og tester, med delte Zod-skjemaer og TypeScript-typer.

## Kom i gang

**Forutsetninger:** Node.js 22 LTS eller nyere, og pnpm (`npm install -g pnpm`). CI kjører på Node 24.

```bash
git clone https://github.com/26zl/StudyWise.git
cd StudyWise
pnpm install

# Konfigurer miljøvariabler
cp backend/.env.example backend/.env
cp frontend/.env.example frontend/.env
# Fyll ut påkrevde verdier i begge filer

# Bygg og start
pnpm build
pnpm dev
```

| Tjeneste    | URL                              |
| ----------- | -------------------------------- |
| Frontend    | <http://localhost:3000>          |
| Backend API | <http://localhost:4000>          |
| API-docs    | <http://localhost:4000/api-docs> |
| Docs        | <http://localhost:5173>          |

## Kommandoer

```bash
# Utvikling
pnpm dev                  # Start alt
pnpm dev:frontend         # Kun frontend
pnpm dev:frontend:turbo   # Frontend med Turbopack (--turbopack).
pnpm dev:backend          # Kun backend

# Kvalitet
pnpm typecheck            # Type-sjekk alle pakker
pnpm lint                 # Lint alle pakker (ESLint)
pnpm lint:md              # Lint markdown-filer (remark)
pnpm format               # Formater alt med Prettier
pnpm format:check         # Sjekk formatering uten å skrive
pnpm build                # Bygg alt

# Tester
pnpm test:unit            # Enhetstester (Vitest)
pnpm test                 # Integrasjonstester
pnpm test:auth:e2e        # E2E-tester (Playwright)

# Vedlikehold
pnpm clean:install        # Full reinstall
pnpm knip                 # Finn ubrukt kode
pnpm syncpack:list        # Sjekk versjonssynkronisering
```

Installer pakker med `--filter`: `pnpm --filter frontend add <pakke>`

## Docker

```bash
cp docker.env.example .env    # Fyll inn verdier
docker compose up --build     # Start MongoDB, Redis, backend, frontend
```

## Git hooks og kvalitetssjekker

Pre-commit-hook (Husky + lint-staged) er midlertidig deaktivert mens kodebasen reformateres samlet, slik at fremtidige commits får små, fokuserte differ. Frem til reaktivering kjøres pre-commit-sjekkene manuelt:

```bash
pnpm format
pnpm test:unit && pnpm typecheck && pnpm lint && pnpm lint:md && pnpm build
```

De samme sjekkene håndheves automatisk i pull requests via GitHub Actions, slik at kvalitetskravet er likt uansett om hooken er aktiv lokalt.

## Testing

Testfiler ligger i `__tests__/`-mapper i hver pakke. E2E-tester bruker Playwright.

```bash
pnpm test:unit                # Alle enhetstester (common + backend + frontend)
pnpm test:unit:common         # Kun common
pnpm test:unit:backend        # Kun backend
pnpm test:unit:frontend       # Kun frontend
pnpm test:auth                # Auth-tester
pnpm test:auth:matrix         # Auth identitetsmatrise (120 scenarier)
pnpm test:ki                  # KI-tester
pnpm test:canvas              # Canvas-tester
```

Se [tests/README.md](./tests/README.md) for detaljer.

> Les [CONTRIBUTING.md](./.github/CONTRIBUTING.md) for utviklingsveiledning.

## Avhengigheter

Dependabot kjører ukentlig (mandager 06:00 CET) og åpner grupperte pull requests for npm og GitHub Actions. Security-advisories åpner PR-er umiddelbart. Konfigurasjon ligger i [`.github/dependabot.yml`](./.github/dependabot.yml).

## Lisens

MIT — se [LICENSE](./LICENSE).

## Bachelorgruppen

| Medlem        | Rolle                                                                     |
| ------------- | ------------------------------------------------------------------------- |
| Laurent Zogaj | Prosjektleder, fullstack, KI/Canvas-integrasjon, arkitektur, UI/UX, CI/CD |
| Abdinasir     | Fullstack, KI-integrasjon, UI/UX                                          |
| Anwar         | Fullstack, KI-integrasjon, UI/UX                                          |
| Ylli Ujkani   | Dokumentasjon, oversettelse                                               |

Veileder: USN – Bachelor i IT, 2026.
