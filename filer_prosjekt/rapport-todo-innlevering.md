# Rapport TODO - siste kontroll før innlevering

Basert på siste kontrollerte PDF: `C:\Users\lenti\Desktop\StudyWise_BachelorOppgave26-IT.pdf`.

Sist kontrollert mot PDF eksportert **18.05.2026 kl. 21:11**, 140 sider. Denne TODO-en viser bare gjenstående punkter som bør rettes før ny PDF-eksport.

Målet med denne filen er å samle de siste synlige rapportfeilene før ny PDF-eksport. Den skal ikke bli et nytt rapportkapittel.

## Start her hvis dere jobber i Word nå

Dette er den korte praktiske rekkefølgen. Alt dere trenger ligger i denne filen.

1. **Behold vedleggsstrukturen slik den faktisk er nå (A-H), men oppdater TOC og henvisninger.** PDF-en har fortsatt gamle TOC-linjer og `Feil! Bokmerke er ikke definert.` for vedlegg som ikke lenger finnes slik.
2. Erstatt placeholderen `Tekst her forklare hva vi bruker av vedlegg og hvorfor` i vedleggsinnledningen.
3. Fjern de to synlige review-markørene i § 3.3.3 og § 4.5.2. I § 4.5.2 skal også avsnittet etter `-----------------------REVIEW` fjernes hvis dere ikke skal ha Canvas-kontekst/`Vedlegg L` med. Søk etter de eksakte tekstene `………………………………….Review…………………………………..` og `-----------------------REVIEW`, ikke bare ordet `review`, fordi `review` også finnes legitimt i litteratur og metodebeskrivelser.
4. Rett hovedteksten: `Vedlegg I` skal bli `Vedlegg G`, `Vedlegg J` skal bli `Vedlegg H`, og `Vedlegg K/L` skal ikke brukes hvis de ikke finnes som vedlegg.
5. Link til full pentestrapport i GitHub-repoet i stedet for å vise til `Vedlegg K`.
6. Søk etter `ligger her` og erstatt med konkrete GitHub-lenker eller `gjengitt nedenfor`.
7. Rett diagram-/sikkerhetsvedlegg: diagramkatalogen er **Vedlegg G**, sikkerhetsvedlegget er **Vedlegg H**. Hvis underpunktene fortsatt heter `J1-J7`, endre dem til `H1-H7`.
8. Rett caption/stiler: Figur 10 og tabelltekster som lekker inn i TOC.
9. Fjern restemarkøren `Passe på alfabetisk rekkefølge` over litteraturlisten.
10. Oppdater innholdsfortegnelsen, eksporter ny PDF og søk i PDF-teksten etter restemarkørene igjen.

## Vedleggsinnledning

> Vedleggene inneholder utvalgte dokumentasjonsutdrag, skjermbilder og oversikter som støtter hovedteksten. Fullstendige tekniske artefakter, diagramfiler og rapporter ligger i prosjektets GitHub-repository. Hovedteksten oppsummerer og drøfter funnene, mens vedleggene dokumenterer grunnlaget.

Merk for dagens struktur: Pentestrapport og Canvas-kontekst ligger ikke som faktisk vedleggsinnhold i PDF-en nå. `Vedlegg K` vises bare som en gammel/ødelagt TOC-linje, og `Vedlegg L` finnes bare som en feil henvisning i hovedteksten. Hvis dere ikke legger dem til, må hovedteksten omtale dem som repo-artefakt/avsnitt, ikke som Vedlegg K/L.

## Kritisk før ny PDF-eksport

Disse punktene er verifisert i PDF-en fra 18.05.2026 kl. 21:11 og bør fikses før innlevering. Utgangspunktet her er at vedleggene beholdes slik de faktisk står i vedleggsdelen: A-H.

