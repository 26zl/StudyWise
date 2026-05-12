# Leseguide — bacheloroppgave gruppe 3 (USN, 2026)

Denne mappen (`filer_prosjekt/`) samler alt supplerende materiale til bacheloroppgaven, organisert slik at en utenforstående leser raskt skal kunne orientere seg uten å lese hele kodebasen først.

## Kort om prosjektet

**StudyWise** er en KI-basert studieassistent for høyere utdanning, integrert med Canvas LMS. Løsningen henter studentens kursdata fra Canvas, lar studenten bygge en privat kunnskapsbase av PDF-er og lenker, og bruker Anthropic Claude med RAG (Retrieval-Augmented Generation) til å gi svar som er forankret i studentens eget pensum.

I sensordokumentasjonen omtales `studwize.page` som en offentlig demo / produksjonslik deploy. Prosjektet er ikke en offisiell tjeneste fra USN, Canvas/Instructure eller andre læresteder.

- **Offentlig demo / produksjonslik deploy:** <https://www.studwize.page>
- **Teknologi:** TypeScript, Next.js 16, Express 5, MongoDB, Redis, Pinecone, Anthropic Claude, Cohere, Clerk
- **Kodebase:** monorepo (pnpm workspaces) med 130 000+ linjer TypeScript
- **Drift:** Vercel (frontend) + Heroku (backend) + Cloudflare (DNS/CDN/WAF/SSL/TLS/Worker)

## Arkitektur på ett minutt

StudyWise er delt i en klientdel, en API-del og flere eksterne datatjenester. Frontend kjører på Vercel, backend kjører på Heroku, og Cloudflare ligger foran de offentlige domenene som DNS-, CDN-, WAF- og TLS-lag. API-et eksponeres kun via `api.studwize.page`; backend avviser direkte origin-trafikk som ikke kommer gjennom Cloudflare.

```text
Bruker
  -> Cloudflare
  -> Vercel / Next.js frontend
  -> /api/* rewrite
  -> Cloudflare API-edge (api.studwize.page)
  -> Heroku / Express backend
  -> MongoDB, Redis, Pinecone, Canvas, Clerk og KI-tjenester
```

| Arkitekturvalg | Hvorfor det er valgt |
|----------------|----------------------|
| pnpm-monorepo med `common` | Deler Zod-skjemaer og TypeScript-typer mellom frontend, backend og tester, slik at API-kontrakter ikke driver fra hverandre. |
| Next.js på Vercel | Gir rask frontend-deploy, edge-nær statisk levering og enkel proxying av `/api/*` til backend. |
| Express på Heroku | Holder API, Canvas-integrasjon, kryptering, RAG-flyt og server-side sikkerhetskontroller samlet i ett autoritativt backend-lag. |
| Cloudflare foran domenene | Samler DNS, TLS, WAF, DDoS-beskyttelse, cache-regler og bot-beskyttelse før trafikken når Vercel eller Heroku. |
| Clerk for autentisering | Reduserer risiko i egen auth-implementasjon og gir støtte for SSO, sesjoner og webhook-basert brukersynk. |
| MongoDB, Redis og Pinecone | Skiller mellom varig applikasjonsdata, hurtig cache/køtilstand og semantisk vektorsøk. |
| Anthropic Claude og Cohere | Claude brukes til generering og analyse, mens Cohere brukes til reranking i RAG-flyten. |

## Anbefalt leserekkefølge

Vi har estimert ca. 30 minutter for en grundig orientering før selve hovedrapporten:

| Steg | Dokument | Tid | Hva du får ut av det |
|------|----------|-----|----------------------|
| 1 | [`diagrammer/00-oversikt.md`](diagrammer/00-oversikt.md) | 10 min | 20 mermaid-diagrammer som dokumenterer arkitekturen, med anbefalt rekkefølge. |
| 2 | [`Prosjektbeskrivelse_gruppe3.pdf`](Prosjektbeskrivelse_gruppe3.pdf) | 5 min | Opprinnelig prosjektbeskrivelse — viser ambisjonsnivå og avgrensning ved oppstart. |
| 3 | [`BOP-Prosjektskisse-Gruppe3-1.pdf`](BOP-Prosjektskisse-Gruppe3-1.pdf) | 5 min | Tidlig prosjektskisse — viser at de tekniske valgene er begrunnet og forankret. |
| 4 | [`brukertest-skjema.md`](brukertest-skjema.md) | 5 min | Brukertest-instrument: 53 spørsmål inkludert SUS-skala. Viser metodisk arbeid. |
| 5 | [`kanban-brukerhistorier.txt`](kanban-brukerhistorier.txt) | 3 min | 55 brukerhistorier fra GitHub Projects — viser kravinnhenting og prioritering. |
| 6 | [`teknisk-kanban-issues.txt`](teknisk-kanban-issues.txt) | 5 min | 187 tekniske issues — viser omfanget av implementasjonen. |
| 7 | [`manus-milepael-3.md`](manus-milepael-3.md) | – | Presentasjonsmanus (kun for kontekst). |

## Innholdsfortegnelse — hva ligger hvor

