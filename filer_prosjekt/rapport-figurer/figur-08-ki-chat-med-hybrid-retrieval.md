# Figur 8 - KI-chat med hybrid retrieval

Rapporttilpasset sekvensdiagram som viser hele kjeden fra spørsmål til SSE-strøm tilbake, inkludert TLS-grenser, PII-sanitering og kryptert lagring.

```mermaid
sequenceDiagram
    autonumber
    actor U as Bruker
    participant FE as Frontend
    participant API as Backend /api/ki/chat
    participant MONGO as MongoDB
    participant PINE as Pinecone
    participant BM25 as BM25 (Mongo)
    participant COHERE as Cohere rerank
    participant ANTH as Anthropic Claude

    U->>FE: Skriver spørsmål
    U->>FE: HTTPS/TLS 1.3
    FE->>API: POST spørsmål + valgt emne/KB<br/>SSE forventes tilbake (TLS)

    API->>MONGO: Hent kursdata, chat-historikk<br/>og chunk-tekst
    Note over API,MONGO: Sensitive lagrede felt leses/dekrypteres i backend ved behov.

    API->>API: PII-saniter bruker-/dokumenttekst<br/>før ekstern indeksering/søk

    par Hybrid retrieval
        API->>PINE: Semantisk vektorsøk<br/>med userId/course/base-filter (TLS)
        PINE-->>API: Kandidater
    and Nøkkelordsøk
        API->>BM25: BM25-søk i Mongo-tekst
        BM25-->>API: Kandidater
    end

    API->>COHERE: Rerank samlet treffsett (TLS)
    COHERE-->>API: Top-N relevante chunks

    API->>API: Bygg prompt:<br/>system + kontekst + historikk + spørsmål
    API->>ANTH: Claude streaming via Vercel AI SDK (TLS)
    loop Tokens
        ANTH-->>API: token/chunk
        API-->>FE: SSE event
        FE-->>U: Streamet svar vises
    end

    API->>API: Valider svarkilde-tag<br/>kursmateriale/canvas/kunnskapsbase/blandet/generell
    API->>API: Krypter chat-historikk<br/>AES-256-GCM
    API->>MONGO: Lagre kryptert samtale
    API-->>FE: SSE done + svarkilde
    FE-->>U: Viser svar + kildebadge
```

Bildetekst: Figur 8: Sekvensdiagram for KI-chat med hybrid retrieval.
