# Database-modeller (MongoDB / Mongoose)

Forenklet ER-diagram over de viktigste collection-ene. `User` er navet, og de fleste andre dokumenter har `userId` som referanse. Soft-delete styres via `DeletedUserTombstone`. Audit-logging og chat-tilbakemelding er separate collections.

```mermaid
erDiagram
    User ||--o| CanvasUser : "1:1 via clerkId"
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
    User ||--o| DeletedUserTombstone : "soft-delete"
    AuditLog }o..|| User : "om bruker (pseudonymisert ved sletting)"
    SystemAnnouncement }o..o{ User : "vist til"
    ContactMessage }o..o{ User : "valgfri ref"

    User {
        string clerkId PK
        string email
        string canvasToken_enc "AES-256-GCM"
        string role "user | admin"
        date createdAt
    }
    CanvasUser {
        string userRef FK
        string canvasUserId
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
        string chunkText
        string source
    }
    DeletedUserTombstone {
        string clerkId
        string status "pending|done"
        date deletedAt
    }
    AuditLog {
        string actorId
        string action
        json metadata
    }
```
