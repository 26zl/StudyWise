# KI-chat-pipeline (sequence)

Hele veien fra brukerens spørsmål til streamet svar med kildebadge. Pipelinen henter Canvas-/kursmateriale-kontekst via `context-loader.service`, henter aktiv kunnskapsbase via `searchKBContent` hvis brukeren har valgt en base, sender samlet kontekst til Claude via Vercel AI SDK med prompt-caching, og parser ut `<svarkilde>`-taggen før svaret lagres og streames til frontend.

```mermaid
sequenceDiagram
    autonumber
    actor U as Bruker
    participant FE as Frontend
    participant API as POST /api/ki/chat
    participant CTX as context-loader.service
    participant HR as hybrid-retrieval.service (Canvas)
    participant KB as searchKBContent (KB)
    participant CAN as Canvas API
    participant PINE as Pinecone
    participant BM25 as BM25 (Mongo)
    participant KBDB as KBContentChunk (Mongo)
    participant CO as Cohere rerank
    participant AI as aiClient (Vercel AI SDK)
    participant ANT as Anthropic Claude
    participant CH as ChatHistory (Mongo)

    U->>FE: Skriver spørsmål
    FE->>API: SSE-strøm m/ messages, kursId, useKB
    par Canvas / kursmateriale
        API->>CTX: loadCanvasContext(...)
        CTX->>CAN: hent moduler/sider/oppgaver
        CAN-->>CTX: data
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
        CTX-->>API: Canvas-/kurskontekst
    and Kunnskapsbase
        API->>KB: searchKBContent(userId, baseId, query)
        KB->>PINE: pineconeQuery(userId + kb:baseId)
        PINE-->>KB: kandidater
        KB->>KBDB: hent chunk-tekst
        KB->>CO: rerank(query, kandidater)
        alt Pinecone tom/utilgjengelig
            KB->>KBDB: keyword/recent fallback
        end
        KB-->>API: <kunnskapsbase>-kontekst
    end
    API->>API: Slå sammen Canvas + KB + chat-historikk
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
