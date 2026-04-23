# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

StudyWise is an AI-powered study assistant for higher education with Canvas LMS integration. Built as a Bachelor's thesis project (2026). Production: <https://www.studwize.page>. The codebase uses Norwegian for variable names, comments, and error messages.

### Norwegian glossary (common directory/concept names)

- `rutere` → routers (Express route modules)
- `kunnskapsbase` → knowledge base (user-uploaded docs/links, RAG-indexed)
- `arbeidsplan` → study plan / weekly schedule
- `ki` → AI (kunstig intelligens) — Claude chat, summaries, quiz/flashcard generation
- `emne` / `emner` → course / courses (Canvas)
- `tester` → tests

## Prerequisites

- **Node.js 22 LTS or newer** (CI runs on Node 24). `pnpm` is the required package manager — do not use npm/yarn.
- Copy env examples before first run: `cp backend/.env.example backend/.env` and `cp frontend/.env.example frontend/.env`, then fill required values in both.

## Local Dev URLs

| Service     | URL                              |
| ----------- | -------------------------------- |
| Frontend    | <http://localhost:3000>          |
| Backend API | <http://localhost:4000>          |
| API docs    | <http://localhost:4000/api-docs> |
| VitePress   | <http://localhost:5173>          |

## Monorepo Structure

pnpm workspaces with five packages:

