# Rapport TODO - siste Word-rydd før innlevering

Basert på siste kontrollerte PDF: `C:\Users\lenti\Desktop\StudyWise_BachelorOppgave26-IT.pdf`.

Målet med denne filen er å rydde de siste synlige rapportfeilene før ny PDF-eksport. Den skal ikke bli et nytt rapportkapittel.

## Start her hvis dere jobber i Word nå

Dette er den korte praktiske rekkefølgen. Alt dere trenger ligger i denne filen.

1. Søk etter `Laurent fikser` og erstatt hele § 4.5.3 med teksten under `Copy-paste-avsnitt -> § 4.5.3`.
2. Søk etter `-----------------------REVIEW` og slett review-linjen. Bruk teksten under `§ 4.5.2 - brukerstyrt Canvas-kontekst` hvis avsnittet må strammes opp.
3. Søk etter `publisere systemmeldinger` og erstatt admin-setningen med teksten i kritisk-listen under.
4. Søk etter `Legge til fin kobling` og erstatt Vedlegg I-listen med lenkeblokken under `Klikkbare lenker i Vedlegg I`.
5. Gå til `Vedlegg L - Canvas kontekst` og lim inn teksten under `Copy-paste-avsnitt -> Vedlegg L`.
6. Legg inn de viktigste faglige tilleggene hvis dere rekker det: kostnader, Qwen/Hugging Face til Claude, LangSmith, Clerk, cache og BullMQ.
7. Oppdater innholdsfortegnelsen og eksporter ny PDF.

## Hovedregel for rapport, vedlegg og repo

> **Hovedteksten skal forklare og drøfte. Vedleggene skal dokumentere. Repoet skal inneholde fullstendige artefakter.**

Praktisk regel:

```text
Kapitteltekst = kort oppsummering + henvisning
Vedlegg = skjermbilder, tabeller, korte utdrag og kataloger
GitHub-repo = fullstendige dokumenter/filer
```

Ikke ha samme lange innhold fullt ut både i kapitteltekst og vedlegg. Hovedteksten skal forklare hva som ble gjort og hvorfor det betyr noe. Vedleggene skal vise dokumentasjonen som støtter dette. Repoet kan inneholde fullversjoner av diagrammer, pentestrapport, compliance-filer og tekniske artefakter.

Copy-paste-setning som kan legges i vedleggsinnledningen:

> Vedleggene inneholder utvalgte dokumentasjonsutdrag, skjermbilder og oversikter som støtter hovedteksten. Fullstendige tekniske artefakter, diagramfiler og rapporter ligger i prosjektets GitHub-repository. Hovedteksten oppsummerer og drøfter funnene, mens vedleggene dokumenterer grunnlaget.

## Kritisk før ny PDF-eksport

Disse punktene er verifisert i PDF-en og bør fikses før innlevering.

- [ ] **§ 4.5.3:** Fjern `Laurent fikser`. Skriv ferdig seksjonen om Canvas-hendelsen/tredjepartsrisiko, eller slett delkapittelet hvis det ikke skal brukes.
- [ ] **§ 4.5.2:** Fjern `-----------------------REVIEW`. Gjør teksten til vanlig rapporttekst eller slett markøren helt.
- [ ] **Vedlegg I:** Fjern setningen `Legge til fin kobling til github for hvert diagram slik at sensor kan bare klikke enkelt på det`. Erstatt den med ferdige GitHub-lenker fra seksjonen `Klikkbare lenker i Vedlegg I` under.
- [ ] **§ 1.5:** Fjern `o` foran kulepunktet `• Kapittel 3.5.7...`.
- [ ] **§ 3.2.4:** Oppdater admin-beskrivelsen nå som use case-diagrammet er endret. Bruk for eksempel:

  > For administrator er de viktigste brukstilfellene å se overordnet statistikk og administrere drift og brukere. Publisering av systemmeldinger inngår i administrativ drift.

