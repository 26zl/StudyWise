# Utviklingsveiledning - Bachelor i IT 2026

Guide for utvikling i StudyWise prosjektet.

## Innholdsfortegnelse

1. [Hvordan systemet fungerer](#hvordan-systemet-fungerer)
2. [Legge til ny funksjonalitet](#legge-til-ny-funksjonalitet)
3. [Common - Delte typer](#common---delte-typer)
4. [Backend - API server](#backend---api-server)
5. [Frontend - Brukergrensesnitt](#frontend---brukergrensesnitt)
6. [Feilhåndtering](#feilhåndtering)
7. [Arbeidsflyt](#arbeidsflyt)

---

## Hvordan systemet fungerer

### Dataflyt

```text
1. Canvas LMS (institusjonens læringsplattform, f.eks. universiteter og høgskoler)
   ↓
2. Backend henter data fra Canvas API
   ↓
3. Backend validerer og transformerer data
   ↓
4. Frontend henter data fra backend
   ↓
5. Frontend validerer og viser data til bruker
```

**Cache og vektorsøk:** Redis cacher Canvas API-svar og sync-struktur (per bruker/emne; sync TTL 2 timer i `canvas-sync.service.ts`). Pinecone brukes til vektorsøk på kursinnhold (integrated embedding); chunk-tekst lagres i MongoDB (`ContentEmbedding`) som sannhetskilde.

### Autentisering og Brukerdata

Det er kritisk å forstå skillet mellom "Lokal Bruker" og "Canvas Bruker".

### Lokal Bruker (User)

- Speiler identiteten fra Clerk (`clerkId`, epost, navn, rolle)
- Her lagres appspesifikke data som Canvas API-token (kryptert) og preferanser
- Denne modellen representerer StudyWise-brukeren etter at Clerk-sesjonen er verifisert

### Canvas Bruker (CanvasUser)

- Cache av offentlig profilinfo fra Canvas (navn, bilde, innstillinger)
- Har felt `localUser` som peker tilbake på `User`

### Flyten

1. Bruker logger inn (Clerk; `User` synkroniseres til MongoDB)
2. Backend bruker `User.canvasApiToken` for å snakke med Canvas API
3. Resultatet fra `/whoami` lagres/oppdateres i `CanvasUser`
4. `CanvasUser.localUser` settes til `User._id` for å binde dem sammen

---

## Legge til ny funksjonalitet

### Steg 1: Definer datatyper i Common

```typescript
// common/src/minFunksjon.ts
import { z } from "zod";

export const MinDataSchema = z.object({
  id: z.string(),
  tittel: z.string(),
});

export type MinData = z.infer<typeof MinDataSchema>;
```

Legg til en subpath-eksport i `common/package.json` under `"exports"` (f.eks. `"./minFunksjon"`) som peker på den kompilerte filen i `dist/`.

### Steg 2: Lag backend endpoint

```typescript
// backend/src/rutere/minFunksjon/minFunksjon.ts
import { Router } from "express";
import { MinDataSchema } from "common/minFunksjon";

const router = Router();

router.get("/", async (req, res) => {
  try {
    const data = await hentData();
    res.json(MinDataSchema.parse(data));
  } catch (error) {
    // Bruk standardisert feilhåndtering
    sendUnknownError(res, error, { kontekst: "minFunksjon" });
  }
});

export default router;
```

Registrer i `backend/src/index.ts`.

### Steg 3: Lag frontend hook

```typescript
// frontend/app/minFunksjon/minFunksjon-api.ts
import { useQuery } from "@tanstack/react-query";
import { MinDataSchema } from "common/minFunksjon";

export function useMinData() {
  return useQuery({
    queryKey: ["minData"],
    queryFn: async () => {
      const res = await fetch("/api/minFunksjon");
      if (!res.ok) throw new Error("Feil ved henting");
      return MinDataSchema.parse(await res.json());
    },
  });
}
```

### Steg 4: Bruk i komponent

```typescript
export function MinKomponent() {
  const { data, isLoading, error } = useMinData();

  if (isLoading) return <div>Laster...</div>;
  if (error) return <div>Feil: {error.message}</div>;

  return <div>{data?.tittel}</div>;
}
```

---

## Common - Delte typer

### Hva er Common?

Common inneholder data-definisjoner og valideringsregler som deles mellom backend og frontend.

### Når bruker du Common?

**JA:**

- Data som sendes mellom backend og frontend
- Data fra eksterne APIer (Canvas, Anthropic/Claude)
- Delte feiltyper og error codes

**NEI:**

- React komponenter
- Express middleware
- CSS styling
- Kode som kun brukes i én pakke

### Viktige filer i Common

- `auth.ts` - Auth schemas og cookie-konstanter
- `canvas.ts` - Canvas API schemas
- `canvasErrors.ts` - Strukturerte Canvas-feilkoder
- `canvasInstitutions.ts` - Liste over støttede Canvas-institusjoner (USN m.fl.)
- `ki.ts` - KI API schemas og meldingslengde-grenser
- `chat.ts` - Chat-melding schemas og samtalehistorikk
- `document.ts` - Dokumentanalyse schemas
- `calendar.ts` - Kalender schemas
- `calendar-ui.ts` - Kalender UI schemas
- `dateUtils.ts` - Dato-hjelpefunksjoner (`getWeekNumber()`)
- `arbeidsplan.ts` - Arbeidsplan-konstanter (`UKEDAGER`)
- `admin.ts` - Admin-paginering og spørringstyper
- `contact.ts` - Kontaktskjema-schemas og -konstanter
- `notifications.ts` - Web push-preferanser og abonnementer
- `export.ts` - Eksport-schemas (PDF, Word, Excel, Notion)
- `kunnskapsbase.ts` - Kunnskapsbase-schemas (lenker, filer, chunks)

### Docs-pakken

Prosjektet har en `docs/`-pakke som bruker VitePress for prosjektdokumentasjon. Den bygges og deployes separat til GitHub Pages via `deploy.docs.yml`. Startes lokalt med `pnpm dev:docs`.

---

## Backend - API server

### Hva gjør backend?

1. Henter data fra Canvas API og AI-tjenester (Claude)
2. Validerer at dataene er korrekte med Zod
3. Transformerer data til vårt format
4. Sender data til frontend

### Viktige konvensjoner

**Logging:**

```typescript
// RIKTIG - Bruk pino logger
logger.info({ data }, "Hentet data");
logger.error({ err: error }, "Feil ved henting");

// FEIL - Aldri console.log
console.log(data);
```

**Database:**

```typescript
// RIKTIG - Bruk Mongoose modeller
const users = await User.find({ active: true });

// FEIL - Ikke bruk native driver direkte
// db.collection('users').find(...)
```

**Konfigurasjon:**

- AI-modeller: `backend/src/rutere/ki/aiModels.ts`
- System prompt: `backend/src/rutere/ki/systemPrompt.ts`
- Canvas paginering: `PAGE_SIZE` og `MAX_PAGES` i `canvasUtils.ts`
- Cache TTL: `CACHE_TTL` i `canvasUtils.ts`; sync i Redis: `SYNC_CACHE_TTL` (2 timer) i `canvas-sync.service.ts`
- Vektorsøk: `backend/src/services/pinecone.service.ts`; miljøvariabler: `PINECONE_API_KEY`, `PINECONE_INDEX_NAME`
- AI-tracing: `backend/src/lib/langsmith.ts` wrapper KI-kall fra `aiClient.ts` og sender prompt/completion-traces til LangSmith når `LANGCHAIN_API_KEY` er satt. Tracing hoppes over stille hvis nøkkelen mangler, så lokal dev fungerer uten LangSmith-konto. Brukes for feilsøking, ytelsesmåling og kvalitetsovervåking av KI-svar.

---

## Frontend - Brukergrensesnitt

### Styling (Tailwind CSS)

**Mobile First:**

```typescript
// RIKTIG - Start med mobil, legg til breakpoints
className="w-full md:w-1/2"

// FEIL - Start med desktop
className="w-1/2 max-md:w-full"
```

**Dark Mode:**

```typescript
// RIKTIG - Alltid ha dark: variant
className="bg-white dark:bg-slate-900 text-black dark:text-white"
```

### Data fetching

**Bruk relative URL-er:**

```typescript
// RIKTIG - Next.js rewrites håndterer resten
const res = await fetch("/api/canvas/emner");

// FEIL - Hardkodet URL
const res = await fetch("http://localhost:4000/api/canvas/emner");
```

Du trenger IKKE endre `next.config.js` for nye endpoints - alt under `/api/*` sendes automatisk til backend.

---

## Feilhåndtering

### Backend

Bruk standardisert feilhåndtering fra `backend/src/utils/apiError.ts`:

```typescript
import { apiError, sendZodError, sendUnknownError, requireUserId } from "../../utils/apiError.js";

// Auth-guard (returnerer userId eller sender 401 og returnerer null)
const userId = requireUserId(req, res);
if (!userId) return;

// Autentiseringsfeil
apiError.unauthorized(res, "Du må logge inn");

// Valideringsfeil
apiError.badRequest(res, "Ugyldig input", detaljer);

// Ikke funnet
apiError.notFound(res, "Bruker");

// Konflikt
apiError.conflict(res, "Ressursen eksisterer allerede");

// Zod feil
if (error instanceof ZodError) {
  return sendZodError(res, error, "Registrering");
}

// Ukjent feil
return sendUnknownError(res, error, { kontekst: "minFunksjon" });
```

### Frontend

Bruk felles error-klasser fra `frontend/app/lib/errors.ts`:

```typescript
import {
  KIAuthError,
  KIRateLimitError,
  CanvasTokenMissingError,
  AppError
} from "../lib/errors";

// Sjekk error type
if (error instanceof KIRateLimitError) {
  // Vis "vent litt" melding
}

// Sjekk om reauth kreves
if (AppError.isAppError(error) && error.requiresReauth()) {
  // Redirect til innlogging
}
```

---

## Arbeidsflyt

### Daglig utvikling

```bash
# 1. Start utviklingsservere
pnpm dev

# 2. Gjør endringer
# Backend: backend/src/
# Frontend: frontend/app/
# Common: common/src/

# 3. Se endringer live
# Frontend: http://localhost:3000
# Backend: http://localhost:4000

# 4. Stopp servere
pnpm kill:dev
```

### Før du committer

```bash
pnpm test:unit && pnpm typecheck && pnpm lint && pnpm lint:md && pnpm build
```

**Pre-commit-hook:** Repoet har Husky + lint-staged **konfigurert**, men hooken er **midlertidig deaktivert** (se `.husky/pre-commit`). Kjør derfor `pnpm format` manuelt før commit inntil hooken reaktiveres. Sjekker i kommandoen over (`pnpm test:unit && pnpm typecheck && pnpm lint && pnpm lint:md && pnpm build`) håndheves av CI på hver PR.

### Git workflow

```bash
# 1. Oppdater fra main
git checkout main
git pull origin main

# 2. Lag ny branch
git checkout -b feature/min-funksjon

# 3. Gjør endringer og commit
git add .
git commit -m "Legg til min funksjon"

# 4. Push og opprett PR
git push origin feature/min-funksjon
```

---

## Tips

### Debugging

**Backend:**

```typescript
logger.info({ data }, "Debug info");
```

**Frontend:** Bruk `console.log` kun i utvikling; unngå i produksjonskode der det kan lekke sensitiv info.

### TypeScript errors

1. Sjekk at du har importert riktig type
2. Sjekk at du har eksportert fra Common
3. Kjør `pnpm typecheck` for å se alle feil
4. Kjør `pnpm build` hvis common-typer mangler

### Debugging: 401 på /api/user/me i lokal dev

Hvis du får 401 "Mangler autentiseringstoken" på `/api/user/me` lokalt (f.eks. at admin-fanen ikke vises selv om brukeren din har `role: "admin"` i MongoDB), og DevTools → Application → Cookies viser flere `__session*` eller `__clerk_db_jwt*`-cookies (noen med et `_XXX`-suffix og noen uten), har du blandede Clerk-instanser på samme port. Dette skjer typisk hvis du har brukt både prod og dev Clerk publishable keys på `localhost:3000` på ulike tidspunkt.

**Symptomer:**

- `/api/user/me` returnerer 401 med `{"kode":"auth_error","melding":"Mangler autentiseringstoken"}`
- Request-headeren mangler `Authorization: Bearer ...` (kun Cookie er satt)
- Sidebaren viser ikke admin-fanen selv om databasen sier bruker er admin

**Fiks (rekkefølge — stopp når det fungerer):**

1. Last siden på nytt. Appen rydder automatisk duplikat Clerk-cookies i dev ved mount, og `hentMeg` retry-er én gang ved 401 etter en Clerk session-reload.
2. Åpne nettleserens konsoll og kjør `window.__studywiseResetClerk()` — dette sletter alle Clerk-cookies og reloader siden.
3. Manuelt: DevTools → Application → Cookies → `localhost:3000` → Clear all → hard-refresh (Ctrl+Shift+R) → logg inn på nytt.
4. Verifiser at `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` (frontend) og `CLERK_SECRET_KEY` (backend) peker på samme Clerk-instans (begge `pk_test_*`+`sk_test_*` for dev, eller begge `pk_live_*`+`sk_live_*` for live). Mixing skaper samme 401-symptom.

**Dette kan ikke skje i prod** — prod har én Clerk-instans per domene, vanlige brukere får aldri dual cookie-state. Mitigeringene over (auto-opprydding, retry, dev reset-helper) er dev-only og har ingen effekt i production-builds.

### Docker

Hele prosjektet kan kjøres lokalt via Docker:

```bash
# Start alt (MongoDB, Redis, backend, frontend)
docker compose up --build
```

Forutsetning: `backend/.env` må finnes med påkrevde nøkler (ANTHROPIC_API_KEY, COHERE_API_KEY, CLERK_SECRET_KEY, ENCRYPTION_KEY, MONGO_URI, REDIS_URL, PINECONE_API_KEY, PINECONE_INDEX_NAME). Se `backend/.env.example`. MongoDB og Redis startes automatisk av Docker. Ved MongoDB Atlas «bad auth»: sjekk brukernavn/passord og Database Access. I Redis Cloud anbefales eviction policy `allkeys-lru` for å unngå «nesten full»-varsler.

### Valgfrie miljøvariabler

Disse aktiverer tilleggsfunksjoner, men kjernen fungerer uten. Backend/frontend hopper stille over integrasjoner når nøklene ikke er satt — praktisk for lokal dev.

**Backend (`backend/.env`):**

- `ENCRYPTION_KEY_PREV` - Forrige krypteringsnøkkel under nøkkelrotasjon (dekrypterer legacy-data under migrasjon)
- `CONTACT_WORKER_URL`, `CONTACT_WORKER_SECRET`, `CONTACT_TO_EMAIL`, `CONTACT_FROM_EMAIL` - Cloudflare Worker-relay som sender kontaktskjema til Resend (e-postlevering). Uten disse kjører kontakt i mock-modus lokalt
- `DD_*` - Datadog APM-backend-monitorering (`DD_API_KEY`, `DD_SERVICE`, `DD_ENV`, osv.)
- `LANGCHAIN_API_KEY`, `LANGCHAIN_PROJECT`, `LANGCHAIN_ENDPOINT`, `LANGCHAIN_TRACING_V2` - LangSmith-tracing for KI-kall. Hopper stille over tracing når nøkkelen mangler
- `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` - Web Push-varsler (generer med `npx web-push generate-vapid-keys`)
- `TURNSTILE_SECRET_KEY` - Cloudflare Turnstile backend-verifisering

**Frontend (`frontend/.env`):**

- `NEXT_PUBLIC_POSTHOG_KEY`, `NEXT_PUBLIC_POSTHOG_HOST` - PostHog produktanalyse (cookieless, consent-gated)
- `NEXT_PUBLIC_DD_RUM_APPLICATION_ID`, `NEXT_PUBLIC_DD_RUM_CLIENT_TOKEN`, `NEXT_PUBLIC_DD_SITE` - Datadog RUM frontend-overvåking
- `NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA` - Release-versjon for telemetri (settes automatisk av Vercel)

Se `backend/.env.example` og `frontend/.env.example` for full liste med kommentarer.

### Hjelp

- Les eksisterende kode i `canvas/` og `ki/` mappene
- [Next.js docs](https://nextjs.org/docs)
- [React Query docs](https://tanstack.com/query/latest)
- [Zod docs](https://zod.dev)
