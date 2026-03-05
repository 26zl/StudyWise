# AI Agent Guidelines & Project Master Reference

**VIKTIG FOR AI-AGENTER:** Les dette dokumentet NØYE før du gjør endringer. Dette er "loven" for prosjektet.

Dette er et **pnpm monorepo-prosjekt** som består av:

1. **Frontend**: Next.js 16 (App Router)
2. **Backend**: Express 5 API Server
3. **Common**: Delte TypeScript-typer og Zod-skjemaer
4. **Docs**: VitePress-dokumentasjon (Vue 3)

---

## 1. Teknologistack

### Frontend

- **Core**: Next.js 16, React 19, TypeScript 5.9
- **Styling**: Tailwind CSS v4 (med `@tailwindcss/postcss`)
- **State/Data**: `@tanstack/react-query` v5 for server-state, `zustand` for client-state
- **Forms**: `react-hook-form` + `@hookform/resolvers` + `zod`
- **Routing**: Next.js App Router (Server Components default)
- **Notifications**: `sonner` for toast-meldinger. Bruk ALDRI `alert()` i frontend.

### Backend

- **Core**: Express 5, Node.js 20+
- **Language**: TypeScript (kjøres med `tsx` i dev, `node` i prod)
- **Database**: MongoDB via `mongoose` v9
- **Validation**: `zod` (gjenbruker schema fra `common`)
- **API Docs**: `swagger-ui-express` + `swagger-jsdoc`
- **Logging**: `pino` + `pino-http`. Bruk ALLTID `logger.info/error`, ALDRI `console.log`
- **Cache**: `redis` client interfacing with Redis Cloud
- **AI**: `@anthropic-ai/sdk` for Claude

### Common

Delte Zod-skjemaer og TypeScript-typer mellom frontend og backend. **Bruk subpath-imports** (ikke `common/src/...`):

```typescript
import { CanvasCourseSchema } from "common/canvas";       // Canvas API-typer
import { classifyHttpStatus } from "common/canvasErrors";  // Feilkoder og hjelpere
import { SubTaskSchema } from "common/ki";                 // KI/AI-typer
import { ChatMessageSchema } from "common/chat";           // Chat-historikk-typer
import { CalendarItemSchema } from "common/calendar";      // Kalender API-typer
import { CalendarUIEventSchema } from "common/calendar-ui"; // Kalender UI-typer
import { DocumentSchema } from "common/document";          // Dokumentbehandling
import { COOKIE_NAMES } from "common/auth";                // Auth-konstanter
import { getWeekNumber } from "common/dateUtils";          // Dato-hjelpefunksjoner
```

Når du legger til et nytt skjema i common, legg til en subpath-eksport i `common/package.json` `"exports"`-kartet.

---

## 2. Dataflyt & Arkitektur

### Dashboard (SPA-Container)

Lokasjon: `frontend/app/dashboard/page.tsx`

Dette er hjertet av applikasjonen og fungerer som en **sentral hub** for studenten.

- **Formål**: Samler læringsplattform (Canvas) og støtteverktøy (KI) i ett grensesnitt
- **Virkemåte**: Bygget som en **SPA (Single Page Application) container**. Den laster ikke siden på nytt når man bytter fane, men bruker React state (`activeView`) for å bytte komponenter umiddelbart

### API Kommunikasjon

Frontend snakker aldri direkte til eksterne APIer (Canvas, etc). Alt går via backend proxy for sikkerhet.

1. **Frontend Browser**: `fetch('/api/canvas/courses')`
2. **Next.js Server**: Proxyer `http://localhost:3000/api/*` -> `http://localhost:4000/api/*` (definert i `next.config.js`).
3. **Express Backend**: Mottar request, validerer token, kaller eksternt system (f.eks Canvas API), og returnerer data.

### Docker

Prosjektet kan kjøres lokalt via Docker med `docker compose up --build`. Dette starter MongoDB, Redis, backend og frontend. Dockerfile bruker multi-stage build med separate targets for backend og frontend.

**Miljøvariabler for Docker/produksjon:**

- `INTERNAL_API_URL`: URL til backend i Docker/produksjon (f.eks `http://backend:4000`). Settes automatisk i `docker-compose.yml`. For lokal utvikling uten Docker brukes default `http://localhost:4000`.

---

## 3. Utviklingsrutiner

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

# Bygg for produksjon (common → backend → frontend → docs)
pnpm build

