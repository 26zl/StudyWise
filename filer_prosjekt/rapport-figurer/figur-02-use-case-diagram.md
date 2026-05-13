# Figur 2 - Use case-diagram for StudyWise

Forenklet use case-diagram til hovedteksten i kapittel 3.2.4. Den fullstendige varianten ligger som `vedlegg-k-use-case-diagram.png`.

```mermaid
flowchart LR
    Student((Student))
    Admin((Admin))

    subgraph StudyWise["StudyWise"]
        UC1["Logg inn"]
        UC2["Koble til Canvas"]
        UC3["Chat med KI"]
        UC4["Generer quiz"]
        UC5["Generer flashcards"]
        UC6["Last opp dokument"]
        UC7["Lag ukeplan"]
        UC8["Eksporter samtale"]
        UC9["Del samtale"]
        UC10["Slett konto"]
        UC11["Se brukerstatistikk"]
        UC12["Publiser systemmelding"]
        UC13["Inspisere BullMQ-kø"]
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

    Admin --> UC11
    Admin --> UC12
    Admin --> UC13

    classDef actor fill:#fde68a,stroke:#92400e,color:#1f2937
    classDef usecase fill:#dbeafe,stroke:#1d4ed8,color:#1f2937
    class Student,Admin actor
    class UC1,UC2,UC3,UC4,UC5,UC6,UC7,UC8,UC9,UC10,UC11,UC12,UC13 usecase
```

Bildetekst: Figur 2: Use case-diagram for StudyWise.
