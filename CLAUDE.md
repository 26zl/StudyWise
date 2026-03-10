# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

**IMPORTANT FOR AI AGENTS:** Read this document CAREFULLY before making changes. This is the "law" for the project.

## Project Overview

StudyWise - AI-powered study assistant with Canvas LMS integration. pnpm monorepo with `frontend`, `backend`, `common`, and `docs` packages.

---

## 1. Technology Stack

### Frontend

- **Core**: Next.js 16, React 19, TypeScript 5.9
- **Styling**: Tailwind CSS v4 (with `@tailwindcss/postcss`) — use `m-0!` syntax for important, NOT `!m-0`
- **State/Data**: `@tanstack/react-query` v5 for server-state, `zustand` for client-state, **nuqs** for URL-synced state (e.g. dashboard `?view=`)
- **Forms**: `react-hook-form` + `@hookform/resolvers` + `zod`
- **Routing**: Next.js App Router (Server Components default)
- **Error handling**: Shared error classes in `frontend/app/lib/errors.ts`

### Backend

- **Core**: Express 5, Node.js 20+
- **Language**: TypeScript (runs with `tsx` in dev, `node` in prod)
- **Database**: MongoDB via `mongoose` v9
- **Validation**: `zod` (reuses schemas from `common`)
- **API Docs**: `swagger-ui-express` + `swagger-jsdoc`
- **Logging**: `pino` + `pino-http`. ALWAYS use `logger.info/error`, NEVER `console.log`
- **Cache**: `redis` client with Redis Cloud
- **AI**: `@anthropic-ai/sdk` for Claude
- **Error handling**: Standardized via `backend/src/utils/apiError.ts`
- **APM**: Datadog (`dd-trace`) — initializes conditionally when `DD_API_KEY` is set (`backend/src/datadog.ts`)
- **Resilience**: Circuit breakers for Canvas and Anthropic APIs (`backend/src/utils/circuitBreaker.ts`), request timeout middleware (`backend/src/middleware/request-timeout.ts`)

### Common

Zod schemas and TypeScript interfaces shared between frontend and backend. **Subpath imports** (use these, not `common/src/...`):

```typescript
import { CanvasCourseSchema } from "common/canvas";       // Canvas API types
import { classifyHttpStatus } from "common/canvasErrors";  // Error codes & helpers
import { SubTaskSchema } from "common/ki";                 // KI/AI feature types
import { ChatMessageSchema } from "common/chat";           // Chat history types
import { CalendarItemSchema } from "common/calendar";           // Calendar API types
import { Assignment, COURSE_COLOR_CLASSES } from "common/calendar-ui"; // Calendar UI types
import { DocumentParseResultSchema } from "common/document";   // Document processing types
import { AUTH_COOKIE_NAME, AUTH_REFRESH_COOKIE_NAME } from "common/auth"; // Auth constants
import { getWeekNumber } from "common/dateUtils";          // Date utilities
```

When adding a new schema to common, add a subpath export in `common/package.json` `"exports"` map.

---

## 2. Commands

```bash
pnpm dev                    # Start frontend (3000) + backend (4000) + docs (5173)
pnpm dev:frontend           # Start only frontend
pnpm dev:backend            # Start only backend
pnpm dev:docs               # Start only docs
pnpm typecheck              # Type-check all packages
pnpm lint                   # Lint all packages
pnpm lint:md                # Lint markdown files
pnpm build                  # Build all (common → backend → frontend → docs)

# Targeted builds (each also builds common first)
pnpm build:common           # Build only common package
pnpm build:frontend         # Build common + frontend
pnpm build:backend          # Build common + backend

pnpm --filter frontend add <pkg>   # Add package to frontend
pnpm --filter backend add <pkg>    # Add package to backend

pnpm kill:dev               # Kill all Node processes (Windows)
pnpm clean:all              # Delete all build artifacts and node_modules
pnpm clean:install          # Full reinstall (clean + install + update + build)
```

### Dev Server URLs

