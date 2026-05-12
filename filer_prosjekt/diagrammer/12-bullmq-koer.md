# BullMQ unified queue

Tre logiske job-typer prosesseres av én Worker på én kø (`studywise-jobs`) for å redusere antall Redis-tilkoblinger fra 8 til 4 per instans. Diagrammet viser dispatcher-mønsteret og hvordan jobs migreres fra de gamle separate køene.

```mermaid
flowchart LR
    subgraph Producers["Producers"]
        KS["kontoSlett.ts<br/>(bruker-sletting)"]
        AUTH["middleware/auth.ts<br/>(Clerk cleanup)"]
        WP["webPush.service<br/>(varsler)"]
    end

    subgraph Old["Gamle køer (engangs-migrasjon)"]
        Q1["clerk-deletion"]
        Q2["pinecone-cleanup"]
        Q3["web-push"]
    end

    UQ[("Unified queue<br/>'studywise-jobs'<br/>Redis")]

    subgraph Worker["Worker (concurrency 10)"]
        DISP{"dispatcher<br/>switch(job.name)"}
        P1["processClerkDeletionJob"]
        P2["processPineconeCleanupJob"]
        P3["processWebPushJob"]
    end

    subgraph External["Eksterne effekter"]
        CLERK["Clerk<br/>users.deleteUser"]
        PINE["Pinecone<br/>delete by metadata filter"]
        PUSH["Web Push<br/>VAPID"]
    end

    KS -->|add 'clerk-deletion'| UQ
    KS -->|add 'pinecone-cleanup'| UQ
    AUTH -->|add 'clerk-deletion'| UQ
    WP -->|add 'web-push'| UQ

    Q1 -. migrateOldQueues .-> UQ
    Q2 -. migrateOldQueues .-> UQ
    Q3 -. migrateOldQueues .-> UQ

    UQ --> DISP
    DISP -->|clerk-deletion| P1 --> CLERK
    DISP -->|pinecone-cleanup| P2 --> PINE
    DISP -->|web-push| P3 --> PUSH

    P1 -. on failed .-> HF1["handleClerkDeletionFailure"]
    P2 -. on failed .-> HF2["handlePineconeCleanupFailure"]
    P3 -. on failed .-> HF3["handleWebPushFailure"]
```
