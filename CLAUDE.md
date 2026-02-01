# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

**IMPORTANT FOR AI AGENTS:** Read this document CAREFULLY before making changes. This is the "law" for the project.

## Project Overview

StudyWise - AI-powered study assistant with Canvas LMS integration. pnpm monorepo with `frontend`, `backend`, and `common` packages.

---

## 1. Complete Project Structure

```text
StudyWise/
├── common/                  # Shared Zod schemas (workspace package)
│   ├── src/
│   │   ├── auth.ts              # Auth schemas
│   │   ├── canvas.ts            # Canvas API schemas
│   │   ├── ki.ts                # AI API schemas
│   │   ├── calendar.ts          # Calendar/deadline schemas
│   │   ├── chat.ts              # Chat history schemas
│   │   └── index.ts             # Exports all schemas
│   ├── dist/                    # Compiled files (.js + .d.ts)
│   ├── package.json             # Includes build script
│   └── tsconfig.json            # Extends ../tsconfig.base.json
├── frontend/                # Next.js frontend
│   ├── app/                # App Router
│   │   ├── hjem/           # Home / Landing page
│   │   │   └── page.tsx
│   │   ├── canvas/         # Canvas
│   │   │   └── canvas-api.ts    # API logic only (hooks)
│   │   ├── dashboard/      # Dashboard (SPA Hub)
│   │   │   └── page.tsx         # Main page controlling views
│   │   ├── auth/           # Authentication
│   │   │   ├── auth-api.ts      # Auth API hooks
│   │   │   ├── auth-server.ts   # Server-side auth helpers
│   │   │   └── page.tsx         # Login page
│   │   ├── ki/                  # AI pages
│   │   │   └── ki-api.ts        # API logic only (hooks)
│   │   ├── hooks/               # Custom React hooks
│   │   │   ├── useChatHistory.ts    # Chat history hook
│   │   │   └── use-auth-sync.ts     # Cross-tab auth sync
│   │   ├── layout.tsx      # Root layout (Providers + Global CSS)
│   │   ├── page.tsx        # Root page (redirects to /hjem)
│   │   ├── providers.tsx   # React Query provider
│   │   ├── globals.css     # Global styling (Tailwind v4)
│   │   └── components/     # Reusable components
│   │       ├── canvasSection.tsx    # Shows Canvas content in dashboard
│   │       ├── kiSection.tsx        # Shows AI chat in dashboard
│   │       ├── header.tsx           # Global header
│   │       └── footer.tsx           # Global footer
│   ├── calendar/           # Calendar feature (outside app/)
│   │   ├── calendar-api.ts      # Calendar data hooks
│   │   ├── CalendarSection.tsx  # Main calendar component
│   │   ├── CalendarGrid.tsx     # Calendar grid view
│   │   ├── CalendarHeader.tsx   # Calendar navigation
│   │   ├── DateDetailsModal.tsx # Date details popup
│   │   ├── UpcomingDeadlines.tsx # Deadline list
│   │   └── CourseLegend.tsx     # Course color legend
│   ├── package.json
│   ├── postcss.config.mjs  # Tailwind v4 config
│   └── tsconfig.json
├── backend/                # Express backend
│   ├── src/
│   │   ├── database/       # Database connection and models
│   │   │   ├── database.ts      # Connects to MongoDB
│   │   │   └── models/          # Mongoose models
│   │   │       ├── User.ts          # Local user (auth, encrypted Canvas token)
│   │   │       ├── CanvasUser.ts    # Cached Canvas profile data
│   │   │       └── ChatHistory.ts   # Encrypted chat history
│   │   ├── rutere/         # API routes
│   │   │   ├── canvas/
│   │   │   │   └── canvas.ts    # Canvas LMS API endpoints
│   │   │   ├── auth/
│   │   │   │   └── auth.ts      # Authentication endpoints
│   │   │   └── ki/
│   │   │       └── ki.ts        # AI endpoints
│   │   ├── swagger.ts      # Swagger/OpenAPI configuration
│   │   └── index.ts        # Server entry point + /health endpoint
│   ├── package.json
│   └── tsconfig.json       # Extends ../tsconfig.base.json
├── tsconfig.base.json      # Shared TypeScript configuration
├── package.json            # Workspace root (monorepo scripts)
├── pnpm-workspace.yaml     # pnpm workspace config
└── docker-compose.yml      # Docker Compose config
```

---

## 2. Technology Stack

### Frontend

- **Core**: Next.js 16.1.4, React 19.2.3, TypeScript 5.9
- **Styling**: Tailwind CSS v4.1 (with `@tailwindcss/postcss`)
- **State/Data**: `@tanstack/react-query` v5 for server-state, `zustand` for client-state
- **Forms**: `react-hook-form` + `@hookform/resolvers` + `zod`
- **Routing**: Next.js App Router (Server Components default)

### Backend

