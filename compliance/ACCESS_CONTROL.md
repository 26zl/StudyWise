# Tilgangskontroll — StudyWise

> **Intern policy.** Hvem kan gjøre hva i StudyWise, hvordan tildeles og
> fjernes tilgang, og hvilke tekniske kontrollmekanismer som håndhever det.
>
> **Sist oppdatert:** 2026-04-18

## Prinsipper

1. **Minimum-tilgang** — hver aktør får kun de rettighetene som trengs for oppgaven
2. **Separasjon** — produksjon og test er helt adskilte (ulike databaser, ulike nøkler)
3. **Håndhevet server-side** — roller lagres og sjekkes kun på server; aldri tillitt klientinput
4. **Revisjon** — alle sensitive handlinger audit-logges med aktør-ID, tidspunkt, IP og UA
5. **Step-up for irreversible ting** — kontosletting og andre destruktive ops krever fersk sesjon

## Roller

| Rolle | Tildeles av | Tilgang |
| ----- | ----------- | ------- |
| `user` (standard) | Automatisk ved registrering | Egen data, KI-chat, kunnskapsbase, Canvas-integrasjon, egne preferanser |
| `admin` | Manuelt av bachelor-teamet i Clerk-dashboard (metadata) | Alt over + admin-panel: vedlikehold, audit-logger, brukeradministrasjon, systemmeldinger, `/health/dependencies` |

Rollen lagres som Clerk public metadata og synkes til `User.role` i MongoDB
ved innlogging. Backend leser kun fra MongoDB, ikke fra klientinput.

## Admin-tildeling og -fjerning

### Tildele admin

1. Bachelor-team-medlem logger inn i Clerk-dashboard
2. Åpner brukerens profil
3. Setter `publicMetadata.role = "admin"`
4. Neste innlogging/`/me`-kall synkroniserer rollen til MongoDB
5. Handlingen loggføres (som minimum i Clerk audit-log)

**Policy:** admin-tildeling skal kun gis til bachelor-teamet og veileder ved
USN (hvis relevant). Ikke til eksterne testere eller demo-brukere.

### Fjerne admin

1. Fjern `publicMetadata.role` i Clerk-dashboard (eller sett til `user`)
2. Eksisterende sesjon fortsetter med gammel rolle til `/me` oppdateres
3. For umiddelbar effekt: "Logg ut alle sesjoner" på brukeren i Clerk

### Ved teammedlem som forlater prosjektet

1. Fjern admin-rollen umiddelbart
2. Roter `ENCRYPTION_KEY` hvis personen hadde tilgang til Heroku config vars
3. Roter Clerk webhook-secret hvis personen hadde tilgang til Clerk-dashboard
4. Gå gjennom audit-logger for siste 30 dager for uventet aktivitet
5. Dokumenter i `.incidents/` hvis det er grunn til å undersøke videre

## Tekniske kontrollmekanismer

### Request-kjeden

Hver autentisert API-forespørsel går gjennom:

1. **`requireAuth`** — Clerk Bearer-token verifiseres, `req.user` settes
2. **`requireAcceptedTerms`** — bruker med utdaterte vilkår avvises (unntatt whitelist)
3. **Rolle-spesifikk middleware** — f.eks. `requireRole("admin")` på admin-ruter
4. **Step-up for sensitive ops** — `requireRecentAuth` (Clerk-sesjon < 45 min)

### Sensitive operasjoner som krever step-up

- **Sletting av egen konto** (`DELETE /api/user/account`) — Clerk-sesjon må være < 45 min
- **Admin-handlinger generelt** — rate-limited + audit-logget

Step-up oppnås ved å logge ut og logge inn på nytt, eller ved å reautentisere
via Clerk når sesjonen er for gammel.

### Hvem kan se hva

| Data | Vanlig bruker | Admin |
| ---- | ------------- | ----- |
| Egen konto, chat, kunnskapsbase | ✓ | ✓ |
| Andre brukeres data | ✗ | Kun aggregerte metrics, IKKE innhold av chat/kunnskapsbase |
| Audit-logger | ✗ | ✓ (via admin-panel) |
| `/health/dependencies` | ✗ | ✓ |
| Systemmelding-publisering | ✗ | ✓ |
| Canvas-tokens (klartekst) | ✗ | ✗ — tokens lagres kryptert, ingen menneske ser klartekst etter inngang |
| `ENCRYPTION_KEY` | ✗ | Kun via Heroku config vars; ikke i kode eller database |

Selv admin har ikke direkte tilgang til klartekst av andres Canvas-tokens
eller chat-innhold — kryptering beskytter mot innvendig trussel.

## Separasjon av miljøer

| Miljø | Clerk-instans | MongoDB | Redis | Pinecone-index | ENCRYPTION_KEY |
| ----- | ------------- | ------- | ----- | -------------- | -------------- |
| Development | `pk_test_*` | Lokal / dev-cluster | Lokal / dev | `studywise-dev` | Dev-nøkkel |
| Production | `pk_live_*` | Prod-cluster | Redis Cloud prod | `studywise-prod` | Prod-nøkkel i Heroku |

Ingen testdata flyter til produksjon (eller motsatt). Deploy-pipeline
garanterer at env vars lastes fra riktig miljø.

## Audit av tilgang

Alle sensitive handlinger logges som `AuditLog`-oppføringer:

- `SIGN_OUT`, `USER_CREATED`, `ACCOUNT_DELETED`
- `CANVAS_TOKEN_CREATED/UPDATED/DELETED`
- `ADMIN_ACTION`, `ADMIN_ANNOUNCEMENT_PUBLISHED/CLEARED`
- `TERMS_ACCEPTED`, `TERMS_ENFORCEMENT_BLOCKED`
- `ACCESS_DENIED`, `TOKEN_VERIFICATION_FAILURE`
- `CSRF_VIOLATION`, `RATE_LIMIT_EXCEEDED`
- `KI_CHAT`, `KI_DOCUMENT_ANALYZED`, `KB_*`

Hver oppføring inneholder: `actorUserId`, `action`, `category`, `outcome`,
`role`, `ip`, `userAgent`, `requestId`, `traceId`, `metadata`. Retention:
24 måneder (se [`DATA_RETENTION.md`](./DATA_RETENTION.md)).

## Nødgang (break-glass)

Hvis regulær admin-tilgang ikke fungerer (f.eks. Clerk nede, admin låst ute):

1. **Heroku config vars** kan endres direkte via Heroku CLI av hvem som helst med Heroku-admin-tilgang
2. **MongoDB Atlas** kan endres direkte via Atlas-konsoll av DB-admin
3. Alle direkte DB-endringer **må dokumenteres i `.incidents/`** med tidspunkt, aktør, begrunnelse og hva som ble endret
4. Audit-logg i appen vil mangle slike handlinger — derfor er ekstern loggføring kritisk

## Revidering

Denne policyen revideres:

- Ved endringer i team-sammensetning
- Ved ny funksjonalitet som endrer tilgangsmodellen
- Minst én gang per år
