# StudyWise - Bachelor 2026

[![CI](https://github.com/26zl/StudyWise/actions/workflows/ci.yml/badge.svg)](https://github.com/26zl/StudyWise/actions/workflows/ci.yml)
[![Deploy](https://github.com/26zl/StudyWise/actions/workflows/deploy.yml/badge.svg)](https://github.com/26zl/StudyWise/actions/workflows/deploy.yml)
[![Deploy Docs](https://github.com/26zl/StudyWise/actions/workflows/deploy.docs.yml/badge.svg)](https://github.com/26zl/StudyWise/actions/workflows/deploy.docs.yml)
[![OWASP Dependency-Check](https://github.com/26zl/StudyWise/actions/workflows/owasp-dependency-check.yml/badge.svg)](https://github.com/26zl/StudyWise/actions/workflows/owasp-dependency-check.yml)
[![Update dependencies](https://github.com/26zl/StudyWise/actions/workflows/update-dependencies.yml/badge.svg)](https://github.com/26zl/StudyWise/actions/workflows/update-dependencies.yml)

STUDYWISE - En KI-basert studieassistent for høyere utdanning med integrasjon mot Canvas Instructure.
**Produksjonsnettside:** <https://www.studwize.page>

> **Utvikling?** Les [CONTRIBUTING.md](./CONTRIBUTING.md) (veileder for bidragsytere) og [AGENTS.md](./AGENTS.md) (arkitektur og teknisk "lovverk").

## Teknologi & Arkitektur (Monorepo)

Prosjektet er bygd som et **pnpm-monorepo** for å dele skjemaer og typer (`common`) sømløst mellom klient og server.

- **Frontend:** Next.js 16 (React 19), Tailwind CSS v4, React Query, Zustand.
- **Backend:** Node.js, Express 5, TypeScript.
- **Databaser & Cache:** MongoDB (primær database), Pinecone (vektorsøk for KI-dokumenter), Redis (hurtigminne for Canvas API og sessions).
- **KI-Motor:** Anthropic Claude & Cohere (hybrid søk).
- **Infrastruktur & Sikkerhet:** Heroku (backend), Vercel (frontend), Datadog (APM/overvåking), Clerk (bruker-autentisering), Cloudflare (WAF/CDN/Turnstile).

---

## Kom i gang

### Forutsetninger

- Node.js 20+ og `pnpm` installert (`npm install -g pnpm`)
- Canvas LMS-konto

### Installasjon

```bash
git clone https://github.com/26zl/StudyWise.git
cd StudyWise
pnpm install
```

### Konfigurer miljøvariabler

Kopier `backend/.env.example` til `backend/.env` og fyll ut påkrevde verdier som `MONGO_URI`, `REDIS_URL`, og div. API-nøkler (AI, Pinecone m.m.).

### Bygg og Start

```bash
pnpm build
pnpm dev
```

## Kommandoer (kjør fra rot)

```bash
# Utvikling
pnpm dev              # Start frontend + backend + docs
pnpm dev:frontend     # Start kun frontend
pnpm dev:backend      # Start kun backend
pnpm dev:docs         # Start kun dokumentasjon

# Kvalitetssikring
pnpm typecheck        # Type-check alle pakker
pnpm lint             # Lint alle pakker
pnpm build            # Bygg alt (common → backend → frontend → docs)

# Installere pakker (VIKTIG: Bruk --filter)
pnpm --filter frontend add <pakkenavn>
pnpm --filter backend add <pakkenavn>
pnpm --filter common add <pakkenavn>

# Vedlikehold
pnpm run clean:all        # Fjerner alt: node_modules, dist, .next, pnpm-lock.yaml
pnpm run clean:install    # Full reinstall (clean + install + update + build)
pnpm kill:dev             # Stopp alle Node prosesser (Windows)
```

## Utviklingsservere

| Tjeneste     | URL                              |
| ------------ | -------------------------------- |
| Frontend     | <http://localhost:3000>          |
| Backend API  | <http://localhost:4000>          |
| Swagger UI   | <http://localhost:4000/api-docs> |
| Docs         | <http://localhost:5173>          |

## Lisens

Dette prosjektet er utgitt under **MIT-lisensen**. Se filen [LICENSE](./LICENSE) for flere detaljer.
