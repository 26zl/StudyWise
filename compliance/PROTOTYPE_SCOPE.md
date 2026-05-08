# Prototype-scope og institusjonell avgrensning

> **Sist oppdatert:** 2026-05-08
>
> Dette dokumentet forklarer hvordan StudyWise skal forstås som
> bachelorprototype, og hva som må avklares før en eventuell reell
> institusjonsutrulling.

## Status

StudyWise er et bachelorprosjekt ved Universitetet i Sørøst-Norge (USN) og en
teknisk demonstrator for hvordan Canvas-data, kalender, KI-assistanse og
studieplanlegging kan samles i en felles studieflate.

StudyWise er ikke en offisiell tjeneste fra USN, Canvas/Instructure eller andre
læresteder. Den offentlige deployen brukes for demonstrasjon, dokumentasjon og
avgrenset testing.

## Canvas-integrasjon

Dagens Canvas-kobling bruker personlig API-token som brukeren selv oppretter i
Canvas. Tokenet lagres kryptert og brukes server-side for lesetilgang til data
brukeren allerede har tilgang til i Canvas. StudyWise skriver ikke tilbake til
Canvas.

Denne tokenflyten er et prototypevalg. For en produksjonsvariant bør
integrasjonen erstattes av en institusjonsgodkjent modell, typisk:

- Canvas OAuth eller developer key med riktige scopes
- LTI dersom StudyWise skal opptre som Canvas-app
- Feide/FS der identitet, studiested eller studiedata skal forankres i
  institusjonelle systemer
- godkjenning fra lærestedets Canvas-administrator og relevante
  personvern-/sikkerhetsfunksjoner

## KI, Canvas-innhold og opphavsrett

KI-funksjonene kan bruke brukerens spørsmål, Canvas-utdrag, oppgavetekst,
dokumentinnhold og kunnskapsbaseinnhold som kontekst. Avhengig av funksjon kan
tekst sendes til eksterne underleverandører dokumentert i
[`SUBPROCESSORS.md`](./SUBPROCESSORS.md), blant annet Anthropic, Pinecone,
Cohere og LangSmith.

Brukere og testpersoner skal derfor ikke bruke StudyWise med:

- taushetsbelagt informasjon
- sensitive eller unødvendige personopplysninger
- opphavsbeskyttet materiale de ikke har rett til å behandle i en slik tjeneste
- eksamens- eller innleveringsarbeid der KI-bruk ikke er tillatt

PII-sanitering er best-effort og reduserer risiko, men den kan ikke garantere at
all personinformasjon eller alt beskyttet innhold fjernes fra fri tekst.

## Akademisk redelighet

StudyWise er ment som læringsstøtte. KI-generert innhold skal ikke leveres som
studentens eget arbeid. Brukeren må følge emnets og lærestedets regler for
eksamen, innlevering, kildebruk og dokumentasjon av KI-bruk.

For en produksjonsvariant bør appen og dokumentasjonen ha tydelige mekanismer
for:

- synlig informasjon om akademisk redelighet i KI-flyt, eksport og deling
- kurs-/emnespesifikke begrensninger dersom institusjonen krever det
- logging eller brukerbekreftelse der dette er nødvendig for etterlevelse

## Testpersoner og personvern

Tidligere avgrenset testing med ca. 10 testpersoner er avsluttet, og tilhørende
kontoer/data er slettet. Videre testing med eksterne testpersoner bør avklares
med veileder og relevante personvernfunksjoner ved USN. Dersom prosjektet
behandler personopplysninger utover ren egenbruk i teamet, må teamet vurdere om
behandlingen skal meldes til Sikt eller dokumenteres på annen måte etter USNs
gjeldende retningslinjer.

## For produksjon

For bruk utover bachelor-/demokontekst bør følgende være på plass for lansering:

1. Institusjonsgodkjent Canvas-integrasjon (OAuth/LTI/developer key).
2. Avklart behandlingsansvar og databehandleravtaler.
3. Oppdatert DPIA/PIA med faktisk brukergruppe, datatyper og leverandører.
4. Avklaring av opphavsrett og bruk av Canvas-/pensuminnhold i KI-tjenester.
5. Rutiner for akademisk redelighet, eksamensbruk og KI-dokumentasjon.
6. Sikkerhetstest av autentisert flyt og admin-/Canvas-integrasjon.
