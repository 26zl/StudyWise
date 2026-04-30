# Brukerreise — student fra registrering til bruk

Viser den typiske reisen en student går gjennom fra de første gangen de hører om StudyWise til de bruker appen i en hverdagssituasjon. Diagrammet er nyttig i UX-delen av bacheloroppgaven for å vise hvordan løsningen er tenkt brukt og hvor de viktigste friksjonspunktene ligger.

```mermaid
journey
    title Brukerreise — student bruker StudyWise gjennom semesteret
    section Oppdage
      Hører om appen fra medstudent: 4: Student
      Besøker studwize.page: 5: Student
      Leser om funksjonalitet: 5: Student
    section Onboarde
      Registrerer konto via Clerk: 4: Student
      Verifiserer e-post: 3: Student
      Aksepterer vilkår og personvern: 5: Student
      Henter Canvas API-token: 2: Student
      Limer inn token i appen: 4: Student
    section Utforske
      Ser dashboard med emner: 5: Student
      Åpner ukeplan og frister: 5: Student
      Stiller første KI-spørsmål: 5: Student
      Ser kildebadge på svaret: 4: Student
    section Bruke daglig
      Laster opp PDF til kunnskapsbase: 4: Student
      Genererer quiz fra pensum: 5: Student
      Tar quiz og ser statistikk: 5: Student
      Lager flashcards: 4: Student
      Ber om oppgavenedbrytning: 5: Student
    section Dele og eksportere
      Eksporterer notater til Notion: 4: Student
      Deler samtale med medstudent: 5: Student
    section Avslutte
      Sletter en samtale: 5: Student
      Sletter hele kontoen ved studieslutt: 3: Student
```

## Friksjonspunkter avdekket i brukertest

Brukertesten (se `brukertest-skjema.md`) kartla disse smertepunktene, som er adressert i sluttproduktet:

| Steg | Friksjon | Tiltak |
|------|----------|--------|
| Hente Canvas-token | Studenten må navigere i Canvas-innstillinger | Veiledning med skjermbilder per institusjon, lenkesnarvei, validering før lagring |
| Vente på første sync | Følte seg "henger" | Streaming-progress, "kommer i gang"-empty state, bakgrunns-sync |
| Forstå KI-svarets kilde | Tvil om svaret kom fra eget pensum | `<svarkilde>`-badge: kursmateriale / canvas / kunnskapsbase / blandet / generell |
| Slette konto | Bekymring for at data blir liggende | Eksplisitt step-up auth, bekreftelsesmodal, audit-logg, soft-delete + hard-delete-jobber |
