# CLAUDE.md

> **For human readers (e.g. evaluators of the bachelor thesis):** this file is primarily an instruction document for AI coding assistants (Claude Code, Cursor, Copilot, etc.) working in this repository, but it doubles as a compact technical reference. It documents the architectural ground rules, security guardrails, and project conventions in one place. The English language is intentional — it ensures any AI assistant interprets the rules consistently regardless of the developer's editor language settings. The application code itself, including variable names and comments, is in Norwegian (see the glossary in the _Project Overview_ section).
>
> For a higher-level orientation in the project, see [`README.md`](./README.md), [`filer_prosjekt/00-LESEGUIDE.md`](./filer_prosjekt/00-LESEGUIDE.md) and the diagrams in [`filer_prosjekt/diagrammer/`](./filer_prosjekt/diagrammer/).

This file provides guidance to Claude Code (claude.ai/code) and other AI coding assistants when working with code in this repository. Read the **Guardrails** section below before making any changes.

## Guardrails for AI assistants (READ FIRST)

These guardrails exist because StudyWise handles personal data, Canvas tokens, chat history and KI-pipeline secrets. The codebase is published as a bachelor thesis (USN, 2026) and is intentionally constructed so that an unsafe change is hard to merge by accident. AI assistants must respect that — uncertainty is resolved by **asking the human developer driving the session**, not by guessing or bypassing checks.

### Hard prohibitions — never do these without explicit human approval

1. **Never disable, weaken or bypass security middleware.** Helmet (CSP with nonce), CSRF protection, rate limiting, `requireAuth`, `requireRecentAuth` (step-up), Cloudflare Turnstile verification, `requireCloudflare`, and host/origin validation are load-bearing. Removing or relaxing any of them is a security regression. The middleware order in `backend/src/index.ts` is also sensitive — Clerk webhook needs raw body before JSON parsing, Cloudflare-only enforcement runs early in production, CSRF runs after CORS, and route-specific rate limits must stay on the endpoints that need them. Do not reorder.
2. **Never change cryptographic parameters.** Encryption is AES-256-GCM via `backend/src/utils/kryptering.ts`. The active key is `ENCRYPTION_KEY`; rotation uses `ENCRYPTION_KEY_PREV`. Do not change algorithm, key length, IV length or authentication tag handling. Do not invent your own crypto. Do not store keys in code, in tests, or in commits.
3. **Never introduce secrets in code or git.** All secrets go through `process.env`, validated by `backend/src/utils/validateEnv.ts` and `frontend/app/lib/validateEnv.ts` at startup. Never commit `.env`, `.env.local`, tokens, signed URLs or example values that look real. TruffleHog runs in CI to catch this; do not work around it.
4. **Never log tokens, Canvas API responses, chat content or PII.** Logging uses Pino (`logger.info`, `logger.warn`, `logger.error`) with structured fields. Never `console.log` in backend. When logging, never include the Bearer token, encrypted blobs, full chat messages, e-mail, phone number, fødselsnummer, studentnummer or addresses. The best-effort PII-masking regex in `backend/src/services/document.ts` (the `maskPII` step inside document text extraction) is the boundary before content is chunked and indexed in Pinecone; weakening it leaks PII to a third party. Prompt-injection sanitization for KB context lives in `backend/src/services/kunnskapsbase-indeksering.service.ts` (`sanitizeKBBodyText`, `sanitizeForPromptTag`) — also do not weaken.
5. **Never bypass the soft-delete and queue pattern for user deletion.** User deletion goes through `kontoSlett.ts` → `clerkDeletion.queue.ts` (Clerk) and `pineconeCleanup.queue.ts` (vectors), with `DeletedUserTombstone` tracking the lifecycle. Do not write code that directly removes a `User` record without going through this flow — that creates orphaned data in Clerk, Pinecone and Mongo.
6. **Never modify migration history.** Migrations in `backend/src/database/migrations.ts` are append-only and idempotent (each runs once based on `id`). Never edit a migration that has already been deployed; add a new one instead. Do not change the `id` of an existing migration.
7. **Never disable, skip or comment out failing tests** to make CI pass. Fix the underlying issue. Do not use `it.skip`, `test.skip`, `it.todo`, `xit` or `xdescribe` to silence a real failure. If a test is genuinely obsolete, remove it with a commit message that explains why.
8. **Never bypass type and runtime validation.** TypeScript runs in strict mode in all packages. Avoid `any`. Do not use `as` casts to launder types past the compiler. Every shared type lives in `common/` as a Zod schema and is exported as both schema (runtime validation) and type (`z.infer<typeof ...>`). External input — HTTP body, Canvas API response, Anthropic response, file uploads — must pass a Zod parse before it is trusted.
9. **Never bypass git safety.** No `git push --force` to `main`, no `git commit --no-verify`, no `git commit --no-gpg-sign`, no `git rebase -i` on shared branches. The pre-commit hook is active (runs `lint-staged`), and the same checks run in CI on PRs — do not work around either.
10. **Never weaken GitHub Actions trust boundaries.** Do not introduce `pull_request_target`. Do not add shared package-manager caches (`actions/cache`, `cache: pnpm`, restore keys, etc.), global `npm install -g`, or `curl | sh` installers to deploy, publish, release or otherwise privileged workflows with secrets or write permissions. `pnpm lint:actions-security` enforces this.
11. **Never weaken pnpm supply-chain guardrails.** Keep `minimumReleaseAge: 7200` in `pnpm-workspace.yaml` unless a human explicitly approves a security exception. Prefer narrow `minimumReleaseAgeExclude` entries for urgent, reviewed fixes over lowering the global delay.
12. **Never run destructive operations** without explicit human confirmation: `pnpm db:reset-encrypted`, `pnpm data:nuke --confirm` (wipes all Mongo/Redis/Pinecone/Clerk data for the configured env), dropping a Mongo collection, deleting Pinecone records, `git reset --hard`, `git clean -f`. These are not reversible.

