# Kunnskapsbase — RAG-søk

RAG-flyt for brukerens private kunnskapsbase. Skriveveien lagrer chunks i `KBContentChunk` og upsert-er tekstrecords til Pinecone. Leseveien bruker `searchKBContent`: Pinecone semantisk søk med `userId` + `kb:<baseId>`-filter, Cohere-rerank ved treff og MongoDB keyword/recent fallback når Pinecone ikke gir brukbare resultater.

```mermaid
flowchart LR
    subgraph Indeksering["Indeksering (skrivevei)"]
        UP["Bruker laster opp<br/>PDF/DOCX/lenke"]
        PARSE["extractTextFromFile / crawler<br/>documentParserWorker ved filer"]
        SAN["PII-maskering for filtekst<br/>prompt-tag sanitize ved kontekst"]
        CHUNK["chunk.service<br/>tekst-chunks"]
        IDX["kunnskapsbase-indeksering.service<br/>indexKBContent"]
        KB[("Kunnskapsbase + KBContentChunk<br/>(MongoDB)")]
        PINE_W[("Pinecone<br/>delt namespace<br/>metadata: userId/base")]
    end

    UP --> PARSE --> SAN --> IDX
    IDX --> CHUNK
    CHUNK -->|chunks| IDX
    IDX -->|lagrer chunk-tekst| KB
    IDX -->|upsert tekst records| PINE_W

    subgraph Lesing["Lesing (søk)"]
        Q["Bruker stiller spørsmål"]
        SEARCH["searchKBContent<br/>(kunnskapsbase-indeksering.service)"]
        VEC["pineconeQuery<br/>userId + kb:baseId-filter"]
        RR["cohere-rerank.service"]
        FB["MongoDB keyword/recent fallback<br/>(KBContentChunk)"]
        OUT["Topp-N kontekst-chunks<br/>til chat-pipeline"]
    end

    Q --> SEARCH
    SEARCH --> VEC
    VEC --> RR
    RR --> OUT
    SEARCH --> FB --> OUT

    PINE_W -. brukes av .-> VEC
    KB -. hydrering/fallback .-> SEARCH
```
