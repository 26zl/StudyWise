# AI Agent Guidelines & Project Master Reference

Dette dokumentet gir retningslinjer for AI-agenter (f.eks. Claude, Cursor) som jobber med koden i dette repoet.

**VIKTIG FOR AI-AGENTER:** Les dette dokumentet NØYE før du gjør endringer. Dette er "loven" for prosjektet.

StudyWise – AI-drevet studieveileder med Canvas LMS-integrasjon. pnpm-monorepo med pakkene `frontend`, `backend`, `common` og `docs`.

---

## 1. Teknologistack

### Frontend

- **Core**: Next.js 16, React 19, TypeScript 5.9
- **Styling**: Tailwind CSS v4 (med `@tailwindcss/postcss`) — bruk `m-0!`-syntaks for important, IKKE `!m-0`
- **State/Data**: `@tanstack/react-query` v5 for server-state, `zustand` for client-state, **nuqs** for URL-synkronisert state (f.eks. dashboard `?view=`)
- **Forms**: `react-hook-form` + `@hookform/resolvers` + `zod`
- **Routing**: Next.js App Router (Server Components default)
- **Feilhåndtering**: Delte error-klasser i `frontend/app/lib/errors.ts`
- **Varsler**: `sonner` for toast-meldinger. Bruk ALDRI `alert()` eller `confirm()` i frontend.

### Backend

- **Core**: Express 5, Node.js 20+
- **Språk**: TypeScript (kjøres med `tsx` i dev, `node` i prod)
- **Database**: MongoDB via `mongoose` v9
- **Validering**: `zod` (gjenbruker schema fra `common`)
- **API-dokumentasjon**: `swagger-ui-express` + `swagger-jsdoc`
- **Logging**: `pino` + `pino-http`. Bruk ALLTID `logger.info/error`, ALDRI `console.log`
- **Cache**: `redis`-klient mot Redis Cloud (Canvas API-cache, sync-struktur, KI-sesjon, rate limiting). **PDF/fil-innhold lagres aldri i Redis** — kun i MongoDB (ContentEmbedding); Redis brukes kun for struktur og session. Alle nøkler har TTL; sett **maxmemory-policy** til `allkeys-lru` for å unngå «nesten full»-varsler.
- **Vektorsøk**: Pinecone (serverless-indeks med **integrated embedding**). Embeddings genereres av Pinecone; chunk-tekst lagres i MongoDB (`ContentEmbedding`) som sannhetskilde og sendes til Pinecone for indeksering.
- **AI**: `@anthropic-ai/sdk` for Claude, `cohere-ai` for hybrid søk-reranking (rerank-v3.5)
- **Feilhåndtering**: Standardisert via `backend/src/utils/apiError.ts`
- **APM**: Datadog (`dd-trace`) — kreves i produksjon via `validateEnv()` og initialiseres i `backend/src/datadog.ts`; init er wrappet i try/catch slik at serveren fortsatt kan håndtere feil hvis tracer-oppsettet selv svikter. Frontend: RUM kjøres via `DatadogRum` når `DD_RUM_APPLICATION_ID`/`DD_RUM_CLIENT_TOKEN` eller `NEXT_PUBLIC_DD_RUM_APPLICATION_ID`/`NEXT_PUBLIC_DD_RUM_CLIENT_TOKEN` er satt.
- **Resiliens**: Circuit breakers for Canvas og Anthropic API (`backend/src/utils/circuitBreaker.ts`), request timeout-middleware (`backend/src/middleware/request-timeout.ts`)

### Common

Delte Zod-skjemaer og TypeScript-typer mellom frontend og backend. **Bruk subpath-imports** (ikke `common/src/...`):

