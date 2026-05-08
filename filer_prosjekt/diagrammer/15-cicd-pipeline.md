# CI/CD-pipeline (GitHub Actions)

Viser den fulle pipelinen fra kodeendring til offentlig demo / produksjonslik deploy. Inkluderer både kvalitetssikring (typecheck, lint, test, sikkerhetsskanning) og deploy til Vercel/Heroku/GitHub Pages. Dokumenterer at prosjektet har modne automatiserte rutiner — relevant for vurdering av leveransekvalitet.

```mermaid
flowchart TB
    DEV["Utvikler<br/>git push"]
    PR["Pull Request<br/>til main"]
    MAIN["main-branch<br/>oppdatert"]

    subgraph CI["CI workflow (.github/workflows/ci.yml)"]
        direction TB
        SETUP["Setup: Node 24 + pnpm install"]
        FORMAT["Prettier --check"]
        TYPE["pnpm typecheck"]
        LINT["pnpm lint + lint:md"]
        UNIT["pnpm test:unit<br/>(1100+ Vitest-tester)"]
        BUILD["pnpm build<br/>(common, backend, frontend, docs)"]
    end

    subgraph SEC["Sikkerhetsskanning"]
        TRUFFLE["TruffleHog<br/>(hemmeligheter i git)"]
        OSV["OSV-Scanner<br/>(pnpm-lock)"]
        ESLINT_SEC["eslint-plugin-security<br/>(SAST)"]
        OWASP["OWASP Dep-Check<br/>(ukentlig)"]
        SBOM["CycloneDX SBOM<br/>(artefakt)"]
    end

    subgraph FUNC["Funksjonelle tester (func-testing.yml)"]
        E2E["Playwright Chromium<br/>(auth + smoke)"]
        AUTH_MX["Auth-matrix<br/>120 scenarier"]
    end

    subgraph DEPLOY["Deploy-workflows"]
        VERCEL["Vercel<br/>(frontend)"]
        HEROKU["Heroku<br/>(backend)"]
        PAGES["GitHub Pages<br/>(docs)"]
        CFW["Cloudflare<br/>(Worker)"]
    end

    DEPENDABOT["Dependabot<br/>ukentlig (mandag 06:00 CET)<br/>grupperte PR-er"]

    DEV --> PR
    PR --> CI
    PR --> SEC
    PR --> FUNC

    CI --> SETUP --> FORMAT --> TYPE --> LINT --> UNIT --> BUILD

    PR -->|grønn CI| MAIN
    MAIN --> DEPLOY

    DEPLOY --> VERCEL
    DEPLOY --> HEROKU
    DEPLOY --> PAGES
    DEPLOY --> CFW

    DEPENDABOT --> PR

    classDef build fill:#bbf7d0,stroke:#166534,color:#1f2937
    classDef sec fill:#fecaca,stroke:#991b1b,color:#1f2937
    classDef test fill:#bfdbfe,stroke:#1e3a8a,color:#1f2937
    classDef deploy fill:#fde68a,stroke:#92400e,color:#1f2937
    class SETUP,FORMAT,TYPE,LINT,UNIT,BUILD build
    class TRUFFLE,OSV,ESLINT_SEC,OWASP,SBOM sec
    class E2E,AUTH_MX test
    class VERCEL,HEROKU,PAGES,CFW deploy
```

## Workflows i `.github/workflows/`

| Workflow | Trigger | Hva den gjør |
|----------|---------|--------------|
| `ci.yml` | Push, PR | Format, typecheck, lint, build, enhetstester |
| `func-testing.yml` | Push, PR | Playwright E2E + auth-scenariomatrise |
| `deploy.yml` | Push til `main` | Deploy frontend (Vercel) + backend (Heroku) |
| `deploy.docs.yml` | Endring i `docs/` | Deploy VitePress til GitHub Pages |
| `owasp-dependency-check.yml` | Ukentlig + manuelt | OWASP-skann av avhengigheter |
| `update-dependencies.yml` | Manuelt | Hjelpetjeneste for grupperte oppdateringer |

## Kvalitetsporter før deploy

For at en commit skal nå offentlig demo / produksjonslik deploy må alle disse passere:

1. **Format**: Prettier-konsistens
2. **Typer**: TypeScript strict på alle 5 pakker
3. **Lint**: ESLint + remark for markdown
4. **Tester**: Vitest + Playwright
5. **Sikkerhet**: TruffleHog + OSV + ESLint-security
6. **Build**: Alle pakker bygger uten feil
