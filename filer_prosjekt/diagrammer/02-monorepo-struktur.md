# Monorepo-struktur (pnpm workspaces)

Viser de fem workspace-pakkene, byggrekkefølgen og hvilke avhengigheter som er delt. `common` må bygges først fordi både `backend` og `frontend` importerer typene derfra. Pakken fungerer som fullstack-kontrakten i prosjektet: skjemaendringer defineres med Zod i `common`, valideres i backend og brukes som typer i frontend og tester.

```mermaid
flowchart TB
    subgraph Repo["BachelorOppgave/ (pnpm workspaces)"]
        direction TB
        COMMON["common/<br/>Zod-skjemaer + delte typer<br/>subpath-eksport: common/canvas, common/ki, ..."]
        BACKEND["backend/<br/>Express 5 API<br/>Mongoose, Redis, BullMQ, Pinecone"]
        FRONTEND["frontend/<br/>Next.js 16 App Router<br/>React 19, Tailwind, Zustand, React Query"]
        DOCS["docs/<br/>VitePress dokumentasjon<br/>GitHub Pages"]
        TESTS["tests/<br/>Integrasjon + Playwright E2E<br/>tsx run.ts"]
    end

    BACKEND -->|importerer| COMMON
    FRONTEND -->|importerer| COMMON
    TESTS -->|importerer| COMMON
    TESTS -. tester .-> BACKEND
    TESTS -. tester .-> FRONTEND

    BUILD["Byggrekkefølge:<br/>1. common  ->  2. backend  ->  3. frontend  ->  4. docs"]:::note

    classDef note fill:#fef3c7,stroke:#b45309,color:#1f2937
    classDef shared fill:#ddd6fe,stroke:#5b21b6,color:#1f2937
    classDef app fill:#bbf7d0,stroke:#166534,color:#1f2937
    classDef testpkg fill:#fecaca,stroke:#991b1b,color:#1f2937
    classDef docpkg fill:#bfdbfe,stroke:#1e3a8a,color:#1f2937
    class COMMON shared
    class BACKEND,FRONTEND app
    class TESTS testpkg
    class DOCS docpkg
```