```typescript
import { CanvasCourseSchema } from "common/canvas";             // Canvas API-typer
import { classifyHttpStatus } from "common/canvasErrors";       // Feilkoder og hjelpere
import { CANVAS_INSTITUTIONS } from "common/canvasInstitutions"; // Canvas-institusjonsliste
import { SubTaskSchema } from "common/ki";                      // KI/AI-typer
import { ChatMessageSchema } from "common/chat";                // Chat-historikk-typer
import { CalendarItemSchema } from "common/calendar";           // Kalender API-typer
import { Assignment, COURSE_COLOR_CLASSES } from "common/calendar-ui"; // Kalender UI-typer
import { DocumentParseResultSchema } from "common/document";    // Dokumentbehandling
import { AUTH_CHANNEL_NAME } from "common/auth";                // Auth-konstanter (f.eks. BroadcastChannel sync)
import { getWeekNumber } from "common/dateUtils";               // Dato-hjelpefunksjoner
import { UKEDAGER } from "common/arbeidsplan";                  // Arbeidsplan-konstanter
import { PaginationQueryValueSchema } from "common/admin";      // Admin-paginering og -typer
import { KONTAKT_MAX_ATTACHMENTS } from "common/contact";       // Kontaktskjema-konstanter
import { BrowserPushPreferencesSchema } from "common/notifications"; // Web push-typer
```

Når du legger til et nytt skjema i common, legg til en subpath-eksport i `common/package.json` sitt `"exports"`-kart.

---

## 2. Kommandoer

```bash
pnpm dev                    # Bygger common (predev), starter backend; frontend og docs starter etter backend /health (wait-on) – unngår ECONNREFUSED
pnpm dev:frontend           # Kun frontend (backend kan være nede)
pnpm dev:backend            # Kun backend
pnpm dev:docs               # Kun docs
pnpm typecheck              # Typecheck alle pakker
pnpm lint                   # Lint alle pakker
pnpm lint:md                # Lint markdown-filer
pnpm build                  # Bygg alt (common → backend → frontend → docs)

# Målrettede bygg (bygger common først)
pnpm build:common           # Kun common
pnpm build:frontend         # common + frontend
pnpm build:backend          # common + backend

pnpm --filter frontend add <pkg>   # Legg til pakke i frontend
pnpm --filter backend add <pkg>   # Legg til pakke i backend

pnpm kill:dev               # Stopp alle Node-prosesser (Windows)
pnpm clean:all              # Slett alle build-artefakter og node_modules
pnpm clean:install          # Full reinstall (clean + install + update + build)
```

### Dev-server-URLer

| Tjeneste     | URL                                   |
|--------------|---------------------------------------|
| Frontend     | <http://localhost:3000>               |
| Backend API  | <http://localhost:4000>               |
| Swagger UI   | <http://localhost:4000/api-docs>      |
| Health Check | <http://localhost:4000/health>        |
| Docs         | <http://localhost:5173>               |

**Bygge-rekkefølge**: `common` må bygges før frontend/backend. `pnpm build` håndterer dette automatisk. Ved `pnpm dev` kjører `predev` først (bygger common); frontend og docs venter på at backend svarer på `/health` før de startes.

### Tester

Vitest er satt opp for `common`, `frontend` og `backend` med 23 testfiler (~712 tester). Testfiler ligger i `__tests__/`-mapper i hver pakke.

```bash
pnpm test:unit               # Kjør alle enhetstester (common + backend + frontend)
pnpm test:unit:common        # Kjør kun common-tester
pnpm test:unit:backend       # Kjør kun backend-tester
pnpm test:unit:frontend      # Kjør kun frontend-tester
pnpm --filter backend test   # Kjør backend-tester (vitest)
pnpm --filter frontend test  # Kjør frontend-tester (vitest + @testing-library/react)
pnpm --filter common test    # Kjør common-tester (vitest)
```

### E2E / Funksjonelle tester (Playwright)

Workspace-pakken `tests/` inneholder Playwright E2E-spesifikasjoner og egne test-runnere. Krever at backend + frontend kjører.

