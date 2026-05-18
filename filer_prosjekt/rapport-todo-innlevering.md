# Rapport TODO - siste Word-rydd før innlevering

Dette er den korte gjenværende sjekklisten etter siste PDF-eksport
`StudyWise_BachelorOppgave26-IT(3).pdf`.

Målet er bare å holde orden på de siste synlige formaterings- og vedleggsfeilene i
Word/PDF. Ikke legg inn nytt rapportinnhold her.

Statusen under er justert mot rapportutdraget limt inn 18.05.2026.

## Står igjen

- [ ] **5.2.1:** CLAUDE.md-avsnittet vises i innholdsfortegnelsen. Sett avsnittet til **Normal** i Word og oppdater TOC.
- [ ] **1.5:** Det står `o • Kapittel 3.5.7 ...`. Fjern `o` og behold ett vanlig kulepunkt.
- [ ] **Vedlegg E:** Vedlegg E mangler fortsatt i innholdsfortegnelsen / vedleggene hopper fra D til F. Lag Vedlegg E med SUS/NPS-tabell, eller fjern referanser til Vedlegg E.
- [ ] **Vedlegg K:** Vedlegg K lager fortsatt rare tomme linjer/prikker i innholdsfortegnelsen. Sjekk tomme avsnitt, bildetekster og overskriftsstiler rundt Vedlegg K-bildene.
- [ ] **Vedlegg L:** Overskrift og kort pentestrapport-oppsummering finnes, men selve pentestrapporten er ikke lagt inn/vedlagt i rapporten. Legg inn full rapport fra `filer_prosjekt/pentest-studwize.md` eller gjør det eksplisitt at den leveres som separat repo-fil.
- [ ] **Siste restesøk:** Fjern synlige rester i rapportutdraget: `Kan noen lese denne og evt justere på den` i § 4.4.2, `-----------------------REVIEW` i § 4.5.2, `Gjøre diagrammet litt mer tydelig kanskje?` under CI/CD-figuren, og `Markerer sketchy links med rød` i litteraturlisten. Søk i tillegg etter `TODO` og `KILDE HER`.

## Figur- og tabellnummerering

- [ ] **Figur 11 er brukt to ganger:** Omnummerer figurene slik at middleware beholder **Figur 11**, CI/CD-pipeline blir **Figur 12** (var Figur 11), dataflyt med kryptering blir **Figur 13** (var Figur 12), og SUS-figur i § 4.6.1 blir **Figur 14** (var Figur 13).
- [ ] **§ 3.4.5:** Rett feilformatert bildetekst/brødtekst. `Figur 10: visualiserer middleware-kjeden...` skal være brødtekst: `Figur 10 visualiserer middleware-kjeden...`.
- [ ] **Vedlegg B:** Rett tabellreferansen fra `Tabell 2 i kapittel 3.2 viser et utdrag av MoSCoW` til at MoSCoW er **Tabell 3**.
- [ ] **Vedlegg C:** Rett tabellreferansen fra `Tabell 1 i kapittel 3.1.5 viser et utdrag av risikoanalysen` til at risikoanalysen er **Tabell 2**.
- [ ] **Tabellnummerering:** Dobbeltsjekk at faktisk rekkefølge er 1 = Milepæler, 2 = Risikoanalyse, 3 = MoSCoW, 4 = Hovedteknologier, 5 = Testkommandoer, 6 = CI/CD, 7 = Sikkerhetstiltak.

## Vedlegg som må fikses eller legges til

- [ ] **4.1 Vedlegg E:** Mangler helt. § 3.5.4 refererer til `Vedlegg E`, men vedleggene hopper fra D til F. Lag Vedlegg E med SUS-rådata/SUS- og NPS-tabell, eller fjern referansen i § 3.5.4.
- [ ] **4.2 Vedlegg K:** Vedlegg K eksisterer og rapporten viser til figur K1, men innholdsfortegnelsen/vedleggssidene har fortsatt tomme linjer/prikker. Sjekk at K1 faktisk er synlig og at eventuelle K2/K3 for Snyk/DeepScan-bilder enten er lagt inn eller bevisst utelatt.
- [ ] **4.3 Vedlegg L - Pentestrapport:** Vedlegg L finnes nå med kort pentestrapport-struktur, 35 funn (F-01 til F-35), F-14/F-29 og mitigeringer, og det er ikke lenger gammel docs-/brukerveiledningstekst. Selve pentestrapporten er likevel ikke lagt inn/vedlagt. Legg inn full rapport fra `filer_prosjekt/pentest-studwize.md`, eller avklar tydelig at repo-filen er vedlegget sensor skal lese.