- [ ] **Vedlegg J1-J7:** Sett inn skjermbildene, eller fjern underseksjonene som mangler bilde. Nå ser J1 Security Headers, J2 DeepScan, J3 GitHub Actions, J4 Datadog APM, J5 Datadog Host Metrics, J6 PostHog og J7 Cloudflare ut til å være tomme.
- [ ] **Vedlegg L - Canvas kontekst:** Fyll inn kort dokumentasjon av Canvas-kontekst, eller fjern vedlegget og alle henvisninger til det. Nå er vedlegget tomt.
- [ ] **Innholdsfortegnelsen:** Tabell-bildetekster lekker fortsatt inn i TOC. Sett `Tabell X:`-tekstene til Word-stilen **Bildetekst/Caption**, ikke Heading, og oppdater TOC.
- [ ] **Figur 7:** Endre svak bildetekst fra `Figur 7: wireframe og endelig design` til noe mer presist, for eksempel:

  > Figur 7: Sammenligning av tidlig wireframe og ferdig implementert grensesnitt i StudyWise.

- [ ] **Figur 10:** Teksten `Figur 10: visualiserer middleware-kjeden...` er ikke en god bildetekst. Enten gjør den til brødtekst:

  > Figur 10 visualiserer middleware-kjeden og viser hvor forespørsler kan avvises.

  eller bruk en faktisk caption:

  > Figur 10: Middleware-kjede med avvisningspunkter i backend.

- [ ] **Siste synlige restesøk i Word:** Søk etter `TODO`, `REVIEW`, `KILDE HER`, `fikser`, `ligger her`, `Markerer`, `Kan noen lese` og `Gjøre diagrammet`.

## Vedleggsstruktur som skal beholdes

Behold dagens struktur E-L. Den er ryddig nok, men må ikke fylles med lange duplikater av hovedteksten.

```text
Vedlegg E - Skjermbilder fra produksjon
Vedlegg F - Gantt-skjema
Vedlegg G - Arkitekturdiagram
Vedlegg H - Use case-diagram
Vedlegg I - Teknisk diagramkatalog
Vedlegg J - Sikkerhet, kvalitetsskann og observability
Vedlegg K - Pentestrapport
Vedlegg L - Canvas kontekst
```

Sjekkpunkter:

- [ ] Ikke kall Vedlegg E for `SUS-resultater` noe sted. Vedlegg E er nå skjermbilder fra produksjon.
- [ ] Hvis SUS-tabellen fortsatt trengs, behold den i § 4.6.1 eller lag et eget vedlegg. Ikke omnummerer vedleggene rett før innlevering hvis det skaper mer rot.
- [ ] Vedlegg I skal være en katalog med lenker til diagrammene i repoet, ikke en full kopi av alle diagrammene.
- [ ] Vedlegg J skal være skjermbilder/bevis fra Security Headers, DeepScan, GitHub Actions, Datadog, PostHog og Cloudflare.
- [ ] Vedlegg K skal være kort pentestrapport-utdrag/oppsummering + tydelig henvisning til full rapport i repoet. Ikke lim inn hele pentestrapporten i kapittel 4.
- [ ] Vedlegg L skal dokumentere Canvas-kontekst, ikke pentestrapport. I PDF-en er **K = Pentestrapport** og **L = Canvas kontekst**.

## Hovedtekst: korte henvisninger, ikke fulle vedlegg

Bruk korte formuleringer som disse i hovedkapitlene:

```text
Vi gjennomførte en manuell pentest med 35 nummererte funn. De viktigste funnene var F-14 og F-29, som drøftes i 4.5.6. Full pentestrapport ligger i Vedlegg K og i prosjektets GitHub-repository.
```

```text
Utvalgte sikkerhets- og observability-resultater er dokumentert i Vedlegg J, blant annet Security Headers, DeepScan, GitHub Actions, Datadog, PostHog og Cloudflare.
```

```text
Detaljerte tekniske diagrammer er samlet i Vedlegg I som diagramkatalog, med lenker til fullstendige diagramfiler i GitHub-repositoriet.
```

## Ufullstendige lenker og "ligger her"

