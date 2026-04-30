# Produksjonsmiljø

Hvordan en ekte request flyter gjennom produksjon — fra brukerens nettleser, via DNS og CDN, gjennom Vercel og Heroku, til datalag og managed tredjepartstjenester. Viser også observabilitets- og hemmelighets-håndtering.

```mermaid
flowchart TB
    USER["Sluttbruker<br/>nettleser / mobil"]

    subgraph DNS["DNS + edge"]
        CFDNS["Cloudflare DNS<br/>studwize.page"]
        WWW["www.studwize.page<br/>(A/CNAME -> Vercel)"]
        APIH["api.studwize.page<br/>(CNAME -> Heroku)"]
        DOCSH["docs.studwize.page<br/>(GitHub Pages)"]
    end

    subgraph VercelProd["Vercel (produksjon)"]
        EDGE["Vercel Edge Network<br/>CDN + ISR cache"]
        NEXT["Next.js 16 (App Router)<br/>SSR/ISR + rewrites /api/* -> backend"]
    end

    subgraph HerokuProd["Heroku (produksjon)"]
        ROUTER["Heroku Router<br/>(2 hops -> trust proxy=2)"]
        DYNO["web dyno<br/>node dist/index.js<br/>Procfile m/ NODE_OPTIONS"]
    end

    subgraph DataProd["Datalag (managed)"]
        ATLAS[("MongoDB Atlas<br/>replica set + backup")]
        REDIS[("Redis (Heroku/Cloud)<br/>cache + BullMQ")]
        PINE[("Pinecone<br/>namespace = userId")]
    end

    subgraph KIProd["KI / søk"]
        ANTH["Anthropic Claude<br/>(prompt caching)"]
        COH["Cohere rerank"]
    end

    subgraph AuthProd["Auth + anti-bot"]
        CLERK["Clerk<br/>session JWT + webhook"]
        TURN["Cloudflare Turnstile"]
    end

    subgraph Mail["E-post-relay"]
        WORKER["Cloudflare Worker<br/>(secret-header auth)"]
        RESEND["Resend API"]
    end

    subgraph Obs["Observabilitet"]
        DD["Datadog APM<br/>traces + logs"]
        LS["LangSmith<br/>KI-traces (opt-in)"]
        PH["PostHog<br/>produktanalytics"]
        PINOLOGS["Heroku log drain<br/>(Pino strukturert)"]
    end

    subgraph Secrets["Hemmeligheter"]
        VENV["Vercel env vars<br/>(NEXT_PUBLIC_* + private)"]
        HENV["Heroku config vars<br/>ENCRYPTION_KEY, ANTHROPIC_API_KEY,<br/>CLERK_SECRET_KEY, MONGO_URI, ..."]
    end

    subgraph CICD["CI/CD"]
        GH["GitHub main"]
        ACT["GitHub Actions<br/>typecheck, test, lint, TruffleHog"]
        VBUILD["Vercel build hook"]
        HBUILD["Heroku build<br/>heroku-postbuild: common + backend"]
    end

    USER -->|HTTPS| CFDNS
    CFDNS --> WWW
    CFDNS --> APIH
    CFDNS --> DOCSH

    WWW --> EDGE --> NEXT
    NEXT -->|/api/* rewrite| APIH
    APIH --> ROUTER --> DYNO

    DYNO --> ATLAS
    DYNO --> REDIS
    DYNO --> PINE
    DYNO --> ANTH
    DYNO --> COH
    DYNO --> CLERK
    CLERK -->|webhook<br/>raw body| DYNO

    NEXT --> TURN
    DYNO --> TURN
    NEXT --> PH

    DYNO -->|kontaktskjema| WORKER --> RESEND

    DYNO -.traces.-> DD
    DYNO -.KI-traces.-> LS
    DYNO -.logs.-> PINOLOGS

    NEXT -. leser .- VENV
    DYNO -. leser .- HENV

    GH --> ACT
    ACT --> VBUILD --> NEXT
    ACT --> HBUILD --> DYNO

    HEALTH["Healthchecks:<br/>/health (liveness)<br/>/ready (Mongo)<br/>/health/dependencies (admin)"]:::note
    DYNO --- HEALTH

    classDef ext fill:#fde68a,stroke:#92400e,color:#1f2937
    classDef data fill:#bfdbfe,stroke:#1e3a8a,color:#1f2937
    classDef app fill:#bbf7d0,stroke:#166534,color:#1f2937
    classDef sec fill:#fecaca,stroke:#991b1b,color:#1f2937
    classDef obs fill:#ddd6fe,stroke:#5b21b6,color:#1f2937
    classDef note fill:#fef3c7,stroke:#b45309,color:#1f2937
    class CFDNS,WWW,APIH,DOCSH,EDGE ext
    class ATLAS,REDIS,PINE data
    class NEXT,DYNO,ROUTER,WORKER app
    class CLERK,TURN,VENV,HENV sec
    class DD,LS,PH,PINOLOGS obs
    class ANTH,COH,RESEND ext
```

## Nøkkelkarakteristikker for produksjon

- **HTTPS overalt** — HSTS aktivert i Helmet (`maxAge: 31536000, includeSubDomains`).
- **Trust proxy = 2** — matcher Cloudflare + Heroku Router-hops, ellers blir klient-IP og `req.protocol` feil.
- **Host-validering** — kun `API_HOST` + `INTERNAL_HOSTS` slipper gjennom på backend.
- **Streng CSP** — `default-src 'none'`, `frame-ancestors 'none'` (Swagger UI er deaktivert i prod).
- **Graceful shutdown** — SIGTERM lukker HTTP-server, BullMQ-workers, Mongo og Redis i rekkefølge.
- **Helsestatus** — Heroku poller `/health`; readiness venter på Mongo; admin-only `/health/dependencies` viser Pinecone/Anthropic/Cohere/Clerk/Redis.
- **Kø-resiliens** — BullMQ-workers prøver å starte på nytt med backoff hvis Redis er nede ved oppstart, uten at API-et restartes.
- **Hemmeligheter** — kun via Heroku/Vercel config vars; TruffleHog i CI fanger lekkasjer i kode.
- **Backup** — MongoDB Atlas point-in-time recovery; Pinecone har ingen backup, men kan gjenopprettes fra `ContentEmbedding` (kilde-sannhet for chunk-tekst).
