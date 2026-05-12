# Canvas-integrasjon

Hvordan Canvas-data flyter fra LMS til StudyWise. Tokens sendes til backend og lagres kryptert (AES-256-GCM) i `User`, Canvas-svar caches i Redis (2t TTL), strukturen lagres i `CanvasStructure`, og fil-/sideinnhold lagres som `ContentEmbedding`-chunks og synkroniseres til Pinecone via `embedding.service`.

```mermaid
flowchart TB
    U["Bruker oppgir<br/>Canvas API-token"]
    FE["Frontend<br/>/canvas-side"]

    subgraph Backend["Backend"]
        AUTH["knyttCanvasToken<br/>middleware"]
        TOKEN["POST /api/user/token<br/>brukerAuth"]
        CR["canvasRuter"]
        CS["canvas-sync.service"]
        CSQ["canvasStructuredQueries"]
        DOC["document.service / documentParserWorker<br/>tekstuttrekk + PII-maskering for filer"]
        CHUNKER["chunk.service<br/>tekst-chunks"]
        IDX["embedding.service<br/>upsertStoredFileContent"]
    end

    subgraph Lagring
        ENC[("User.canvasApiToken<br/>AES-256-GCM")]
        CACHE[("Redis cache<br/>2t TTL")]
        STRUCT[("CanvasStructure")]
        CHUNK[("ContentEmbedding<br/>chunk-tekst")]
        VEC[("Pinecone<br/>integrated embedding<br/>metadata: userId/course/file")]
    end

    CANVAS["Canvas LMS<br/>REST API"]

    U --> FE
    FE -->|lagre token| TOKEN
    TOKEN -->|encrypt i kryptering.ts| ENC
    FE -->|GET /api/canvas/*| CR
    CR --> AUTH
    AUTH -->|dekrypter token| ENC
    AUTH --> CS
    CS -->|cache hit?| CACHE
    CS -->|miss| CANVAS
    CANVAS -->|JSON| CS
    CS -->|skriv| CACHE
    CS -->|persister struktur| STRUCT
    CS -->|fil-/sideinnhold| DOC
    DOC --> CHUNKER
    CHUNKER --> IDX
    IDX -->|chunk-tekst| CHUNK
    IDX -->|tekst records| VEC
    CSQ -->|spørringer| STRUCT
    CR -->|svar| FE
```
