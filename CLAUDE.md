# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

**IMPORTANT FOR AI AGENTS:** Read this document CAREFULLY before making changes. This is the "law" for the project.

## Project Overview

StudyWise - AI-powered study assistant with Canvas LMS integration. pnpm monorepo with `frontend`, `backend`, and `common` packages.

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

- Zod schemas and TypeScript interfaces shared between frontend and backend
- Error types and codes (`canvasErrors.ts`)
- Constants (cookie names, message limits)

---

## 2. Commands

```bash
pnpm dev                    # Start frontend (3000) + backend (4000)
pnpm typecheck              # Type-check all packages
pnpm lint                   # Lint all packages
pnpm build                  # Build all (common → backend → frontend)

pnpm --filter frontend add <pkg>   # Add package to frontend
pnpm --filter backend add <pkg>    # Add package to backend

pnpm kill:dev               # Kill all Node processes (Windows)
pnpm clean:install          # Full reinstall
```

**Build order**: `common` must be built before frontend/backend. `pnpm build` handles this automatically.

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

### Key Configuration Files

- **AI models**: `backend/src/rutere/ki/aiModels.ts`
- **System prompt**: `backend/src/rutere/ki/systemPrompt.ts`
- **Canvas pagination**: `PAGE_SIZE`, `MAX_PAGES` in `canvasUtils.ts`
- **Cache TTL**: `CACHE_TTL` in `canvasUtils.ts`
- **JWT expiry**: Configurable via `JWT_ACCESS_EXPIRES`, `JWT_REFRESH_EXPIRES` env vars
- **Cookie names**: `common/src/auth.ts`
- **Message limits**: `common/src/ki.ts`

---

## 4. Coding Rules

### General Rules

- **pnpm only** - Never npm
- **Pino logger** - Never console.log in backend
- **Zod validation** - At all package boundaries
- **Relative URLs** - Frontend uses `/api/...`, Next.js rewrites to backend
- **No emojis** - Unless user explicitly requests
- **Config protection** - Don't modify tsconfig/eslint/next.config without asking
- **Norwegian naming** - Routes, components, variables in Norwegian; filenames in English

### Styling Rules (Tailwind)

- NEVER use custom `.css` files (except `globals.css`)
- **Dark Mode**: All colors MUST have a `dark:` variant
- **Mobile First**: Always design for mobile first, then add breakpoints (`sm:`, `md:`, `lg:`)
  - Correct: `w-full md:w-1/2`
  - Wrong: `w-1/2 max-md:w-full`

### Error Handling

**Backend** - Use `backend/src/utils/apiError.ts`:
```typescript
import { apiError, sendZodError, sendUnknownError } from "../../utils/apiError.js";

apiError.unauthorized(res, "Message");
apiError.badRequest(res, "Message", details);
apiError.notFound(res, "Resource");
sendZodError(res, zodError, "Context");
sendUnknownError(res, error, { kontekst: "function" });
```

**Frontend** - Use `frontend/app/lib/errors.ts`:
```typescript
import { KIAuthError, CanvasTokenMissingError, AppError } from "../lib/errors";

if (AppError.isAppError(error) && error.requiresReauth()) {
  // Handle reauth
}
```

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