```bash
pnpm test                          # Kjør alle testsuiter (auth, ki, canvas) via samlet runner
pnpm test:auth                     # Auth-suite (DB-sjekk, HTTP-smoke, API-repro)
pnpm test:auth:e2e                 # Playwright E2E auth-tester (alle nettlesere)
pnpm test:ki                       # KI/AI-smoketester
pnpm test:canvas                   # Canvas-smoketester
pnpm test:auth:matrix              # Full auth-scenariomatrise (120 scenarier)
pnpm test:auth:matrix:basic        # Gruppe A: Signup uniqueness
pnpm test:auth:matrix:update       # Gruppe G: Username updates
pnpm test:auth:matrix:delete       # Gruppe I: Deletion/reuse
pnpm test:auth:matrix:race         # Gruppe L: Race conditions
```

`func-testing.yml`-workflowen kjører Playwright E2E i CI (manuell trigger eller etter CI). Laster opp HTML-rapport og trace-artefakter.

### Docker (kun lokal utvikling)

```bash
docker compose up --build   # Kjør full stack lokalt (MongoDB, Redis, backend, frontend)
```

Docker brukes **kun for lokal utvikling** — ikke i produksjon. Alle tjenester bruker `security_opt: no-new-privileges:true`.

### Deploy

- **Backend**: Heroku (Professional dyno + Datadog buildpack) — auto-deploy fra `main` via Heroku Automatic Deploys
- **Frontend**: Vercel — deployes via `deploy.yml` etter at Functional Testing er grønn
- **Sikkerhet/CDN**: Cloudflare (DDoS, SSL/TLS, caching)
- **Docs**: GitHub Pages — deployes via `deploy.docs.yml` ved endringer i `docs/`

---

## 3. Arkitektur

### Dataflyt

```text
1. Canvas LMS (institusjonens læringsplattform, f.eks. universiteter og høgskoler i Norge)
   ↓
2. Backend henter data fra Canvas API
   ↓
3. Backend validerer og transformerer data
   ↓
4. Frontend henter data fra backend
   ↓
5. Frontend validerer og viser data til brukeren
```

Frontend kaller aldri eksterne APIer direkte. Alle forespørsler til `/api/*` og `/health` proxyes via Next.js til backend (konfigurert i `next.config.js` via `INTERNAL_API_URL`; dev fallback til `http://localhost:4000`).

### Auth-middleware-kjede

Forespørsler autentiseres gjennom middleware i `backend/src/middleware/`:

1. **`requireAuth`** (`auth.ts`) — Verifiserer Clerk Bearer-token fra `Authorization`-header, finner/oppretter MongoDB `User` via `clerkId`, setter `req.user` og `req.actorRole`
2. **`knyttCanvasToken`** (`auth.ts`) — Knytter dekryptert Canvas API-token og base URL til `req.canvasToken` / `req.canvasBaseUrl`. Bruk `knyttCanvasTokenValgfritt` for ruter som fungerer med eller uten Canvas
3. **`requireRole`** (`require-role.ts`) — RBAC-guard; sjekker `req.actorRole` mot tillatte roller

Typisk rute-oppsett: `router.use(requireAuth)`, deretter `knyttCanvasToken` per rute der Canvas-tilgang trengs.

### Audit-logging

`backend/src/utils/auditLog.ts` — `audit()` skriver strukturerte hendelser til MongoDB (`AuditLog`-modell) med aktør, handling, kategori, utfall og request-metadata. Kategorier: `auth`, `profile`, `integration`, `admin`, `security`, `privacy`, `ki`. Dekker auth-feil, admin-handlinger, kontosletting, Canvas-token-ops, chat-deling, RBAC/CSRF/rate-limit-brudd, sikkerhetsvarsler og alle KI-operasjoner (chat, dokumentanalyse, oppsummering, oppgavedeling, ukeplan, historikk-sletting). Importer `AUDIT_ACTIONS` for forhåndsdefinerte handlingskonstanter. AuditLog har 2-års TTL og automatisk GDPR-anonymisering ved brukersletting.

### Dashboard (SPA-container)

Lokasjon: `frontend/app/dashboard/page.tsx` (side) og `frontend/app/components/DashboardView.tsx` (hoved-UI).

