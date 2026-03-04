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
1. Canvas LMS (USN sin læringsplattform)
   ↓
2. Backend henter data fra Canvas API
   ↓
3. Backend validerer og transformerer data
   ↓
4. Frontend henter data fra backend
   ↓
5. Frontend validerer og viser data til bruker
```

### Autentisering og Brukerdata

Det er kritisk å forstå skillet mellom "Lokal Bruker" og "Canvas Bruker".

### Lokal Bruker (User)

- Innlogging, passord, epost, og hemmeligheter
- Her lagres Canvas API Token (kryptert)
- Denne modellen representerer en person som kan logge inn

### Canvas Bruker (CanvasUser)

- Cache av offentlig profilinfo fra Canvas (navn, bilde, innstillinger)
- Har felt `localUser` som peker tilbake på `User`

### Flyten

1. Bruker logger inn (JWT Auth med `User` data)
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

Oppdater `common/src/index.ts` for å eksportere.

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
- Data fra eksterne APIer (Canvas, Anthropic/Claude, HuggingFace)
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
- `ki.ts` - KI API schemas og meldingslengde-grenser
- `chat.ts` - Chat-melding schemas og samtalehistorikk
- `document.ts` - Dokumentanalyse schemas
- `calendar.ts` - Kalender schemas
- `calendar-ui.ts` - Kalender UI schemas

### Docs-pakken

Prosjektet har en `docs/`-pakke som bruker VitePress for prosjektdokumentasjon. Den bygges og deployes separat til GitHub Pages via `deploy.docs.yml`. Startes lokalt med `pnpm dev:docs`.

---

## Backend - API server

### Hva gjør backend?

1. Henter data fra Canvas API og AI-tjenester (Claude/HuggingFace)
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
- Cache TTL: `CACHE_TTL` i `canvasUtils.ts`

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
import { apiError, sendZodError, sendUnknownError } from "../../utils/apiError.js";

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
pnpm typecheck && pnpm lint && pnpm build
```

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

**Frontend:**

```typescript
console.log("Data:", data);
```

### TypeScript errors

1. Sjekk at du har importert riktig type
2. Sjekk at du har eksportert fra Common
3. Kjør `pnpm typecheck` for å se alle feil
4. Kjør `pnpm build` hvis common-typer mangler

### Docker

Hele prosjektet kan kjøres lokalt via Docker:

```bash
# Start alt (MongoDB, Redis, backend, frontend)
docker compose up --build
```

Forutsetning: `backend/.env` må finnes med Anthropic API-nøkkel (påkrevd), HuggingFace-nøkkel (valgfri fallback), JWT-secrets og ENCRYPTION_KEY. MongoDB og Redis startes automatisk av Docker.

### Hjelp

- Les eksisterende kode i `canvas/` og `ki/` mappene
- [Next.js docs](https://nextjs.org/docs)
- [React Query docs](https://tanstack.com/query/latest)
- [Zod docs](https://zod.dev)
