# Milepæler og tidslinje (Gantt)

Prosjektets tidsplan vist som Gantt-diagram. Dekker hele bacheloroppgaveløpet fra oppstart i januar til innlevering og presentasjon i mai/juni 2026. Brukes i metodedelen av oppgaven for å dokumentere planlegging og fremdrift.

```mermaid
gantt
    title StudyWise — bacheloroppgave 2026
    dateFormat YYYY-MM-DD
    axisFormat %b
    excludes weekends

    section Oppstart
    Idéfase og avgrensning            :done, ide, 2026-01-13, 2026-01-27
    Prosjektskisse innlevert          :milestone, m1, 2026-01-27, 0d
    Forprosjektrapport                :done, fpr, 2026-01-27, 2026-02-10
    Milepæl 1 — godkjent forprosjekt  :milestone, m2, 2026-02-10, 0d

    section Planlegging
    Kravinnhenting + brukerhistorier  :done, krav, 2026-02-03, 2026-02-21
    Arkitekturvalg                    :done, ark, 2026-02-10, 2026-02-24
    Velg av tech stack                :done, tech, 2026-02-10, 2026-02-21

    section Utvikling — fase 1
    Monorepo-oppsett + CI             :done, repo, 2026-02-17, 2026-03-03
    Auth (Clerk + Turnstile)          :done, auth, 2026-02-24, 2026-03-10
    Canvas-integrasjon                :done, canvas, 2026-03-03, 2026-03-24
    Database-modeller                 :done, db, 2026-03-03, 2026-03-17
    Milepæl 2 — basisapp deployable   :milestone, m3, 2026-03-24, 0d

    section Utvikling — fase 2
    KI-chat (Claude + RAG)            :done, ki, 2026-03-17, 2026-04-07
    Kunnskapsbase + Pinecone          :done, kb, 2026-03-24, 2026-04-14
    Quiz, flashcards, oppgavenedbrytning :done, ki2, 2026-03-31, 2026-04-21
    Eksport + deling                  :done, exp, 2026-04-07, 2026-04-21

    section Kvalitet
    Sikkerhetslag + GDPR-flyt         :done, sec, 2026-03-24, 2026-04-21
    Test-suite + Playwright E2E       :done, test, 2026-03-17, 2026-04-28
    Auth-scenariomatrise              :done, mx, 2026-04-07, 2026-04-21
    Brukertesting                     :done, ut, 2026-04-21, 2026-04-28

    section Avslutning
    Skriving av rapport               :active, rap, 2026-04-14, 2026-05-19
    Diagrammer + dokumentasjon        :active, doc, 2026-04-21, 2026-05-12
    Polering + bugfix                 :pol, 2026-05-05, 2026-05-19
    Innlevering bacheloroppgave       :milestone, m4, 2026-05-19, 0d
    Milepæl 3 — sluttpresentasjon     :milestone, m5, 2026-06-02, 0d
```

## Milepæler

| # | Milepæl | Dato | Leveranse |
|---|---------|------|-----------|
| M1 | Prosjektskisse innlevert | 2026-01-27 | `Prosjektbeskrivelse_gruppe3.pdf` |
| M2 | Forprosjekt godkjent | 2026-02-10 | `BOP-Prosjektskisse-Gruppe3-1.pdf` |
| M3 | Basisapp deployable | 2026-03-24 | Auth + Canvas + dashboard live |
| M4 | Bacheloroppgave innlevert | 2026-05-19 | `BSc/BScThesis.pdf` + kildekode |
| M5 | Sluttpresentasjon | 2026-06-02 | `manus-milepael-3.md` |

## Metodikk

Prosjektet er gjennomført med **Kanban** som arbeidsmetodikk (ikke Scrum), drevet av to GitHub Projects-tavler:

- **Brukerhistorier** (#21) — 55 historier som beskriver "hva" og "hvorfor" fra studentens perspektiv
- **Tekniske issues** (#25) — 187 oppgaver som beskriver "hvordan" hver historie realiseres

Dette ga gruppa fleksibilitet til å jobbe med flere parallelle delsystemer uten faste sprintlengder, samtidig som tavlene ga sporbar dokumentasjon for vurdering.