- **Formål**: Samler Canvas og KI-verktøy i ett grensesnitt
- **Virkemåte**: SPA-container; aktiv visning styres av URL-parametren `?view=` via **nuqs** (`useQueryState`) i `DashboardView`, så fane-bytt ikke laster siden på nytt og URL holdes i sync

### Database-modeller

- **User**: Lokal StudyWise-bruker som speiler Clerk-identitet og lagrer appdata (unik epost, `clerkId`, rolle, kryptert `canvasApiToken`, preferanser). **Soft-delete-mønster**: User har et `deletedAt`-felt — alle spørringer MÅ filtrere med `deletedAt: { $exists: false }` med mindre du bevisst sjekker slettede brukere
- **CanvasUser**: Cache av Canvas-profilinfo, koblet til User via `localUser`
- **ChatHistory**: Kryptert chat-historikk per bruker (AES-256-GCM)
- **TaskBreakdown**: KI-genererte oppgavedelinger med redigerbare deloppgaver
- **Arbeidsplan**: Ukeplaner (studieblokker); collection-navn er `arbeidsplan` (ikke `arbeidsplans`)
- **ContentEmbedding**: Chunk-tekst og metadata per bruker/kurs/fil (MongoDB). Sannhetskilde for innhold; vektorindeks ligger i Pinecone (integrated embedding). Ingen vektorindeks i Atlas
- **DeletedUserTombstone**: GDPR-tombstone for slettede brukere (forhindrer re-registrering innen TTL)
- **PendingClerkDeletion**: Sporer asynkrone Clerk-brukerslettingsforespørsler
- **WebPushSubscription**: Browser push-varsling-abonnementer per bruker
- **SharedChat**: Offentlige delelenker for chat-samtaler (med utløpstid)
- **CanvasStructure**: Cachet Canvas-kursstruktur (moduler, elementer)

### Viktige konfigurasjonsfiler

- **AI-modeller**: `backend/src/rutere/ki/aiModels.ts`
- **System prompt**: `backend/src/rutere/ki/systemPrompt.ts`
- **KI timeout/cache**: `backend/src/rutere/ki/kiConstants.ts`
- **Canvas-paginering**: `PAGE_SIZE`, `MAX_PAGES` i `canvasUtils.ts`
- **Cache TTL**: `CACHE_TTL` i `canvasUtils.ts`; sync-struktur i Redis: `SYNC_CACHE_TTL` (2 timer) i `canvas-sync.service.ts`; KI-sesjonskontekst: `SESSION_CONTEXT_TTL` i `kiConstants.ts`
- **Pinecone**: `backend/src/services/pinecone.service.ts` (upsert, query, deleteByFilter); env: `PINECONE_API_KEY`, `PINECONE_INDEX_NAME`
- **Tillatte frontend-origins**: `WEB_ORIGINS` (kommaseparert liste) brukes av CORS, CSRF og Clerk `authorizedParties`
- **Cookie-navn**: `common/src/auth.ts`
- **Meldingsgrenser**: `common/src/ki.ts`
- **Kontaktskjema**: Drevet av Cloudflare Turnstile (`TURNSTILE_SECRET_KEY`) og en transport som videresender til en Cloudflare Worker (`CONTACT_WORKER_URL`, `CONTACT_WORKER_SECRET`, `CONTACT_TO_EMAIL`, `CONTACT_FROM_EMAIL`). Disse variablene er påkrevd i produksjon.

### KI-ruter (`backend/src/rutere/ki/`)

Hver fil håndterer ett KI-område:

- `ki.ts` – Generell chat-endepunkt
- `kiAnalyse.ts` – Dokumentanalyse (PDF, Word, bilder via Vision)
- `kiOppsummering.ts` – Tekstoppsummering
- `kiHistory.ts` – Chat-historikk
- `kiShare.ts` – Chat-deling (offentlige delelenker med utløpstid)
- `taskBreakdown.ts` – Oppgavedeling
- `weeklyPlan.ts` – KI-genererte ukeplaner

Andre ruter:

- `contact/contact.ts` – Håndterer kontaktskjema med Turnstile-verifisering og videresender til Cloudflare Worker

Delt infrastruktur (gjenbruk disse, ikke dupliser):

