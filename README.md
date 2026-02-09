# StudyWise - Bachelor 2026

STUDYWISE - En KI-basert studieassistent for høyere utdanning med integrasjon mot Canvas Instructure. Bachelor i IT 2026.

Produksjonsnettside - <https://www.studwize.page>

> **Deploy:** Backend kjører hos Render, frontend hos Vercel. Cloudflare brukes for DDoS-beskyttelse, SSL/TLS og ytelse. Dockerfile og docker-compose.yml i root kan brukes for lokal kjøring av hele stacken.

**Utvikling?** Les [CONTRIBUTING.md](./CONTRIBUTING.md) for detaljert guide om hvordan du skal kode og utvikle dette prosjektet.

## Teknologi stack

- **Frontend**: Next.js 16 + TypeScript + Tailwind CSS v4 + React Query + Zustand + Zod + React Hook Form
- **Backend**: Express 5 + TypeScript + Redis + Pino + Helmet + Zod + HuggingFace Inference
- **Database**: MongoDB (Atlas/Lokal) + Redis (Cloud/Lokal)
- **Common**: Delte Zod schemas og feiltyper (frontend + backend)
- **Pakkehåndtering**: pnpm workspace (monorepo)
- **Autentisering**: JWT (access + refresh tokens)

## Kom i gang

### Forutsetninger

- Node.js 20+ installert
- pnpm installert (`npm install -g pnpm`)
- Canvas LMS-konto (f.eks. USN Canvas)

> **Viktig:** Hold din lokale versjon oppdatert! Kjør `git pull origin main` jevnlig.

### Installasjon

1. **Klon repoet**:

```bash
git clone <repo-url>
cd StudyWise
```

1. **Installer dependencies**:

```bash
pnpm install
```

1. **Konfigurer miljøvariabler**:

Opprett `backend/.env` (se `backend/.env.example`).

1. **Bygg prosjektet**:

```bash
pnpm build
```

## Kommandoer (kjør fra rot)

```bash
# Utvikling
pnpm dev              # Start frontend + backend
pnpm dev:frontend     # Start kun frontend
pnpm dev:backend      # Start kun backend

# Kvalitetssikring
pnpm typecheck        # Type-check alle pakker
pnpm lint             # Lint alle pakker
pnpm build            # Bygg alt (common → backend → frontend)

# Installere pakker (VIKTIG: Bruk --filter)
pnpm --filter frontend add <pakkenavn>
pnpm --filter backend add <pakkenavn>
pnpm --filter common add <pakkenavn>

# Vedlikehold
pnpm run clean:all        # Fjerner alt: node_modules, dist, .next, pnpm-lock.yaml
pnpm run clean:install    # Full reinstall (clean + install + update + build)
pnpm kill:dev             # Stopp alle Node prosesser (Windows)
pnpm run update           # Oppdater alle pakker

# Docker (kjør hele prosjektet lokalt)
docker compose up --build # Starter MongoDB, Redis, backend og frontend
```

## Utviklingsservere

| Tjeneste     | URL                              |
| ------------ | -------------------------------- |
| Frontend     | <http://localhost:3000>          |
| Backend      | <http://localhost:4000>          |
| Swagger UI   | <http://localhost:4000/api-docs> |
| Health Check | <http://localhost:4000/health>   |


## API Dokumentasjon

### Swagger UI

Backend har integrert Swagger UI: <http://localhost:4000/api-docs>

### Hovedendepunkter

- `GET /health` - Server health check
- `GET /api/canvas/*` - Canvas LMS integrasjon
- `POST /api/auth/*` - Autentisering
- `POST /api/ki/*` - KI-assistenten

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