- [ ] Søk etter alle forekomster av `ligger her`.
- [ ] Hvis full artefakt finnes i repoet, erstatt teksten med en konkret GitHub-lenke.
- [ ] Hvis full artefakt allerede er gjengitt i vedlegget, skriv `gjengitt nedenfor` i stedet for `ligger her`.
- [ ] For Vedlegg G og H kan teksten peke til Vedlegg I og konkrete diagramfiler:
  - `01-arkitektur-overordnet.md`
  - `13-use-case-diagram.md`
- [ ] For Vedlegg K kan teksten peke til:
  - `https://github.com/26zl/StudyWise/blob/main/filer_prosjekt/pentest-studwize.md`
- [ ] Ikke bruk usikre lenker til filer som kanskje ikke finnes, som `moscow.md`, uten å kontrollere faktisk filsti først. **Verifisert 18.05.2026:** `moscow.md` finnes ikke i repoet. For Vedlegg B er MoSCoW-tabellen allerede gjengitt inline, så bytt `ligger her` med `er gjengitt nedenfor`.

## Klikkbare lenker i Vedlegg I

Erstatt den enkle bullet-listen i Vedlegg I med klikkbare GitHub-lenker slik at sensor kan åpne hvert diagram direkte.

```markdown
**Oversikt over diagramfiler (klikkbare lenker):**

- [00 - Samlet oversikt over diagrammene](https://github.com/26zl/StudyWise/blob/main/filer_prosjekt/diagrammer/00-oversikt.md)
- [01 - Overordnet systemarkitektur](https://github.com/26zl/StudyWise/blob/main/filer_prosjekt/diagrammer/01-arkitektur-overordnet.md)
- [02 - Monorepo-struktur og pakker](https://github.com/26zl/StudyWise/blob/main/filer_prosjekt/diagrammer/02-monorepo-struktur.md)
- [03 - Autentisering og brukerflyt](https://github.com/26zl/StudyWise/blob/main/filer_prosjekt/diagrammer/03-autentiseringsflyt.md)
- [04 - KI-chat og modellkall](https://github.com/26zl/StudyWise/blob/main/filer_prosjekt/diagrammer/04-ki-chat-pipeline.md)
- [05 - Integrasjon mot Canvas LMS](https://github.com/26zl/StudyWise/blob/main/filer_prosjekt/diagrammer/05-canvas-integrasjon.md)
- [06 - Kunnskapsbase og RAG-flyt](https://github.com/26zl/StudyWise/blob/main/filer_prosjekt/diagrammer/06-kunnskapsbase-rag.md)
- [07 - Datamodeller og datalagring](https://github.com/26zl/StudyWise/blob/main/filer_prosjekt/diagrammer/07-database-modeller.md)
- [08 - Backend middleware-rekkefølge](https://github.com/26zl/StudyWise/blob/main/filer_prosjekt/diagrammer/08-middleware-stack.md)
- [09 - Sletting av bruker og tilhørende data](https://github.com/26zl/StudyWise/blob/main/filer_prosjekt/diagrammer/09-bruker-sletting.md)
- [10 - Deployment og infrastruktur](https://github.com/26zl/StudyWise/blob/main/filer_prosjekt/diagrammer/10-deployment-arkitektur.md)
- [11 - Sikkerhetslag i løsningen](https://github.com/26zl/StudyWise/blob/main/filer_prosjekt/diagrammer/11-sikkerhetslag.md)
- [12 - Jobbkøer og bakgrunnsprosesser (BullMQ)](https://github.com/26zl/StudyWise/blob/main/filer_prosjekt/diagrammer/12-bullmq-koer.md)
- [13 - Fullstendig use case-diagram](https://github.com/26zl/StudyWise/blob/main/filer_prosjekt/diagrammer/13-use-case-diagram.md)
- [14 - Brukerreise gjennom løsningen](https://github.com/26zl/StudyWise/blob/main/filer_prosjekt/diagrammer/14-brukerreise.md)
- [15 - CI/CD-pipeline](https://github.com/26zl/StudyWise/blob/main/filer_prosjekt/diagrammer/15-cicd-pipeline.md)
- [16 - Milepæler og tidslinje](https://github.com/26zl/StudyWise/blob/main/filer_prosjekt/diagrammer/16-milepaeler-tidslinje.md)
- [17 - UML-klassediagram](https://github.com/26zl/StudyWise/blob/main/filer_prosjekt/diagrammer/17-uml-klassediagram.md)
- [18 - Work Breakdown Structure](https://github.com/26zl/StudyWise/blob/main/filer_prosjekt/diagrammer/18-wbs-work-breakdown.md)
- [19 - Teststrategi](https://github.com/26zl/StudyWise/blob/main/filer_prosjekt/diagrammer/19-test-strategi.md)
- [20 - STRIDE-basert trusselmodell](https://github.com/26zl/StudyWise/blob/main/filer_prosjekt/diagrammer/20-stride-trusselmodell.md)
- [21 - Observability-stack](https://github.com/26zl/StudyWise/blob/main/filer_prosjekt/diagrammer/21-observability-stack.md)

Hele diagrammappen kan også åpnes samlet:
[filer_prosjekt/diagrammer/](https://github.com/26zl/StudyWise/tree/main/filer_prosjekt/diagrammer)
```

