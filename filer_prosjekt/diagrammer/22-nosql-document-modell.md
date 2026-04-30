# NoSQL document-modell (MongoDB)

Mens diagram 7 viser en klassisk ER-stil for Mongoose-modellene, dokumenterer dette diagrammet hvordan dataene faktisk er strukturert i MongoDB — hvilke felter som er **embedded** (ligger inne i dokumentet), hvilke som er **referenced** (ObjectId-kobling), hvilke som er **kryptert blob**, og hvilke indekser som er kritiske for ytelse, GDPR-retention og sikkerhet.

NoSQL-dokumentmodellering er forskjellig fra relasjonell modellering: vi velger embed når dataene alltid leses sammen, og reference når de gjenbrukes eller endres uavhengig.

```mermaid
flowchart TB
    subgraph User["👤 User (collection)"]
        U_id["_id : ObjectId"]
        U_clerkId["clerkId : string [unique idx]"]
        U_email["email : string"]
        U_canvasToken["canvasToken : string<br/>🔒 AES-256-GCM"]
        U_role["role : 'user' | 'admin'"]
        U_terms["acceptedTerms : { version, ts, ip, ua }<br/>📦 EMBEDDED"]
        U_prefs["preferences : { theme, locale, notif... }<br/>📦 EMBEDDED"]
        U_deleted["deletedAt : Date | null<br/>(soft-delete)"]
    end

    subgraph ChatHistory["💬 ChatHistory (collection)"]
        C_id["_id : ObjectId"]
        C_userId["userId : ObjectId → User [idx]"]
        C_courseId["courseId : string"]
        C_blob["encryptedBlob : Buffer<br/>🔒 AES-256-GCM<br/>(messages array embedded)"]
        C_kilde["svarkilde : enum"]
        C_updated["updatedAt : Date [idx]"]
    end

    subgraph Kunnskapsbase["📚 Kunnskapsbase (collection)"]
        K_id["_id : ObjectId"]
        K_userId["userId : ObjectId → User [idx]"]
        K_title["title : string"]
        K_sourceType["sourceType : 'pdf'|'docx'|'url'|..."]
        K_meta["meta : { size, mime, ... }<br/>📦 EMBEDDED"]
    end

    subgraph KBContentChunk["📄 KBContentChunk (collection)"]
        KC_id["_id : ObjectId"]
        KC_userId["userId : ObjectId → User"]
        KC_kbId["kbId : ObjectId → Kunnskapsbase"]
        KC_text["chunkText : string<br/>🔍 TEXT INDEX (BM25)"]
        KC_pos["position : number"]
    end

    subgraph AuditLog["📝 AuditLog (collection) — TTL 24mnd"]
        A_id["_id : ObjectId"]
        A_actor["actorUserId : string<br/>(pseudonymisert v/ sletting)"]
        A_action["action : enum"]
        A_meta["metadata : object<br/>📦 EMBEDDED"]
        A_ts["timestamp : Date<br/>⏱️ TTL INDEX 63 072 000s"]
    end

    subgraph SharedChat["🔗 SharedChat (collection) — TTL 30d"]
        S_id["_id : ObjectId"]
        S_chatId["chatId : ObjectId → ChatHistory"]
        S_token["shareToken : string [unique]"]
        S_expires["expiresAt : Date<br/>⏱️ TTL INDEX"]
    end

    subgraph Tombstone["🪦 DeletedUserTombstone — TTL 90d"]
        T_id["_id : ObjectId"]
        T_clerkId["clerkId : string [unique]"]
        T_status["status : 'pending'|'done'"]
        T_ts["deletedAt : Date<br/>⏱️ TTL INDEX 7 776 000s"]
    end

    subgraph Pinecone["☁️ Pinecone (vektor-DB)"]
        P_ns["namespace = userId"]
        P_vec["vector : float[1024]"]
        P_metadata["metadata : { kbId, chunkId, ... }"]
    end

    subgraph Redis["🔴 Redis (cache + køer)"]
        R_canvas["canvas:<userId>:<resource><br/>TTL 2t"]
        R_rate["ratelimit:<key><br/>TTL 1m–1t"]
        R_bull["bull:studywise-jobs:*<br/>(BullMQ-jobber)"]
    end

    User -.->|userId ref| ChatHistory
    User -.->|userId ref| Kunnskapsbase
    Kunnskapsbase -.->|kbId ref| KBContentChunk
    ChatHistory -.->|chatId ref| SharedChat
    User -.->|actorUserId| AuditLog
    User -.->|clerkId| Tombstone
    KBContentChunk -.->|chunkId i metadata| Pinecone

    classDef coll fill:#bfdbfe,stroke:#1e3a8a,color:#1f2937
    classDef ttl fill:#fde68a,stroke:#92400e,color:#1f2937
    classDef ext fill:#ddd6fe,stroke:#5b21b6,color:#1f2937
    class User,ChatHistory,Kunnskapsbase,KBContentChunk coll
    class AuditLog,SharedChat,Tombstone ttl
    class Pinecone,Redis ext
```

