# STRIDE-trusselmodell

Visuell oppsummering av STRIDE-trusselmodellen som er detaljert i `compliance/THREAT_MODEL.md`. STRIDE er et industristandard rammeverk fra Microsoft for å klassifisere sikkerhetstrusler. Hver bokstav representerer én kategori; diagrammet viser de viktigste truslene mot StudyWise og hvilke tiltak som adresserer hver.

```mermaid
flowchart TB
    subgraph S["S — Spoofing<br/>(identitetsforfalskning)"]
        S1["Stjålne credentials"]
        S2["CSRF / forfalsket request"]
        S3["Falsk Clerk-webhook"]
        S4["OAuth-konto-overtakelse"]
        SM["→ Clerk + 2FA + Turnstile<br/>Origin-validering<br/>Webhook-signatur (Svix)<br/>Tombstone 90 dager"]:::mit
    end

    subgraph T["T — Tampering<br/>(endring av data)"]
        T1["NoSQL injection"]
        T2["Bypass av vilkår"]
        T3["Polyglot-filer / zip-bombe"]
        T4["XSS i systemmelding"]
        TM["→ Mongoose + Zod<br/>requireAcceptedTerms<br/>Magic-byte + filtype<br/>React auto-escape"]:::mit
    end

    subgraph R["R — Repudiation<br/>(fornektelse)"]
        R1["'Jeg godtok aldri vilkårene'"]
        R2["Admin fornekter handling"]
        R3["Sletting angres"]
        RM["→ TERMS_ACCEPTED-audit<br/>AuditLog for alle admin-ops<br/>Step-up auth + bekreftelse"]:::mit
    end

    subgraph I["I — Information Disclosure<br/>(datalekkasje)"]
        I1["PII til tredjepart (Pinecone)"]
        I2["Token-lekkasje i logg"]
        I3["Cross-user data-lekkasje"]
        I4["Hemmeligheter i git"]
        IM["→ PII-sanitize regex<br/>Pino strukturert (aldri token)<br/>Pinecone namespace=userId<br/>TruffleHog i CI"]:::mit
    end

    subgraph D["D — Denial of Service<br/>(tjenestenekt)"]
        D1["KI-API-spam"]
        D2["Stort opplastet innhold"]
        D3["Slow-loris / open conn"]
        D4["Heroku H15 timeout"]
        DM["→ rate-limit per bruker<br/>express.json 10mb-grense<br/>requestTimeout-middleware<br/>SSE bypass av compression"]:::mit
    end

    subgraph E["E — Elevation of Privilege<br/>(rettighetseskalering)"]
        E1["Bruker oppnår admin-tilgang"]
        E2["Bypass av requireAuth"]
        E3["Path traversal i opplasting"]
        E4["Server-Side Request Forgery"]
        EM["→ requireRole('admin')<br/>Middleware-rekkefølge fast<br/>Sti-normalisering<br/>SSRF-guard på URL-input"]:::mit
    end

    classDef threat fill:#fecaca,stroke:#991b1b,color:#1f2937
    classDef mit fill:#bbf7d0,stroke:#166534,color:#1f2937
    class S1,S2,S3,S4,T1,T2,T3,T4,R1,R2,R3,I1,I2,I3,I4,D1,D2,D3,D4,E1,E2,E3,E4 threat
```

## Tilknyttet dokumentasjon

| Dokument | Innhold |
|----------|---------|
| [`compliance/THREAT_MODEL.md`](../../compliance/THREAT_MODEL.md) | Full STRIDE-tabell med vektorer og tiltak |
| [`compliance/PIA.md`](../../compliance/PIA.md) | Privacy Impact Assessment (GDPR Art. 35) |
| [`compliance/INCIDENT_RESPONSE.md`](../../compliance/INCIDENT_RESPONSE.md) | Hendelseshåndtering og varsling |
| Diagram 11 — sikkerhetslag | 15 lag forsvar i dybden |
| Diagram 09 — bruker-sletting | GDPR-implementasjon |