- `aiClient.ts` – AI-klient for Claude (import `chatCompletion`, `isClientAvailable`), wrappet i circuit breaker
- `handleAIError.ts` – Sentral AI-feilhåndterer for timeout/rate-limit/billing/503 (import `handleAIError`)
- `aiModels.ts` – Modellkonfigurasjon, `DEFAULT_MODEL`
- `kiConstants.ts` – `KI_CACHE_TTL`, `KI_OPPSUMMERING_CACHE_TTL`, `KI_TIMEOUT_MS`
- `systemPrompt.ts` – Én kilde for `STUDYWISE_SYSTEM_PROMPT`
- `studyContentUtils.ts` – Delte hjelpefunksjoner for studieinnhold (JSON-ekstraksjon, målrettede spørringer)

SSE-endepunkter må sjekke `res.writableEnded` før de skriver keepalive-pings. SSE-responser hopper over gzip-komprimering (`text/event-stream`-filter i `backend/src/index.ts`).

**KI-kontekstlasting**: Ved lasting av Canvas-kontekst for chat opprettes en `AbortController` og dens `signal` sendes til `loadCanvasContext` → `syncCanvasDataForUser`. Ved `res.once('finish')` / `res.once('close')` aborteres kontrolleren slik at bakgrunnssynk stoppes når responsen er ferdig.

### Dokumentbehandling

Backend tar imot filopplasting via `multer` og prosesserer med:

- `unpdf` + `mammoth` – Tekstuttrekk fra PDF og Word
- `tesseract.js` + `sharp` – OCR for bilder
- Uthentet tekst sendes som KI-kontekst

---

## 4. Regler for koding

### Generelle regler

- **Kun pnpm** – aldri npm
- **Pino-logger** – aldri console.log i backend
- **Zod-validering** – på alle pakkegrenser
- **Relative URLer** – frontend bruker `/api/...`, Next.js rewriter til backend
- **Konfigurasjon**: Ikke endre tsconfig/eslint/next.config uten å spørre
- **Norsk naming** – ruter, komponenter og variabler på norsk; filnavn på engelsk. **Alle kodekommentarer skal være på norsk** — ingen engelske hjelpekommentarer
- **Host-validering** – I produksjon er `API_HOST` påkrevd og styrer hvilket hostname som er tillatt (f.eks. `api.studwize.page`). Direkte tilgang via `herokuapp.com` returnerer 403. `/health` er unntatt. `TRUST_PROXY_HOPS` må settes riktig for faktisk proxy-kjede slik at klient-IP og rate limiting blir korrekt.
- **CORS pre-check** – Origin-validering skjer før `cors()`-middleware for å unngå generiske 500-feil fra ugyldige origins
- **Trust proxy** – Satt til `1` i Express for korrekt IP-håndtering bak Cloudflare/Heroku-proxyer
- **Rate limiting** – bruk eksisterende `rateLimitKi`-middleware for KI-endepunkter; for andre sensitive endepunkter: `rate-limiter-flexible` (se `backend/src/middleware/rate-limit.ts`)
- **Sikkerhetslint** – `pnpm lint` inkluderer `eslint-plugin-security` (SAST) i frontend og backend. Kjøres i CI.
- **Toast** – frontend skal bruke `sonner` for varsler. Aldri `alert()` eller `confirm()`
- **Typing av `req.user`** – globalt typet via `backend/src/typer/express.d.ts`. Aldri cast med `as any`
- **Middleware-rekkefølge** – I `backend/src/index.ts` må alle ruter monteres ETTER body parser, CORS og auth. Monteres ruter først, blir `req.body` og `req.user` `undefined`

### Styling (Tailwind)

- Aldri egne `.css`-filer (unntatt `globals.css`)
- **Dark mode**: Alle farger MÅ ha `dark:`-variant
- **Mobile first**: Design for mobil først, deretter breakpoints (`sm:`, `md:`, `lg:`)
  - Riktig: `w-full md:w-1/2`
  - Feil: `w-1/2 max-md:w-full`

