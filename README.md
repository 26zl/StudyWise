# StudyWise - Bachelor 2026

[![CI](https://github.com/26zl/StudyWise/actions/workflows/ci.yml/badge.svg)](https://github.com/26zl/StudyWise/actions/workflows/ci.yml)
[![Deploy](https://github.com/26zl/StudyWise/actions/workflows/deploy.yml/badge.svg)](https://github.com/26zl/StudyWise/actions/workflows/deploy.yml)
[![Deploy Docs](https://github.com/26zl/StudyWise/actions/workflows/deploy.docs.yml/badge.svg)](https://github.com/26zl/StudyWise/actions/workflows/deploy.docs.yml)
[![OWASP Dependency-Check](https://github.com/26zl/StudyWise/actions/workflows/owasp-dependency-check.yml/badge.svg)](https://github.com/26zl/StudyWise/actions/workflows/owasp-dependency-check.yml)
[![Update dependencies](https://github.com/26zl/StudyWise/actions/workflows/update-dependencies.yml/badge.svg)](https://github.com/26zl/StudyWise/actions/workflows/update-dependencies.yml)

STUDYWISE - En KI-basert studieassistent for høyere utdanning med integrasjon mot Canvas Instructure. Bachelor i IT 2026.

Produksjonsnettside - <https://www.studwize.page>

> **Deploy:** Backend på Heroku, frontend på Vercel, CDN og sikkerhet (Cloudflare), dokumentasjon på GitHub Pages.

**Utvikling?** Les [CONTRIBUTING.md](./CONTRIBUTING.md) for detaljert guide om hvordan du skal kode og utvikle dette prosjektet.

## Teknologi stack (Monorepo)

### Frontend

- **Ramme**: Next.js 16, React 19, TypeScript 5.9, App Router
- **Styling**: Tailwind CSS v4 (`@tailwindcss/postcss`), next-themes (dark mode)
- **State**: TanStack React Query v5 (server), Zustand (klient), nuqs (URL-synkronisert state, f.eks. dashboard `?view=`)
- **Skjemaer**: react-hook-form, @hookform/resolvers, Zod
- **UI**: Lucide React, Sonner (toast), Vercel Speed Insights
- **Observability**: Datadog RUM for brukeropplevelse, sesjonsinnspilling og feilsporing i frontend

### Backend

- **Ramme**: Express 5, Node.js 20+, TypeScript (tsx i dev, node i prod)
- **Database**: MongoDB via Mongoose v9 for persistering og indekser
- **Cache**: Redis for Canvas API-cache, sync-struktur, KI-sesjon og rate limiting. PDF/fil-innhold lagres kun i MongoDB.
- **Vektorsøk**: Pinecone (serverless, integrated embedding); chunk-tekst i MongoDB som sannhetskilde
- **Auth**: Clerk (autentisering og brukersynk)
- **KI**: Anthropic Claude, Cohere reranking, circuit breakers, request timeout
- **API**: Swagger UI + swagger-jsdoc, compression, Helmet, CORS
- **Logging**: Pino + pino-http (redakterer PII)
- **Filer**: Multer; tekst fra PDF/Word (unpdf, mammoth), OCR (tesseract.js, sharp)
- **Observability**: Datadog APM (dd-trace) for tracing, runtime metrics og log-korrelasjon

## Kom i gang

### Forutsetninger

- Node.js 20+ installert
- pnpm installert (`npm install -g pnpm`)
- Canvas LMS-konto fra ditt lærested i Norge som bruker Canvas

> **Viktig:** Hold din lokale versjon oppdatert! Kjør `git pull origin main` jevnlig.

### Installasjon

1. **Klon repoet**:

   ```bash
   git clone <repo-url>
   cd StudyWise
   ```

2. **Installer dependencies**:

   ```bash
   pnpm install
   ```

3. **Konfigurer miljøvariabler**:

   Opprett `backend/.env` (se `backend/.env.example`).

4. **Bygg prosjektet**:

   ```bash
   pnpm build
   ```

## Kommandoer (kjør fra rot)

```bash
# Utvikling
pnpm dev              # Start frontend + backend + docs
pnpm dev:frontend     # Start kun frontend
pnpm dev:backend      # Start kun backend
pnpm dev:docs         # Start kun dokumentasjon

# Kvalitetssikring
pnpm typecheck        # Type-check alle pakker
pnpm lint             # Lint alle pakker
pnpm build            # Bygg alt (common → backend → frontend → docs)

# Installere pakker (VIKTIG: Bruk --filter)
pnpm --filter frontend add <pakkenavn>
pnpm --filter backend add <pakkenavn>
pnpm --filter common add <pakkenavn>

# Vedlikehold
pnpm run clean:all        # Fjerner alt: node_modules, dist, .next, pnpm-lock.yaml
pnpm run clean:install    # Full reinstall (clean + install + update + build)
pnpm kill:dev             # Stopp alle Node prosesser (Windows)
pnpm run update           # Oppdater alle pakker

# Docker (kun lokal utvikling)
docker compose up --build # Starter MongoDB, Redis, backend og frontend (alle med security_opt: no-new-privileges)
```

## Utviklingsservere

| Tjeneste     | URL                              |
| ------------ | -------------------------------- |
| Frontend     | <http://localhost:3000>          |
| Backend      | <http://localhost:4000>          |
| Swagger UI   | <http://localhost:4000/api-docs> |
| Health Check | <http://localhost:4000/health>   |
| Docs         | <http://localhost:5173>          |

## API Dokumentasjon

### Swagger UI

Backend har integrert Swagger UI: <http://localhost:4000/api-docs>

### Hovedendepunkter

- `GET /health` - Server health check
- `GET /api/canvas/*` - Canvas LMS integrasjon (emner, oppgaver, moduler, kunngjøringer, kalender)
- `/api/user/*` - StudyWise-brukerdata (profil, preferanser, Canvas-token, logout, kontosletting). Innlogging og registrering håndteres av Clerk.
- `/api/ki/*` - KI-assistenten (chat, dokumentanalyse, oppsummering, task breakdown)

### Canvas API

- [Canvas REST API](https://developerdocs.instructure.com/services/canvas/resources/)
- [Canvas Developer Docs](https://developerdocs.instructure.com/services/canvas)

## Kodestandarder

- **TypeScript**: Strict mode, unngå `any`
- **Logging**: Bruk `pino` logger i backend, aldri `console.log`
- **Validering**: Zod på alle grensesnitt
- **Styling**: Tailwind CSS, mobile-first, dark mode støtte
- **Navngivning**: Norske/Engelske navn for ruter/variabler, engelske filnavn

## Feilsøking

### Common package feil

```bash
pnpm build:common  # Eller bare: pnpm build
```

### Port allerede i bruk

```bash
pnpm kill:dev
```

## Lisens

Se LICENSE-fil for detaljer.