Legg gjerne til denne setningen rett under introduksjonen i Vedlegg I:

> Lenkene under åpner mermaid-kilden direkte på GitHub, hvor diagrammene kan leses i kontekst. Høyoppløselige PNG-eksporter ligger i `filer_prosjekt/diagrammer/png/`.

## Punkt som er foreldet eller feil i gammel TODO

Ikke bruk tid på disse punktene lenger:

- [x] `Kan noen lese denne...` ble ikke funnet i PDF-en.
- [x] `Gjøre diagrammet litt mer tydelig kanskje?` ble ikke funnet i PDF-en.
- [x] `Markerer sketchy links med rød` ble ikke funnet i PDF-en.
- [x] Påstanden om at Vedlegg E mangler i TOC er feil. Vedlegg E finnes i innholdsfortegnelsen, men innhold/henvisninger må fortsatt være konsistente.
- [x] Store norske leksikon ser ut til å ha `u.å.-a` og `u.å.-b` i litteraturlisten.
- [x] Flere gamle punkter om Figur 11, 12, 13 og 14 er foreldet. PDF-en har disse figurnumrene riktig.
- [x] Gamle punkter som sier `Vedlegg L = Pentestrapport` er feil. Riktig struktur er `Vedlegg K = Pentestrapport` og `Vedlegg L = Canvas kontekst`.

## Innhold som bør legges til hvis tiden holder

Disse punktene er ikke like kritiske som restemarkører og tomme vedlegg, men de gir rapporten mer ærlig prosjektrefleksjon.

- [ ] **§ 3.1.5 Risikoanalyse:** Legg til risiko om driftskostnader/kvoter hos tredjepartstjenester.

  Forslag:

  | Risiko | Sannsynlighet | Konsekvens | Tiltak |
  |---|---|---|---|
  | Driftskostnader eller kvoter hos tredjepartstjenester overstiger prosjektets rammer. | Middels | Middels | Bruke gratisnivåer og prøvekreditter der det er mulig, overvåke forbruk, begrense unødvendige KI-kall og dokumentere kostnadsbildet som videre arbeid. |

- [ ] **§ 4.4.4 Leverandøravhengighet:** Nevn økonomisk avhengighet eksplisitt:

  > Leverandøravhengigheten er ikke bare teknisk, men også økonomisk. I bachelorperioden betalte gruppa for enkelte tjenester, blant annet Clerk, Heroku og Claude-bruk, mens Pinecone og Cohere i stor grad ble brukt gjennom gratisnivåer eller prøveperioder. Dette gjorde prosjektet gjennomførbart innenfor studentrammene, men betyr også at kostnadsbildet ikke er representativt for langsiktig drift med flere brukere.

