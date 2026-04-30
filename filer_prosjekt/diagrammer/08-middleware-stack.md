# Middleware-stack (Express)

Rekkefølgen på middleware i `backend/src/index.ts` er sikkerhetskritisk. Clerk-webhook trenger rå body **før** JSON-parser, CSRF kjører **etter** CORS, og rate-limit kjører **før** `requireAuth`. Diagrammet leses ovenfra og ned i kjøringsrekkefølge.

```mermaid
flowchart TB
    REQ["Innkommende HTTP-request"] --> TP["app.set('trust proxy', N)"]
    TP --> HOST{"Prod?"}
    HOST -- Ja --> HV["Host/origin-validering<br/>API_HOST + INTERNAL_HOSTS"]
    HOST -- Nei --> HELM
    HV --> HELM["Helmet<br/>CSP, HSTS, X-Frame, ..."]
    HELM --> URL["express.urlencoded"]
    URL --> RID["requestIdMiddleware<br/>(req.id for korrelasjon)"]
    RID --> LOG["pinoHttp<br/>strukturert logging"]
    LOG --> COMP["compression<br/>(skipper SSE)"]
    COMP --> WH{"Path = /api/clerk-webhook?"}
    WH -- Ja --> RAW["express.raw + clerkWebhookRouter<br/>verifiser Svix-signatur"]
    WH -- Nei --> JSON["express.json (10mb)"]
    JSON --> TO["requestTimeout"]
    TO --> ORIG["Origin-validering før cors()"]
    ORIG --> CORS["cors() m/ allowlist"]
    CORS --> CSRF["beskytteMotCsrf<br/>x-studywise-csrf + origin/referer"]
    CSRF --> PUB{"Offentlig path?<br/>/health, /ready, /api/kontakt, ..."}
    PUB -- Ja --> ROUTE
    PUB -- Nei --> AUTH["requireAuth<br/>Clerk Bearer-token"]
    AUTH --> TERMS["requireAcceptedTerms<br/>403 terms_outdated"]
    TERMS --> RL["rateLimitMe<br/>(per rute)"]
    RL --> ROLE{"Admin-rute?"}
    ROLE -- Ja --> RR["requireRole('admin')"]
    ROLE -- Nei --> ROUTE["Feature-router<br/>(canvas, ki, kb, quiz, ...)"]
    RR --> ROUTE
    ROUTE --> H404["404 + global errorhandler"]

    classDef sec fill:#fecaca,stroke:#991b1b,color:#1f2937
    classDef parse fill:#bfdbfe,stroke:#1e3a8a,color:#1f2937
    classDef obs fill:#fde68a,stroke:#92400e,color:#1f2937
    class HV,HELM,CORS,CSRF,AUTH,TERMS,RL,RR sec
    class URL,JSON,RAW,COMP parse
    class RID,LOG obs
```
