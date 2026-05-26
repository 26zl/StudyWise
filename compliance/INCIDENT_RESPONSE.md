# Incident Response — StudyWise

> **Internt dokument.** Sjekkliste for hva teamet gjør hvis vi oppdager et
> sikkerhetsbrudd, datalekkasje eller mistenkelig aktivitet. Gir et klart
> forhold til GDPR Art. 33 (72-timers varsling til Datatilsynet) og
> Art. 34 (varsling til berørte brukere ved høy risiko).
>
> **Sist oppdatert:** 2026-05-26

## Prinsipp

**Raskt, dokumentert, ærlig.** Bedre å varsle for mye enn for lite. Logg
alle steg med tidspunkt underveis.

## Kategorier

- **Kritisk** — databrudd med PII eksponert, Canvas-token-lekkasje,
  admin-konto kompromittert, ransomware.
  _Varsling:_ Ja — Datatilsynet innen 72t, brukere innen 72t.
- **Alvorlig** — uautorisert adgang uten PII-lekkasje, DoS som tok ned
  tjenesten > 4t, sårbarhet brukt i angrep.
  _Varsling:_ Kanskje — vurder risiko.
- **Mindre** — skannet sårbarhet fikset før utnyttelse, melding via
  kontaktskjema, mistenkelig aktivitet uten bevis.
  _Varsling:_ Nei, men logg internt.

## Sjekkliste ved kritisk hendelse

### Første time (T+0 til T+1t)

- **Noter tidspunkt for oppdagelse** (UTC). Dette er startpunktet for
  72-timers-fristen.
- **Samle team.** Minimum to personer som kan koordinere.
- **Stopp blødningen.**
  - Roter `ENCRYPTION_KEY` hvis den kan være kompromittert.
  - Revoker alle Clerk-sesjoner (via admin → "Logg ut alle sesjoner").
  - Skru av misbrukte API-nøkler hos Anthropic/Pinecone/Cohere.
  - Deaktiver konto(er) som er kompromittert.
- **Ikke slett logger.** Bevar alt til etterforskning.
- **Start incident-logg.** En markdown-fil per hendelse i `.incidents/`:
  tidspunkt, hva ble observert, hvem gjorde hva, hvilke systemer berørt.

### Første 24 timer (T+1t til T+24t)

- **Identifiser omfanget.**
  - Hvilke data var eksponert? (Canvas-tokens, chat, PII, audit-logs?)
  - Hvor mange brukere er berørt?
  - Hvor lenge var data eksponert?
  - Via hvilken angrepsvektor?
- **Isoler årsaken.**
  - Sjekk audit-logs: uvanlige queries, tilgangsmønstre, nye admin-konti.
  - Sjekk deploy-historikk: ble noe endret nylig?
  - Sjekk Datadog/Grafana for anomalier.
- **Konsulter veileder ved USN** hvis det er uklart om bachelor-teamet
  må håndtere alene.
- **Forbered Datatilsynet-varsel** (utkast).

### Før T+72t

- **Varsle Datatilsynet** (GDPR Art. 33) via skjema på
  <https://www.datatilsynet.no/melde-avvik/>. Varselet skal inneholde:
  - Hva slags brudd (kategori, omfang, antall berørte).
  - Navn + kontakt for ansvarlig person.
  - Sannsynlige konsekvenser.
  - Hva vi har gjort og planlegger å gjøre.
- **Vurder direkte varsling til brukere** (Art. 34) — påkrevd hvis
  bruddet "sannsynligvis medfører høy risiko for deres rettigheter og
  friheter". Ved tvil: varsle.
- **Varsel til brukere via e-post + banner på /status**.
  Innhold:
  - Hva som skjedde (konkret).
  - Hvilke data som er berørt.
  - Hva brukeren bør gjøre (f.eks. roter Canvas-token, endre passord).
  - Hva vi gjør for å hindre gjentagelse.
  - Kontaktinfo for spørsmål.

### Etter håndtering

- **Post-mortem** skrevet innen 1 uke. Hva gikk galt, hva fungerte,
  hvilke endringer må vi gjøre?
- **Oppdater PIA.md** hvis risikobildet endret seg.
- **Oppdater kode og prosesser** for å forhindre gjentagelse.
- **Arkivér incident-logg** i `.incidents/YYYY-MM-DD-slug.md`.

## Kontaktpunkter

- **Datatilsynet (varsling):**
  [datatilsynet.no/melde-avvik](https://www.datatilsynet.no/melde-avvik/)
- **USN veileder:** (fylles inn ved prosjektstart)
- **Leverandører (ved brudd hos dem):** kontakt via deres support-kanal
- **Clerk:** <support@clerk.com>
- **Anthropic:** <security@anthropic.com>
- **MongoDB Atlas:** via Atlas-konsollen
- **Pinecone:** <support@pinecone.io>

## Vanlige angrepsvektorer og første-steg

### Lekket `ENCRYPTION_KEY`

1. Generer ny nøkkel.
2. Sett `ENCRYPTION_KEY_PREV` til gamle nøkkel (dual-read).
3. Deploy.
4. Kjør `pnpm db:reset-encrypted --confirm` for å slette/tilbakestille data
   og felt som er kryptert med gammel nøkkel (se scripts/reset-encrypted-data.mjs).
5. Fjern `ENCRYPTION_KEY_PREV` etter fullført rotasjon.
6. Varsle om token-lekkasje til berørte brukere.

### Clerk webhook-secret lekket

1. Roter secret i Clerk Dashboard.
2. Oppdater `CLERK_WEBHOOK_SECRET` i Heroku config.
3. Restart backend.
4. Sjekk audit-logs for uvanlig webhook-aktivitet.

### Mistenkt uautorisert admin-aktivitet

1. Logg ut alle sesjoner for den aktuelle admin-brukeren.
2. Roter Clerk-session-tokens (Clerk-dashboard).
3. Se gjennom `AuditLog` for `admin_*`-handlinger siste 30 dager.
4. Kontakt Clerk hvis Clerk-innlogging selv er kompromittert.

### DoS / ressursmisbruk

1. Sjekk rate-limit-logger (`x-ratelimit-*`-headers i Pino-logs).
2. Blokker angripende IP-er i Cloudflare.
3. Øk rate-limit-sensitivitet hvis nødvendig.
4. Skalér Heroku-dyne midlertidig hvis legitim trafikkspike.

### Canvas-token-lekkasje (kun én bruker)

1. Kontakt brukeren — be dem tilbakekalle tokenet i Canvas.
2. Slett tokenet fra vår database.
3. Etterforsk om det var vår feil (f.eks. logg-eksponering) eller bruker-
   side (deling, phishing).
4. Hvis vår feil: vurder om andre brukere også er berørt → Art. 33-varsling.

## Forebygging

- CI kjører sikkerhets-scan ved hver PR.
- `ENCRYPTION_KEY` roteres ideelt hver 12. måned uansett (ikke bare ved
  brudd).
- Admin-panelet har audit-logging på alle operasjoner.
- Step-up auth ved sensitive operasjoner (kontosletting).
- Web-push-varsler om mistenkelig aktivitet (fremtidig utvidelse).
