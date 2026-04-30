# KI-chat-pipeline (sequence)

Hele veien fra brukerens spørsmål til streamet svar med kildebadge. Pipelinen henter Canvas-kontekst og kunnskapsbase-kontekst hvis aktivert, sender til Claude via Vercel AI SDK med prompt-caching, og parser ut `<svarkilde>`-taggen før den lagres og streames til frontend.

```mermaid
sequenceDiagram
    autonumber
    actor U as Bruker
    participant FE as Frontend
    participant API as POST /api/ki/chat
    participant CTX as context-loader.service
    participant HR as hybrid-retrieval.service
    participant CAN as Canvas API
    participant PINE as Pinecone
    participant BM25 as BM25 (Mongo)
    participant CO as Cohere rerank
    participant AI as aiClient (Vercel AI SDK)
    participant ANT as Anthropic Claude
    participant CH as ChatHistory (Mongo)

    U->>FE: Skriver spørsmål
    FE->>API: SSE-strøm m/ messages, kursId, useKB
    API->>CTX: loadCanvasContext + loadKnowledgeBaseContext
    par Canvas
        CTX->>CAN: hent moduler/sider/oppgaver
        CAN-->>CTX: data
    and Kunnskapsbase
        CTX->>HR: hybridRetrieval(query, userId)
        par Vektor
            HR->>PINE: semantisk søk
            PINE-->>HR: kandidater
        and Nøkkelord
            HR->>BM25: BM25-søk
            BM25-->>HR: kandidater
        end
        HR->>CO: rerank(query, kandidater)
        CO-->>HR: top-N
        HR-->>CTX: kontekst-chunks
    end
    CTX-->>API: sammensatt kontekst
    API->>AI: streamText(messages + system + cache)
    AI->>ANT: Anthropic Messages API (streaming)
    loop Tokens
        ANT-->>AI: delta
        AI-->>API: chunk
        API-->>FE: SSE event
        FE-->>U: viser tekst
    end
    AI->>AI: extractAnswerAndSource(raw)
    Note over AI: Parser <svarkilde> tag:<br/>kursmateriale | canvas | kunnskapsbase | blandet | generell
    API->>CH: Lagre samtale + kilde
    API-->>FE: SSE done (med svarkilde)
    FE-->>U: viser svar + kildebadge
```