- [ ] **Innholdsfortegnelse og bokmerker:** Oppdater TOC slik at den matcher faktisk vedleggsstruktur A-H i vedleggsdelen. TOC-en viser nå gamle/feil vedleggslinjer: `Vedlegg B - Komplett MoSCoW-matrise`, `Vedlegg C - Komplett risikoanalyse`, `Vedlegg D - Brukertestskjema`, `Vedlegg E - Skjermbilder`, `Vedlegg F - Gantt`, `Vedlegg G - Arkitektur`, `Vedlegg H - Use case`, `Vedlegg I - Teknisk diagramkatalog`, `Vedlegg J - Sikkerhet...` og `Vedlegg K - Pentestrapport`. Den skal i stedet følge A-H-listen under.
- [ ] **Bokmerkefeil:** Fjern `Feil! Bokmerke er ikke definert.` i TOC. Feilen skyldes trolig gamle/ødelagte heading-kryssreferanser.
- [ ] **Vedleggsbokstaver:** Behold dagens faktiske vedleggsbokstaver, men pass på at TOC og hovedtekst bruker samme bokstaver.
- [ ] **Vedleggsinnledning:** Erstatt teksten `Tekst her forklare hva vi bruker av vedlegg og hvorfor` på side 128 med ferdig vedleggsintroduksjon.
- [ ] **§ 3.3.3:** Fjern `………………………………….Review…………………………………..` på side 51.
- [ ] **§ 4.5.2:** Fjern `-----------------------REVIEW` på side 97. Hvis Canvas-kontekst/`Vedlegg L` ikke skal være med, fjern hele avsnittet fra `For at KI-assistenten...` til og med `...for et gitt formål.`
- [ ] **Hovedtekst s. 49:** Endre `Flere detaljerte tekniske diagrammer er samlet i Vedlegg I` til `Vedlegg G`.
- [ ] **Hovedtekst s. 73:** Endre pentesthenvisningen fra `ligger i Vedlegg K` til konkret repo-lenke til `filer_prosjekt/pentest-studwize.md`.
- [ ] **Hovedtekst s. 73:** Endre `Vedlegg J, figur J1` til `Vedlegg H, figur H1` hvis sikkerhetsunderpunktene endres til H1-H7.
- [ ] **Hovedtekst s. 74:** Endre `Observability-oppsettet er dokumentert som teknisk diagram i Vedlegg I` til `Vedlegg G`.
- [ ] **Hovedtekst s. 74:** Endre `skjermbilder ... lagt ved i Vedlegg J` til `Vedlegg H`.
- [ ] **Hovedtekst s. 97:** Fjern hele `figur (vedlegg L)`-avsnittet hvis Canvas-kontekst ikke skal være med.
- [ ] **Hovedtekst s. 107:** Endre `Detaljer ligger i Vedlegg K` til at detaljene ligger i full pentestrapport i GitHub-repositoriet.
- [ ] **`ligger her`:** Søk etter alle tre forekomster på side 132-134 og erstatt med konkret GitHub-lenke eller `gjengitt nedenfor`.
- [ ] **Litteraturliste s. 119:** Fjern restemarkøren `Passe på alfabetisk rekkefølge` og kontroller at kildene er sortert alfabetisk.
- [ ] **Vedlegg G s. 135-136:** PDF-en sier `PNG-format`, men lista viser `.md`-filnavn. Erstatt denne delen med den oppdaterte diagramkatalogen fra `filer_prosjekt/rapport-figurer/vedlegg/vedlegg-g-teknisk-diagramkatalog.md`, eller bruk konkrete PNG-lenker uten å lime inn alle diagrammene som bilder.
- [ ] **Vedlegg H - sikkerhet:** Underpunktene heter fortsatt `J1-J7`, men vedlegget er H. Endre underpunktene til `H1-H7`, og oppdater hovedtekstens `figur J1` til `figur H1`.
- [ ] **§ 3.2.4:** Oppdater admin-beskrivelsen hvis dere vil unngå at `publisere systemmeldinger` fremstår som et eget hoved-use-case:

  > For administrator er de viktigste brukstilfellene å se overordnet statistikk og administrere drift og brukere. Publisering av systemmeldinger inngår i administrativ drift.

- [ ] **Innholdsfortegnelsen:** Tabell-bildetekster lekker fortsatt inn i TOC, spesielt `Tabell 2` og `Tabell 5`. Sett `Tabell X:`-tekstene til Word-stilen **Bildetekst/Caption**, ikke Heading, og oppdater TOC.
- [ ] **Figur 10:** Teksten `Figur 10: visualiserer middleware-kjeden...` på side 68 er ikke en god bildetekst. Bruk for eksempel:

  > Figur 10: Middleware-kjede med avvisningspunkter i backend.

