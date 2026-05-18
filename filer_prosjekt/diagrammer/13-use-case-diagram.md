# Use case-diagram

UML-style use case-diagram som viser de viktigste aktørene og hvilke funksjoner de kan utløse i StudyWise. Diagrammet svarer på spørsmålet "hva kan brukeren gjøre med systemet?", og er nyttig for å avgrense omfanget av løsningen i innledningen til bacheloroppgaven.

```mermaid
flowchart LR
    Student((Student))
    Admin((Administrator))
    System((Vedlikeholdsjobb<br/>BullMQ/cron))
    Canvas((Canvas LMS))
    Clerk((Clerk))
    Pinecone((Pinecone))

    subgraph StudyWise["Use cases — StudyWise"]
        UC1["Registrere konto<br/>+ akseptere vilkår"]
        UC2["Koble til Canvas<br/>med API-token"]
        UC3["Se emner, frister<br/>og oppgaver"]
        UC4["Stille spørsmål til KI<br/>med kurskontekst"]
        UC5["Bygge kunnskapsbase<br/>(PDF, lenker)"]
        UC6["Generere quiz<br/>og flashcards"]
        UC7["Be om oppgavenedbrytning<br/>og ukeplan"]
        UC8["Eksportere innhold<br/>(PDF/Word/Notion)"]
        UC9["Dele samtale<br/>via lenke (TTL)"]
        UC10["Gi tilbakemelding<br/>(tommel opp/ned)"]
        UC11["Slette egen konto<br/>(GDPR Art. 17)"]
        UC12["Se audit-logger"]
        UC13["Administrere brukere"]
        UC14["Inspisere BullMQ-køer"]
        UC15["Retry ekstern sletting<br/>(Clerk/Pinecone)"]
        UC16["Sende web-push<br/>varsler"]
        UC17["Rydde utløpte<br/>delte samtaler"]
    end

    Student --> UC1
    Student --> UC2
    Student --> UC3
    Student --> UC4
    Student --> UC5
    Student --> UC6
    Student --> UC7
    Student --> UC8
    Student --> UC9
    Student --> UC10
    Student --> UC11

    Admin --> UC12
    Admin --> UC13
    Admin --> UC14

    System --> UC15
    System --> UC16
    System --> UC17

    UC2 -. include .-> Canvas
    UC3 -. include .-> Canvas
    UC15 -. include .-> Clerk
    UC15 -. include .-> Pinecone
    UC1 -. include .-> Clerk
    UC11 -. include .-> Clerk

    classDef actor fill:#fde68a,stroke:#92400e,color:#1f2937
    classDef ext fill:#fecaca,stroke:#991b1b,color:#1f2937
    class Student,Admin,System actor
    class Canvas,Clerk,Pinecone ext
```

## Aktører

| Aktør | Beskrivelse |
|-------|-------------|
| **Student** | Primærbruker. Logger inn med Clerk, kobler til Canvas og bruker KI-funksjonene. |
| **Administrator** | Forhøyet rolle for drift og vedlikehold. Egen `/admin`-flate beskyttet av `requireRole("admin")`. |
| **Vedlikeholdsjobb** | Automatiske bakgrunnsprosesser (BullMQ-workers, intervall-pollere). Ingen menneskelig aktør. |
| **Canvas LMS** | Ekstern aktør som leverer kursdata via REST API. |
| **Clerk** | Ekstern aktør for autentisering, sender også webhooks for bruker-livssyklus. |
| **Pinecone** | Ekstern vektortjeneste som brukes ved søk og opprydding av brukerdata. |