- **Core**: Express 5.2.1, Node.js 20+
- **Language**: TypeScript (runs with `tsx` in dev, `node` in prod)
- **Database**: MongoDB via `mongoose` v9.1
- **Validation**: `zod` (reuses schemas from `common`)
- **API Docs**: `swagger-ui-express` + `swagger-jsdoc`
- **Logging**: `pino` + `pino-http`. ALWAYS use `logger.info/error`, NEVER `console.log`
- **Cache**: `redis` client interfacing with Redis Cloud
- **AI**: `@huggingface/inference` for HuggingFace model integration

### Common

- Only `zod` definitions and TypeScript interfaces/types. No business logic.

---

## 3. Commands

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

## 4. Architecture

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

Frontend never calls external APIs directly. All `/api/*` requests proxy through Next.js to backend (configured in `next.config.js`). Backend validates requests, calls external APIs (Canvas, HuggingFace), and returns validated data.

### Dashboard (SPA Container)

Location: `frontend/app/dashboard/page.tsx`

This is the heart of the application and functions as a **central hub** for the student.

- **Purpose**: Combines learning platform (Canvas) and support tools (AI) in one interface
- **How it works**: Built as an **SPA (Single Page Application) container**. It doesn't reload the page when switching tabs, but uses React state (`activeView`) to switch components (`CanvasSection`, `KISection`) immediately.

### Database Models

- **User** (`backend/src/database/models/User.ts`): Local auth (email, password, canvasApiToken encrypted). This is where we store the Canvas API Token.
- **CanvasUser** (`backend/src/database/models/CanvasUser.ts`): Cache of public profile info from Canvas (name, avatar, settings). Links back to User via `localUser` field.
- **ChatHistory** (`backend/src/database/models/ChatHistory.ts`): Encrypted chat history per user. Messages are encrypted with AES-256-GCM before storage.

---

## 5. Coding Rules

### Folder Structure Rules

**Frontend:**

- Page components (`page.tsx`) should be thin. Move logic to `app/components/`
- New components go in `frontend/app/components/`
- API calls abstracted in hooks (e.g., `canvas-api.ts`)
- SPA container remains in `frontend/app/dashboard/page.tsx`

**Backend:**

- Each "resource" (Canvas, Auth, KI) gets its own folder under `src/rutere/`
- No logic in `src/index.ts` - setup only

### Styling Rules (Tailwind)

- NEVER use custom `.css` files (except `globals.css`)
- **Dark Mode**: All colors MUST have a `dark:` variant
  - Example: `bg-white dark:bg-gray-900 text-black dark:text-white`
- **Mobile First**: Always design for mobile first, then add breakpoints (`sm:`, `md:`, `lg:`)
  - Correct: `w-full md:w-1/2` (Starts full width, becomes half on desktop)
  - Wrong: `w-1/2 max-md:w-full` (Starts desktop, fixes for mobile)
- **Responsiveness**: Always test that design works on mobile, tablet, and desktop

### Database Rules

- Define schemas in `backend/src/database/models/`
- Use Zod in `common` to validate data *before* it hits the database
- **Use Mongoose Models**: Always use Mongoose models as intended (`.find()`, `.create()`, etc.). Avoid native MongoDB driver calls unless strictly necessary.

### General Rules

- **pnpm only** - Never npm
- **Pino logger** - Never console.log in backend
- **Zod validation** - At all package boundaries
- **Relative URLs** - Frontend uses `/api/...`, Next.js rewrites to backend
- **No emojis** - Unless user explicitly requests
- **Config protection** - Don't modify tsconfig/eslint/next.config without asking first
- **Norwegian naming** - Routes, components, variables in Norwegian; filenames in English

---

## 6. Git & Workflow

1. **Stay updated**: Run `git pull origin main` often to avoid conflicts
2. **Quality check**: Run `pnpm typecheck`, `pnpm lint`, and `pnpm build` regularly to catch errors early
3. NEVER use `npm`. This is a `pnpm` project.

```bash
# First time setup
pnpm install
pnpm build  # Builds common package first!
```

---

## 7. Security and Privacy (Zero Tolerance)

### No Hardcoding of Secrets

It is **strictly forbidden** to hardcode sensitive data.

- **API Keys**: Must always be loaded from `.env` files
- **Tokens**: Must never be checked into git
- **URLs**: Use environment variables

### Privacy (GDPR)

We handle student data.

- **Logging**: Never log personally identifiable information (PII) like names/emails in production
- **Data Flow**: Send only necessary data to frontend
- **AI**: **Never** send PII to external AI services (OpenAI/HuggingFace) without anonymization

---

## 8. Troubleshooting

- **"Can't resolve 'common'"** → `pnpm build:common` or just `pnpm build`
- **Port in use** → `pnpm kill:dev`
- **Type errors after clean** → `pnpm build`
- **"MongoNetworkError"** → Check that MongoDB is running (if local) or that `MONGO_URI` in `backend/.env` is correct. Check that your IP is whitelisted in MongoDB Atlas if using cloud database.

---

Keep this file updated if the project structure changes significantly.
