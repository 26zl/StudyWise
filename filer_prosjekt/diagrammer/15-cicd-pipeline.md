# CI/CD-pipeline (GitHub Actions)

Viser den fulle pipelinen fra kodeendring til offentlig demo / produksjonslik deploy. Inkluderer kvalitetssikring (typecheck, lint, test, build), supply-chain-kontroller (Actions-guardrails, OSV, SBOM, Trivy, TruffleHog) og deploy til Vercel/Heroku/GitHub Pages. Dokumenterer at prosjektet har modne automatiserte rutiner — relevant for vurdering av leveransekvalitet.

```mermaid
flowchart TB
    DEV["Utvikler<br/>git push"]
    PR["Pull Request<br/>til main"]
    MAIN["main-branch<br/>oppdatert"]

    subgraph CI["CI workflow (.github/workflows/ci.yml)"]
        direction TB
        ACTIONLINT["Actionlint + workflow guardrails<br/>pull_request_target/cache/curl/npm -g"]
        PNPM_SEC["pnpm guardrail<br/>minimumReleaseAge >= 5 dager"]
        SETUP["Setup: Node 24 + pnpm install<br/>safe-chain checksum"]
        COMMON["pnpm --filter common build"]
        UNIT["pnpm test:unit<br/>(1190+ Vitest-tester)"]
        TYPE["pnpm typecheck"]
        LINT["pnpm lint + lint:md"]
        SYNCPACK["pnpm syncpack:list<br/>dependency sync"]
        SOFT["pnpm lint:soft-delete"]
        BUILD["pnpm build<br/>(common, backend, frontend, docs)"]
    end

    subgraph SEC["Sikkerhetsskanning"]
        TRUFFLE["TruffleHog<br/>(hemmeligheter i git)"]
        OSV["OSV-Scanner<br/>(pnpm-lock)"]
        ESLINT_SEC["eslint-plugin-security<br/>(SAST)"]
        OWASP["OWASP Dep-Check<br/>(ukentlig)"]
        SBOM["CycloneDX SBOM<br/>(artefakt)"]
        TRIVY["Trivy<br/>Dockerfile + backend-image"]
    end

    subgraph FUNC["Funksjonelle tester (func-testing.yml)"]
        SMOKE["HTTP smoke<br/>auth + KI + Canvas"]
        E2E["Playwright Chromium<br/>auth + app + security smoke"]
    end

    subgraph DEPLOY["Deploy"]
        VERCEL["Vercel<br/>(frontend)"]
        HEROKU["Heroku Automatic Deploys<br/>(backend fra main)"]
        PAGES["GitHub Pages<br/>(docs)"]
        CFW["Cloudflare Workers Builds<br/>(Resend-relay)"]
    end

    DEPS["Ukentlig dependency-vedlikehold<br/>pnpm update:safe-PR + Actions Dependabot<br/>GitHub security advisories"]

    DEV --> PR
    PR --> CI
    PR --> SEC

    CI --> ACTIONLINT --> PNPM_SEC --> SETUP --> COMMON --> UNIT --> TYPE --> LINT --> SYNCPACK --> SOFT --> BUILD
    SEC --> OSV
    SEC --> SBOM
    SEC --> TRIVY
    SEC --> TRUFFLE
    LINT -.inkluderer.-> ESLINT_SEC
    DEPS --> PR

    PR -->|merge etter grønne checks| MAIN
    MAIN -->|push trigger CI| CI
    CI -->|workflow_run success på main push| FUNC
    FUNC --> SMOKE --> E2E
    FUNC -->|workflow_run success| VERCEL
    MAIN -->|Heroku auto deploy| HEROKU
    MAIN -->|docs-endring| PAGES
    MAIN -->|Workers Builds| CFW

    classDef build fill:#bbf7d0,stroke:#166534,color:#1f2937
    classDef sec fill:#fecaca,stroke:#991b1b,color:#1f2937
    classDef test fill:#bfdbfe,stroke:#1e3a8a,color:#1f2937
    classDef deploy fill:#fde68a,stroke:#92400e,color:#1f2937
    class ACTIONLINT,PNPM_SEC,SETUP,COMMON,TYPE,LINT,UNIT,SYNCPACK,SOFT,BUILD build
    class TRUFFLE,OSV,ESLINT_SEC,OWASP,SBOM,TRIVY sec
    class E2E,SMOKE test
    class VERCEL,HEROKU,PAGES,CFW deploy
```

## Workflows i `.github/workflows/`

| Workflow | Trigger | Hva den gjør |
|----------|---------|--------------|
| `ci.yml` | Push og PR mot `main` | Actionlint, guardrails, install, unit, typecheck, lint, syncpack, soft-delete lint, build, OSV, SBOM, Trivy og TruffleHog |
| `func-testing.yml` | Manuelt eller etter grønn CI på `main`-push | Lokal Mongo/Redis, backend smoke og Playwright Chromium |
| `deploy.yml` | Etter grønn `Functional Testing` på `main` | Deploy frontend til Vercel fra verifisert commit |
| `deploy.docs.yml` | Endring i `docs/` | Deploy VitePress til GitHub Pages |
| `owasp-dependency-check.yml` | Ukentlig + manuelt | OWASP-skann av avhengigheter |
| `update-dependencies.yml` | Ukentlig + manuelt | `pnpm update:safe` innenfor semver og `minimumReleaseAge`, typecheck/lint/build og PR |

Backend deployes via Heroku Automatic Deploys fra `main`, mens Cloudflare Worker bygges fra `wrangler.toml` i Cloudflare Workers Builds.

## Kvalitetsporter før deploy

For at en commit skal nå offentlig demo / produksjonslik deploy må alle disse passere:

1. **Typer**: TypeScript strict på alle workspace-pakker
2. **Lint**: ESLint, markdown-lint, syncpack og soft-delete guardrail
3. **Tester**: Vitest, backend smoke og Playwright Chromium
4. **Supply chain**: Actions/pnpm guardrails, safe-chain checksum, OSV, SBOM, Trivy, TruffleHog og ukentlig OWASP
5. **Build**: Alle pakker bygger uten feil
6. **Deploy-gate**: Frontend deployes først etter grønn CI + Functional Testing på `main`
