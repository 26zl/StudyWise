# Sikkerhetsretningslinjer

Takk for at du bidrar til å holde StudyWise trygt for brukerne våre. Denne
siden beskriver hvordan du rapporterer sårbarheter, hvilke typer rapporter
vi prioriterer, og hva du kan forvente fra oss.

## Rapportering

**Ikke åpne en offentlig issue** for sikkerhetsfeil. Send heller rapporten
privat gjennom én av disse kanalene:

- **Kontaktskjema:**
  [studwize.page/kontakt](https://www.studwize.page/kontakt) — velg emne som
  gjør det tydelig at det gjelder en sikkerhetssak.
- **Maskin-lesbar kontakt:**
  [`/.well-known/security.txt`](https://www.studwize.page/.well-known/security.txt)
  (RFC 9116) gir deg kanonisk kontaktadresse.

## Hva en god rapport bør inneholde

For at vi skal kunne reprodusere og rette sårbarheten raskt, hjelper det
hvis rapporten inneholder:

- Beskrivelse av sårbarheten og potensiell påvirkning
- Steg-for-steg for å reprodusere
- Eventuell proof-of-concept (screenshot, HTTP-request, kode-utdrag)
- Berørte endepunkter / komponenter
- Forslag til mulig rettelse (valgfritt, men satt pris på)

## Hva du kan forvente fra oss

- **Bekreftelse** innen 72 timer på at rapporten er mottatt.
- **Første vurdering** innen 7 dager der vi deler om vi regner det som en
  sårbarhet, alvorlighetsgrad og neste steg.
- **Jevnlig status** til vi har en fix på plass.
- **Anerkjennelse** i release notes eller en dedikert takk-side hvis du
  ønsker det (vi respekterer om du heller vil være anonym).

StudyWise er et bachelorprosjekt uten bug-bounty-program — vi har ikke
økonomisk kompensasjon å tilby. Det vi kan tilby er rask, respektfull
behandling og offentlig anerkjennelse.

## Scope

**In scope** (rapporter om disse):

- Autentisering og autorisasjon (Clerk-flyt, step-up auth, RBAC)
- Sensitive lekkasjer (Canvas-token, chat-innhold, kunnskapsbase,
  audit-logs)
- Injection-sårbarheter (XSS, SQL/NoSQL, kommando-injection)
- CSRF, SSRF, åpen omdirigering
- Svake kryptografiske valg, nøkkel-eksponering
- Filopplasting-sårbarheter (polyglot-filer, zip-bomber, sti-traversering)
- Fjerning/omgåelse av rate-limit og CSRF-beskyttelse
- Priviligertilgang-eskalering (admin-takeover, bruker-impersonation)

**Out of scope** (vi tar ikke imot disse som sårbarhetsrapporter):

- Rapporter basert på utdaterte automatiske skanneverktøy uten verifisert
  påvirkning
- Manglende sikkerhetsheadere uten dokumentert angrepsvektor
- Spam- eller bruddlignende oppførsel fra logget-inn bruker på egen konto
- Sårbarheter i tredjepartstjenester (Clerk, Anthropic, Pinecone osv.) —
  rapporter disse direkte til leverandøren
- Sosial manipulering mot teammedlemmer eller brukere
- Fysisk tilgang til infrastruktur

## Ansvarlig offentliggjøring

Vi ber om at du:

1. Gir oss rimelig tid (minimum 30 dager, normalt 90 dager) til å rette
   før offentliggjøring.
2. Ikke utnytter sårbarheten utover det som er nødvendig for å
   demonstrere den.
3. Ikke tilgjengeliggjør, endrer eller sletter brukerdata.
4. Rapporterer via de private kanalene over, ikke gjennom offentlige
   issues eller sosiale medier.

Så lenge du følger disse prinsippene, vil vi behandle rapporten som
konstruktiv forskning og ikke eskalere til juridiske tiltak.

## Sikkerhetsarkitektur

For en oversikt over hvordan tjenesten er sikret, se:

- Brukerrettet: [/sikkerhet](https://www.studwize.page/sikkerhet)
- Intern risikovurdering: [PIA.md](../compliance/PIA.md)
- Hva vi gjør ved brudd: [INCIDENT_RESPONSE.md](../compliance/INCIDENT_RESPONSE.md)

## GitHub Actions-sikkerhet

Workflowene skal ikke bruke `pull_request_target`. Validering av pull
requests skal skje med ordinær `pull_request` og minst mulig tilgang.

Deploy-, publish-, release- og andre privilegerte workflows med secrets eller
write-permissions skal kjøre rene installasjoner uten delte
package-manager-cacher (`actions/cache`, `cache: pnpm`, restore keys osv.).
De skal heller ikke installere verktøy med global `npm install -g` eller
`curl | sh`.
Dette håndheves i CI med `pnpm lint:actions-security`.

## Avhengighetssikkerhet

Repoet bruker pnpm og `minimumReleaseAge: 7200` i `pnpm-workspace.yaml`.
Det betyr at nye npm-publiseringer må være minst 5 dager gamle før pnpm kan
løse dem inn. Dette reduserer risikoen for at en ny, kompromittert
pakkeversjon rekker inn i dependency-update eller lokale installs før den er
oppdaget og fjernet fra registryet. CI håndhever dette med
`pnpm lint:pnpm-security`.

CI genererer en CycloneDX SBOM fra `package.json` og `pnpm-lock.yaml`, og
laster den opp som workflow-artefakt. Dockerfile og backend-container-image
skannes med Trivy for HIGH/CRITICAL funn. `safe-chain` installeres fra en
versjonspinnet release-binær med SHA-256-verifisering. Vercel CLI kjøres via
`pnpm exec`, slik at deploy-verktøyet også er dekket av lockfile og pnpm sine
supply-chain-regler.
