# AI Agent Guidelines & Project Master Reference

**VIKTIG FOR AI-AGENTER:** Les dette dokumentet NØYE før du gjør endringer. Dette er "loven" for prosjektet.

Dette er et **pnpm monorepo-prosjekt** som består av:

1. **Frontend**: Next.js 16 (App Router)
2. **Backend**: Express 5 API Server
3. **Common**: Delte TypeScript-typer og Zod-skjemaer

---

## 1. Komplett Prosjektstruktur

```text
StudyWise/
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
│   │   ├── page.tsx        # Root page (redirecter til /hjem)
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
│   │   │   └── ki/
│   │   │       └── ki.ts        # KI/AI endpoints
│   │   ├── swagger.ts      # Swagger/OpenAPI konfigurasjon
│   │   └── index.ts        # Server entry point + /health endpoint
│   ├── package.json
│   └── tsconfig.json       # Extends ../tsconfig.base.json
├── tsconfig.base.json      # Delt TypeScript konfigurasjon
├── package.json            # Workspace root (monorepo scripts)
├── pnpm-workspace.yaml     # pnpm workspace config
└── docker-compose.yml      # Docker Compose config
```

---

## 2. Teknologistack (Deep Dive)

- **Core**: Next.js 16.1.4, React 19.2.3, TypeScript 5.9.
- **Styling**: Tailwind CSS v4.1 (med `@tailwindcss/postcss`).
- **State/Data**: `@tanstack/react-query` v5 for server-state. `zustand` for client-state.
- **Forms**: `react-hook-form` + `@hookform/resolvers` + `zod`.
- **Routing**: Next.js App Router (Server Components default).

### Dashboard (SPA-Container)

Lokasjon: `frontend/app/dashboard/page.tsx`

Dette er hjertet av applikasjonen og fungerer som en **sentral hub** for studenten.

- **Formål**: Samler læringsplattform (Canvas) og støtteverktøy (KI) i ett grensesnitt.
- **Virkemåte**: Bygget som en **SPA (Single Page Application) container**. Den laster ikke siden på nytt når man bytter fane, men bruker React state (`activeView`) for å bytte komponenter (`CanvasSection`, `KISection`) umiddelbart.

### Backend

- **Core**: Express 5.2.1, Node.js 20+.
- **Language**: TypeScript (kjøres med `tsx` i dev, `node` i prod).
- **Database**: MongoDB via `mongoose` v9.1.
- **Validation**: `zod` (gjenbruker schema fra `common`).
- **API Docs**: `swagger-ui-express` + `swagger-jsdoc`.
- **Logging**: `pino` + `pino-http`. Bruk ALLTID `logger.info/error`, ALDRI `console.log`.
- **Cache**: `redis` client interfacing with Redis Cloud.
- **AI**: `@huggingface/inference` for integrasjon mot HuggingFace modeller.

### Common

- Kun `zod` definisjoner og TypeScript interface/types. Ingen forretningslogikk.

---

## 3. Dataflyt & Nettverk

### API Kommunikasjon

Frontend snakker aldri direkte til eksterne APIer (Canvas, OpenAI, etc). Alt går via backend proxy for sikkerhet.

1. **Frontend Browser**: `fetch('/api/canvas/courses')`
2. **Next.js Server**: Proxyer `http://localhost:3000/api/*` -> `http://localhost:4000/api/*` (definert i `next.config.js`).
3. **Express Backend**: Mottar request, validerer token, kaller eksternt system (f.eks Canvas API), og returnerer data.

### Docker Nettverk

Vi bruker standard host-networking konsept der alt er tilgjengelig via `localhost`.

**Miljøvariabler i `frontend/.env`:**

- `NEXT_PUBLIC_API_URL`: URL til backend (f.eks `http://localhost:4000`).

---

## 4. Utviklingsrutiner

### Installasjon & Setup

ALDRI bruk `npm`. Dette er et `pnpm` prosjekt.

```bash
# Første gang oppsett
pnpm install
pnpm build # Bygger common pakken først!
```

### Git & Workflow

