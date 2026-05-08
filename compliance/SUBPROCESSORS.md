# Underleverandører (Subprocessors) — StudyWise

> **GDPR Art. 28 / Art. 30.** Liste over tredjeparts databehandlere som kan
> behandle personopplysninger på våre vegne. Alle har publisert DPA
> (databehandleravtale) som vi støtter oss på. Oppdateres ved endring i
> leverandører eller scope.
>
> **Sist oppdatert:** 2026-04-18

## Hva er en underleverandør?

En underleverandør (subprocessor / databehandler) er en ekstern tjeneste som
kan behandle personopplysninger på vegne av StudyWise. Vi forplikter oss til
å kun bruke leverandører som har tilstrekkelige tekniske og organisatoriske
tiltak og som kan dokumentere GDPR-etterlevelse.

## Aktive underleverandører

| Leverandør             | Formål                                         | Data behandlet                                                      | Lokasjon             | Overføringsgrunnlag | Sertifisering            |
| ---------------------- | ---------------------------------------------- | ------------------------------------------------------------------- | -------------------- | ------------------- | ------------------------ |
| **Clerk**              | Innlogging, passord, 2FA, Google/Microsoft SSO | E-post, hashet passord, 2FA-hemmeligheter, sesjonstokens            | USA                  | SCC + EU-US DPF     | SOC 2 Type II            |
| **Anthropic** (Claude) | KI-svar, oppsummering, quiz/flashcards         | Chat-innhold, oppgavetekst, dokumentinnhold (PII-sanitert)          | USA                  | EU-US DPF           | SOC 2 Type II            |
| **Pinecone**           | Vektorsøk i kunnskapsbase                      | Anonymiserte tekst-chunks + embeddings (ingen PII etter sanitering) | USA                  | SCC + EU-US DPF     | SOC 2 Type II            |
| **Cohere**             | Rerank av søkeresultater                       | Anonymiserte tekstutdrag                                            | USA                  | SCC                 | SOC 2 Type II            |
| **MongoDB Atlas**      | Primær database                                | All lagret brukerdata (kryptert at-rest)                            | EU-regioner (primær) | SCC for replikering | SOC 2 Type II, ISO 27001 |
| **Redis Cloud**        | Cache og rate-limiting                         | Canvas-cache, sesjons-kontekst (kortvarig)                          | EU                   | SCC                 | SOC 2 Type II            |
| **Heroku**             | Backend-hosting                                | All backend-trafikk (metadata, logger)                              | USA                  | SCC + EU-US DPF     | SOC 2 Type II            |
| **Vercel**             | Frontend-hosting                               | HTTP-requests, edge-logger                                          | Global edge          | SCC + EU-US DPF     | SOC 2 Type II            |
| **Cloudflare**         | CDN, WAF, DDoS, Turnstile                      | IP, user-agent, request-metadata                                    | Global edge          | SCC + EU-US DPF     | SOC 2 Type II, ISO 27001 |
| **Datadog**            | APM, RUM, Session Replay (mask-modus)          | Ytelsesmetrikker, feilspor, maskerte DOM-events                     | USA/EU               | SCC + EU-US DPF     | SOC 2 Type II            |
| **PostHog**            | Produktanalyse (cookieless)                    | Pseudonyme bruksmønstre, sidevisninger                              | USA                  | SCC                 | SOC 2 Type II            |
| **LangSmith**          | KI-feilsøking                                  | Prompt-/respons-par med anonym request-ID                           | USA                  | SCC                 | SOC 2 Type II            |
| **Resend**             | E-postlevering for kontaktskjema               | Navn, e-post, melding (via Cloudflare Worker-relay)                 | USA                  | SCC + EU-US DPF     | SOC 2 Type II            |

## Prototype- og institusjonsavgrensning

StudyWise er en bachelorprototype, ikke en offisiell tjeneste fra USN,
Canvas/Instructure eller andre læresteder. Teamet støtter seg på leverandørenes
standard-DPA-er og publiserte sikkerhetsdokumentasjon. Det foreligger ikke en
institusjonell databehandleravtale mellom StudyWise og USN eller andre skoler
for bred produksjonsbruk.

Canvas LMS er kilden til brukerens kursdata, men er ikke en underleverandør for
StudyWise i denne prototypen. Brukeren kobler selv til Canvas med personlig
API-token. En produksjonsvariant bør bruke institusjonsgodkjent Canvas OAuth,
LTI eller developer key og avklare behandlingsansvar, databehandleravtaler og
opphavsrett før utrulling.

## Overføringsgrunnlag

Alle overføringer utenfor EØS skjer på basis av minst ett av:

- **EU-kommisjonens standardkontraktsklausuler (SCC)** — bindende kontraktsvilkår
- **EU-US Data Privacy Framework (DPF)** — sertifiseringsordning for amerikanske leverandører
- **Tilstrekkelighetsbeslutninger** der aktuelt

## Endringer i underleverandør-listen

Ved tillegg eller endring av underleverandør:

1. Oppdater denne fila med tidspunkt og ny rad
2. Oppdater `/personvern`-siden med samme informasjon
3. Oppdater `compliance/PIA.md` hvis risikobildet endres
4. Vurder om brukere skal varsles (vesentlige endringer i datautførsel)

## Innsyn

Brukere kan be om innsyn i hvilke databehandlere som behandler deres
personopplysninger, og få tilgang til den spesifikke DPA-en ved å kontakte
oss via [kontaktskjemaet](https://www.studwize.page/kontakt).
