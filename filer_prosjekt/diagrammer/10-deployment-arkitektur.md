# Deployment-arkitektur

Hvilke deler kjøres hvor i produksjon. Frontend ligger på Vercel, backend på Heroku, dokumentasjon på GitHub Pages, og Resend-relayet er en Cloudflare Worker. Eksterne data-/KI-tjenester er managed.

```mermaid
flowchart LR
    subgraph DNS["DNS (studwize.page)"]
        WWW["www.studwize.page"]
        API["api.studwize.page"]
        DOCS_DNS["docs.studwize.page"]
    end

    subgraph Vercel["Vercel"]
        FE["frontend (Next.js 16)<br/>edge cache + ISR"]
    end

    subgraph Heroku["Heroku"]
        BE["backend dyno<br/>Procfile -> node dist"]
    end

    subgraph GH["GitHub"]
        REPO["studywise repo"]
        ACT["GitHub Actions<br/>CI: typecheck, test, lint, TruffleHog"]
        PAGES["GitHub Pages<br/>VitePress docs"]
    end

    subgraph CF["Cloudflare"]
        WK["Worker: Resend e-post<br/>(secret-header auth)"]
    end

    subgraph Managed["Managed services"]
        ATLAS[("MongoDB Atlas")]
        RC[("Redis Cloud / Heroku Redis")]
        PC[("Pinecone")]
        CLERK["Clerk"]
        ANT["Anthropic"]
        COH["Cohere"]
        TS["Cloudflare Turnstile"]
        PH["PostHog"]
        DD["Datadog"]
        LS["LangSmith"]
    end

    WWW --> FE
    API --> BE
    DOCS_DNS --> PAGES

    FE -->|/api/* rewrite| BE
    BE --> ATLAS
    BE --> RC
    BE --> PC
    BE --> CLERK
    BE --> ANT
    BE --> COH
    BE --> WK
    FE --> TS
    BE --> TS
    FE --> PH
    BE -.-> DD
    BE -.-> LS

    REPO -->|push| ACT
    ACT -->|deploy| FE
    ACT -->|deploy| BE
    ACT -->|deploy| PAGES
    ACT -->|deploy| WK
```