- [ ] **4.4 Vedlegg M (vurder):** Legg eventuelt til kort sammendrag av `compliance/`-mappa med henvisning til de syv dokumentene. Alternativt utvid compliance-omtalen i § 3.6.2 uten eget vedlegg.
- [ ] **4.5 Vedlegg N (valgfritt):** Legg eventuelt til kort henvisning til `filer_prosjekt/manus-milepael-3.md`, `filer_prosjekt/kanban-brukerhistorier.txt` og `filer_prosjekt/teknisk-kanban-issues.txt` for å vise prosjektartefakter utenfor GitHub Projects.

## Siste format- og kildekontroll

- [ ] **TOC + kapitteloverskrifter:** `1. Innledning` (med punktum) og `4 Drøfting` (uten punktum) er inkonsistent. Velg én stil og bruk den konsekvent.
- [x] **Forordet:** Stavemåten `Ingrid Sundbø` ser riktig ut i rapportutdraget.
- [ ] **Litteraturlisten:** Store norske leksikon er brukt to ganger med bare `(u.å.)`. Skill dem med `u.å.-a` og `u.å.-b`.
- [ ] **Litteraturlisten:** `m’Raihi` ser konsistent ut i utdraget, men kjør et siste Word-søk etter både `m'Raihi` og `m’Raihi` før innlevering.

## Del 3-status

Ikke marker hele del 3 som ferdig ennå. Punktene under skiller mellom det som er synlig implementert i siste PDF, og det som fortsatt bør verifiseres manuelt i Word.

### Ferdig / i praksis ferdig

- [x] 3.1 Branch protection / Rulesets.
- [x] 3.2 Security Headers A+ skann.
- [x] 3.3 Snyk og DeepScan som utviklingsnære skann.
- [x] 3.4 Henvisninger til Vedlegg J og K.
- [x] 3.5 Pentest-utvidelse.
- [x] 3.5.0 MFA og backup codes, hovedinnhold.
- [x] 3.5.1 Manuell pentest i 3.5.6.
- [x] 3.5.2 Funn fra pentesten.
- [x] 3.5.3 Korrigert 4.7.2.
- [x] 3.6.1 Konkrete testtall.
- [x] 3.6.2 Compliance-dokumenter.
- [x] 3.6.3 CLAUDE.md som metodisk bidrag.
- [x] 3.6.4 Datadog AppSec + IAST i Tabell 7.
- [x] 3.6.5 requireCloudflare.
- [x] 3.6.6 Prompt-injection-vern på indekseringstidspunkt.
- [x] 3.6.7 Egendefinert soft-delete-lint.
- [x] 3.6.8 Cloudflare Origin Certificate + Full strict TLS.
- [x] 3.6.9 Health-endepunkter.
- [x] 3.6.11 Migrasjoner append-only og idempotent.
- [x] 3.6.12 PostHog i 4.4.4 Leverandøravhengighet.
- [x] 3.7 Omskrevet sammendrag.

### Åpent til manuell verifisering

- [ ] 3.5.4 Vedlegg L finnes som Pentestrapport i innholdsfortegnelsen, men selve pentestrapporten er ikke lagt inn/vedlagt. Se 4.3.
- [ ] 3.6.10 Swagger UI / OpenAPI.
- [ ] 3.8 Metodekapittel-punktet er innholdsmessig lagt inn, men har formateringsfeil i 1.5: `o • Kapittel 3.5.7 ...`. Rett til vanlig kulepunkt.

Når punktene er løst og verifisert i ny PDF-eksport, kan denne filen også slettes eller flyttes ut av repoet før endelig innlevering.
