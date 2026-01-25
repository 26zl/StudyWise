# Bachelor IT - USN 2026

Bacheloroppgave i IT og informasjonssystemer 2026.

**Utvikling?** Les [CONTRIBUTING.md](./CONTRIBUTING.md) for detaljert guide om
hvordan du skal kode og utvikle dette prosjektet.

## Teknologi stack

- **Frontend**: Next.js 16 + TypeScript + Tailwind CSS + React Query +
  TanStack + Zod + Hookform
- **Backend**: Express 5 + TypeScript + Pino + Helmet + Zod + Hugging Face
- **Common**: Zod schemas (delt mellom frontend og backend)
- **Pakkehåndtering**: pnpm workspace (monorepo)
- **Autentisering**: JWT

## Kom i gang

### Forutsetninger

- Node.js 18+ installert
- pnpm installert (`npm install -g pnpm`)
- Canvas LMS-konto (f.eks. USN Canvas)

> **Viktig:** Husk å holde din lokale versjon oppdatert! Kjør `git pull origin main` jevnlig.
> **Tips:** Kjør `pnpm typecheck`, `pnpm lint` og `pnpm build` jevnlig for å oppdage feil tidlig.

### Installasjon

1. **Klon repoet**:

```bash
git clone <repo-url>
cd BachelorOppgave
```

1. **Installer dependencies**:

```bash
pnpm install
```

1. **Konfigurer miljøvariabler**:

Opprett `backend/.env` (se `backend/.env.example`):

```env
PORT=4000
WEB_ORIGIN=http://localhost:3000
CANVAS_TOKEN=din_canvas_token_her
CANVAS_BASE_URL=https://usn.instructure.com
```

## Kommandoer (kjør fra rot)

```bash
# Utvikling
pnpm dev              # Start alt (frontend + backend)
pnpm dev:frontend     # Start kun frontend
pnpm dev:backend      # Start kun backend
pnpm dev:common       # Watch mode for common (type checking)

# Linting
pnpm lint             # Lint alle pakker (frontend + backend)
pnpm lint:frontend    # Lint kun frontend
pnpm lint:backend     # Lint kun backend

# Type checking
pnpm typecheck        # Type-check alle pakker
pnpm typecheck:frontend   # Type-check frontend
pnpm typecheck:backend    # Type-check backend
pnpm typecheck:common     # Type-check common

# Bygg (NB: common bygges automatisk før frontend/backend)
pnpm build            # Bygg alt (common → backend → frontend)
pnpm build:common     # Bygg kun common
pnpm build:frontend   # Bygg common + frontend
pnpm build:backend    # Bygg common + backend

# Produksjon
pnpm start            # Start alt (frontend + backend)
pnpm start:frontend   # Start kun frontend
pnpm start:backend    # Start kun backend

# Dependencies
pnpm outdated         # Sjekk utdaterte pakker (alle)
pnpm update           # Oppdater alle pakker
pnpm update:frontend  # Oppdater kun frontend
pnpm update:backend   # Oppdater kun backend
pnpm update:common    # Oppdater kun common

# Installere nye pakker
# VIKTIG: Ikke installer pakker i roten (uten --filter). Det skaper rot!
pnpm --filter frontend add <pakkenavn>   # Installer i frontend
pnpm --filter backend add <pakkenavn>    # Installer i backend
pnpm --filter common add <pakkenavn>     # Installer i common

# Vedlikehold
pnpm clean            # Fjern build-filer (dist, .next)
pnpm clean:install    # Full reinstall (sletter node_modules + lock)
```

**Utviklingsservere:**

- Backend: <http://localhost:4000>
- Frontend: <http://localhost:3000>
- API Dokumentasjon (Swagger): <http://localhost:4000/api-docs>
- Health Check: <http://localhost:4000/health>

## Docker (alternativ kjøring)

Docker lar deg kjøre applikasjonen i containere, nyttig for produksjon og
konsistent utvikling.

**Krav:**

- Docker installert
- Docker Compose installert

### Kjøre med Docker Compose

1. **Bygg og start alle services**:

```bash
docker-compose up --build
```

1. **Stopp services**:

```bash
docker-compose down
```

1. **Kjør i bakgrunnen (detached mode)**:

```bash
docker-compose up -d
```

1. **Se logger**:

```bash
docker-compose logs -f
```

### Dev-compose (valgfritt)

Det finnes også en enkel `docker-compose.dev.yml` for utvikling (volumes + hot reload).

```bash
docker compose -f docker-compose.dev.yml up
```

## API Dokumentasjon

### Swagger UI (Interaktiv API-dokumentasjon)

Backend har integrert Swagger UI for å utforske og teste API-endepunkter:

- **URL**: <http://localhost:4000/api-docs>
- **Dokumenterer**: Alle endpoints i `/api/auth`, `/api/canvas`, og `/health`
- **Interaktivt**: Test API-kall direkte fra nettleseren

**Nyttige endpoints:**

- `GET /health` - Server health check (returnerer uptime, timestamp, status)
- `GET /api/canvas/*` - Canvas LMS integrasjon
- `GET /api/auth/*` - Autentisering

### Eksterne API-er

**Canvas API Dokumentasjon:**