- [ ] **Siste synlige restesøk i Word/PDF:** Søk etter kjente faktiske treff: `………………………………….Review`, `-----------------------REVIEW`, `ligger her`, `Tekst her`, `Feil! Bokmerke`, `Vedlegg I`, `Vedlegg J`, `Vedlegg K`, `vedlegg L` og `Passe på alfabetisk`. Ta gjerne et ekstra sanity-søk etter `TODO`, `KILDE HER`, `fikser`, `Markerer`, `Kan noen lese` og `Gjøre diagrammet`; disse ble ikke funnet i PDF-en fra 18.05.2026 kl. 21:11, men er raske å kontrollere.

## Vedleggsstruktur som skal beholdes

Behold vedleggene slik de faktisk står i vedleggsdelen. Jobben er ikke å lage nye vedlegg rett før innlevering, men å rette TOC og hovedtekst slik at de peker på riktig bokstav.

```text
Vedlegg A - Gruppekontrakt
Vedlegg B - Brukertestskjema, struktur og innhold
Vedlegg C - Skjermbilder fra produksjon
Vedlegg D - Gantt-skjema
Vedlegg E - Arkitekturdiagram
Vedlegg F - Use case-diagram
Vedlegg G - Teknisk diagramkatalog
Vedlegg H - Sikkerhet, kvalitetsskann og observability
```

Viktig: Etter at TOC og henvisninger er rettet i Word, oppdater TOC og sjekk at `Feil! Bokmerke er ikke definert.` er borte.

Sjekkpunkter:

- [ ] Ikke kall Vedlegg C for `SUS-resultater` noe sted. Vedlegg C er nå skjermbilder fra produksjon.
- [ ] Hvis SUS-tabellen fortsatt trengs, behold den i § 4.6.1 eller lag et eget vedlegg. Ikke omnummerer hovedteksten rett før innlevering hvis det skaper mer rot.
- [ ] TOC må ikke lenger liste MoSCoW/risikoanalyse som Vedlegg B/C hvis de ikke finnes der.
- [ ] Vedlegg G skal være en katalog med lenker til diagrammene i repoet, ikke en full kopi av alle diagrammene.
- [ ] Vedlegg G må ikke si `PNG-format` og deretter liste `.md`-filer uten klikkbare PNG-lenker.
- [ ] Vedlegg H skal være skjermbilder/bevis fra Security Headers, DeepScan, GitHub Actions, Datadog, PostHog og Cloudflare.
- [ ] Ikke bruk Vedlegg K/L i hovedtekst hvis de ikke finnes som vedlegg. Bruk repo-lenke for pentestrapport og vanlig teksthenvisning for Canvas-kontekst.

## Hovedtekst: korte henvisninger, ikke fulle vedlegg

Bruk korte formuleringer som disse i hovedkapitlene:

```text
Vi gjennomførte en manuell pentest med 35 nummererte funn. De viktigste funnene var F-14 og F-29, som drøftes i 4.5.6. Full pentestrapport ligger i prosjektets GitHub-repository.
```

```text
Utvalgte sikkerhets- og observability-resultater er dokumentert i Vedlegg H, blant annet Security Headers, DeepScan, GitHub Actions, Datadog, PostHog og Cloudflare.
```

```text
Detaljerte tekniske diagrammer er samlet i Vedlegg G som diagramkatalog, med lenker til høyoppløselige PNG-versjoner i GitHub-repositoriet.
```

## Ufullstendige lenker og "ligger her"

- [ ] Søk etter alle forekomster av `ligger her`.
- [ ] Hvis full artefakt finnes i repoet, erstatt teksten med en konkret GitHub-lenke.
- [ ] Hvis full artefakt allerede er gjengitt i vedlegget, skriv `gjengitt nedenfor` i stedet for `ligger her`.
- [ ] I ny PDF finnes `ligger her` i Gantt-, arkitektur- og use case-vedleggene. Siden figurene allerede står i Vedlegg D, E og F, erstatt `ligger her` med `gjengitt nedenfor`. GitHub-lenkene bør ligge i Vedlegg G, ikke gjentas her.
  - Vedlegg D: skriv at Gantt-figuren er `gjengitt nedenfor`.
  - Vedlegg E: skriv at arkitekturfiguren er `gjengitt nedenfor`.
  - Vedlegg F: skriv at use case-figuren er `gjengitt nedenfor`.
