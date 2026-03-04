# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

**IMPORTANT FOR AI AGENTS:** Read this document CAREFULLY before making changes. This is the "law" for the project.

## Project Overview

StudyWise - AI-powered study assistant with Canvas LMS integration. pnpm monorepo with `frontend`, `backend`, `common`, and `docs` packages.

---

## 1. Technology Stack

### Frontend

- **Core**: Next.js 16, React 19, TypeScript 5.9
- **Styling**: Tailwind CSS v4 (with `@tailwindcss/postcss`)
- **State/Data**: `@tanstack/react-query` v5 for server-state, `zustand` for client-state
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
- **AI**: `@huggingface/inference` for HuggingFace models
- **Error handling**: Standardized via `backend/src/utils/apiError.ts`

### Common

Zod schemas and TypeScript interfaces shared between frontend and backend. **Subpath imports** (use these, not `common/src/...`):

```typescript
import { CanvasCourseSchema } from "common/canvas";       // Canvas API types
import { classifyHttpStatus } from "common/canvasErrors";  // Error codes & helpers
import { SubTaskSchema } from "common/ki";                 // KI/AI feature types
import { ChatMessageSchema } from "common/chat";           // Chat history types
import { CalendarItemSchema } from "common/calendar";      // Calendar API types
import { CalendarUIEventSchema } from "common/calendar-ui"; // Calendar UI types
import { DocumentSchema } from "common/document";          // Document processing types
import { COOKIE_NAMES } from "common/auth";                // Auth constants
import { getWeekNumber } from "common/dateUtils";          // Date utilities
```

When adding a new schema to common, add a subpath export in `common/package.json` `"exports"` map.

---

## 2. Commands

```bash
pnpm dev                    # Start frontend (3000) + backend (4000) + docs
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

**Build order**: `common` must be built before frontend/backend. `pnpm build` handles this automatically.

### Tests

Vitest is configured for both `frontend` and `backend` (with `supertest`). No test files exist yet.

```bash
pnpm --filter backend test   # Run backend tests (vitest)
pnpm --filter frontend test  # Run frontend tests (vitest + @testing-library/react)
```

### Docker

```bash
docker compose up --build   # Run full stack locally (MongoDB, Redis, backend, frontend)
```

### Deployment

- **Backend**: Render (Docker)
- **Frontend**: Vercel
- **Security/CDN**: Cloudflare (DDoS, SSL/TLS, caching)

---

## 3. Architecture

### Data Flow

```text
1. Canvas LMS (USN's learning platform)
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

Location: `frontend/app/dashboard/page.tsx`

- **Purpose**: Combines Canvas and AI tools in one interface
- **How it works**: SPA container using React state (`activeView`) to switch components without page reload

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

- `hfClient.ts` - Singleton HuggingFace `InferenceClient` (import `hfClient`)
- `handleHFError.ts` - Shared HF error handler for timeout/rate-limit/503 (import `handleHFError`)
- `kiConstants.ts` - `KI_CACHE_TTL`, `KI_OPPSUMMERING_CACHE_TTL`, `KI_TIMEOUT_MS`
- `systemPrompt.ts` - Single source for `STUDYWISE_SYSTEM_PROMPT`

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
- `frontend/app/lib/fristUtils.ts` — `klassifiserFrist()`, `formaterTid()`, deadline thresholds
- `frontend/app/lib/errorUtils.ts` — `parseApiError()`, `lagBrukervennligFeilmelding()`
- `frontend/app/lib/errors.ts` — `AppError` class hierarchy for typed error handling

### Database Rules

- Define schemas in `backend/src/database/models/`
- Use Zod in `common` to validate data before it hits the database
- Use Mongoose models as intended (`.find()`, `.create()`, etc.)

---

## 5. Git & Workflow

1. **Stay updated**: Run `git pull origin main` often
2. **Quality check**: Run `pnpm typecheck`, `pnpm lint`, and `pnpm build` regularly
3. NEVER use `npm`. This is a `pnpm` project.

```bash
# First time setup
pnpm install
pnpm build  # Builds common package first!
```

---

## 6. Security and Privacy (Zero Tolerance)

### No Hardcoding of Secrets

- **API Keys**: Must always be loaded from `.env` files
- **Tokens**: Must never be checked into git
- **URLs**: Use environment variables

### Privacy (GDPR)

- **Logging**: Never log PII (names/emails) in production
- **Data Flow**: Send only necessary data to frontend
- **AI**: Never send PII to external AI services without anonymization

---

## 7. Troubleshooting

- **"Can't resolve 'common'"** → `pnpm build:common` or `pnpm build`
- **Port in use** → `pnpm kill:dev`
- **Type errors after clean** → `pnpm build`
- **"MongoNetworkError"** → Check `MONGO_URI` in `.env` and IP whitelist in MongoDB Atlas

---

Keep this file updated if the project structure changes significantly.
