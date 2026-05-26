# Lagringstid (Data Retention Schedule) — StudyWise

> **GDPR Art. 5(1)(e) — lagringsbegrensning.** Personopplysninger skal ikke
> lagres lenger enn nødvendig for formålet de ble samlet inn for. Denne fila
> konsoliderer retention-reglene på tvers av tjenesten; detaljer står i
> `compliance/PIA.md` og på `/personvern`.
>
> **Sist oppdatert:** 2026-04-18

## Prinsipper

1. **Minimering** — lagre kun det som trengs for formålet
2. **Tidsbegrensning** — slett eller anonymiser når formålet er oppfylt
3. **Automasjon** — bruk TTL-indekser og planlagte jobber der mulig
4. **Reverserbar sletting er ikke sletting** — "soft delete" brukes kun med
   klar begrunnelse og definert hard-delete-periode

## Retention-oversikt

| Datatype                                       | Formål                   | Lagringssted                           | Retention                                     | Sletting                                           |
| ---------------------------------------------- | ------------------------ | -------------------------------------- | --------------------------------------------- | -------------------------------------------------- |
| Konto (e-post, navn, brukernavn)               | Identifisering           | Clerk + MongoDB                        | Inntil kontosletting                          | Ved brukerens initiativ                            |
| Canvas API-token                               | Canvas-integrasjon       | MongoDB (AES-256-GCM)                  | Inntil bruker fjerner eller sletter konto     | Via Innstillinger eller kontosletting              |
| Samtalehistorikk (chat)                        | Kjernefunksjon           | MongoDB (AES-256-GCM blob per samtale) | Inntil bruker sletter eller konto slettes     | Per samtale eller alt                              |
| Kunnskapsbase (tekst + embeddings)             | RAG-kontekst             | MongoDB + Pinecone                     | Inntil bruker sletter basen eller kontoen     | Kaskade-sletting via BullMQ                        |
| Canvas-cache                                   | Ytelse                   | Redis                                  | 2 timer TTL (sync-struktur), 5–30 min (misc)  | Automatisk via Redis TTL                           |
| Rate-limit-tellere                             | Misbruksbeskyttelse      | Redis                                  | 1 min – 1 time                                | Automatisk via Redis TTL                           |
| Brukerpreferanser (UI, varsler, cookieConsent) | Personalisering          | MongoDB                                | Inntil kontosletting                          | Ved kontosletting                                  |
| Audit-logger (IP, UA, handling)                | Sikkerhet, etterlevelse  | MongoDB (TTL-index)                    | 24 måneder                                    | Automatisk via TTL + anonymisert ved kontosletting |
| Chat-tilbakemelding (tommel opp/ned)           | Kvalitetsforbedring      | MongoDB                                | Inntil kontosletting                          | Ved kontosletting                                  |
| Delte samtaler (shared chats)                  | Deling med utløp         | MongoDB (TTL)                          | 30 dager fra opprettelse                      | Automatisk via TTL                                 |
| Web-push-abonnementer                          | Varsler                  | MongoDB                                | Inntil bruker deaktiverer eller sletter konto | Per enhet eller kontosletting                      |
| Kontaktskjema-meldinger                        | Brukerstøtte             | MongoDB + Resend-levering              | Opptil 365 dager eller til saken er behandlet | Automatisk eller manuell                           |
| Clerk-sletting-køoppføringer (tombstones)      | OAuth-konflikthåndtering | MongoDB                                | 90 dager                                      | Automatisk via TTL                                 |
| Sesjonstokens                                  | Innlogging               | Clerk                                  | Per Clerk-konfigurasjon                       | Logout/utløp                                       |
| Systemmelding-cache                            | Ytelse                   | Redis                                  | 30 sekunder TTL                               | Automatisk                                         |
| Public status-cache                            | Ytelse                   | Redis                                  | 30 sekunder TTL                               | Automatisk                                         |
| Kryptert token-cache (per sesjon)              | Ytelse                   | In-memory                              | Per sesjon / til logout                       | Ved logout eller Clerk-sesjonsutløp                |

## Kontosletting (GDPR Art. 17)

Ved full kontosletting:

- **Slettes permanent**: samtalehistorikk, Canvas-token, kunnskapsbase, chat-tilbakemelding, preferanser, delte samtaler, webpush-abonnementer, Pinecone-vektorer, arbeidsplan, task breakdown, study context
- **Anonymiseres**: audit-logger (brukerens `actorUserId` erstattes med `deleted:<id>`), `SystemAnnouncement.publishedBy` (unset)
- **Beholdes kortvarig**: tombstone (90 dager) for å håndtere OAuth-konflikter og gjentatte sletteforsøk idempotent

Sletting er transaksjonell — enten lykkes alt, eller ingenting. Feilede
eksterne kall (Clerk, Pinecone) re-prøves via BullMQ med dead-letter-kø.

## Hvordan retention håndheves

- **MongoDB TTL-indekser** — automatisk sletting for audit-logger, delte
  samtaler, tombstones, web-push-subscriptions
- **Redis TTL** — automatisk utløp for all cache
- **BullMQ-jobber** — kaskade-sletting ved kontosletting (Clerk, Pinecone)
- **Manuell innsats** — kontaktskjema-meldinger markeres som behandlet av
  admin-panelet; kan slettes manuelt før 365-dagers automatisk sletting

## Avvik fra denne planen

Avvik (f.eks. forlenget retention av spesifikke logger for pågående
incident response) må dokumenteres:

1. Hvilke data, hvor mange rader, hvorfor forlenget
2. Ny retention-dato
3. Hvem som godkjente (bachelor-teamet)
4. Slettes senest ved retention-dato

Loggføres i `.incidents/` eller som intern note om det ikke er tilknyttet
hendelse.