- [ ] **§ 5.3 Videre arbeid:** Legg til kort avsnitt om kostnadsmodell:

  > Ved videre drift må også kostnadsmodellen avklares. I bachelorperioden ble enkelte tjenester betalt av gruppa, mens andre tjenester ble brukt gjennom gratisnivåer eller prøvekreditter. En videreføring av StudyWise krever derfor en konkret vurdering av faste månedlige kostnader, KI-forbruk, lagringskostnader, autentisering, observability og hvilke tjenester som må erstattes eller reforhandles dersom gratisnivåene ikke lenger er tilstrekkelige.

- [ ] **§ 4.4.2:** Nevn at Hugging Face/Qwen hadde svak dokumentforståelse, særlig for dokumenter med figurer, diagrammer og PowerPoint-struktur, og at dette var en grunn til bytte til Claude med bedre multimodal/langkontekst-støtte.
- [ ] **§ 4.4:** Nevn tydeligere hvorfor LangSmith ble brukt: se prompt, hentet kontekst, modellrespons og dårlige svar, ikke bare om kall feilet.
- [ ] **§ 4.5 eller § 4.3:** Nevn at dere først vurderte/bygde egen auth, men byttet til Clerk fordi autentisering er sikkerhetskritisk og vanskelig å gjøre riktig selv.
- [ ] **§ 4.4.1:** Nevn at endring fra ca. 5 minutter til lengre cachetid, opptil 24 timer for stabile Canvas-data, ga merkbar forbedring for KI-flyt og responstid.
- [ ] **§ 3.3.3 / § 4.3.7:** Nevn hvorfor BullMQ ble tatt i bruk etter hvert: eksplisitte jobbkøer gjorde opprydding, retry og bakgrunnsarbeid mer kontrollerbart enn ad hoc Redis-tilstand.
- [ ] **§ 5.3:** Nevn tunge PowerPoint-filer med diagrammer/figurer som videre arbeid for OCR, multimodal dokumentforståelse og feilhåndtering.
- [ ] **§ 4.3.7:** Nevn breaking changes ved pakkeoppdateringer, for eksempel Zod/Next.js, som teknisk gjeld og behov for kontrollert oppdateringsflyt.
- [ ] **§ 4.3.7 eller § 5.3:** Nevn Heroku-minneproblematikk som mitigert, men fortsatt en driftsbegrensning.
- [ ] **§ 3.4.2:** Nevn admin-delen som en samlet driftsflate som erstattet behovet for å sjekke flere eksterne dashboards manuelt.
- [ ] **§ 4.3.3:** Nevn Next.js App Router-treghet som praktisk erfaring og rammeverksrisiko.
- [ ] **§ 3.4.1 eller § 4.7.2:** Nevn env-validering som tiltak for å sikre at alle utviklere har riktige miljøvariabler og at feil oppdages ved startup.
- [ ] **§ 1.4, § 4.5.2 eller § 5.3:** Nevn at Canvas-institusjoner delvis er hardkodet og at dere ikke kan garantere støtte for alle universiteter/høyskoler.
- [ ] **§ 4.5:** Nevn at CSP, Clerk og Cloudflare krevde mye tuning for å balansere sikkerhet mot fungerende tredjepartsskript.

## Copy-paste-avsnitt klare for innliming

Disse er ferdige tekstutkast som kan limes inn i Word og justeres språklig ved behov.

### Til § 4.5.3 - Canvas-hendelsen og vurdering av tredjepartsrisiko

Bruk denne til å erstatte `Laurent fikser`.

> StudyWise er avhengig av flere eksterne tjenester, og Canvas er den viktigste av disse i brukerens studiehverdag. En hendelse, endring eller ustabilitet hos Canvas ville ikke nødvendigvis skyldes StudyWise, men kunne likevel påvirke brukeropplevelsen direkte. Dette gjør Canvas til en del av tredjepartsrisikoen i prosjektet, ikke bare en teknisk integrasjon.
>
> For StudyWise betyr dette at data fra Canvas må behandles som ekstern og potensielt ufullstendig informasjon. Systemet må håndtere manglende svar, endrede API-responser, ulike emnestrukturer og perioder der Canvas ikke er tilgjengelig. Vi har derfor brukt caching, feilhåndtering og tydelige feilmeldinger for å redusere konsekvensen for brukeren. Samtidig viser avhengigheten til Canvas hvorfor LTI 1.3 eller en institusjonell integrasjon ville vært bedre i en videreføring, fordi det kunne gitt mer standardisert tilgangsstyring, tydeligere ansvarsdeling og mindre friksjon for studenten.