| Service      | URL                                   |
|--------------|---------------------------------------|
| Frontend     | <http://localhost:3000>               |
| Backend API  | <http://localhost:4000>               |
| Swagger UI   | <http://localhost:4000/api-docs>      |
| Health Check | <http://localhost:4000/health>        |
| Docs         | <http://localhost:5173>               |

**Build order**: `common` must be built before frontend/backend. `pnpm build` handles this automatically.

### Tests

Vitest is configured for both `frontend` and `backend` (with `supertest`). No test files exist yet.

```bash
pnpm --filter backend test   # Run backend tests (vitest)
pnpm --filter frontend test  # Run frontend tests (vitest + @testing-library/react)
```

### Docker (kun lokal utvikling)

```bash
docker compose up --build   # Run full stack locally (MongoDB, Redis, backend, frontend)
```

Docker brukes **kun for lokal utvikling** — ikke i produksjon.

### Deployment

- **Backend**: Render (Native Runtime, ikke Docker)
- **Frontend**: Vercel
- **Security/CDN**: Cloudflare (DDoS, SSL/TLS, caching)

---

## 3. Architecture

### Data Flow

```text
1. Canvas LMS (institution's learning platform, e.g. universities/colleges in Norway)
   ↓
2. Backend fetches data from Canvas API
   ↓
3. Backend validates and transforms data
   ↓
4. Frontend fetches data from backend
   ↓
5. Frontend validates and displays data to user
```

Frontend never calls external APIs directly. All `/api/*` requests proxy through Next.js to backend (configured in `next.config.js`).

### Dashboard (SPA Container)

Location: `frontend/app/dashboard/page.tsx` (page) and `frontend/app/components/DashboardView.tsx` (main UI).

- **Purpose**: Combines Canvas and AI tools in one interface
- **How it works**: SPA container; active view is driven by the `?view=` URL param via **nuqs** (`useQueryState`) in `DashboardView`, so switching tabs does not reload the page and the URL stays in sync

### Database Models

- **User**: Local auth (email, password, encrypted canvasApiToken)
- **CanvasUser**: Cache of Canvas profile info, links to User via `localUser`
- **ChatHistory**: Encrypted chat history per user (AES-256-GCM)
- **TaskBreakdown**: AI-generated task breakdowns with editable subtasks

### Key Configuration Files

- **AI models**: `backend/src/rutere/ki/aiModels.ts`
- **System prompt**: `backend/src/rutere/ki/systemPrompt.ts`
- **KI timeouts/cache**: `backend/src/rutere/ki/kiConstants.ts`
- **Canvas pagination**: `PAGE_SIZE`, `MAX_PAGES` in `canvasUtils.ts`
- **Cache TTL**: `CACHE_TTL` in `canvasUtils.ts`
- **JWT expiry**: Configurable via `JWT_ACCESS_EXPIRES`, `JWT_REFRESH_EXPIRES` env vars
- **Cookie names**: `common/src/auth.ts`
- **Message limits**: `common/src/ki.ts`

### AI Routes (`backend/src/rutere/ki/`)

Each file handles a distinct AI feature:

- `ki.ts` - General chat endpoint
- `kiCanvas.ts` - Canvas-context AI queries
- `kiAnalyse.ts` - Assignment analysis (uses `analyzeDocumentCore()` shared by both endpoints)
- `kiOppsummering.ts` - Text summarization
- `kiHistory.ts` - Chat history management
- `taskBreakdown.ts` - Task breakdown generation