- [Canvas REST API Resources](https://developerdocs.instructure.com/services/canvas/resources/)
- [Canvas Developer Documentation](https://developerdocs.instructure.com/services/canvas)

## Prosjektstruktur atm

```text
BachelorOppgave/
├── common/                  # Delte Zod schemas (workspace pakke)
│   ├── src/
│   │   ├── auth.ts              # Auth schemas
│   │   ├── canvas.ts            # Canvas API schemas
│   │   ├── ki.ts                # KI API schemas
│   │   └── index.ts             # Eksporterer alle schemas
│   ├── dist/                    # Kompilerte filer (.js + .d.ts)
│   ├── package.json             # Inkluderer build script
│   └── tsconfig.json            # Extends ../tsconfig.base.json
├── frontend/                # Next.js frontend
│   ├── app/                # App Router
│   │   ├── hjem/           # Hjemmeside / Landing page
│   │   │   └── page.tsx
│   │   ├── canvas/         # Canvas
│   │   │   └── canvas-api.ts    # Kun API-logikk (hooks)
│   │   ├── dashboard/      # Dashboard (SPA Hub)
│   │   │   └── page.tsx         # Hovedsiden som styrer visningene
│   │   ├── auth/           # Autentisering
│   │   │   ├── auth-api.ts      # Auth API hooks
│   │   │   └── page.tsx         # Login-side
│   │   ├── ki/                 # KI-sider
│   │   │   └── ki-api.ts        # Kun API-logikk (hooks)
│   │   ├── layout.tsx      # Root layout (Providers + Global CSS)

│   │   ├── providers.tsx   # React Query provider
│   │   ├── globals.css     # Global styling (Tailwind v4)
│   │   ├── components/     # Gjenbrukbare komponenter
│   │       ├── canvasSection.tsx    # Viser Canvas-innhold i dashboard
│   │       ├── kiSection.tsx        # Viser AI-chat i dashboard
│   │       ├── header.tsx           # Global header
│   │       └── footer.tsx           # Global footer
│   ├── package.json
│   ├── postcss.config.mjs  # Tailwind v4 config
│   └── tsconfig.json
├── backend/                # Express backend
│   ├── src/
│   │   ├── database/       # Database-kobling
│   │   │   └── database.ts      # Kobler til MongoDB
│   │   ├── rutere/         # API-ruter
│   │   │   ├── canvas/
│   │   │   │   └── canvas.ts    # Canvas LMS API endpoints
│   │   │   ├── auth/
│   │   │   │   └── auth.ts      # Autentisering endpoints
│   │   │   └── KI/
│   │   │       └── KI.ts        # KI/AI endpoints
│   │   ├── swagger.ts      # Swagger/OpenAPI konfigurasjon
│   │   └── index.ts        # Server entry point + /health endpoint
│   ├── package.json
│   └── tsconfig.json       # Extends ../tsconfig.base.json
├── tsconfig.base.json      # Delt TypeScript konfigurasjon
├── package.json            # Workspace root (monorepo scripts)
├── pnpm-workspace.yaml     # pnpm workspace config
└── docker-compose.yml      # Docker Compose config
```

### Kodestandarder

- **TypeScript**: Bruk strict mode, unngå `any`
- **Navngivning**: Bruk norske navn for ruter, komponenter og variabler. Hold filnavn mest mulig på engelsk der det er fornuftig.
- **Formatering**: Prosjektet bruker automatisk formatering
- **Kommentarer**: Skriv kommentarer på norsk

### Viktige Notater

**Common Package:**

- `common/` pakke må bygges før backend/frontend (`pnpm build:common`)
- Build scripts håndterer dette automatisk (`pnpm build` bygger i riktig rekkefølge)
- Eksporterer kompilerte `.js` filer og `.d.ts` type definisjoner
- Alle packages bruker shared `tsconfig.base.json` for konsistens

**TypeScript Konfigurasjoner:**

- Root: `tsconfig.base.json` - Delt konfigurasjon
- Common: Bygger til `dist/` med type definisjoner
- Backend: NodeNext module resolution
- Frontend: Bundler module resolution (Next.js)

**Code Quality:**

- ESLint konfigurert for både frontend og backend
- Automatisk linting med `pnpm lint`
- Snyk vulnerability scanning integrert
- Dependency overrides for sikkerhet (glob, inflight)

**Docker Optimalisering:**

- Frontend bruker Next.js standalone mode (mindre image størrelse)
- Health checks konfigurert for alle services
- Multi-stage builds for optimal layer caching
- Ingen unødvendige dependencies i production images

**Git Ignore & Autogenererte filer:**

- `next-env.d.ts` er lagt til i `.gitignore`. Denne filen genereres automatisk av Next.js og endres ofte. Den vil opprettes automatisk hos deg når du kjører `pnpm dev` eller `pnpm build`, så du trenger ikke tenke på den.

## Feilsøking

### pnpm kommandoer virker ikke

```bash
pnpm clean:install
```

### Backend starter ikke / Port allerede i bruk

Hvis du får feilmelding om at port 4000 eller 3000 er i bruk:

**Stopp alle Node prosesser:**

```bash
pnpm kill:dev
```

**Manuell feilsøking:**

- Sjekk at `.env` er konfigurert riktig (ingen quotes rundt CANVAS_TOKEN)
- Verifiser at port 4000 er ledig (`netstat -ano | findstr :4000` på Windows)
- Sørg for at dotenv.config() kalles før andre imports i index.ts

**Tips:** `Ctrl+C` stopper ikke alltid backend ordentlig. Bruk `pnpm kill:dev`
før du starter `pnpm dev` på nytt.

### Frontend kobler ikke til backend

- Sjekk at `WEB_ORIGIN` i `backend/.env` matcher frontend URL
- Verifiser CORS-innstillinger

### Canvas API feiler

- Verifiser at Canvas token er gyldig
- Sjekk at `CANVAS_BASE_URL` er riktig

## Lisens

Se LICENSE-fil for detaljer.
