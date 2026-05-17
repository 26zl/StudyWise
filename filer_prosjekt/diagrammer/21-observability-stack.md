# Observability-stack: Datadog og Grafana

Hvordan signaler fra applikasjonen flyter til Datadog (us5) og videre til det eksterne Grafana-dashboardet. Frontend bruker Datadog RUM Browser SDK (`@datadog/browser-rum` v6.33.0, initialisert i `frontend/app/components/layout/DatadogRum.tsx:65-154` med service-navn `studywise-frontend`). Backend bruker Node.js APM-agenten `dd-trace` v5.102.0 (initialisert tidlig i `backend/src/datadog.ts:11-52` og importert først i `backend/src/index.ts:15`, med service-navn `studywise-backend`). Begge skrur seg av hvis `DD_API_KEY` mangler.

BullMQ-worker kjører i samme prosess som Express-backenden (`Procfile:1` har kun én `web`-prosess, og `backend/src/queues/index.ts:1-9` beskriver én unified worker). BullMQ-spans rapporteres derfor under `studywise-backend`-tjenesten via dd-trace's auto-instrumentation av Redis-klienten, ikke som en egen Datadog-service. Tag-distribusjonen er kritisk: APM-traces har `service:studywise-backend`, RUM-events har `service:studywise-frontend`, mens Heroku-dynoinfrastrukturmetrikker mangler `service:`-tag og må filtreres med `dynotype:web` / `dyno:web.N`.

Logger-pipelinen er litt indirekte: Pino (`backend/src/utils/logger.ts:62-186`) skriver strukturert JSON til stdout med `dd.trace_id` / `dd.span_id` injisert automatisk (`datadog.ts:26` setter `logInjection: true`). Det er en Heroku log drain (konfigurert i Heroku-dashboard, *ikke* i koden) som faktisk videresender stdout-loggen til Datadog. Tilsvarende gjelder dyno-metrikkene — Heroku Datadog-integrasjonen settes opp utenfor repoet.

Grafana lever som ekstern instans og henter all data via Datadog-pluginen mot us5. Det er ingen Grafana-config, dashboard-JSON eller SDK i kodebasen — Grafana-koblingen er en lenke i admin-grensesnittet (`frontend/app/components/admin/AdminSection.tsx`). LangSmith (`backend/src/lib/langsmith.ts`, `LANGCHAIN_API_KEY`-gated) og PostHog (`frontend`, cookie-gated) er parallelle observabilitetsløp som *ikke* går via Datadog — de er tegnet med stiplet linje for å gi det fulle bildet.

```mermaid
flowchart LR
    subgraph App["Applikasjonslag"]
        FE["studywise-frontend<br/>Next.js 16 på Vercel<br/>@datadog/browser-rum v6.33.0<br/>DatadogRum.tsx"]
        BE["studywise-backend<br/>Express 5 på Heroku web dynos<br/>dd-trace v5.102.0 (backend/src/datadog.ts)<br/>──────────────<br/>Inkluderer BullMQ-worker<br/>i samme prosess<br/>(backend/src/queues/index.ts)"]
    end

    subgraph HerokuPlat["Heroku-plattform (utenfor repo)"]
        DYNO["Dyno-metrikker<br/>CPU, RAM, dyno-load"]
        DRAIN["Log drain<br/>(stdout → Datadog)"]
    end

    subgraph DD["Datadog (site: us5.datadoghq.com)"]
        APM["APM<br/>trace.express.request{hits,errors,apdex}<br/>trace.redis.command (inkl. BullMQ BZPOPMIN)<br/>trace.mongodb.query<br/>trace.http.request"]
        RUM["RUM<br/>@view.largest_contentful_paint<br/>@view.cumulative_layout_shift<br/>@view.interaction_to_next_paint<br/>page-views, errors, session-replay 50%"]
        INFRA["Infrastructure<br/>system.cpu.user, system.mem.used<br/>tag: dynotype:web, dyno:web.N"]
        LOGS["Logs<br/>Pino JSON med dd.trace_id<br/>(logInjection: true)"]
        PROF["Profiling<br/>(betinget: DD_PROFILING_ENABLED)"]
    end

    subgraph GR["Grafana (ekstern instans, ikke i repo)"]
        DS["Datasource: Datadog-plugin<br/>API-spørringer mot us5"]
        DASH["Dashboard /d/fbrdskw/studywize-observability<br/>R1 Overview · R2 Backend Health<br/>R3 Latency (p50/p75/p95)<br/>R4 Core Web Vitals*<br/>R5 Infrastructure"]
    end

    LS["LangSmith<br/>LANGCHAIN_API_KEY-gated<br/>backend/src/lib/langsmith.ts"]:::ext
    PH["PostHog<br/>frontend, cookie-gated"]:::ext

    FE -->|"RUM-events<br/>service:studywise-frontend"| RUM
    BE -->|"APM-traces<br/>service:studywise-backend"| APM
    BE -->|"continuous profiling<br/>(hvis env)"| PROF
    BE -->|"pino → stdout"| DRAIN
    DRAIN -->|"Heroku log drain<br/>(ekstern setup)"| LOGS
    DYNO -->|"Heroku DD-integrasjon<br/>(ekstern setup)"| INFRA

    APM ==> DS
    RUM ==> DS
    INFRA ==> DS
    LOGS ==> DS
    DS ==> DASH

    BE -.->|"LLM-tracing<br/>(parallelt løp)"| LS
    FE -.->|"klient-events<br/>(parallelt løp)"| PH

    classDef ext fill:#fff2cc,stroke:#d4a017,color:#000
    classDef obs fill:#e6d6f5,stroke:#7b3fbf,color:#000
    classDef app fill:#d5e8d4,stroke:#3f8a4f,color:#000
    classDef plat fill:#f5f5f5,stroke:#666,color:#000
    class DD,GR obs
    class App app
    class HerokuPlat plat
```

`*` Core Web Vitals-panelene viser "No data" fordi Grafanas Datadog-plugin returnerer 400 for `@view.*`-felter via API. Panelene må konfigureres manuelt i Grafana sin panel-editor med RUM measure picker.
