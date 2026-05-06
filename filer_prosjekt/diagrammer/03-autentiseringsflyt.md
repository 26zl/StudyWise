# Autentiseringsflyt (Clerk + Turnstile)

Sekvensdiagram for innlogging og påfølgende API-kall. Clerk håndterer identitet; Cloudflare Turnstile beskytter sensitive flyter; Cloudflare-edge ligger foran API-et; backend verifiserer Clerk-token og synker brukeren til lokal `User`-modell. Webhook fra Clerk leveres med rå body før JSON-parser.

```mermaid
sequenceDiagram
    autonumber
    actor U as Bruker
    participant FE as Frontend (Next.js)
    participant CF as Cloudflare edge
    participant CL as Clerk
    participant TS as Turnstile
    participant BE as Backend (Express)
    participant DB as MongoDB

    U->>FE: Åpner /auth/sign-in
    FE->>TS: Vis widget (sensitive flyt)
    U->>TS: Løser challenge
    TS-->>FE: Turnstile-token
    FE->>CF: POST /api/auth-turnstile/verify
    CF->>BE: Forward via api.studwize.page
    BE->>TS: Server-side verify
    TS-->>BE: ok
    BE-->>CF: Set HttpOnly Turnstile-cookie
    CF-->>FE: 200 verified
    FE->>CF: GET /api/auth-turnstile/gate
    CF->>BE: Valider Turnstile-cookie
    BE-->>FE: 200 verified
    FE->>CL: Sign-in / sign-up
    CL-->>FE: Session token (JWT)

    Note over CL,BE: Webhook til /api/clerk-webhook<br/>raw body FØR JSON-parser
    CL->>CF: user.created / user.updated (signert)
    CF->>BE: Forward webhook
    BE->>BE: Verifiser Svix-signatur
    BE->>DB: Upsert User (clerkId)

    U->>FE: Bruker app
    FE->>CF: GET /api/canvas/kurs<br/>Authorization: Bearer <token>
    CF->>BE: Forward via api.studwize.page
    BE->>BE: requireAuth -> Clerk SDK verifiser
    BE->>DB: Slå opp User via clerkId
    BE-->>FE: 200 JSON
```