Shared infrastructure (reuse these, don't duplicate):

- `aiClient.ts` - AI client for Claude (import `chatCompletion`, `isClientAvailable`), wrapped in circuit breaker
- `handleAIError.ts` - Centralized AI error handler for timeout/rate-limit/billing/503 (import `handleAIError`)
- `aiModels.ts` - Model config, `DEFAULT_MODEL`
- `kiConstants.ts` - `KI_CACHE_TTL`, `KI_OPPSUMMERING_CACHE_TTL`, `KI_TIMEOUT_MS`
- `systemPrompt.ts` - Single source for `STUDYWISE_SYSTEM_PROMPT`

SSE endpoints must check `res.writableEnded` before writing keepalive pings.

### Document Processing

The backend accepts file uploads via `multer` and processes them with:

- `unpdf` + `mammoth` - Extract text from PDFs and Word docs
- `tesseract.js` + `sharp` - OCR for images
- Extracted text is passed as AI context

---

## 4. Coding Rules

### General Rules

- **pnpm only** - Never npm
- **Pino logger** - Never console.log in backend
- **Zod validation** - At all package boundaries
- **Relative URLs** - Frontend uses `/api/...`, Next.js rewrites to backend
- **Config protection** - Don't modify tsconfig/eslint/next.config without asking
- **Norwegian naming** - Routes, components, variables in Norwegian; filenames in English
- **Rate limiting** - Apply `rate-limiter-flexible` middleware for new sensitive endpoints (see `backend/src/middleware/rate-limit.ts`)
- **Security linting** - `pnpm lint` includes `eslint-plugin-security` (SAST) in both frontend and backend. Runs automatically in CI.
- **Toast notifications** - Frontend must use `sonner` for user-facing notifications. Never use `alert()` or `confirm()`
- **`req.user` typing** - Globally typed via `backend/src/typer/express.d.ts`. Never cast with `as any`
- **Middleware ordering** - In `backend/src/index.ts`, mount all route handlers AFTER body parsers, CORS, and auth middleware. Mounting before means `req.body` and `req.user` will be `undefined`

### Styling Rules (Tailwind)

- NEVER use custom `.css` files (except `globals.css`)
- **Dark Mode**: All colors MUST have a `dark:` variant
- **Mobile First**: Always design for mobile first, then add breakpoints (`sm:`, `md:`, `lg:`)
  - Correct: `w-full md:w-1/2`
  - Wrong: `w-1/2 max-md:w-full`

### Error Handling

**Backend** - Use `backend/src/utils/apiError.ts`:

```typescript
import { apiError, sendZodError, sendUnknownError, requireUserId } from "../../utils/apiError.js";

// Auth guard (returns userId or sends 401 and returns null)
const userId = requireUserId(req, res);
if (!userId) return;

apiError.unauthorized(res, "Message");
apiError.badRequest(res, "Message", details);
apiError.notFound(res, "Resource");
sendZodError(res, zodError, "Context");
sendUnknownError(res, error, { kontekst: "function" });
```

**Backend Canvas errors** - Use `backend/src/rutere/canvas/canvasErrors.ts`:

```typescript
import { createCanvasError, getErrorResponse, classifyHttpStatus } from "./canvasErrors.js";
// createCanvasError() for throwing, getErrorResponse() for JSON responses
```

**Frontend** - Use `frontend/app/lib/errors.ts`:

```typescript
import { KIAuthError, CanvasTokenMissingError, AppError } from "../lib/errors";

if (AppError.isAppError(error) && error.requiresReauth()) {
  // Handle reauth
}
```

**Frontend API error parsing** - Use `frontend/app/lib/errorUtils.ts`:

```typescript
import { parseApiError, lagBrukervennligFeilmelding } from "../lib/errorUtils";
const melding = await parseApiError(res, "Fallback tekst");
```

### UI-only State Pattern

When a common type needs UI-only fields (e.g. optimistic state), extend it locally and strip the extra fields before calling the API:

```typescript
import type { SubTask } from "common/ki";

interface SubTaskUI extends SubTask {
  approved?: boolean; // UI-only — never sent to backend
}

// Strip at the API boundary
onSave(subtasks.map(({ approved: _approved, ...task }) => task));
```

### Shared Utilities (reuse, don't duplicate)

**Backend**:

- `backend/src/utils/env.ts` — `isProd` boolean (use instead of inline `process.env.NODE_ENV === "production"`)
- `backend/src/utils/htmlUtils.ts` — `stripHtml(html, { removeStyles?: boolean })`
- `backend/src/utils/logger.ts` — Pino logger singleton (auto-redacts PII)

**Frontend**:

- `frontend/app/lib/dato.ts` — date/time formatting (`formaterDatoShort()`, `formaterKlokkeslett()`, `dagerFraIdag()`, `formaterDagerRelativtFrist()`); use these instead of raw `toLocaleDateString`/`toLocaleTimeString`
- `frontend/app/lib/varsler.ts` — frist thresholds (`FRIST_VINDU_DAGER`), `klassifiserFrist()`, `formaterTid()`, varsler types and build logic
- `frontend/app/canvas/canvasUtils.ts` — Canvas data utils (`erInnlevert()`, `formaterEmneStatus()`); other files should import from here
- `frontend/app/lib/errorUtils.ts` — `parseApiError()`, `lagBrukervennligFeilmelding()`
- `frontend/app/lib/errors.ts` — `AppError` class hierarchy for typed error handling

### Database Rules

- Define schemas in `backend/src/database/models/`
- Use Zod in `common` to validate data before it hits the database
- Use Mongoose models as intended (`.find()`, `.create()`, etc.)
- **Migrations**: `backend/src/database/migrations.ts` — runs automatically at startup. Add new migrations to the `migrations` array

---

## 5. Adding New Functionality

Follow this pattern: **Common → Backend → Frontend**

1. **Common**: Define Zod schema in `common/src/<feature>.ts`, add subpath export in `common/package.json` `"exports"`, run `pnpm build:common`
2. **Backend**: Create route file in `backend/src/rutere/<feature>/`, register router in `backend/src/index.ts`
3. **Frontend**: Create data-fetching hook with `@tanstack/react-query` in `frontend/app/<feature>/<feature>-api.ts`
4. **Component**: Use the hook in a component under `frontend/app/components/`

No changes to `next.config.js` needed — all `/api/*` routes automatically proxy to backend.

---

## 6. Git & CI/CD

1. **Stay updated**: Run `git pull origin main` often
2. **Quality check**: Run `pnpm typecheck`, `pnpm lint`, and `pnpm build` regularly
3. NEVER use `npm`. This is a `pnpm` project.

```bash
# First time setup
pnpm install
pnpm build  # Builds common package first!
```

### CI Pipeline (`.github/workflows/ci.yml`)

Runs on push and PRs to `main`. **Actionlint must be green before other jobs run** (`needs: [actionlint]`):

- **actionlint** – workflow lint (fast, no deps). Must pass first.
- **quality** – typecheck, lint, lint:md, verify build
- **dependency-scan** – `pnpm audit --audit-level=high`
- **secret-scan** – TruffleHog scans for leaked secrets

All jobs have timeouts. Deploy (`deploy.yml`) triggers automatically when CI succeeds on push to `main`.

---

## 7. Security and Privacy (Zero Tolerance)

### No Hardcoding of Secrets

- **API Keys**: Must always be loaded from `.env` files
- **Tokens**: Must never be checked into git
- **URLs**: Use environment variables

### Privacy (GDPR)

- **Logging**: Never log PII (names/emails) in production
- **Data Flow**: Send only necessary data to frontend
- **AI**: Never send PII to external AI services without anonymization

### Documented security/audit decisions

- **M2 (refresh bypass rate-limit)**: Product decision required on who should have access; rate limit on `/refresh` is in place.
- **M6 (BroadcastChannel validation)**: BroadcastChannel is same-origin only per browser spec — risk is minimal; extra validation not required.
- **H3 (multer MIME-type)**: Magic-byte validation happens in `parseDocument()`. Multer `fileFilter` cannot inspect buffer in memory storage mode.
- **H5 (ErrorBoundary for lazy chunks)**: `SectionErrorBoundary` already wraps all lazy-loaded sections in `DashboardView`.

---

## 8. Troubleshooting

- **"Can't resolve 'common'"** → `pnpm build:common` or `pnpm build`
- **Port in use** → `pnpm kill:dev`
- **Type errors after clean** → `pnpm build`
- **"MongoNetworkError"** → Check `MONGO_URI` in `.env` and IP whitelist in MongoDB Atlas

---

Keep this file updated if the project structure changes significantly.
