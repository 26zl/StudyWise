# Bruker-sletting (hard delete + tombstone + retry-kø)

Kontosletting går gjennom `kontoSlett.ts`, ikke direkte mot `User`. Backend kjører en MongoDB-transaksjon som oppretter en minimal `DeletedUserTombstone` (90 dagers TTL) og hard-sletter `User` samt brukerens tilknyttede data. Pinecone- og Clerk-sletting forsøkes synkront etter transaksjonen; BullMQ brukes som retry-mekanisme hvis en ekstern sletting feiler.

```mermaid
flowchart TB
    U["Bruker velger 'slett konto'"]
    FE["Frontend bekrefter<br/>(step-up auth)"]
    KS["DELETE /api/user/account<br/>(kontoSlett.ts)"]
    TX["MongoDB transaction"]
    TOMB["DeletedUserTombstone<br/>minimal state + 90d TTL"]
    DATA["Hard delete brukerdata<br/>Chat, Canvas, KB, push,<br/>ActivityLog, StudyContext"]
    USER["Hard delete User"]
    PINE_SYNC["Pinecone cleanup<br/>delete by userId/base filter"]
    CLERK_SYNC["Clerk cleanup<br/>users.deleteUser"]
    QUEUE[("BullMQ unified queue<br/>'studywise-jobs'")]

    subgraph Retry["Retry ved ekstern feil"]
        CLER["clerkDeletion.queue<br/>retry Clerk API"]
        PINE["pineconeCleanup.queue<br/>retry vector delete"]
    end

    CLERKAPI["Clerk SDK<br/>users.deleteUser"]
    PINEAPI["Pinecone<br/>metadata-filter delete"]
    DONE["Sletting fullført<br/>idempotent ved gjentatt kall"]

    U --> FE --> KS
    KS --> TX
    TX --> TOMB
    TX --> DATA
    TX --> USER
    KS --> PINE_SYNC --> PINEAPI
    KS --> CLERK_SYNC --> CLERKAPI

    PINE_SYNC -.feil.-> QUEUE
    CLERK_SYNC -.feil.-> QUEUE
    QUEUE --> CLER
    QUEUE --> PINE
    CLER --> CLERKAPI
    PINE --> PINEAPI

    USER --> DONE
    CLERKAPI --> DONE
    PINEAPI --> DONE

    classDef bad fill:#fecaca,stroke:#991b1b,color:#1f2937
    classDef ok fill:#bbf7d0,stroke:#166534,color:#1f2937
    class DATA,USER,PINE_SYNC,CLERK_SYNC bad
    class TOMB,DONE ok
```
