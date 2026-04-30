# GDPR — datalivssyklus og lagringstid

Visuell oppsummering av retention-reglene i `compliance/DATA_RETENTION.md`. Diagrammet viser livsløpet til persondata fra innsamling til sletting eller anonymisering, og hvilke automatiske mekanismer som håndhever lagringsbegrensningen (GDPR Art. 5(1)(e)).

```mermaid
flowchart LR
    subgraph Innsamling
        I1["Bruker registrerer<br/>seg via Clerk"]
        I2["Bruker limer inn<br/>Canvas API-token"]
        I3["Bruker chatter<br/>med KI"]
        I4["Bruker laster opp<br/>til kunnskapsbasen"]
    end

    subgraph Lagring["Lagring m/ tiltak"]
        L1["Clerk + Mongo<br/>(konto)"]
        L2["Mongo<br/>AES-256-GCM<br/>(canvas-token)"]
        L3["Mongo<br/>AES-256-GCM blob<br/>(chat-historikk)"]
        L4["Mongo + Pinecone<br/>(KB + embeddings)"]
        L5["Redis<br/>TTL 30s–2t<br/>(cache)"]
        L6["Mongo TTL-index<br/>24 mnd<br/>(audit)"]
        L7["Mongo TTL<br/>30 dager<br/>(delte samtaler)"]
        L8["Mongo TTL<br/>90 dager<br/>(tombstones)"]
    end

    subgraph Slett["Sletting / anonymisering"]
        S1["Bruker initierer<br/>kontosletting"]
        S2["BullMQ:<br/>clerkDeletion-job"]
        S3["BullMQ:<br/>pineconeCleanup-job"]
        S4["AuditLog<br/>pseudonymisert"]
        S5["Automatisk via<br/>TTL-indeks / Redis"]
        S6["Tombstone holdes<br/>90 dager (OAuth-konflikt)"]
    end

    I1 --> L1
    I2 --> L2
    I3 --> L3
    I4 --> L4

    L5 --> S5
    L6 --> S5
    L7 --> S5
    L8 --> S5

    S1 --> L1
    S1 --> L2
    S1 --> L3
    S1 --> L4
    S1 --> S2
    S1 --> S3
    S1 --> S4
    S1 --> S6

    S2 --> Clerk[("Clerk<br/>deleted")]
    S3 --> Pine[("Pinecone<br/>namespace slettet")]

    classDef collect fill:#bfdbfe,stroke:#1e3a8a,color:#1f2937
    classDef store fill:#fde68a,stroke:#92400e,color:#1f2937
    classDef del fill:#fecaca,stroke:#991b1b,color:#1f2937
    classDef ext fill:#ddd6fe,stroke:#5b21b6,color:#1f2937
    class I1,I2,I3,I4 collect
    class L1,L2,L3,L4,L5,L6,L7,L8 store
    class S1,S2,S3,S4,S5,S6 del
    class Clerk,Pine ext
```

## Retention-tabell (forenklet)

| Datatype | Hvor | Levetid | Sletting |
|----------|------|---------|----------|
| Konto (e-post, navn) | Clerk + Mongo | Til kontosletting | Bruker-initiert |
| Canvas API-token | Mongo (AES-256-GCM) | Til bruker fjerner | Manuelt eller v/ kontosletting |
| Chat-historikk | Mongo (AES-256-GCM) | Til bruker sletter | Per samtale eller alt |
| Kunnskapsbase | Mongo + Pinecone | Til bruker sletter | Kaskade via BullMQ |
| Canvas-cache | Redis | 2 timer (sync) | Automatisk TTL |
| Audit-logger | Mongo TTL | 24 måneder | TTL + anonymisering |
| Delte samtaler | Mongo TTL | 30 dager | Automatisk TTL |
| Tombstone (OAuth) | Mongo TTL | 90 dager | Automatisk TTL |
| Sesjonstokens | Clerk | Per Clerk-config | Logout/utløp |

## GDPR-rettigheter dekket

| Rett | Implementasjon |
|------|----------------|
| **Art. 15 — Innsyn** | Kontoeksport til Notion/Word/PDF |
| **Art. 16 — Korreksjon** | Bruker kan oppdatere konto via Clerk + appen |
| **Art. 17 — Sletting** | Soft-delete + BullMQ-jobber + tombstone (se diagram 9) |
| **Art. 20 — Dataportabilitet** | KI-eksport til standardformater |
| **Art. 33 — Varsling** | INCIDENT_RESPONSE.md (72-timers varsling) |
| **Art. 35 — DPIA** | Dokumentert i PIA.md |