### Feilhåndtering

**Backend** – bruk `backend/src/utils/apiError.ts`:

```typescript
import { apiError, sendZodError, sendUnknownError, requireUserId } from "../../utils/apiError.js";

// Auth-guard (returnerer userId eller sender 401 og returnerer null)
const userId = requireUserId(req, res);
if (!userId) return;

apiError.unauthorized(res, "Melding");
apiError.badRequest(res, "Melding", detaljer);
apiError.notFound(res, "Ressurs");
sendZodError(res, zodError, "Kontekst");
sendUnknownError(res, error, { kontekst: "minFunksjon" });
```

**Backend Canvas-feil** – bruk `backend/src/rutere/canvas/canvasErrors.ts`:

```typescript
import { createCanvasError, getErrorResponse, classifyHttpStatus } from "./canvasErrors.js";
// createCanvasError() for å kaste, getErrorResponse() for JSON-respons
```

**Frontend** – bruk `frontend/app/lib/errors.ts`:

```typescript
import { KIAuthError, KIRateLimitError, CanvasTokenMissingError, AppError } from "../lib/errors";

if (error instanceof KIRateLimitError) { /* vis "vent litt" */ }
if (AppError.isAppError(error) && error.requiresReauth()) { /* redirect til innlogging */ }
```

**Frontend API-feil** – bruk `frontend/app/lib/errorUtils.ts`:

```typescript
import { parseApiError, lagBrukervennligFeilmelding } from "../lib/errorUtils";
const melding = await parseApiError(res, "Fallback tekst");
```

### SubTaskUI-mønster (UI-only state)

Når en common-type trenger kun-UI-felt (f.eks. `approved` for optimistisk UI), lag et lokalt interface som utvider typen, og fjern ekstra felt ved API-grensen:

```typescript
import type { SubTask } from "common/ki";

interface SubTaskUI extends SubTask {
  approved?: boolean; // Kun UI – sendes ikke til backend
}

// Strip ved lagring
onSave(subtasks.map(({ approved: _approved, ...task }) => task));
```

### Delte hjelpefiler (gjenbruk, ikke dupliser)

**Backend**:

- `backend/src/utils/env.ts` — `isProd` (bruk i stedet for inline `process.env.NODE_ENV === "production"`)
- `backend/src/utils/htmlUtils.ts` — `stripHtml(html, { removeStyles?: boolean })`
- `backend/src/utils/logger.ts` — Pino-logger singleton (redakterer PII automatisk)
- `backend/src/utils/apiError.ts` — Standard feilrespons + `requireUserId()`
- `backend/src/utils/auditLog.ts` — `audit()` + `AUDIT_ACTIONS` for strukturerte audit-hendelser
- `backend/src/utils/kryptering.ts` — `encrypt()` / `decrypt()` for AES-256-GCM (Canvas-tokens, chat-historikk)

**Frontend**:

- `frontend/app/lib/dato.ts` — dato/klokkeslett (`formaterDatoShort()`, `formaterKlokkeslett()`, `dagerFraIdag()`, `formaterDagerRelativtFrist()`); bruk disse i stedet for rå `toLocaleDateString`/`toLocaleTimeString`
- `frontend/app/lib/varsler.ts` — frist-terskler (`FRIST_VINDU_DAGER`), `klassifiserFrist()`, `formaterTid()`, varsler-typer
- `frontend/app/canvas/canvasUtils.ts` — Canvas-data (`erInnlevert()`, `formaterEmneStatus()`); importer herfra
- `frontend/app/lib/errorUtils.ts` — `parseApiError()`, `lagBrukervennligFeilmelding()`
- `frontend/app/lib/errors.ts` — `AppError`-klassehierarki for typet feilhåndtering
- `frontend/app/components/ui/Loading.tsx` — felles last-UI: `LoadingSpinner` og `LoadingView` (én fil; bruk for alle lastetilstander). `FeilMelding` for feilvisning.

### Database