- **common/** — Shared Zod schemas and TypeScript types (no runtime deps except Zod). Subpath exports in package.json (e.g., `common/canvas`, `common/ki`). Must be built before other packages.
- **backend/** — Express 5 API server (TypeScript, ES modules). MongoDB (Mongoose), Redis cache, Pinecone vectors, BullMQ jobs, Clerk auth, Claude AI via Vercel AI SDK.
- **frontend/** — Next.js 16 with App Router and Turbopack. React 19, Tailwind CSS, Zustand, React Query, Clerk auth. All `/api/*` requests proxy to backend via next.config.js rewrites.
- **docs/** — VitePress documentation site, deployed to GitHub Pages.
- **tests/** — Integration/E2E tests (Playwright + custom test runner via `tsx run.ts`).

## Commands

All commands run from the repo root via pnpm:

```bash
# Development
pnpm dev                    # Starts all services. Backend starts first; frontend and docs wait on http://localhost:4000/health before launching.
pnpm dev:backend            # Backend only (tsx watch, port 4000)
pnpm dev:frontend           # Frontend only (Next.js turbopack, port 3000)
pnpm dev:docs               # Docs only (VitePress, port 5173)
pnpm kill:dev               # Kill dev servers

# Build / Production
pnpm build                  # Build all (common -> backend -> frontend -> docs)
pnpm build:common           # Must run first if common types changed
pnpm start                  # Run backend + frontend in parallel (production mode)

# Quality checks
pnpm typecheck              # Typecheck all packages (builds common first)
pnpm lint                   # ESLint across all packages
pnpm lint:md                # Markdown linting via remark
pnpm format                 # Prettier write across repo
pnpm format:check           # Prettier check (no write)

# Tests
pnpm test:unit              # Vitest unit tests (common + backend + frontend)
pnpm test:unit:common       # Common unit tests only
pnpm test:unit:backend      # Backend unit tests only
pnpm test:unit:frontend     # Frontend unit tests only
pnpm test                   # Integration test runner (tsx run.ts)
pnpm test:auth              # Auth integration tests
pnpm test:auth:db           # Auth DB connectivity/state check
pnpm test:auth:smoke        # Fast auth smoke subset
pnpm test:auth:e2e          # Playwright E2E auth tests
pnpm test:auth:matrix       # Auth identity matrix (120 scenarios); :basic/:oauth/:update/:delete/:session/:race for subsets
pnpm test:ki                # AI/KI integration tests
pnpm test:ki:smoke          # Fast KI smoke subset
pnpm test:canvas            # Canvas integration tests
pnpm test:canvas:smoke      # Fast Canvas smoke subset

# Maintenance
pnpm knip                   # Dead code detection
pnpm knip:fix               # Auto-remove detected dead code (may delete files)
pnpm syncpack:list          # Check dependency version consistency
pnpm syncpack:fix            # Fix version mismatches and reformat package.json files
pnpm clean:all              # Remove node_modules and build artifacts
pnpm clean:install          # Full clean reinstall + rebuild
pnpm lint:soft-delete       # Lint soft-delete patterns
pnpm db:reset-encrypted     # Reset encrypted DB fields (key rotation helper)
```

Per-package scripts (run with `pnpm --filter <pkg> <script>`): `dev`, `build`, `lint`, `typecheck`, `test`, `test:watch`.

Run a single unit test file: `pnpm --filter backend vitest src/path/to/file.test.ts` (same pattern for frontend/common).

## Architecture

### Data Flow

Canvas LMS -> Backend (fetch/validate/transform) -> Frontend (fetch/display). Redis caches Canvas API responses (2hr TTL for sync structures). Pinecone stores content embeddings; chunk text lives in MongoDB (`ContentEmbedding`) as source of truth.

### Authentication

Clerk handles user auth. Backend verifies Bearer tokens via Clerk SDK. Local `User` model syncs from Clerk and stores encrypted Canvas API tokens. `CanvasUser` caches Canvas profile info linked back to `User`. Cloudflare Turnstile guards sensitive auth flows (frontend widget + backend verification).

### Observability

PostHog for product analytics (frontend). Datadog APM and LangSmith tracing are opt-in on the backend via `DD_*` and `LANGCHAIN_*` env vars. Pino is the structured logger across the backend.

### AI Chat Pipeline

Frontend -> `/api/ki/chat` -> load Canvas context (if needed) -> load knowledge base context (if enabled) -> Claude API (SSE stream) -> store in `ChatHistory` -> stream to frontend.

### Search

Hybrid retrieval: BM25 keyword search + Pinecone semantic search, results merged and reranked via Cohere.

### Middleware Stack (applied in order)

Host/origin validation (prod) → Helmet security headers → body parsers → Clerk webhook (raw body, before CSRF) → request timeout → CORS → CSRF protection → rate limiting → auth check (`requireAuth`). Order matters — Clerk webhook needs raw body before JSON parsing, CSRF runs after CORS.

### Backend Organization

- `backend/src/rutere/` — Express routers organized by feature
- `backend/src/services/` — Business logic
- `backend/src/queues/` — BullMQ queues with shared Redis connection
- `backend/src/database/models/` — Mongoose models
- `backend/src/middleware/` — Express middleware stack
- `backend/src/utils/` — Shared utilities including `apiError` helpers and `validateEnv` startup checks
- OpenAPI spec exposed via Swagger UI at `/api-docs` in development only

### Frontend Organization

- `frontend/app/` — Next.js App Router pages and layouts
- `frontend/app/components/` — Reusable React components (ui/, ki/, canvas/)
- `frontend/app/lib/` — Client utilities and error classes

### Health Endpoints

- `/health` — liveness (fast, no external calls)
- `/ready` — readiness (requires MongoDB connected)
- `/health/dependencies` — detailed dependency status (admin-only)

### Cloudflare Worker

`cloudflare/worker.js` — Resend email relay for the contact form, invoked by the backend via secret-header auth.

## Conventions

- **Types-first**: Define Zod schemas in `common/`, add subpath export in `common/package.json`, then use in backend and frontend.
- **Logging**: Use pino logger (`logger.info`, `logger.error`), never `console.log` in backend.
- **Frontend data fetching**: Use relative URLs (`/api/...`), Next.js rewrites proxy to backend. No need to modify `next.config.js` for new endpoints.
- **Styling**: Mobile-first Tailwind, always include `dark:` variants.
- **Error handling**: Backend uses `apiError.*` utilities. Frontend uses typed error classes from `frontend/app/lib/errors.ts`.
- **Database**: Mongoose models only, no native MongoDB driver.
- **Module system**: ES modules throughout (`type: "module"`).
- **Strict TypeScript**: All packages use strict mode.

## Pre-commit Checklist

```bash
pnpm test:unit && pnpm typecheck && pnpm lint && pnpm lint:md && pnpm build
```

The Husky pre-commit hook is **currently disabled** — see the comment in `.husky/pre-commit`. It will be reactivated after `main` has been bulk-formatted to avoid noisy diffs. Until then, run `pnpm format` and the checklist above manually before commit. CI enforces the same checks on pull requests. The `lint-staged` config in `package.json` is kept ready for reactivation.

## Deployment

- **Backend** deploys to Heroku (`heroku-postbuild` builds `common` then `backend`; `Procfile` runs the built backend with Node flags tuned for dyno memory).
- **Frontend** deploys to Vercel.
- **Docs** deploy to GitHub Pages via GitHub Actions.

## Docker

```bash
cp docker.env.example .env  # Fill required values
docker compose up --build   # Starts MongoDB, Redis, backend, frontend
```

Requires `backend/.env` with: ANTHROPIC_API_KEY, COHERE_API_KEY, CLERK_SECRET_KEY, ENCRYPTION_KEY, MONGO_URI, REDIS_URL, PINECONE_API_KEY, PINECONE_INDEX_NAME.

Optional env vars: `ENCRYPTION_KEY_PREV` (key rotation), `CONTACT_WORKER_URL` + `CONTACT_WORKER_SECRET` (email relay), `DD_*` (Datadog APM), `LANGCHAIN_*` (LangSmith tracing).