### `diagrammer/`

20 mermaid-diagrammer som dokumenterer den tekniske arkitekturen — eksportert som både `.md` (kilde) og `.png` (høy oppløsning). Se [`diagrammer/00-oversikt.md`](diagrammer/00-oversikt.md) for full leseguide.

| Område | Diagrammer |
|--------|-----------|
| Arkitektur | 01, 02, 10 |
| Funksjonelle flyter (sekvens) | 03, 04, 05 |
| Data og lagring | 06, 07, 12 |
| Sikkerhet og personvern | 08, 09, 11, 20 |
| Brukersentrert design | 13, 14 |
| Kvalitet og prosjekt | 15, 16, 18, 19 |
| UML | 03, 04, 13, 17 |

### Prosjektledelse og metode

- [`Prosjektbeskrivelse_gruppe3.pdf`](Prosjektbeskrivelse_gruppe3.pdf) — formell prosjektbeskrivelse innlevert ved oppstart.
- [`BOP-Prosjektskisse-Gruppe3-1.pdf`](BOP-Prosjektskisse-Gruppe3-1.pdf) — prosjektskisse med tidlig avgrensning og risikoanalyse.
- [`kanban-brukerhistorier.txt`](kanban-brukerhistorier.txt) — 55 brukerhistorier eksportert fra GitHub Projects (#21).
- [`teknisk-kanban-issues.txt`](teknisk-kanban-issues.txt) — 187 tekniske issues eksportert fra GitHub Projects (#25), gruppert etter delsystem.
- [`manus-milepael-3.md`](manus-milepael-3.md) — presentasjonsmanus til siste milepæl, inkludert taletid og rolledeling.

### Brukertesting

- [`brukertest-skjema.md`](brukertest-skjema.md) — selve brukertest-skjemaet i markdown. 53 spørsmål fordelt på 5 seksjoner: bakgrunn, oppgavebasert vurdering, System Usability Scale (SUS), holdninger/læring, og åpne tilbakemeldinger.
- [`brukertest-skjema-bygg.gs`](brukertest-skjema-bygg.gs) — Google Apps Script som bygger skjemaet programmatisk i Google Forms (reproduserbarhet).
- [`StudyWise – Brukertest - Google Skjemaer.pdf`](StudyWise%20%E2%80%93%20Brukertest%20-%20Google%20Skjemaer.pdf) — eksportert versjon av selve Google-skjemaet, slik det ble vist for testdeltakerne.

## Hvor du finner dokumentasjon for hovedtemaene i oppgaven

| Tema | Hvor det dokumenteres |
|------|------------------------|
| **Faglig dybde og kompleksitet** | Hovedrapport + diagram 01, 04, 06, 13. Løsningen integrerer 10+ eksterne tjenester. |
| **Arkitekturkvalitet** | Diagram 02, 07, 08, 10, 12. Modulær oppdeling, typesikker monorepo, asynkrone jobber. |
| **Sikkerhet og personvern (GDPR)** | Diagram 03, 08, 09, 10, 11 + rotmappens `CLAUDE.md` (guardrails-seksjon). Cloudflare-only API-path, 15 sikkerhetslag og soft-delete-flyt for kontosletting. |
| **Brukersentrert utvikling** | `brukertest-skjema.md`, `kanban-brukerhistorier.txt`. SUS-måling, 55 brukerhistorier, ekte testdeltakere. |
| **Prosjektledelse og metodikk** | `kanban-brukerhistorier.txt`, `teknisk-kanban-issues.txt`, `Prosjektbeskrivelse_gruppe3.pdf`. Sporbar Kanban-flyt fra brukerhistorie til implementasjon. |
| **Drift og leveranse** | Diagram 10, 13. Løsningen er deployet som offentlig demo / produksjonslik drift med CI/CD, helsestatus og observabilitet. |
| **Kommunikasjon** | `manus-milepael-3.md`. Norske variabelnavn og kommentarer gjennomgående i kodebasen for tilgjengelighet. |

## Tekniske verifiserings­tips

Hvis man ønsker å verifisere påstandene i rapporten direkte:

- **Live-versjon:** <https://www.studwize.page> (krever Clerk-konto — registrering tar < 1 minutt).
- **API-helsestatus:** <https://api.studwize.page/health> (offentlig liveness-endepunkt via Cloudflare).
- **Dokumentasjon:** <https://26zl.github.io/StudyWise/> (VitePress-side med teknisk dokumentasjon, deployet til GitHub Pages).
- **Kildekode:** rotnivå `CLAUDE.md` gir en kompakt oversikt over guardrails, mappestruktur og pre-commit-rutiner.
- **Bygg lokalt:** `pnpm install && pnpm dev` — krever Node 24 og .env-filer (eksempler i `backend/.env.example` og `frontend/.env.example`).

## Kontakt

Skulle noe være uklart, eller om det er ønske om tilgang til private ressurser (Datadog-dashboards, Pinecone-indeks, m.m.), ta kontakt med gruppa via veileder.

— Gruppe 3: Laurent, Abdinasir, Anwar, Ylli
