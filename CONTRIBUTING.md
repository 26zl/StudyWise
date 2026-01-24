# Utviklingsveiledning

Guide for utvikling i Bachelor IT prosjektet.

## Innholdsfortegnelse

1. [Prosjektstruktur](#prosjektstruktur)
2. [Hvordan systemet fungerer](#hvordan-systemet-fungerer)
3. [Legge til ny funksjonalitet](#legge-til-ny-funksjonalitet)
4. [Common - Delte typer](#common---delte-typer)
5. [Backend - API server](#backend---api-server)
6. [Frontend - Brukergrensesnitt](#frontend---brukergrensesnitt)
7. [Arbeidsflyt](#arbeidsflyt)

---

## Prosjektstruktur

Prosjektet er delt i tre hoveddeler:

```
BachelorOppgave/
├── common/              # Delte typer og validering
│   └── src/
│       ├── canvas.ts
│       └── ki.ts
├── backend/             # API server
│   └── src/
│       ├── rutere/
│       └── index.ts
└── frontend/            # Nettside
    └── app/
        ├── canvas/
        ├── dashboard/
        └── layout.tsx
```

**Common**: Inneholder alle data-definisjoner som brukes av både backend og
frontend. Dette sikrer at begge deler er enige om hvordan dataene ser ut.

**Backend**: Express server som henter data fra Canvas API, behandler det, og
sender det videre til frontend.

**Frontend**: Next.js nettside som viser data til brukeren.

---

## Hvordan systemet fungerer

### Dataflyt

```
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

### Eksempel: Vise kunngjøringer

**1. Bruker besøker `/canvas` siden**

**2. Frontend spør backend om kunngjøringer:**

```typescript
// frontend/app/canvas/canvas-api.ts
fetch("/api/canvas/announcements")
```

**3. Backend henter fra Canvas API:**

```typescript
// backend/src/rutere/canvas/canvas.ts
canvasFetch("/api/v1/announcements")
```

**4. Backend validerer og sender til frontend:**

```typescript
const announcements = CanvasAnnouncementSchema.parse(data);
res.json({ announcements });
```

**5. Frontend validerer og viser:**

```typescript
const data = AnnouncementsResponseSchema.parse(await res.json());
// Viser data i komponenter
```

---

## Legge til ny funksjonalitet

La oss si du skal legge til en **Kalender** som viser studentens timeplan.

### Steg 1: Definer datatyper i Common

**Opprett `common/src/kalender.ts`:**

```typescript
import { z } from "zod";

// Definer hvordan data fra Canvas ser ut
export const CanvasEventSchema = z.object({
  id: z.string(),
  title: z.string(),
  start_at: z.string(),
  end_at: z.string().nullable(),
});

// Definer hvordan vi vil ha dataene i vår app
export const EventSchema = z.object({
  id: z.string(),
  tittel: z.string(),
  start: z.string(),
  slutt: z.string().nullable(),
});

// Definer API-responsen
export const KalenderResponseSchema = z.object({
  events: z.array(EventSchema),
});

// Eksporter TypeScript types
export type Event = z.infer<typeof EventSchema>;
export type KalenderResponse = z.infer<typeof KalenderResponseSchema>;
```

**Oppdater `common/src/index.ts`:**

```typescript
export * from "./canvas";
export * from "./ki";
export * from "./kalender";  // Ny linje
```

### Steg 2: Lag backend endpoint

**Opprett `backend/src/rutere/kalender/kalender.ts`:**

```typescript
import { Router } from "express";
import { z } from "zod";
import { CanvasEventSchema, EventSchema } from "common/kalender";

const router = Router();

router.get("/", async (_req, res) => {
  try {
    // 1. Hent fra Canvas
    const response = await canvasFetch("/api/v1/calendar_events");

    // 2. Valider Canvas data
    const canvasEvents = z.array(CanvasEventSchema).parse(response.data);

    // 3. Transformer til vårt format
    const events = canvasEvents.map(e => ({
      id: e.id,
      tittel: e.title,
      start: e.start_at,
      slutt: e.end_at,
    }));

    // 4. Send til frontend
    res.json({ events });
  } catch (error) {
    res.status(500).json({ feil: "Kunne ikke hente kalender" });
  }
});

export default router;
```

**Registrer i `backend/src/index.ts`:**

```typescript
import kalenderRuter from "./rutere/kalender/kalender.js";
app.use("/api/kalender", kalenderRuter);
```

### Steg 3: Lag frontend komponent

**Opprett `frontend/app/kalender/kalender-api.ts`:**

```typescript
import { useQuery } from "@tanstack/react-query";
import { KalenderResponseSchema } from "common/kalender";

export type { Event, KalenderResponse } from "common/kalender";

async function fetchKalender() {
  const res = await fetch("/api/kalender");
  if (!res.ok) throw new Error("Kunne ikke hente kalender");

  const data = await res.json();
  return KalenderResponseSchema.parse(data);
}

export function useKalender() {
  return useQuery({
    queryKey: ["kalender"],
    queryFn: fetchKalender,
  });
}
```

**Opprett `frontend/components/KalenderSection.tsx`:**

```typescript
"use client";

import { useKalender } from "../app/kalender/kalender-api";

export function KalenderSection() {
  const { data, isLoading, error } = useKalender();

  if (isLoading) return <div>Laster...</div>;
  if (error) return <div>Feil: {error.message}</div>;

  return (
    <div>
      <h2>Min Kalender</h2>
      {data?.events.map(event => (
        <div key={event.id}>
          <h3>{event.tittel}</h3>
          <p>{new Date(event.start).toLocaleDateString("nb-NO")}</p>
        </div>
      ))}
    </div>
  );
}
```

**Oppdater `frontend/app/dashboard/page.tsx` for å inkludere den nye komponenten i menyen.**

### Steg 4: Test

```bash
pnpm dev
# Gå til http://localhost:3000/dashboard
```

---

## Common - Delte typer

### Hva er Common?

Common er en egen pakke som inneholder data-definisjoner og
valideringsregler. Dette sikrer at backend og frontend alltid er enige om
hvordan data skal se ut.

### Hvorfor trenger vi Common?

**Uten Common:**
- Backend sender `{ name: "Ola" }`
- Frontend forventer `{ navn: "Ola" }`
- Applikasjonen krasjer

**Med Common:**
- Begge bruker samme definisjon
- TypeScript varsler hvis noe er feil
- Runtime validering fanger feil

### Når legger du til noe i Common?

**JA:**
- Data som sendes mellom backend og frontend
- Data fra eksterne APIer (Canvas, OpenAI, etc.)

**NEI:**
- React komponenter
- Express middleware
- CSS styling
- Kode som kun brukes i frontend eller backend

### Eksempel

```typescript
// common/src/bruker.ts
import { z } from "zod";

export const BrukerSchema = z.object({
  id: z.number(),
  navn: z.string(),
  epost: z.string().email(),
});

export type Bruker = z.infer<typeof BrukerSchema>;
```

Nå kan både backend og frontend bruke `Bruker` typen og `BrukerSchema` for validering.

---

## Backend - API server

### Hva gjør backend?

Backend er en Express server som:

1. Henter data fra Canvas API
2. Validerer at dataene er korrekte
3. Transformerer data til et format som passer oss
4. Sender data til frontend

### Backend struktur

```
backend/src/
├── rutere/
│   ├── canvas/
│   │   └── canvas.ts      # Endpoints for Canvas data
│   ├── auth/
│   │   └── auth.ts        # Endpoints for pålogging
│   └── KI/
│       └── KI.ts          # Endpoints for AI funksjoner
└── index.ts               # Starter serveren
```

### Backend vanlige oppgaver

**Hente data fra Canvas:**

```typescript
const response = await canvasFetch("/api/v1/courses");
const courses = CoursesSchema.parse(response.data);
```

**Lage et nytt endpoint:**

```typescript
router.get("/mindata", async (req, res) => {
  // Hent data
  const data = await hentData();

  // Send til frontend
  res.json(data);
});
```

**Error handling:**

```typescript
try {
  const data = await risikabelOperasjon();
  res.json(data);
} catch (error) {
  console.error(error);
  res.status(500).json({ feil: "Noe gikk galt" });
}
```

---

## Frontend - Brukergrensesnitt

### Hva gjør frontend?

Frontend er en Next.js nettside som:

1. Henter data fra backend
2. Validerer at dataene er korrekte
3. Viser data til brukeren
4. Håndterer brukerinteraksjon

### Frontend struktur

```
frontend/app/
├── canvas/
│   └── canvas-api.ts      # KUN data-fetching logikk (hooks)
├── dashboard/
│   └── page.tsx           # Hovedsiden (SPA container)
├── hjem/
│   └── page.tsx           # Landingsside
└── layout.tsx             # Overordnet layout

frontend/components/       # Gjenbrukbare UI-komponenter
├── CanvasSection.tsx      # Viser Canvas-data i dashboardet
└── KISection.tsx          # Viser AI-chat i dashboardet
```

### Frontend vanlige oppgaver

**Hente data med React Query:**

```typescript
export function useMinData() {
  return useQuery({
    queryKey: ["mindata"],
    queryFn: async () => {
      const res = await fetch("/api/mindata");
      const data = await res.json();
      return MinDataSchema.parse(data);
    },
  });
}
```

**Vise data i en komponent:**

```typescript
export default function MinSide() {
  const { data, isLoading, error } = useMinData();

  if (isLoading) return <div>Laster...</div>;
  if (error) return <div>Feil!</div>;

  return <div>{data.navn}</div>;
}
```

**Håndtere forms:**

```typescript
const handleSubmit = async (formData) => {
  const res = await fetch("/api/mindata", {
    method: "POST",
    body: JSON.stringify(formData),
  });

  if (!res.ok) {
    alert("Feil!");
  }
};
```

---

## Arbeidsflyt

### Daglig utvikling

```bash
# 1. Start utviklingsservere
pnpm dev

# 2. Gjør endringer i koden
# Backend: backend/src/
# Frontend: frontend/app/
# Common: common/src/

# 3. Se endringer live
# Frontend: http://localhost:3000
# Backend: http://localhost:4000

# 4. Stopp servere
pnpm kill:dev
```

### Legge til nye pakker

```bash
# I frontend
cd frontend
pnpm add react-icons

# I backend
cd backend
pnpm add bcrypt

# I common
cd common
pnpm add zod
```

### Før du committer

```bash
# Sjekk at alt kompilerer
pnpm typecheck

# Test at servere starter
pnpm dev
```

### Git workflow

```bash
# 1. Lag ny branch
git checkout -b feature/kalender

# 2. Gjør endringer og commit
git add .
git commit -m "Legg til kalender funksjonalitet"

# 3. Push til GitHub
git push origin feature/kalender

# 4. Opprett Pull Request på GitHub
```

---

## Tips og triks

### Debugging

**Backend:**

```typescript
console.log("Data fra Canvas:", data);
```

**Frontend:**

```typescript
console.log("Data fra backend:", data);
```

### TypeScript errors

Hvis TypeScript klager:

1. Sjekk at du har importert riktig type
2. Sjekk at du har eksportert fra Common
3. Kjør `pnpm typecheck` for å se alle feil

### API testing

Test backend endpoints direkte:

```bash
curl http://localhost:4000/api/canvas/test
```

### React Query DevTools

Legg til i `frontend/app/layout.tsx` for å se queries:

```typescript
import { ReactQueryDevtools } from '@tanstack/react-query-devtools';

<ReactQueryDevtools initialIsOpen={false} />
```

---

## Hjelp

- Les kodeeksempler i `canvas/` og `ki/` mappene
- Spør teamet i Discord/Teams
- [Next.js dokumentasjon](https://nextjs.org/docs)
- [React Query dokumentasjon](https://tanstack.com/query/latest)
- [Zod dokumentasjon](https://zod.dev)