# Bygg kun common (nødvendig etter endringer i common/)
pnpm build:common
```

### Legge til pakker

Bruk ALLTID `--filter` fra rot:

```bash
pnpm --filter frontend add <pakke>
pnpm --filter backend add <pakke>
pnpm --filter common add <pakke>
```

---

## 4. Regler for Koding

### Mappestruktur Regler

- **Frontend**:
  - Page komponenter (`page.tsx`) skal være tynne. Flytt logikk til `app/components/`.
  - Nye komponenter skal i `frontend/app/components/`.
  - API-kall abstraheres i egne hooks (f.eks `canvas-api.ts`).
  - Mens SPA (Single Page Application) container forblir i `frontend/app/dashboard/page.tsx`.
- **Backend**:
  - Hver "ressurs" (Canvas, Auth, KI) får sin egen mappe under `src/rutere/`.
  - Delte hjelpefunksjoner i `src/utils/` (apiError, logger, env, htmlUtils, kryptering).
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
- **Modeller**: `User`, `CanvasUser`, `ChatHistory`, `TaskBreakdown`

### Backend Middleware-rekkefølge

Ruter i `backend/src/index.ts` MÅ monteres **etter** alle middleware (body parser, CORS, auth). Feil rekkefølge medfører at `req.body` og `req.user` er `undefined`.

```typescript
// RIKTIG — ruter monteres sist
app.use(express.json());     // body parser
app.use(cors(...));          // CORS
app.use(autentiserJwt);      // auth
app.use("/api/ki", kiRuter); // ruter
```

### Typing av `req.user` i Backend

`req.user` er globalt typet via `backend/src/typer/express.d.ts`. Bruk **aldri** `(req as any).user`.

```typescript
// RIKTIG
const userId = req.user?.id;

// FEIL
const userId = (req as any).user?.id;
```

### SubTaskUI-mønster i Frontend

Når en common-type trenger UI-only felt (f.eks. `approved` for optimistisk UI), lag et lokalt interface som *utvider* common-typen. Strip UI-felt ved API-grensen.

```typescript
import type { SubTask } from "common/ki";

interface SubTaskUI extends SubTask {
  approved?: boolean; // UI-only, sendes ikke til API
}

// Strip ved lagring
onSave(subtasks.map(({ approved: _approved, ...task }) => task));
```

### Generelle Regler

- **Konfigurasjon**: AI-agenter skal IKKE endre eller overskrive NOEN SOM HELST konfigurasjonsfiler i hele prosjektet (uansett filtype/navn) med mindre det er strengt nødvendig for kritisk funksjonalitet. Spør ALLTID brukeren først ved slike endringer.
- **Rate limiting**: Bruk eksisterende `rateLimitKi` middleware for KI-endepunkter.
- **Varsler i frontend**: Bruk `sonner` toast, aldri `alert()` eller `confirm()`.

---

## 5. Feilhåndtering

### Backend (`backend/src/utils/apiError.ts`)

Bruk standardisert feilhåndtering:

```typescript
import { apiError, sendZodError, sendUnknownError, requireUserId } from "../../utils/apiError.js";

// Auth-guard (returnerer userId eller sender 401 og returnerer null)
const userId = requireUserId(req, res);
if (!userId) return;

// Standardfeil
apiError.unauthorized(res, "Du må logge inn");
apiError.badRequest(res, "Ugyldig input", detaljer);
apiError.notFound(res, "Bruker");

// Zod-feil
if (error instanceof ZodError) {
  return sendZodError(res, error, "Registrering");
}

// Ukjent feil (logges automatisk)
return sendUnknownError(res, error, { kontekst: "minFunksjon" });
```

### Backend Canvas-feil (`backend/src/rutere/canvas/canvasErrors.ts`)

Re-eksporterer alt fra `common/canvasErrors` + backend-spesifikke utvidelser:

```typescript
import { createCanvasError, getErrorResponse, classifyHttpStatus } from "./canvasErrors.js";

// Kast strukturert Canvas-feil
throw createCanvasError("token_invalid", "Token er ugyldig", { httpStatus: 401 });

// Generer JSON-respons med feilkode
res.status(403).json(getErrorResponse("token_missing"));

// Klassifiser HTTP-status til feilkode
const code = classifyHttpStatus(503); // → "server_error"
```

### Frontend (`frontend/app/lib/errors.ts`)

Bruk felles error-klasser:

```typescript
import { KIAuthError, KIRateLimitError, CanvasTokenMissingError, AppError } from "../lib/errors";

// Sjekk error type
if (error instanceof KIRateLimitError) {
  // Vis "vent litt" melding
}

// Sjekk om reauth kreves
if (AppError.isAppError(error) && error.requiresReauth()) {
  // Redirect til innlogging
}
```

### Frontend feilhjelp (`frontend/app/lib/errorUtils.ts`)

```typescript
import { parseApiError, lagBrukervennligFeilmelding } from "../lib/errorUtils";

// Parse feilrespons fra backend
const melding = await parseApiError(res, "Fallback tekst");