1. **Hold deg oppdatert**: Kjør `git pull origin main` ofte for å unngå konflikter.
2. **Kvalitetssjekk**: Kjør `pnpm typecheck`, `pnpm lint` og `pnpm build` jevnlig for å fange feil tidlig.
3. **Kjøre Prosjektet**

```bash
# Start alt i utviklingsmodus (anbefalt)
pnpm dev

# Start kun backend (hvis du debugger API)
pnpm dev:backend

# Start kun frontend
pnpm dev:frontend
```

### Bygge & Teste

```bash
# Typecheck hele prosjektet
pnpm typecheck

# Linting
pnpm lint

# Bygg for produksjon
pnpm build
```

### Legge til pakker

Gå ALLTID inn i riktig mappe først.

```bash
cd frontend && pnpm add <pakke>
cd backend && pnpm add <pakke>
```

---

## 5. Regler for Koding

### Mappestruktur Regler

- **Frontend**:
  - Page komponenter (`page.tsx`) skal være tynne. Flytt logikk til `app/components/`.
  - Nye komponenter skal i `frontend/app/components/`.
  - API-kall abstraheres i egne hooks (f.eks `canvas-api.ts`).
  - Mens SPA (Single Page Application) container forblir i `frontend/app/dashboard/page.tsx`.
- **Backend**:
  - Hver "ressurs" (Canvas, Auth, KI) får sin egen mappe under `src/rutere/`.
  - Ingen logikk i `src/index.ts` - kun oppsett.

### Styling Regler (Tailwind)

- Bruk ALDRI egne `.css` filer (unntatt `globals.css`).
- **Dark Mode**: Alle farger MÅ ha en `dark:` variant.
  - Eks: `bg-white dark:bg-gray-900 text-black dark:text-white`.
- Bruk `sm:`, `md:`, `lg:` for responsivitet. Mobile-first!

### Database Regler

- Definer Schema i `backend/src/database/models/`.
- Bruk Zod i `common` for å validere data *før* det treffer databasen.
- **Bruk Mongoose Models**: Bruk alltid Mongoose-modeller slik de er ment å brukes (`.find()`, `.create()`, osv.). Unngå native MongoDB driver kall med mindre strengt nødvendig.

- **Bruk Mongoose Models**: Bruk alltid Mongoose-modeller slik de er ment å brukes (`.find()`, `.create()`, osv.). Unngå native MongoDB driver kall med mindre strengt nødvendig.

### Generelle Regler

- **Emojis**: Det skal IKKE brukes emojis i kode (tekst, knapper, kommentarer osv) med mindre brukeren SPESIFIKT ber om det.
- **Konfigurasjon**: AI-agenter skal IKKE endre eller overskrive NOEN SOM HELST konfigurasjonsfiler i hele prosjektet (uansett filtype/navn) med mindre det er strengt nødvendig for kritisk funksjonalitet. Spør ALLTID brukeren først ved slike endringer.

---

## 6. Feilsøking (Troubleshooting)

### "Module not found: Can't resolve 'common'"

- **Løsning**: Common-pakken må bygges før den kan brukes.
- Kjør: `pnpm build:common` eller bare `pnpm build`.

### "MongoNetworkError"

- **Løsning**: Sjekk at MongoDB kjører (hvis lokalt) eller at `MONGO_URI` i `backend/.env` er korrekt.
- Sjekk at din IP er whitelistet i MongoDB Atlas hvis du bruker sky-database.

---

## 7. Sikkerhet og Personvern (nulltoleranse)

### Ingen Hardkoding av Hemmeligheter

Det er **strengt forbudt** å hardkode sensitive data.

- **API Nøkler**: Skal alltid lastes fra `.env` filer.
- **Tokens**: Skal aldri sjekkes inn i git.
- **URLer**: Bruk miljøvariabler.

### Personvern (GDPR)

Vi behandler studentdata.

- **Loggføring**: Aldri loggfør personidentifiserbare data (PII) navn/epost i produksjon.
- **Dataflyt**: Send kun nødvendig data til frontend.
- **AI**: Send **aldri** PII til eksterne AI-tjenester (OpenAI/HuggingFace) uten anonymisering.

---

Hold denne filen oppdatert hvis prosjektstrukturen endres vesentlig.
