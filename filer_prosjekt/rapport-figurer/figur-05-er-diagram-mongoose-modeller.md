# Database-modeller (MongoDB / Mongoose)

Forenklet ER-diagram over de viktigste collection-ene. `User` er navet, og de fleste andre dokumenter har `userId` som referanse. Ved kontosletting hard-slettes `User` og tilknyttede brukerdata, mens `DeletedUserTombstone` beholder minimal konflikt-/idempotency-state med 90 dagers TTL. Audit-logging og chat-tilbakemelding er separate collections.

```mermaid
erDiagram
    User ||--o| CanvasUser : "1:1 via localUser"
    User ||--o{ CanvasStructure : eier
    User ||--o{ ChatHistory : eier
    User ||--o{ Kunnskapsbase : eier
    User ||--o{ ContentEmbedding : eier
    User ||--o{ KBContentChunk : eier
    User ||--o{ LagretQuiz : eier
    User ||--o{ LagretFlashcardSett : eier
    User ||--o{ TaskBreakdown : eier
    User ||--o{ StudyContext : eier
    User ||--o{ ActivityLog : eier
    User ||--o{ FileExtractionStatus : eier
    User ||--o{ WebPushSubscription : eier
    User ||--o{ ArbeidsplanModel : eier
    ChatHistory ||--o{ ChatFeedback : "har"
    ChatHistory ||--o{ SharedChat : "kan deles"
    User ||--o| DeletedUserTombstone : "tombstone ved sletting"
    AuditLog }o..|| User : "actorUserId / targetUserId"
    SystemAnnouncement }o..|| User : "publishedBy (admin)"
    ContactMessage }o..|| User : "statusChangedBy (admin)"

    User {
        string clerkId PK
        string email
        string canvasApiToken "AES-256-GCM"
        string canvasBaseUrl
        string role "user | admin"
        date createdAt
    }
    CanvasUser {
        objectId localUser FK
        number canvasId
        string canvasBaseUrl
        string name
    }
    CanvasStructure {
        string userId FK
        string courseId
        json struktur "moduler/sider/oppgaver"
    }
    ChatHistory {
        string userId FK
        string courseId
        array messages
        string svarkilde
    }
    Kunnskapsbase {
        string userId FK
        string title
        string sourceType "pdf|docx|url|..."
    }
    ContentEmbedding {
        string userId FK
        string text
        string courseId
        number fileId
        number chunkIndex
    }
    DeletedUserTombstone {
        string originalUserId
        string clerkId
        array oauthAccounts
        string usernameNormalized
        date deletedAt
    }
    AuditLog {
        string actorUserId
        string targetUserId
        string action
        json metadata
    }
    SystemAnnouncement {
        string singletonKey
        bool active
        string severity
        string publishedBy
    }
    ContactMessage {
        string epost
        string status
        string statusChangedBy
        date createdAt
    }
```