- Definer schema i `backend/src/database/models/`
- Bruk Zod i `common` for å validere data før det treffer databasen
- Bruk Mongoose-modeller som tiltenkt (`.find()`, `.create()`, osv.)
- **Soft-delete**: Ved spørring mot `User`, legg alltid til `deletedAt: { $exists: false }` med mindre du bevisst trenger slettede brukere (f.eks. admin-statistikk, konfliktdeteksjon med eksplisitt `deletedAt`-sjekk)
- **Nye modeller**: Registrer i `ensureDatabaseIndexes()` i `backend/src/database/database.ts` slik at indekser opprettes ved oppstart
- **Migrations**: `backend/src/database/migrations.ts` — kjøres automatisk ved oppstart. Legg nye migrasjoner til i `migrations`-arrayet. Utførte migrasjoner registreres i `migrationrecords`-collection

---

## 5. Legge til ny funksjonalitet

Følg mønsteret: **Common → Backend → Frontend**

1. **Common**: Definer Zod-schema i `common/src/<feature>.ts`, legg til subpath-eksport i `common/package.json` `"exports"`, kjør `pnpm build:common`
2. **Backend**: Opprett rutefil i `backend/src/rutere/<feature>/`, registrer ruter i `backend/src/index.ts`
3. **Frontend**: Lag datahenting med `@tanstack/react-query` i `frontend/app/<feature>/<feature>-api.ts`
4. **Komponent**: Bruk hook i komponent under `frontend/app/components/`

Du trenger ikke endre `next.config.js` – alle `/api/*` proxyes til backend.

---

## 6. Git og CI/CD

1. **Hold deg oppdatert**: Kjør `git pull origin main` ofte
2. **Kvalitet**: Kjør `pnpm typecheck`, `pnpm lint` og `pnpm build` jevnlig
3. Bruk ALDRI `npm`. Dette er et pnpm-prosjekt.

```bash
# Første gangs oppsett
pnpm install
pnpm build   # Bygger common først!
```

**Miljøvariabler**: Kopier `backend/.env.example` → `backend/.env` og fyll ut. Påkrevd for dev: `MONGO_URI`, `REDIS_URL`, `CLERK_SECRET_KEY`, `ENCRYPTION_KEY`, `ANTHROPIC_API_KEY`, `COHERE_API_KEY`, `PINECONE_API_KEY`, `PINECONE_INDEX_NAME`, `AUTH_TURNSTILE_GATE_SECRET`. Produksjon krever i tillegg `API_HOST`, `TRUST_PROXY_HOPS`, `WEB_ORIGINS` og valgfritt `INTERNAL_HOSTS` (kommaseparerte hostnames for intern trafikk, f.eks. Vercel → Heroku direkte), Datadog APM (`DD_*`), samt kontaktskjema-variabler (`TURNSTILE_SECRET_KEY`, `CONTACT_WORKER_URL`, `CONTACT_WORKER_SECRET`, `CONTACT_TO_EMAIL`, `CONTACT_FROM_EMAIL`).

### CI (`.github/workflows/ci.yml`)

Kjøres ved push og PR mot `main`. **Actionlint må være grønn før de andre jobbene kjører** (`needs: [actionlint]`):

- **actionlint** – workflow-lint (rask, ingen avhengigheter). Må passere først.
- **quality** – enhetstester, typecheck, lint, lint:md, verify build (inkluderer safe-chain malware-deteksjon ved `pnpm install`)
- **dependency-scan** – `pnpm audit --audit-level=high`
- **secret-scan** – TruffleHog (`trufflesecurity/trufflehog@v3.93.8`) skanner etter lekkede hemmeligheter
- **sbom** – genererer CycloneDX SBOM (Software Bill of Materials), lastes opp som artefakt

Alle jobber har `permissions: contents: read` og `actions: read` (på workflow-nivå eller per jobb). Timeout på alle jobber.

### Pipeline-kjede

```text
CI (push/PR) ─┬─→ Deploy (Vercel frontend)
               └─→ Functional Testing (Playwright E2E)  [parallelt, blokkerer ikke deploy]
```

