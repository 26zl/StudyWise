# StudyWise

[![CI](https://github.com/26zl/StudyWise/actions/workflows/ci.yml/badge.svg)](https://github.com/26zl/StudyWise/actions/workflows/ci.yml)
[![Functional Testing](https://github.com/26zl/StudyWise/actions/workflows/func-testing.yml/badge.svg)](https://github.com/26zl/StudyWise/actions/workflows/func-testing.yml)
[![Deploy](https://github.com/26zl/StudyWise/actions/workflows/deploy.yml/badge.svg)](https://github.com/26zl/StudyWise/actions/workflows/deploy.yml)
[![Deploy Docs](https://github.com/26zl/StudyWise/actions/workflows/deploy.docs.yml/badge.svg)](https://github.com/26zl/StudyWise/actions/workflows/deploy.docs.yml)
[![OWASP Dependency-Check](https://github.com/26zl/StudyWise/actions/workflows/owasp-dependency-check.yml/badge.svg)](https://github.com/26zl/StudyWise/actions/workflows/owasp-dependency-check.yml)

En KI-basert studieassistent for høyere utdanning med integrasjon mot Canvas LMS.
Bacheloroppgave 2026.

**Produksjon:** <https://www.studwize.page>

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

## Kom i gang

**Forutsetninger:** Node.js 20+ og pnpm (`npm install -g pnpm`)

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

| Tjeneste    | URL                             |
| ----------- | ------------------------------- |
| Frontend    | <http://localhost:3000>         |
| Backend API | <http://localhost:4000>         |
| API-docs    | <http://localhost:4000/api-docs>|
| Docs        | <http://localhost:5173>         |

## Kommandoer

```bash
# Utvikling
pnpm dev                  # Start alt
pnpm dev:frontend         # Kun frontend
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
pnpm size                 # Sjekk bundle-størrelse
```

Installer pakker med `--filter`: `pnpm --filter frontend add <pakke>`

## Docker

```bash
cp docker.env.example .env    # Fyll inn verdier
docker compose up --build     # Start MongoDB, Redis, backend, frontend
```

## Git hooks

Pre-commit-hook (Husky + lint-staged) kjøres automatisk ved `git commit` og kjører Prettier kun på staged filer (`.ts`, `.tsx`, `.js`, `.json`, `.md`, `.yml`, `.css`). Hooken installeres automatisk via `prepare`-scriptet når du kjører `pnpm install`.

Ved behov kan hooken hoppes over midlertidig med `git commit --no-verify` — men gjør det kun i unntakstilfeller.

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

> Les [CONTRIBUTING.md](./CONTRIBUTING.md) for utviklingsveiledning.

## Avhengigheter

Dependabot kjører ukentlig (mandager 06:00 CET) og åpner grupperte pull requests for npm og GitHub Actions. Security-advisories åpner PR-er umiddelbart. Konfigurasjon ligger i [`.github/dependabot.yml`](./.github/dependabot.yml).

## Lisens

MIT — se [LICENSE](./LICENSE).
