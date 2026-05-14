# Teststrategi (test-pyramide + dekningsområder)

Viser hvilke testtyper som dekker hvilket abstraksjonsnivå i StudyWise. Test-pyramiden er en standard modell for å vise at lave testnivåer (raske, mange) bør dominere over høye (tregere, færre). I tillegg viser tabellen hvilke domener som testes hvor.

```mermaid
flowchart TB
    subgraph Pyramide["Test-pyramiden — StudyWise"]
        direction TB
        E2E["E2E (Playwright)<br/>11 spec-filer<br/>Chromium i CI<br/>auth + smoke"]:::e2e
        MATRIX["Auth-scenariomatrise<br/>120 scenarier<br/>signup, OAuth, sletting,<br/>race conditions"]:::matrix
        INT["Integrasjonstester<br/>tsx run.ts<br/>auth, ki, canvas, db"]:::int
        UNIT["Enhetstester (Vitest)<br/>1192 tester / 60 filer<br/>common 438 + backend 441 + frontend 313"]:::unit
        STATIC["Statisk analyse<br/>TypeScript strict<br/>ESLint + ESLint-security<br/>Prettier"]:::static

        E2E --> MATRIX
        MATRIX --> INT
        INT --> UNIT
        UNIT --> STATIC
    end

    classDef e2e fill:#fecaca,stroke:#991b1b,color:#1f2937
    classDef matrix fill:#fde68a,stroke:#92400e,color:#1f2937
    classDef int fill:#fef3c7,stroke:#b45309,color:#1f2937
    classDef unit fill:#bbf7d0,stroke:#166534,color:#1f2937
    classDef static fill:#bfdbfe,stroke:#1e3a8a,color:#1f2937
```

## Hva testes hvor

| Domene | Enhet (Vitest) | Integrasjon (tsx run.ts) | E2E (Playwright) | Sikkerhet (CI) |
|--------|:---------------:|:------------------------:|:----------------:|:--------------:|
| Skjemavalidering (Zod) | ✓ | – | – | – |
| Kryptering (AES-256-GCM) | ✓ | ✓ | – | – |
| Auth (Clerk-flyt) | ✓ | ✓ | ✓ | – |
| Auth-scenariomatrise | – | – | ✓ (120) | – |
| KI-pipeline (mock + ekte) | ✓ | ✓ | – | – |
| Canvas-API (mock) | ✓ | ✓ | – | – |
| RAG / hybrid-retrieval | ✓ | – | – | – |
| Rate limiting / CSRF | ✓ | ✓ | ✓ | – |
| SSRF-guards | ✓ | – | – | – |
| Sanitization / XSS | ✓ | – | ✓ | ✓ (ESLint-security) |
| Hemmeligheter i git | – | – | – | ✓ (TruffleHog) |
| Sårbare avhengigheter | – | – | – | ✓ (OSV + OWASP) |
| Database-migrasjoner | ✓ | ✓ | – | – |
| Tilgjengelighet (a11y) | – | – | ✓ (axe-core) | – |

## Spesifikke testkommandoer

```bash
pnpm test:unit              # Alle enhetstester (~1192 totalt)
pnpm test:auth:matrix       # 120 auth-scenarier
pnpm test:auth:e2e          # Playwright Chromium
pnpm test:ki:smoke          # Rask KI-røyktest
pnpm test:canvas:smoke      # Rask Canvas-røyktest
```

## Hvorfor pyramiden ser slik ut

- **Statisk analyse** og **enhetstester** er gratis å kjøre tusenvis av ganger og fanger de fleste regresjoner umiddelbart.
- **Integrasjonstester** verifiserer at moduler henger sammen riktig — særlig auth, kryptering og databasekall.
- **Auth-scenariomatrisen** ble laget fordi auth er den mest sikkerhetskritiske flyten i appen og krever uttømmende dekning av kantkasus (OAuth-konflikter, race conditions, gjenbruk av e-post etter sletting).
- **E2E** holdes tynt og fokusert — kun kritiske brukerstier — for å holde CI-tiden lav.