### Required practices — always do these

1. **Types-first.** Define new shared schemas in `common/src/<feature>.ts` as Zod, add subpath export in `common/package.json`, then import in backend and frontend. The same schema validates input on both sides — do not duplicate the type by hand.
2. **Use `apiError.*` helpers in backend** for HTTP error responses (`apiError.badRequest`, `apiError.unauthorized`, etc.). Use the typed error classes in `frontend/app/lib/errors.ts` on frontend. Do not invent ad-hoc error shapes.
3. **Mongoose models only — no native MongoDB driver.** All DB access goes through the models in `backend/src/database/models/`. This preserves middleware, hooks, soft-delete and audit-logging behavior.
4. **Use the existing rate-limit middleware** for new endpoints that touch external APIs, KI, auth, or are state-changing. Do not write your own throttling.
5. **Audit-log sensitive admin actions** via `AuditLog` (account changes, role changes, exports, deletions). Audit-log entries are pseudonymized when a user is deleted — preserve this behavior.
6. **Preserve the `<svarkilde>`-tag mechanism** in KI responses. The system prompt requires the model to label answers as `kursmateriale|canvas|kunnskapsbase|blandet|generell`. Frontend shows this as a visible badge so users do not confuse a free general answer with one anchored in their pensum. Do not remove the tag, change its values, or bypass `extractAnswerAndSource` in `aiClient.ts`.
7. **Frontend `dark:` variants are mandatory** in Tailwind. Mobile-first. Add `dark:`-equivalents for every visible color/background you set.
8. **Frontend data fetching uses relative `/api/...` URLs.** Next.js rewrites in `next.config.js` proxy these to the backend. In production, `INTERNAL_API_URL` must point to `https://api.studwize.page` so Vercel requests still pass through Cloudflare before Heroku. Do not call backend directly via `http://localhost:4000` from frontend code, and do not use a Heroku hostname as the production API target.
9. **ES modules everywhere.** All packages have `"type": "module"`. Use `.js` import suffixes in compiled TypeScript. Do not introduce CommonJS.
10. **Run the pre-commit checklist locally** before any commit: `pnpm format && pnpm test:unit && pnpm typecheck && pnpm lint && pnpm lint:md && pnpm build`.

### When in doubt

If a task seems to require breaking one of these rules, **stop and ask the human developer** before proceeding. Phrasings like "I'll just disable this temporarily" or "we can fix the test later" are red flags — they tend to ship to production. Better to surface the conflict explicitly than to merge a workaround.

These guardrails are an explicit part of the bachelor thesis's contribution on safe AI-assisted coding. They are not aspirational — they are enforced through code review and CI checks. The pre-commit hook is active again: the one-time bulk formatting has been applied across the codebase with `pnpm format`, so the hook now runs `lint-staged` locally before each commit in addition to the CI checks on PRs.

## Project Overview

StudyWise is an AI-powered study assistant for higher education with Canvas LMS integration. Built as a Bachelor's thesis project at the University of South-Eastern Norway (USN), 2026. Public demo / production-like deploy: <https://www.studwize.page>. The codebase uses Norwegian for variable names, comments, and error messages — a deliberate choice that aligns the code with the user-facing language and the report.

### Norwegian glossary (common directory/concept names)

