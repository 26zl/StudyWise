# Bruker-sletting (soft-delete + BullMQ)

Sletting går aldri direkte mot `User`. I stedet markeres en `DeletedUserTombstone`, og to BullMQ-jobber (i den unified køen) rydder opp asynkront i Clerk og Pinecone. AuditLog beholdes, men pseudonymiseres.

```mermaid
flowchart TB
    U["Bruker velger 'slett konto'"]
    FE["Frontend bekrefter<br/>(step-up auth)"]
    KS["DELETE /api/user/account<br/>(kontoSlett.ts)"]
    TOMB["DeletedUserTombstone<br/>status=pending"]
    SOFT["Soft-delete:<br/>User markert deletedAt"]
    QUEUE[("BullMQ unified queue<br/>'studywise-jobs'")]

    subgraph Workers["Worker (concurrency 10)"]
        CLER["clerkDeletion.queue<br/>kall Clerk API"]
        PINE["pineconeCleanup.queue<br/>slett namespace"]
    end

    CLERKAPI["Clerk SDK<br/>users.deleteUser"]
    PINEAPI["Pinecone<br/>namespace delete"]

    AUD["AuditLog<br/>(pseudonymiseres)"]
    DONE["Tombstone status=done"]

    U --> FE --> KS
    KS --> TOMB
    KS --> SOFT
    KS --> QUEUE
    KS --> AUD

    QUEUE --> CLER
    QUEUE --> PINE
    CLER --> CLERKAPI
    PINE --> PINEAPI

    CLERKAPI --> DONE
    PINEAPI --> DONE

    classDef bad fill:#fecaca,stroke:#991b1b,color:#1f2937
    classDef ok fill:#bbf7d0,stroke:#166534,color:#1f2937
    class TOMB,SOFT,AUD bad
    class DONE ok
```
