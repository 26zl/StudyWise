---
layout: home

hero:
  name: "StudyWise"
  text: "KI-basert studieassistent"
  tagline: Smidigere studiedag med Canvas-integrasjon og kunstig intelligens
  actions:
    - theme: brand
      text: Endringslogg
      link: /changelog

features:
  - title: Canvas LMS-integrasjon
    details: Henter emner, oppgaver, frister, moduler og ressurser direkte fra Canvas ved ditt lærested. Alt samlet i ett dashboard.
  - title: KI-studieassistent
    details: Still spørsmål om pensum, last opp PDF-er og bilder for analyse, og få smarte oppfølgingsforslag basert på kontekst.
  - title: Kalender og frister
    details: Kombinert kalendervisning med Canvas-frister og oppgaver, filtrert per semester og emne.
  - title: Sikkerhet og personvern
    details: Ende-til-ende-kryptering av chat-historikk (AES-256-GCM), JWT-autentisering, rate-limiting og GDPR-bevisst dataflyt.
---

# Om prosjektet

**StudyWise** er en KI-basert studieassistent utviklet som bacheloroppgave i IT ved Universitetet i Sørøst-Norge (USN), 2026. Målet med prosjektet er å gi studenter ett samlet verktøy som kobler sammen læringsplattformen Canvas med kunstig intelligens, slik at studenter kan jobbe smartere og mer effektivt med studiene sine.

Prosjektet kombinerer datainnhenting fra Canvas LMS med KI-drevet analyse og interaksjon, alt tilgjengelig gjennom et moderne og responsivt dashboard. Studenter kan blant annet få oversikt over emner og frister, stille spørsmål til en KI-assistent, og analysere dokumenter - uten å måtte veksle mellom flere verktøy.

::: warning Prosjektet er under aktiv utvikling
StudyWise er et pågående bachelorprosjekt og er i konstant endring. Funksjonalitet, design og tekniske løsninger kan endres underveis. Ta forbehold om at det som beskrives her kan avvike fra nåværende tilstand.
:::

## Teknologi

| Lag | Teknologi |
| --- | --------- |
| **Frontend** | Next.js 16, React 19, TypeScript, Tailwind CSS v4 |
| **Backend** | Express 5, Node.js 20+, TypeScript, Mongoose/MongoDB |
| **KI** | Anthropic Claude API |
| **Cache** | Redis Cloud |
| **Monorepo** | pnpm workspaces med `frontend`, `backend`, `common` |
| **CI/CD** | GitHub Actions, Docker, Heroku (backend), Vercel (frontend), Cloudflare |
| **Dokumentasjon** | VitePress (denne siden) |

## Teamet

| Medlem | GitHub | Rolle |
| ------ | ------ | ----- |
| **Laurent Zogaj** | [26zl](https://github.com/26zl) | Prosjektleder / Fullstack / Canvas-integrasjon / Arkitekt |
| **Abdinasir** | [Abdinasir909](https://github.com/Abdinasir909) | Fullstack / KI-integrasjon og tjenester / UI/UX |
| **Anwar** | [Hersino](https://github.com/Hersino) | Fullstack / KI-integrasjon og tjenester / UI/UX |
| **Ylli Ujkani** | [yujk7](https://github.com/yujk7) | Dokumentasjon / Bidrar med kode |