- `rutere` → routers (Express route modules)
- `kunnskapsbase` → knowledge base (user-uploaded docs/links, RAG-indexed)
- `arbeidsplan` → study plan / weekly schedule
- `ki` → AI (kunstig intelligens) — Claude chat, summaries, quiz/flashcard generation
- `emne` / `emner` → course / courses (Canvas)
- `tester` → tests

## Prerequisites

- **Node.js 24 LTS** (CI, Cloudflare and deploy workflows are aligned on Node 24). Use the checked-in `.node-version`/`.nvmrc`, enable Corepack, and use `pnpm` only — do not use npm/yarn.
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
pnpm dev:frontend           # Frontend only (Next.js Webpack, port 3000) — default. Stabil minnebruk over lange økter.
pnpm dev:frontend:turbo     # Frontend med Turbopack (--turbopack). Raskere HMR, men har en kjent memory-leak i Next.js 16 som krasjer dev-serveren etter 6–15 min med tung fil-redigering. Bruk kun for korte økter.
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
pnpm data:nuke              # Wipe ALL app data for the env in backend/.env (Mongo + Redis + Pinecone + Clerk). Dry-run by default; real delete needs --confirm --phrase SLETT_ALT_STUDYWISE_DATA. Set NODE_DNS_SERVERS=8.8.8.8,8.8.4.4 in backend/.env if mongodb+srv:// fails with "querySrv ECONNREFUSED".
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

The system prompt requires the model to emit a `<svarkilde>kursmateriale|canvas|kunnskapsbase|blandet|generell</svarkilde>` tag after every answer. Backend parses this in `extractAnswerAndSource` (in `aiClient.ts`) and frontend renders it as a visible source-badge over assistant messages so users do not confuse a free general answer with one anchored in their own course material.

### Search

Hybrid retrieval: BM25 keyword search + Pinecone semantic search, results merged and reranked via Cohere.

### Middleware Stack (applied in order)

Host/origin validation (prod) → Cloudflare-only enforcement (prod, when enabled) → Helmet security headers → body parsers → Clerk webhook (raw body, before CSRF) → request timeout → CORS → CSRF protection → public routers → auth check (`requireAuth`) → terms check → feature/admin routers with route-specific rate limits and role checks. Order matters — Clerk webhook needs raw body before JSON parsing, Cloudflare-only enforcement must run before protected routes, and CSRF runs after CORS.

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
- **Frontend data fetching**: Use relative URLs (`/api/...`), Next.js rewrites proxy to backend via the configured `INTERNAL_API_URL` (`https://api.studwize.page` in production). No need to modify `next.config.js` for new endpoints.
- **Styling**: Mobile-first Tailwind, always include `dark:` variants.
- **Error handling**: Backend uses `apiError.*` utilities. Frontend uses typed error classes from `frontend/app/lib/errors.ts`.
- **Database**: Mongoose models only, no native MongoDB driver.
- **Module system**: ES modules throughout (`type: "module"`).
- **Strict TypeScript**: All packages use strict mode.

## Pre-commit Checklist

```bash
pnpm test:unit && pnpm typecheck && pnpm lint && pnpm lint:md && pnpm build
```

The Husky pre-commit hook is active — see `.husky/pre-commit`, which runs `lint-staged` (Prettier `--write` on staged files). It was reactivated after the codebase was formatted in one batch with `pnpm format`, so commits now get Prettier applied automatically to staged files, keeping diffs small. The same checks are also enforced by CI on pull requests, and developers still run the checklist above before each commit. The `lint-staged` config lives in `package.json`.

## Deployment

- **Backend** deploys to Heroku (`heroku-postbuild` builds `common` then `backend`; `Procfile` runs the built backend with Node flags tuned for dyno memory). Production origin traffic is expected to arrive through `api.studwize.page` via Cloudflare, not directly through a Heroku hostname.
- **Frontend** deploys to Vercel. Production rewrites use `INTERNAL_API_URL=https://api.studwize.page`.
- **Docs** deploy to GitHub Pages via GitHub Actions.

## Docker

```bash
cp docker.env.example .env  # Fill required values
docker compose up --build   # Starts MongoDB, Redis, backend, frontend
```

Requires `backend/.env` with: ANTHROPIC_API_KEY, COHERE_API_KEY, CLERK_SECRET_KEY, ENCRYPTION_KEY, MONGO_URI, REDIS_URL, PINECONE_API_KEY, PINECONE_INDEX_NAME.

Optional env vars: `ENCRYPTION_KEY_PREV` (key rotation), `CONTACT_WORKER_URL` + `CONTACT_WORKER_SECRET` (email relay), `DD_*` (Datadog APM), `LANGCHAIN_*` (LangSmith tracing).