## Modelleringsvalg

| Mønster | Hvor brukt | Hvorfor |
|---------|------------|---------|
| **Embedded subdocument** | `User.preferences`, `User.acceptedTerms`, `Kunnskapsbase.meta`, `AuditLog.metadata` | Leses alltid sammen med foreldredokumentet, små i størrelse, ikke gjenbrukt på tvers. |
| **Referenced (ObjectId)** | `userId` på de fleste collections | Brukerdata er nav; én bruker har mange chats/KB-er, og dokumentene kan leses uavhengig. |
| **Encrypted blob** | `User.canvasToken`, `ChatHistory.encryptedBlob` | Sensitive data skal være ulesbare uten `ENCRYPTION_KEY`, selv ved lekkasje fra DB-backup. |
| **TTL-indeks** | `AuditLog`, `SharedChat`, `DeletedUserTombstone` | GDPR-retention håndheves automatisk av MongoDB; ingen avhengighet av cron-jobber. |
| **Text-indeks** | `KBContentChunk.chunkText` | BM25-søk i hybrid retrieval — MongoDB håndterer det native. |
| **External vektor-DB** | Pinecone (med `namespace=userId`) | MongoDB støtter ikke ANN-søk på samme kvalitetsnivå; Pinecone er optimalisert for embeddings. |

## Kritiske indekser (auditerbare via `db.collection.getIndexes()`)

| Collection | Indeks | Type | Formål |
|------------|--------|------|--------|
| `User` | `{ clerkId: 1 }` | unique | Sync mot Clerk |
| `User` | `{ email: 1 }` | unique | Login-oppslag |
| `ChatHistory` | `{ userId: 1, updatedAt: -1 }` | compound | Liste samtaler i nyeste rekkefølge |
| `Kunnskapsbase` | `{ userId: 1 }` | secondary | Brukerens KB-oversikt |
| `KBContentChunk` | `{ chunkText: "text" }` | text | BM25-søk |
| `AuditLog` | `{ timestamp: 1 }` | TTL (24mnd) | Auto-sletting |
| `SharedChat` | `{ expiresAt: 1 }` | TTL (30d) | Auto-sletting |
| `DeletedUserTombstone` | `{ deletedAt: 1 }` | TTL (90d) | OAuth-konflikthåndtering |

## Hvorfor en egen NoSQL-modell — og ikke bare ER

ER-diagrammer fra relasjonell verden formidler ikke:

- **Hva som er kryptert** (sikkerhetslag) ⇒ vist med 🔒-merke
- **Hva som lever på TTL** (GDPR-retention) ⇒ vist med ⏱️-merke
- **Embedded vs referenced** (NoSQL-spesifikk avgjørelse) ⇒ vist med 📦-merke
- **Eksterne stores** (Pinecone, Redis) som er en del av datamodellen totalt sett

Dette diagrammet komplementerer derfor diagram 7 (ER) ved å vise den faktiske MongoDB-strukturen.