// Lag brukervennlig melding med kontekst
const brukerMelding = lagBrukervennligFeilmelding(error, { canvas: true });
```

---

## 6. CI/CD & Workflows

Alle workflow-filer er på engelsk og ligger i `.github/workflows/`.

### ci.yml — Kodekvalitet

Kjøres ved push og PR mot `main`. Tre parallelle jobber:

- **quality**: typecheck, lint, lint:md, verify build
- **secret-scan**: TruffleHog (pinnet til spesifikk versjon, f.eks. `@v3.93.6`) — skanner for lekkede hemmeligheter
- **dependency-scan**: `pnpm audit --audit-level=high`

### deploy.yml — Produksjonsdeploy

Utløses via `workflow_run` på "CI" workflow. Deployer **kun** når:

- Alle CI-jobber er grønne (`conclusion == 'success'`)
- Triggeren var en push (ikke PR)

Deploy-steg: pnpm install → build common → Vercel pull/build/deploy → Render deploy hook.

### deploy.docs.yml — GitHub Pages

Utløses ved push til `docs/**`. Bygger VitePress-dokumentasjon og deployer til GitHub Pages.

### dependabot.yml

Ukentlige oppdateringer (mandager) for: `github-actions`, rot, `frontend`, `backend`, `common`, `docs`. Grupperer alle oppdateringer per pakke i én PR.

---

## 7. Feilsøking (Troubleshooting)

### "Module not found: Can't resolve 'common'"

- **Løsning**: Common-pakken må bygges før den kan brukes.
- Kjør: `pnpm build:common` eller bare `pnpm build`.

### "MongoNetworkError"

- **Løsning**: Sjekk at MongoDB kjører (hvis lokalt) eller at `MONGO_URI` i `backend/.env` er korrekt.
- Sjekk at din IP er whitelistet i MongoDB Atlas hvis du bruker sky-database.

### TypeScript-feil etter endringer i `common/`

- Kjør `pnpm build:common` for å regenerere typer, deretter `pnpm typecheck`.

---

## 8. Konfigurasjonsfiler og delt infrastruktur

### Konfigurasjon

- `backend/src/rutere/ki/aiModels.ts` - AI-modeller og standardmodell
- `backend/src/rutere/ki/systemPrompt.ts` - System prompt for KI-assistenten
- `backend/src/rutere/ki/kiConstants.ts` - KI cache-TTL og timeout-verdier
- `backend/src/rutere/canvas/canvasUtils.ts` - Paginering og cache-innstillinger
- `backend/src/middleware/auth.ts` - JWT utløpstider (konfigurerbar via miljøvariabler)
- `common/src/ki.ts` - Delte KI-skjemaer inkl. `SubTaskSchema` og meldingsgrenser
- `common/src/auth.ts` - Cookie-navn og auth-skjemaer

### Delte KI-hjelpefiler (`backend/src/rutere/ki/`)

Gjenbruk disse — **ikke dupliser**:

- `aiClient.ts` — AI-klient for Claude (import `chatCompletion`, `isClientAvailable`)
- `handleAIError.ts` — Sentralisert AI-feilhåndterer for timeout/rate-limit/billing/503 (import `handleAIError`)
- `aiModels.ts` — Modellkonfigurasjon, `DEFAULT_MODEL`
- `kiConstants.ts` — `KI_CACHE_TTL`, `KI_OPPSUMMERING_CACHE_TTL`, `KI_TIMEOUT_MS`
- `systemPrompt.ts` — Én kilde for `STUDYWISE_SYSTEM_PROMPT`

### Delte backend-hjelpefiler (`backend/src/utils/`)

- `env.ts` — `isProd` boolean (bruk i stedet for inline `process.env.NODE_ENV === "production"`)
- `htmlUtils.ts` — `stripHtml(html, { removeStyles?: boolean })`
- `logger.ts` — Pino-logger singleton (auto-redakter PII)
- `apiError.ts` — Standardisert feilrespons + `requireUserId()`

### Delte frontend-hjelpefiler (`frontend/app/lib/`)

- `varsler.ts` — frist-terskler, `klassifiserFrist()`, `formaterTid()`, varsler-typer og byggelogikk
- `frontend/app/canvas/canvasUtils.ts` — Canvas-data-utils (`erInnlevert()`, `formaterEmneStatus()`); bruk denne filen for slik logikk
- `errorUtils.ts` — `parseApiError()`, `lagBrukervennligFeilmelding()`
- `errors.ts` — `AppError`-klassehierarki for typet feilhåndtering

---

## 9. Sikkerhet og Personvern (nulltoleranse)

### Ingen Hardkoding av Hemmeligheter

Det er **strengt forbudt** å hardkode sensitive data.

- **API Nøkler**: Skal alltid lastes fra `.env` filer.
- **Tokens**: Skal aldri sjekkes inn i git.
- **URLer**: Bruk miljøvariabler.

### Sikkerhetsscanning i CI

- **TruffleHog**: Skanner hele git-historikken for lekkede hemmeligheter ved hver push.
- **pnpm audit**: Sjekker for kjente sårbarheter i avhengigheter (nivå: high+).
- **eslint-plugin-security**: Kjøres automatisk via `pnpm lint` i CI. Regel `detect-object-injection` er deaktivert for TypeScript-filer (falske positiver pga. typesystemet).

### Personvern (GDPR)

Vi behandler studentdata.

- **Loggføring**: Aldri loggfør personidentifiserbare data (PII) navn/epost i produksjon.
- **Dataflyt**: Send kun nødvendig data til frontend.
- **AI**: Send **aldri** PII til eksterne AI-tjenester uten anonymisering.

---

Hold denne filen oppdatert hvis prosjektstrukturen endres vesentlig.