### Til § 4.4.2 - Hugging Face/Qwen og bytte til Claude Vision

> I en tidlig fase brukte vi en Qwen-modell via Hugging Face. Denne fungerte greit for enkle tekstspørsmål, men hadde tydelige begrensninger når spørsmålene var knyttet til dokumenter, særlig filer med figurer, skjermbilder, diagrammer eller kompleks PowerPoint-struktur. I praksis klarte modellen ikke å bruke dokumentinnholdet godt nok som faglig kontekst, og viktige deler av materialet falt ofte ut. Dette var en av grunnene til at vi byttet til Claude-modeller med bedre støtte for lange kontekster og multimodalt innhold. Byttet ga mer stabile svar og bedre dokumentforståelse, men løste ikke alle problemer knyttet til tunge dokumenter.

### Til § 4.4.1 - Cache fra 5 minutter til 24 timer

> En praktisk erfaring var at cache-tid hadde stor betydning for KI-opplevelsen. Tidlig hadde enkelte Canvas-data kort cachetid, rundt fem minutter. Dette førte til hyppigere nye kall, tregere responser og mer uforutsigbar tilgjengelighet av kontekst. Da cache-strategien ble justert slik at relativt stabile Canvas-data kunne ligge lenger, opptil 24 timer der det var forsvarlig, ble KI-flyten merkbart raskere og mer stabil. Dette viser at KI-kvalitet ikke bare handler om modellvalg, men også om datatilgang, caching og systemytelse rundt modellen.

### Til § 4.4 - Hvorfor LangSmith ble brukt

> LangSmith ble lagt til for å gi bedre innsikt i KI-pipelinen. Vanlige backend-logger viser at et kall ble gjennomført, men ikke nødvendigvis hvorfor et KI-svar ble dårlig. Med LangSmith kunne vi undersøke prompt, valgt kontekst, modellrespons og feiltilfeller mer strukturert. Dette var særlig nyttig ved feilsøking av hallusineringer, svake svar, manglende kontekst og tilfeller der retrieval hentet feil materiale.

### Til § 4.5 eller § 4.3 - Fra egen autentisering til Clerk

> I starten vurderte vi og eksperimenterte med egen autentiseringslogikk, men dette ble forlatt til fordel for Clerk. Begrunnelsen var sikkerhet og modenhet. Autentisering er et sikkerhetskritisk område med mange detaljer, som passordlagring, sesjoner, OAuth, MFA, recovery og kontoendringer. Ved å bruke en etablert identitetsleverandør kunne vi redusere risikoen for feil i egen implementasjon og heller konsentrere oss om autorisasjon, rollemodell og sikker håndtering av StudyWise-data.

### Til § 3.3.3 eller § 4.3.7 - Hvorfor BullMQ ble tatt i bruk

> Etter hvert som løsningen vokste, ble det tydelig at Redis ikke burde brukes som en ustrukturert oppsamlingsplass for all midlertidig tilstand. Redis ble brukt til cache, rate limiting, låser og etter hvert flere typer bakgrunnsarbeid, og dette gjorde opprydding og feilhåndtering vanskeligere. BullMQ ble derfor tatt i bruk for å gjøre asynkrone oppgaver mer eksplisitte. Med køer, jobber, workers, retry og feilede jobber ble det lettere å skille mellom cache-data og faktisk bakgrunnsarbeid, og lettere å følge opp oppgaver som sletting, cleanup og web-push.

### Til § 5.3 - Tunge PowerPoint-filer og visuelt innhold

