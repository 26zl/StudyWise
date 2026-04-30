# UML klassediagram — kjernetjenester

UML-klassediagram for de viktigste backend-tjenestene som realiserer KI-pipelinen og Canvas-integrasjonen. Diagrammet viser klassenes (modulenes) ansvar, hovedmetoder og deres avhengigheter. Komplementerer det funksjonelle perspektivet i sekvensdiagrammene (3, 4) ved å vise det strukturelle bildet.

I TypeScript er "klasser" ofte realisert som moduler med eksporterte funksjoner; diagrammet abstraherer dette til klassenotasjon for tydelighet.

```mermaid
classDiagram
    class AiClient {
        +streamChat(messages, opts) Promise~Stream~
        +extractAnswerAndSource(raw) AnswerWithSource
        -callAnthropic(messages) AsyncIterable
        -fallbackModel(error) Promise~Stream~
    }

    class ContextLoader {
        +loadCanvasContext(userId, courseId, opts) CanvasContext
        +loadKnowledgeBaseContext(userId, query) KBContext
        -mergeContext(canvas, kb) CombinedContext
    }

    class HybridRetrieval {
        +retrieve(userId, query, topN) RetrievalResult
        -vectorSearch(query) VectorHits
        -bm25Search(query) BM25Hits
        -rerank(query, candidates) RerankedHits
    }

    class CohereRerank {
        +rerank(query, docs, topN) Promise~RerankedDoc[]~
    }

    class PineconeService {
        +upsert(userId, vectors) Promise~void~
        +query(userId, vector, topK) Promise~Match[]~
        +deleteNamespace(userId) Promise~void~
    }

    class Bm25Service {
        +search(userId, query, opts) Promise~BM25Result[]~
        +indexChunk(chunk) Promise~void~
    }

    class EmbeddingService {
        +embed(text) Promise~Float[]~
        +embedBatch(texts) Promise~Float[][]~
    }

    class CanvasService {
        +getKurs(userId) Promise~Kurs[]~
        +getModuler(userId, kursId) Promise~Modul[]~
        +syncStruktur(userId, kursId) Promise~void~
        -fetchWithCache(url, ttl) Promise~Response~
    }

    class IndexeringService {
        +indeksKnowledgeBase(userId, kbId) Promise~void~
        -extractText(file) Promise~string~
        -sanitizePII(text) string
        -chunkText(text) string[]
    }

    class KrypteringUtil {
        +krypter(plaintext, key) Buffer
        +dekrypter(ciphertext, key) string
        -deriveKey(rawKey) Buffer
    }

    class RequireAuth {
        +middleware(req, res, next) void
        -verifyClerkToken(token) ClerkUser
        -loadUser(clerkId) Promise~User~
    }

    class KontoSlett {
        +slett(userId) Promise~void~
        -markTombstone(clerkId) Promise~void~
        -enqueueClerkDeletion(userId) Promise~void~
        -enqueuePineconeCleanup(userId) Promise~void~
    }

    class ClerkDeletionQueue {
        +process(job) Promise~void~
        -callClerkApi(clerkId) Promise~void~
    }

    class PineconeCleanupQueue {
        +process(job) Promise~void~
        -deleteVectorsForUser(userId) Promise~void~
    }

    AiClient ..> ContextLoader : bruker
    AiClient ..> CohereRerank : (via HybridRetrieval)
    ContextLoader ..> CanvasService : Canvas-kontekst
    ContextLoader ..> HybridRetrieval : KB-kontekst
    HybridRetrieval ..> PineconeService : vektorsøk
    HybridRetrieval ..> Bm25Service : nøkkelordsøk
    HybridRetrieval ..> CohereRerank : reranking
    IndexeringService ..> EmbeddingService : embeddings
    IndexeringService ..> PineconeService : upsert
    CanvasService ..> KrypteringUtil : token-dekryptering
    RequireAuth ..> KrypteringUtil : Canvas-token
    KontoSlett ..> ClerkDeletionQueue : enqueue
    KontoSlett ..> PineconeCleanupQueue : enqueue
    PineconeCleanupQueue ..> PineconeService : namespace-slett
```

## Klasse-/modulbeskrivelser

| Klasse | Fil | Hovedansvar |
|--------|-----|-------------|
| `AiClient` | `backend/src/rutere/ki/aiClient.ts` | Kall Claude via Vercel AI SDK, parse `<svarkilde>`-tag |
| `ContextLoader` | `backend/src/services/context-loader.service.ts` | Sammenstille Canvas + KB-kontekst |
| `HybridRetrieval` | `backend/src/services/hybrid-retrieval.service.ts` | Kjøre vektor + BM25 + rerank |
| `CohereRerank` | `backend/src/services/cohere-rerank.service.ts` | Cohere rerank-v3.5 |
| `PineconeService` | `backend/src/services/pinecone.service.ts` | Pinecone upsert/query/slett |
| `Bm25Service` | `backend/src/services/bm25.service.ts` | BM25-søk mot `KBContentChunk` |
| `EmbeddingService` | `backend/src/services/embedding.service.ts` | Embeddings via Anthropic |
| `CanvasService` | `backend/src/rutere/canvas/canvasService.ts` | Canvas REST API + Redis-cache |
| `IndexeringService` | `backend/src/services/kunnskapsbase-indeksering.service.ts` | Tekstutvinning + chunking + PII-sanitize |
| `KrypteringUtil` | `backend/src/utils/kryptering.ts` | AES-256-GCM kryptering |
| `RequireAuth` | `backend/src/middleware/auth.ts` | Clerk Bearer-verifisering |
| `KontoSlett` | `backend/src/rutere/auth/kontoSlett.ts` | Soft-delete + jobb-enqueue |
| `ClerkDeletionQueue` | `backend/src/queues/clerkDeletion.queue.ts` | BullMQ-prosessor |
| `PineconeCleanupQueue` | `backend/src/queues/pineconeCleanup.queue.ts` | BullMQ-prosessor |

## Designmønstre brukt

| Mønster | Hvor | Hensikt |
|---------|------|---------|
| **Service Layer** | `services/` | Skille forretningslogikk fra ruter |
| **Adapter** | `aiClient`, `pinecone.service` | Innkapsle eksterne APIer |
| **Strategy** | `HybridRetrieval` | Bytte mellom vektor / BM25 / hybrid |
| **Queue (Producer/Consumer)** | BullMQ-køer | Asynkron prosessering med retry |
| **Middleware (Chain of Responsibility)** | Express middleware | Sikkerhetslag før handler |
| **Repository (light)** | Mongoose-modeller | Innkapslet datatilgang |
