# Kunnskapsbase — hybrid RAG

To parallelle søkeveier (vektor + nøkkelord) mot brukerens private kunnskapsbase, slått sammen og rerangert av Cohere. PII fjernes før innhold sendes til Pinecone — det er den siste grensen før data forlater backend.

```mermaid
flowchart LR
    subgraph Indeksering["Indeksering (skrivevei)"]
        UP["Bruker laster opp<br/>PDF/DOCX/lenke"]
        PARSE["fileExtractor /<br/>documentParserWorker"]
        SAN["PII-sanitize<br/>(regex i indeksering.service)"]
        CHUNK["chunk.service<br/>tekst-chunks"]
        EMB["embedding.service<br/>Anthropic embeddings"]
        KB[("Kunnskapsbase + KBContentChunk<br/>(MongoDB)")]
        PINE_W[("Pinecone<br/>vektorer m/ namespace=userId")]
    end

    UP --> PARSE --> SAN --> CHUNK --> EMB
    CHUNK -.lagrer chunk-tekst.-> KB
    EMB -->|upsert| PINE_W

    subgraph Lesing["Lesing (søk)"]
        Q["Bruker stiller spørsmål"]
        HR["hybrid-retrieval.service"]
        VEC["semantic-search.service<br/>(Pinecone)"]
        BM["bm25.service<br/>(KBContentChunk)"]
        RR["cohere-rerank.service"]
        OUT["Topp-N kontekst-chunks<br/>til chat-pipeline"]
    end

    Q --> HR
    HR --> VEC
    HR --> BM
    VEC --> RR
    BM --> RR
    RR --> OUT

    PINE_W -. brukes av .-> VEC
    KB -. brukes av .-> BM
```