- [ ] For pentestrapport kan teksten peke direkte til:
  - `https://github.com/26zl/StudyWise/blob/main/filer_prosjekt/pentest-studwize.md`
- [ ] Ikke bruk usikre lenker til filer som kanskje ikke finnes, som `moscow.md`, uten å kontrollere faktisk filsti først. **Verifisert 18.05.2026:** `moscow.md` finnes ikke i repoet. Hvis MoSCoW/risikoanalyse ikke er egne vedlegg, skal de heller ikke stå som Vedlegg B/C i TOC.

## Innhold som bør legges til hvis tiden holder

Disse punktene er ikke like kritiske som restemarkører og vedleggsfeil, men de kan styrke rapporten hvis dere rekker det.

- [ ] **§ 1.4, § 4.5.2 eller § 5.3:** Nevn at Canvas-institusjoner delvis er hardkodet og at dere ikke kan garantere støtte for alle universiteter/høyskoler. Dette ble ikke funnet tydelig i ny PDF.
- [ ] **§ 4.5:** Nevn at CSP, Clerk og Cloudflare krevde mye tuning for å balansere sikkerhet mot fungerende tredjepartsskript. CSP nevnes, men ikke denne praktiske tuning-erfaringen.

## Copy-paste-avsnitt klare for innliming

Disse er ferdige tekstutkast som kan limes inn i Word og justeres språklig ved behov.

### Til § 1.4, § 4.5.2 eller § 5.3 - Hardkodede Canvas-institusjoner

> Canvas-støtten er også en avgrensning. I starten støttet vi bare USN, før løsningen ble utvidet med flere norske institusjoner. Listen over institusjoner er likevel basert på kjente Canvas-domener og er ikke en garanti for at alle universiteter eller høyskoler bruker Canvas, eller at Canvas-oppsettet deres fungerer likt. En mer moden løsning bør derfor ha en dynamisk institusjonskatalog eller institusjonell integrasjon i stedet for en hardkodet liste.

### Til § 4.5 - CSP, Clerk og Cloudflare-tuning

> En annen praktisk sikkerhetserfaring var at strenge sikkerhetsmekanismer måtte balanseres mot fungerende tredjepartsintegrasjoner. CSP-reglene måtte justeres flere ganger for å støtte Clerk, Cloudflare Turnstile, analyseverktøy og nødvendige scripts uten å åpne policyen mer enn nødvendig. Dette viser at sikkerhetsheadere ikke bare kan settes én gang og glemmes. I en moderne webapplikasjon med flere eksterne tjenester må CSP, CORS, Cloudflare-regler og autentiseringsflyt testes samlet.

### Til hovedtekst - pentestrapport som repo-artefakt

Bruk denne hvis dere beholder dagens vedleggsstruktur A-H og ikke skal ha eget Vedlegg K:

> Vi gjennomførte en manuell penetrasjonstest av StudyWise med fokus på autentisering, autorisasjon, API-endepunkter, rate limiting, inputvalidering, kontosletting, Canvas-tokenhåndtering og KI-relaterte angrepsflater som prompt injection.
>
> Testen resulterte i 35 nummererte funn. Ingen kritiske sårbarheter ble stående åpne ved levering. De mest relevante funnene for hovedrapporten er drøftet i kapittel 4.5.6, blant annet F-14 og F-29, fordi de påvirket sikkerhetsdesign og mitigeringer i løsningen.
>
> Full pentestrapport ligger i prosjektets GitHub-repository:  
> `https://github.com/26zl/StudyWise/blob/main/filer_prosjekt/pentest-studwize.md`

Kort setning til hovedtekst hvis den trengs:

> Full pentestrapport er ikke gjengitt i sin helhet i rapporten, men ligger som artefakt i prosjektets GitHub-repository.

## Siste Word-sjekk

- [ ] Oppdater innholdsfortegnelsen etter alle stilendringer.
- [ ] Oppdater figur- og tabelliste hvis rapporten bruker det.
- [ ] Sjekk at alle bilder faktisk vises i eksportert PDF, ikke bare i Word.
- [ ] Sjekk at alle overskrifter i vedlegg har riktig Heading-nivå.
- [ ] Sjekk at alle captions bruker Caption/Bildetekst-stil.
- [ ] Søk etter doble tomsider i vedlegg.
- [ ] Eksporter ny PDF og søk i PDF-tekst etter de samme restemarkørene.
