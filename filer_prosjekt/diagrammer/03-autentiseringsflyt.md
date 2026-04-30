# Autentiseringsflyt (Clerk + Turnstile)

Sekvensdiagram for innlogging og påfølgende API-kall. Clerk håndterer identitet; Cloudflare Turnstile beskytter sensitive flyter; backend verifiserer token og synker brukeren til lokal `User`-modell. Webhook fra Clerk leveres med rå body før JSON-parser.

```mermaid
sequenceDiagram
    autonumber
    actor U as Bruker
    participant FE as Frontend (Next.js)
    participant CL as Clerk
    participant TS as Turnstile
    participant BE as Backend (Express)
    participant DB as MongoDB

    U->>FE: Åpner /auth/sign-in
    FE->>TS: Vis widget (sensitive flyt)
    U->>TS: Løser challenge
    TS-->>FE: Turnstile-token
    FE->>CL: Sign-in (med Turnstile-token)
    CL->>BE: POST /api/auth-turnstile (verifiser)
    BE->>TS: Server-side verify
    TS-->>BE: ok
    BE-->>CL: 200
    CL-->>FE: Session token (JWT)

    Note over CL,BE: Webhook til /api/clerk-webhook<br/>raw body FØR JSON-parser
    CL->>BE: user.created / user.updated (signert)
    BE->>BE: Verifiser Svix-signatur
    BE->>DB: Upsert User (clerkId)

    U->>FE: Bruker app
    FE->>BE: GET /api/canvas/kurs<br/>Authorization: Bearer <token>
    BE->>BE: requireAuth -> Clerk SDK verifiser
    BE->>DB: Slå opp User via clerkId
    BE-->>FE: 200 JSON
```