Deploy (`deploy.yml`) og Functional Testing (`func-testing.yml`) utløses begge automatisk når CI er grønn ved push til `main`. De kjører parallelt — Playwright E2E blokkerer ikke deploy. Backend deployes via Heroku Automatic Deploys (uavhengig av workflow-kjeden).

### Andre workflows

- **func-testing.yml** — Playwright E2E-tester; kjøres parallelt med deploy etter CI er grønn (push til `main`) eller manuelt (workflow_dispatch). Laster opp HTML-rapport og trace-artefakter
- **deploy.yml** — trigger når CI er grønn på `main` (push): frontend deployes via Vercel CLI; backend deployes automatisk via Heroku Automatic Deploys
- **deploy.docs.yml** — ved endringer i `docs/`: bygger VitePress og deployer til GitHub Pages
- **owasp-dependency-check.yml** — ukentlig (mandager) + workflow_dispatch; bruker `dependency-check/Dependency-Check_Action@1.1.0` med input `others` (ikke `args`)
- **update-dependencies.yml** — ukentlig (mandager) + workflow_dispatch, oppretter PR med `pnpm -r update`

---

## 7. Sikkerhet og personvern (nulltoleranse)

### CSP (Content Security Policy)

Nonce-basert CSP håndheves per request i `frontend/proxy.ts`. `buildCspValue(nonce)` fra `next.config.js` genererer policyen: produksjon bruker `'nonce-<verdi>'` + `'strict-dynamic'` for script-src, dev faller tilbake til `'unsafe-inline'`. Nonce sendes til layout via `x-nonce` request-header.

### Ingen hardkoding av hemmeligheter

- **API-nøkler**: Last alltid fra `.env`
- **Tokens**: Aldri sjekk inn i git
- **URLer**: Bruk miljøvariabler

### Sikkerhetsscanning i CI

- **TruffleHog**: Skanner git-historikk for lekkede hemmeligheter ved push
- **pnpm audit**: Sjekker avhengigheter (nivå: high+)
- **eslint-plugin-security**: Kjøres via `pnpm lint` i CI. `detect-object-injection` er deaktivert for TypeScript-filer (falske positiver)

### Personvern (GDPR)

- **Logging**: Aldri logg PII (navn/epost) i produksjon
- **Dataflyt**: Send kun nødvendig data til frontend
- **AI**: Aldri send PII til eksterne AI-tjenester uten anonymisering

### Dokumenterte sikkerhets-/revisjonsbeslutninger

- **M6 (BroadcastChannel-validering)**: BroadcastChannel er begrenset til same-origin per nettleser-spesifikasjon — risikoen er minimal, ekstra validering ikke påkrevd.
- **H3 (multer MIME-type)**: Magic byte-validering skjer i `parseDocument()`. Multer `fileFilter` kan ikke sjekke buffer i memory storage mode.
- **H5 (ErrorBoundary for lazy chunks)**: `SectionErrorBoundary` wrapper allerede alle lazy-loadede seksjoner i `DashboardView`.

---

## 8. Feilsøking

- **"Can't resolve 'common'"** → `pnpm build:common` eller `pnpm build`
- **Port i bruk** → `pnpm kill:dev`
- **Typefeil etter clean** → `pnpm build`
- **"MongoNetworkError"** → Sjekk `MONGO_URI` i `.env` og IP whitelist i MongoDB Atlas
- **"bad auth : authentication failed"** (Atlas) → Sjekk brukernavn/passord og Database Access-rettigheter.
- **TypeScript-feil etter endringer i `common/`** → Kjør `pnpm build:common`, deretter `pnpm typecheck`
- **Redis «nesten full» / høyt minne** → Redis cacher Canvas API + sync-struktur (per bruker/emne). Sett **maxmemory-policy** til `allkeys-lru` (eller `volatile-lru`) i Redis Cloud slik at Redis evicter eldre nøkler. Sync-cache TTL er 2 timer (`SYNC_CACHE_TTL = 7200`) for å begrense vekst.

---

Hold denne filen oppdatert når prosjektstrukturen endres vesentlig.