> Videre arbeid bør også se nærmere på dokumentforståelse for tunge PowerPoint-filer, PDF-er med figurer og dokumenter der viktig informasjon ligger visuelt heller enn som ren tekst. Dette var en kjent begrensning i prosjektet. Claude-modeller med multimodal støtte forbedret situasjonen sammenlignet med den tidlige Hugging Face-løsningen, men en produksjonsmoden løsning bør ha mer systematisk testing av dokumenttyper, OCR, figurforståelse og feilhåndtering når innhold ikke kan ekstraheres godt nok.

### Til § 4.3.7 - Breaking changes i pakker som Zod og Next.js

> Prosjektet opplevde også teknisk risiko ved oppdatering av pakker. Enkelte oppdateringer, blant annet i validerings- og rammeverksnære avhengigheter som Zod og Next.js, kunne introdusere breaking changes eller endret oppførsel som krevde refaktorering. Dette understreker hvorfor CI, typesjekking og delte skjemaer er viktige, men også hvorfor avhengighetsoppdateringer må behandles kontrollert og ikke bare installeres automatisk.

### Til § 4.3.7 eller § 5.3 - Heroku-minneproblematikk

> Drift på Heroku ga også praktiske begrensninger. Backend måtte håndtere API-trafikk, KI-flyter, dokumentprosessering og bakgrunnsjobber innenfor minnegrensene til valgte dynoer. Vi opplevde perioder med høyt minneforbruk, særlig ved tyngre dokumentbehandling og samtidige jobber. Dette er mitigert gjennom mer kontrollert prosessering, købasert arbeid og opprydding, men er fortsatt en driftsbegrensning som bør vurderes dersom løsningen videreføres med flere brukere.

### Til § 3.4.2 - Admin som samlet driftsflate

> Admin-delen ble etter hvert viktigere enn først planlagt. Tidlig måtte vi ofte besøke flere eksterne tjenester og dashboards for å forstå om en feil skyldtes backend, køer, tredjepartstjenester, logger eller brukerdata. Ved å samle statistikk, auditlogger, køstatus, kontaktmeldinger og systemstatus i en egen adminflate ble det enklere å undersøke driftsproblemer fra ett sted. Dette gjorde ikke eksterne verktøy overflødige, men reduserte friksjonen i daglig feilsøking.

### Til § 4.3.3 - Next.js App Router og treghet

> Next.js App Router ga en moderne struktur for ruter, layouts og servernære komponenter, men vi opplevde også praktiske problemer med ytelse under utvikling. I perioder ble deler av applikasjonen tregere enn forventet, og feilsøking krevde gjennomgang av datalasting, klientkomponenter, serverkomponenter og caching. Erfaringen viser at App Router gir mye fleksibilitet, men også at feil plassering av datalasting eller for tunge komponenter raskt kan påvirke opplevd ytelse.

### Til § 3.4.1 eller § 4.7.2 - Env-validering

> For å redusere miljørelaterte feil ble det lagt inn validering av miljøvariabler. Dette gjør at applikasjonen feiler tidlig dersom nødvendige variabler mangler eller har ugyldig format, i stedet for at feilen først oppstår midt i en brukerforespørsel. Tiltaket var særlig nyttig fordi flere utviklere jobbet lokalt med ulike `.env`-oppsett, samtidig som produksjon brukte egne variabler i Vercel, Heroku og tredjepartstjenester.

### Til § 1.4, § 4.5.2 eller § 5.3 - Hardkodede Canvas-institusjoner

> Canvas-støtten er også en avgrensning. I starten støttet vi bare USN, før løsningen ble utvidet med flere norske institusjoner. Listen over institusjoner er likevel basert på kjente Canvas-domener og er ikke en garanti for at alle universiteter eller høyskoler bruker Canvas, eller at Canvas-oppsettet deres fungerer likt. En mer moden løsning bør derfor ha en dynamisk institusjonskatalog eller institusjonell integrasjon i stedet for en hardkodet liste.

### Til § 4.5 - CSP, Clerk og Cloudflare-tuning

