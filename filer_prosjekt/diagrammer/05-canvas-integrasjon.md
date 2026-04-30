# Canvas-integrasjon

Hvordan Canvas-data flyter fra LMS til StudyWise. Tokens lagres kryptert (AES-256-GCM) i `User`, Canvas-svar caches i Redis (2t TTL), strukturen lagres i `CanvasStructure`, og innhold indekseres til Pinecone via `ContentEmbedding` for senere søk.

```mermaid
flowchart TB
    U["Bruker oppgir<br/>Canvas API-token"]
    FE["Frontend<br/>/canvas-side"]

    subgraph Backend["Backend"]
        AUTH["knyttCanvasToken<br/>middleware"]
        CR["canvasRuter"]
        CS["canvas-sync.service"]
        CSQ["canvasStructuredQueries"]
        IDX["kunnskapsbase-indeksering.service<br/>(PII-sanitize -> chunk -> embed)"]
    end

    subgraph Lagring
        ENC[("User.canvasToken<br/>AES-256-GCM")]
        CACHE[("Redis cache<br/>2t TTL")]
        STRUCT[("CanvasStructure")]
        CHUNK[("ContentEmbedding<br/>chunk-tekst")]
        VEC[("Pinecone<br/>vektorer")]
    end

    CANVAS["Canvas LMS<br/>REST API"]

    U --> FE
    FE -->|krypter via kryptering.ts| ENC
    FE -->|GET /api/canvas/*| CR
    CR --> AUTH
    AUTH -->|dekrypter token| ENC
    AUTH --> CS
    CS -->|cache hit?| CACHE
    CS -->|miss| CANVAS
    CANVAS -->|JSON| CS
    CS -->|skriv| CACHE
    CS -->|persister struktur| STRUCT
    CS -->|tekstinnhold| IDX
    IDX -->|chunk-tekst| CHUNK
    IDX -->|embeddings| VEC
    CSQ -->|spørringer| STRUCT
    CR -->|svar| FE
```
