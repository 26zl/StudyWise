# StudyWise

[![CI](https://github.com/26zl/StudyWise/actions/workflows/ci.yml/badge.svg)](https://github.com/26zl/StudyWise/actions/workflows/ci.yml)
[![Functional Testing](https://github.com/26zl/StudyWise/actions/workflows/func-testing.yml/badge.svg)](https://github.com/26zl/StudyWise/actions/workflows/func-testing.yml)
[![Deploy](https://github.com/26zl/StudyWise/actions/workflows/deploy.yml/badge.svg)](https://github.com/26zl/StudyWise/actions/workflows/deploy.yml)
[![Deploy Docs](https://github.com/26zl/StudyWise/actions/workflows/deploy.docs.yml/badge.svg)](https://github.com/26zl/StudyWise/actions/workflows/deploy.docs.yml)
[![OWASP Dependency-Check](https://github.com/26zl/StudyWise/actions/workflows/owasp-dependency-check.yml/badge.svg)](https://github.com/26zl/StudyWise/actions/workflows/owasp-dependency-check.yml)
[![Update dependencies](https://github.com/26zl/StudyWise/actions/workflows/update-dependencies.yml/badge.svg)](https://github.com/26zl/StudyWise/actions/workflows/update-dependencies.yml)
[![Node.js](https://img.shields.io/badge/node-24.x-339933?logo=node.js&logoColor=white)](./.nvmrc)
[![pnpm](https://img.shields.io/badge/pnpm-10.33.4-F69220?logo=pnpm&logoColor=white)](./package.json)
[![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178C6?logo=typescript&logoColor=white)](./tsconfig.base.json)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](./LICENSE)

En KI-basert studieassistent for høyere utdanning med integrasjon mot Canvas LMS.
Bacheloroppgave i IT ved Universitetet i Sørøst-Norge (USN), 2026 — gruppe 3.

- **Offentlig demo / produksjonslik deploy:** <https://www.studwize.page>
- **Dokumentasjon:** <https://26zl.github.io/StudyWise/>
- **Statusside:** <https://www.studwize.page/status>

> For en raskere orientering i prosjektet, se `filer_prosjekt/00-LESEGUIDE.md` og diagrammene i `filer_prosjekt/diagrammer/`.

## Prototype-scope og avgrensning

StudyWise er en bachelorprototype og teknisk demonstrator, ikke en offisiell
tjeneste fra USN, Canvas/Instructure eller andre læresteder. Den offentlige
deployen brukes for å demonstrere hva som er teknisk mulig med Canvas-data,
KI-assistanse og studieplanlegging i én flate.

Dagens Canvas-kobling bruker personlig API-token som brukeren selv oppretter i
Canvas. Dette er et bevisst prototypevalg for bachelorprosjektet. En reell
institusjonsutrulling bør erstattes av en godkjent integrasjonsmodell, for
eksempel Feide/FS der det er relevant og Canvas OAuth, LTI eller developer key
godkjent av lærestedets Canvas-administrator.

KI-funksjoner kan behandle Canvas-utdrag, dokumentinnhold og brukerens egne
spørsmål hos eksterne underleverandører som Anthropic, Pinecone, Cohere og
LangSmith. Brukere og testpersoner skal derfor ikke bruke løsningen med
taushetsbelagt informasjon, personopplysninger eller opphavsbeskyttet materiale
de ikke har rett til å behandle. KI-generert innhold er læringsstøtte og skal
ikke leveres som eget arbeid der emne- eller eksamensregler forbyr det.

## Teknologi

Monorepo med fem pakker (`common`, `backend`, `frontend`, `docs`, `tests`) administrert med pnpm workspaces.

| Lag      | Teknologi                                    |
| -------- | -------------------------------------------- |
| Frontend | Next.js, React, Tailwind CSS                 |
| Backend  | Node.js, Express, TypeScript                 |
| Database | MongoDB, Redis, Pinecone                     |
| KI       | Anthropic Claude, Cohere, LangSmith          |
| Auth     | Clerk, Cloudflare Turnstile                  |
| Infra    | Heroku, Vercel, Datadog, PostHog, Cloudflare |

## Deploy- og driftsarkitektur

Frontend kjører på Vercel bak Cloudflare, mens backend kjører på Heroku bak `api.studwize.page`. Next.js proxyer `/api/*` videre til Cloudflare API-edge, og Express-backenden avviser direkte origin-trafikk som ikke kommer via Cloudflare. `common`-pakken er kontrakten mellom frontend, backend og tester, med delte Zod-skjemaer og TypeScript-typer.

## Kom i gang

**Forutsetninger:** Node.js 24 LTS og pnpm via Corepack. CI og deploy er satt opp for Node 24, og repoet har både `.node-version` og `.nvmrc` for samme versjon.

```bash
git clone https://github.com/26zl/StudyWise.git
cd StudyWise
corepack enable
pnpm install

# Konfigurer miljøvariabler
cp backend/.env.example backend/.env
cp frontend/.env.example frontend/.env
# Fyll ut påkrevde verdier i begge filer

# Bygg og start
pnpm build
pnpm dev
```

| Tjeneste    | URL                              |
| ----------- | -------------------------------- |
| Frontend    | <http://localhost:3000>          |
| Backend API | <http://localhost:4000>          |
| API-docs    | <http://localhost:4000/api-docs> |
| Docs        | <http://localhost:5173>          |

## Kommandoer

```bash
# Utvikling
pnpm dev                  # Start alt
pnpm dev:frontend         # Kun frontend
pnpm dev:frontend:turbo   # Frontend med Turbopack (--turbopack).
pnpm dev:backend          # Kun backend

# Kvalitet
pnpm typecheck            # Type-sjekk alle pakker
pnpm lint                 # Lint alle pakker (ESLint)
pnpm lint:md              # Lint markdown-filer (remark)
pnpm format               # Formater alt med Prettier
pnpm format:check         # Sjekk formatering uten å skrive
pnpm build                # Bygg alt

# Tester
pnpm test:unit            # Enhetstester (Vitest)
pnpm test                 # Integrasjonstester
pnpm test:auth:e2e        # E2E-tester (Playwright)

# Vedlikehold
pnpm update               # Sikker dependency-oppdatering innenfor semver + minimumReleaseAge
pnpm clean:install        # Full reinstall
pnpm knip                 # Finn ubrukt kode
pnpm syncpack:list        # Sjekk versjonssynkronisering
```

Installer pakker med `--filter`: `pnpm --filter frontend add <pakke>`

## Docker

```bash
cp docker.env.example .env    # Fyll inn verdier
docker compose up --build     # Start MongoDB, Redis, backend, frontend
```

## Git hooks og kvalitetssjekker

Kvalitetssjekker kjøres manuelt lokalt og automatisk i CI. Før større commits anbefales:

```bash
pnpm format
pnpm test:unit && pnpm typecheck && pnpm lint && pnpm lint:md && pnpm build
```

De samme sjekkene håndheves automatisk i pull requests via GitHub Actions, slik at kvalitetskravet er likt på tvers av utviklingsmiljøer.
CI håndhever også Actions-sikkerhet med `pnpm lint:actions-security` og pnpm supply-chain-regelen med `pnpm lint:pnpm-security`: repoet skal ikke bruke `pull_request_target`, deploy/publish/privilegerte workflows skal ikke bruke delte package-manager-cacher, global `npm install -g` eller `curl | sh`, og `minimumReleaseAge` skal ikke senkes under 5 dager.
CI genererer CycloneDX SBOM som artefakt og skanner Dockerfile/backend-image med Trivy. Eksterne `safe-chain`-binærer lastes ned med SHA-256-verifisering før bruk, og Vercel CLI kjøres fra pnpm-locken i stedet for global npm-install.

## Testing

Testfiler ligger i `__tests__/`-mapper i hver pakke. E2E-tester bruker Playwright.

```bash
pnpm test:unit                # Alle enhetstester (common + backend + frontend)
pnpm test:unit:common         # Kun common
pnpm test:unit:backend        # Kun backend
pnpm test:unit:frontend       # Kun frontend
pnpm test:auth                # Auth-tester
pnpm test:auth:matrix         # Auth identitetsmatrise (120 scenarier)
pnpm test:ki                  # KI-tester
pnpm test:canvas              # Canvas-tester
```

Se [tests/README.md](./tests/README.md) for detaljer.

> Les [CONTRIBUTING.md](./.github/CONTRIBUTING.md) for utviklingsveiledning.

## Avhengigheter

Dependency-oppdateringer håndteres på to spor: `update-dependencies.yml` kjører ukentlig `pnpm update:safe` innenfor semver-rangene i `package.json` og `minimumReleaseAge`, mens Dependabot åpner ukentlige PR-er for GitHub Actions. Security-advisories åpner PR-er umiddelbart. Konfigurasjon ligger i [`.github/dependabot.yml`](./.github/dependabot.yml).
pnpm er konfigurert med `minimumReleaseAge: 7200` i `pnpm-workspace.yaml`, slik at nye npm-publiseringer må være minst 5 dager gamle før de kan løses inn. Det blokkerer helt ferske kompromitterte publiseringer, men låser oss ikke til gamle versjoner: ukentlig update-workflow plukker fortsatt opp patch/minor-oppdateringer etter venteperioden.

## Dokumentasjon og policyer

Viktige avgrensnings- og compliance-dokumenter:

- [`compliance/PROTOTYPE_SCOPE.md`](./compliance/PROTOTYPE_SCOPE.md) — prototype-scope, Canvas-avgrensning og produksjonskrav
- [`compliance/PIA.md`](./compliance/PIA.md) — personvernvurdering og restrisiko
- [`compliance/SUBPROCESSORS.md`](./compliance/SUBPROCESSORS.md) — underleverandører og dataflyt
- [`.github/SECURITY.md`](./.github/SECURITY.md) — sårbarhetsrapportering

## Lisens

MIT — se [LICENSE](./LICENSE).

## Bachelorgruppen

| Medlem        | Rolle                                                                     |
| ------------- | ------------------------------------------------------------------------- |
| Laurent Zogaj | Prosjektleder, fullstack, KI/Canvas-integrasjon, arkitektur, UI/UX, CI/CD |
| Abdinasir     | Fullstack, KI-integrasjon, UI/UX                                          |
| Anwar         | Fullstack, KI-integrasjon, UI/UX                                          |
| Ylli Ujkani   | Dokumentasjon, oversettelse                                               |

Veileder: USN – Bachelor i IT, 2026.