> En annen praktisk sikkerhetserfaring var at strenge sikkerhetsmekanismer måtte balanseres mot fungerende tredjepartsintegrasjoner. CSP-reglene måtte justeres flere ganger for å støtte Clerk, Cloudflare Turnstile, analyseverktøy og nødvendige scripts uten å åpne policyen mer enn nødvendig. Dette viser at sikkerhetsheadere ikke bare kan settes én gang og glemmes. I en moderne webapplikasjon med flere eksterne tjenester må CSP, CORS, Cloudflare-regler og autentiseringsflyt testes samlet.

### Til § 4.5.2 - Brukerstyrt Canvas-kontekst og dataminimering

> For at KI-assistenten skal kunne gi kontekstuelt relevante svar, må den ha tilgang til studentens data. Dette er løst gjennom et eksplisitt kontrollprinsipp der brukeren selv velger hvilke datakilder som tillates brukt som kontekst. Studenten kan individuelt aktivere eller deaktivere tilgang til kunngjøringer, emner, oppgaver og kalender, uten at alle data automatisk gjøres tilgjengelig for modellen. Dette gir brukeren mer direkte kontroll over informasjonsflyten og reduserer risikoen for at sensitiv eller irrelevant informasjon utilsiktet inngår i KI-konteksten. Tilnærmingen støtter dataminimeringsprinsippet i GDPR, fordi kun data som er relevante for den aktuelle funksjonen bør behandles.

### Til § 4.4.4 - Kostnader og gratisnivåer

> Leverandøravhengigheten er ikke bare teknisk, men også økonomisk. I bachelorperioden betalte gruppa for enkelte tjenester, blant annet Clerk, Heroku og Claude-bruk, mens Pinecone og Cohere i stor grad ble brukt gjennom gratisnivåer eller prøveperioder. Dette gjorde prosjektet gjennomførbart innenfor studentrammene, men betyr også at kostnadsbildet ikke er representativt for langsiktig drift med flere brukere. Dersom StudyWise videreføres, må kostnader til KI-kall, autentisering, hosting, observability, vektorsøk og reranking vurderes som en del av driftsmodellen.

### Til § 5.3 - Kostnadsmodell ved videreføring

> Ved videre drift må også kostnadsmodellen avklares. I bachelorperioden ble enkelte tjenester betalt av gruppa, mens andre tjenester ble brukt gjennom gratisnivåer eller prøvekreditter. En videreføring av StudyWise krever derfor en konkret vurdering av faste månedlige kostnader, KI-forbruk, lagringskostnader, autentisering, observability og hvilke tjenester som må erstattes eller reforhandles dersom gratisnivåene ikke lenger er tilstrekkelige.

### Til Vedlegg L - Canvas kontekst

> Vedlegg L dokumenterer hvordan StudyWise bruker Canvas-data som kontekst i KI-funksjoner. Canvas-kontekst kan omfatte emner, oppgaver, kalenderhendelser, kunngjøringer og moduler, avhengig av hva brukeren har koblet til og aktivert. Dataene hentes via brukerens personlige Canvas-token, caches der det er forsvarlig, og brukes som del av promptgrunnlaget når brukeren stiller spørsmål eller genererer studierelatert innhold. Hensikten med vedlegget er å vise hvilke Canvas-datakilder som kan inngå i KI-konteksten, og hvordan dette er avgrenset gjennom brukerinnstillinger, caching og dataminimering.

## Siste Word-sjekk

- [ ] Oppdater innholdsfortegnelsen etter alle stilendringer.
- [ ] Oppdater figur- og tabelliste hvis rapporten bruker det.
- [ ] Sjekk at alle bilder faktisk vises i eksportert PDF, ikke bare i Word.
- [ ] Sjekk at alle overskrifter i vedlegg har riktig Heading-nivå.
- [ ] Sjekk at alle captions bruker Caption/Bildetekst-stil.
- [ ] Søk etter doble tomsider i vedlegg.
- [ ] Eksporter ny PDF og søk i PDF-tekst etter de samme restemarkørene.
