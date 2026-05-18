# Leseguide - supplerende prosjektmateriale

Denne mappen inneholder supplerende materiale til bacheloroppgaven om StudyWise. Innholdet består av dokumentasjon som enten er nevnt i rapporten eller forklarer prosjektets arbeid.

## Kort om StudyWise

StudyWise er en KI-basert studieassistent for høyere utdanning. Løsningen kobler seg til Canvas LMS via brukerens egen token, lar studenten bygge en privat kunnskapsbase, og bruker Claude, Pinecone og Cohere til å gi svar med faglig kontekst.

- Demo: <https://www.studwize.page>
- API-status: <https://api.studwize.page/health>
- Teknisk dokumentasjon: <https://26zl.github.io/StudyWise/>
- Stack: TypeScript, Next.js, Express, MongoDB, Redis, Pinecone, Anthropic Claude, Cohere, Clerk, Cloudflare, Vercel og Heroku.

Prosjektet er en bachelorprototype, ikke en offisiell tjeneste fra USN, Canvas/Instructure eller andre læresteder.

## Anbefalt leserekkefølge

| Steg | Dokument | Hvorfor lese det |
|---|---|---|
| 1 | [`diagrammer/00-oversikt.md`](diagrammer/00-oversikt.md) | Gir rask teknisk oversikt og peker videre til høyoppløselige PNG-diagrammer. |
| 2 | [`Prosjektbeskrivelse_gruppe3.pdf`](Prosjektbeskrivelse_gruppe3.pdf) | Viser opprinnelig prosjektbeskrivelse og avgrensning. |
| 3 | [`BOP-Prosjektskisse-Gruppe3-1.pdf`](BOP-Prosjektskisse-Gruppe3-1.pdf) | Viser tidlig prosjektskisse, risiko og plan. |
| 4 | [`brukertest-skjema.md`](brukertest-skjema.md) | Dokumenterer brukertestopplegg og SUS-spørsmål. |
| 5 | [`kanban-brukerhistorier.txt`](kanban-brukerhistorier.txt) | Viser brukerhistorier og funksjonell prioritering. |
| 6 | [`teknisk-kanban-issues.txt`](teknisk-kanban-issues.txt) | Viser teknisk arbeidsomfang og nedbrytning av implementasjonen. |
| 7 | [`pentest-studwize.md`](pentest-studwize.md) | Full pentestrapport med funn og mitigeringer. |

## Hva ligger hvor?

### Prosjektstyring og krav

- [`Prosjektbeskrivelse_gruppe3.pdf`](Prosjektbeskrivelse_gruppe3.pdf) - formell prosjektbeskrivelse.
- [`BOP-Prosjektskisse-Gruppe3-1.pdf`](BOP-Prosjektskisse-Gruppe3-1.pdf) - tidlig prosjektskisse.
- [`kanban-brukerhistorier.txt`](kanban-brukerhistorier.txt) - 55 brukerhistorier fra GitHub Projects.
- [`teknisk-kanban-issues.txt`](teknisk-kanban-issues.txt) - 187 tekniske issues, gruppert etter delsystem.

### Brukertesting

- [`brukertest-skjema.md`](brukertest-skjema.md) - strukturert brukertestskjema.
- [`brukertest-skjema-bygg.gs`](brukertest-skjema-bygg.gs) - Google Apps Script som kan bygge skjemaet.
- [`StudyWise - Brukertest - Google Skjemaer.pdf`](<StudyWise – Brukertest - Google Skjemaer.pdf>) - eksport fra Google Forms.
- [`rapport-figurer/kilder/brukertest-resultater-fra-pdf.md`](rapport-figurer/kilder/brukertest-resultater-fra-pdf.md) - SUS/NPS-tall og kvalitative hovedfunn fra brukertesten.

### Teknisk dokumentasjon og diagrammer

- [`diagrammer/`](diagrammer/) - Mermaid-kilder og høyoppløselige PNG-eksporter for 21 tekniske diagrammer.
- [`diagrammer/00-oversikt.md`](diagrammer/00-oversikt.md) - samlet diagramoversikt med anbefalt leserekkefølge.
- [`rapport-figurer/hovedrapport/`](rapport-figurer/hovedrapport/) - PNG-kopier brukt som figurer i hovedrapporten.
- [`rapport-figurer/vedlegg/`](rapport-figurer/vedlegg/) - figurer og diagramkatalog brukt i vedlegg:
  - `vedlegg-d-gantt-skjema.png`
  - `vedlegg-e-arkitekturdiagram.png`
  - `vedlegg-f-use-case-diagram.png`
  - `vedlegg-g-teknisk-diagramkatalog.md`

### Sikkerhet og personvern

- [`pentest-studwize.md`](pentest-studwize.md) - full pentestrapport.
- [`../compliance/`](../compliance/) - personvern- og sikkerhetsdokumentasjon, blant annet PIA, STRIDE-trusselmodell, datalagring, tilgangsstyring og hendelseshåndtering.

## Hovedtema og dokumentasjon

| Tema | Dokumentasjon |
|---|---|
| Arkitektur | `diagrammer/01`, `02`, `04`, `06`, `08`, `10`, `11`, `12`, `21` |
| Sikkerhet/personvern | `pentest-studwize.md`, `diagrammer/03`, `08`, `09`, `11`, `20`, `../compliance/` |
| Brukersentrert utvikling | `brukertest-skjema.md`, Google Forms-PDF, `brukertest-resultater-fra-pdf.md` |
| Prosjektmetodikk | Prosjektbeskrivelse, prosjektskisse, brukerhistorier og tekniske kanban-issues |
| Rapportfigurer | `rapport-figurer/hovedrapport/` og `rapport-figurer/vedlegg/` |

## Notat til sensor

Full kodebase ligger i repositoryet. Denne mappen er ment som en rask inngang til prosjektartefaktene som støtter rapporten.
