# Manglende temaer i bachelorrapporten — ferdig tekst til innliming

Dette dokumentet samler ferdig norsk tekst for de syv temaene som mangler eller er underdekket i hovedrapporten. Hvert avsnitt er skrevet i samme tone og stil som resten av rapporten, og kan kopieres direkte inn i Word. Plasseringsforslag står over hver tekstblokk.

Prioritert rekkefølge før innlevering:

1. Supply chain-angrep — teori i 2.5.2 + praksis i 3.5.6/3.6
2. Dependabot og automatisert avhengighetsoppdatering — tillegg i 3.5.6
3. Snyk og DeepScan som utviklingsnære skann — tillegg i 3.5.6
4. Docker — én linje i 3.4.1
5. GitHub Copilot eksplisitt nevnt — liten edit i 4.8.2
6. Prosjektskisse, prosjektbeskrivelse og Google Forms-PDF som vedlegg
7. GitHub Education — kort merknad i 3.1.4
8. Rapportstruktur knyttet til Johannessen — én setning i 1.5 eller 3.5.7

---

## 1. Supply chain-angrep

### 1a. Tillegg i 2.5.2 (Sårbarhetsskann og penetrasjonstesting)

Plassering: nytt avsnitt etter eksisterende tekst om penetrasjonstesting i 2.5.2, før setningen "Automatiserte skann og manuell penetrasjonstesting er derfor komplementære."

> En egen kategori sikkerhetsrisiko som har fått økt oppmerksomhet de siste årene, er forsyningskjedeangrep mot programvare. I et slikt angrep kompromitteres ikke applikasjonen direkte, men en av avhengighetene den bygger på. Ohm mfl. beskriver hvordan ondsinnede pakker har blitt distribuert via offentlige pakkeregistre som npm og PyPI, og at vanlige angrepsvektorer omfatter typosquatting, kompromitterte vedlikeholderkontoer og innsmugling av skadelig kode i nye versjoner av legitime pakker (Ohm mfl., 2020). ENISA peker på at slike angrep er særlig krevende fordi de utnytter den eksisterende tillitskjeden mellom utvikler, pakkeregister og kjøretid, og at konsekvensen kan ramme alle som installerer den kompromitterte versjonen (ENISA, 2021).
>
> Konkrete hendelser de siste årene illustrerer alvoret. Bakdøren i `xz-utils` (CVE-2024-3094) viste hvordan en langvarig sosialteknisk innsats kan plante kode med systemnær tilgang i bredt brukte open source-prosjekter. På npm-økosystemet har angrep som `event-stream`, `ua-parser-js` og Shai-Hulud-ormen vist at en enkelt kompromittert publiseringskonto kan spre skadelig kode til titalls millioner installasjoner i løpet av timer.
>
> For et webprosjekt som StudyWise, med over 1 000 transitive npm-avhengigheter, er forsyningskjederisiko ikke en teoretisk problemstilling. Tradisjonelle sårbarhetsskann fanger bare opp pakker som allerede er kjent som sårbare. De fanger ikke nye, ondsinnede pakker som ennå ikke er rapportert. Tiltak mot forsyningskjedeangrep må derfor kombinere flere lag: forsinket installasjon av nye versjoner for å gi tid til at ondsinnede pakker oppdages og fjernes fra registret, automatisert sikkerhetsskann av både kode og pipeline-konfigurasjon, og bevisst håndtering av tillit til både direkte og transitive avhengigheter.

### 1b. Tillegg i 3.6 (Sikkerhet og personvern) — nytt underkapittel 3.6.3

Plassering: nytt underkapittel 3.6.3 etter 3.6.2 (GDPR i praksis).

> ### 3.6.3 Tiltak mot forsyningskjedeangrep
>
> Som beskrevet i 2.5.2 utgjør forsyningskjedeangrep en kategori sikkerhetsrisiko som ikke fanges opp av tradisjonelle sårbarhetsskann alene. StudyWise har derfor flere lag med tiltak rettet spesifikt mot denne typen angrep.
>
> Det første tiltaket er en konfigurert karantenetid for nye pakkeversjoner. I `pnpm-workspace.yaml` er `minimumReleaseAge` satt til 7200 minutter (5 dager). Dette betyr at pnpm nekter å installere en pakkeversjon som er publisert mindre enn fem dager tidligere. Hensikten er å gi tid til at ondsinnede publiseringer rekker å bli oppdaget, rapportert og fjernet fra npm-registret før de når kodebasen vår. Tiltaket bygger på erfaringer fra Shai-Hulud-ormen og lignende hendelser, der angripere har vært avhengige av rask spredning før motmaktene rakk å reagere.
>
> Det andre tiltaket er bruk av AikidoSec sin `safe-chain` CLI i CI-pipelinen. Verktøyet er installert via `scripts/install-safe-chain-ci.sh`, som henter en signert binærfil fra GitHub Releases og verifiserer den mot en pinnet SHA256-sum før installasjon. `safe-chain` kjøres deretter som ekstra sjekk på pakkeinstallasjoner og fanger blant annet kjent skadelig kode, mistenkelige post-install-skript og uventede endringer i pakkemetadata.
>
> Det tredje tiltaket er to egne lint-skript: `lint-pnpm-security.mjs` validerer at `pnpm-workspace.yaml` ikke har fått svekkede sikkerhetsinnstillinger, mens `lint-github-actions-security.mjs` validerer at GitHub Actions-workflowene ikke innfører kjente risikomønstre, blant annet `pull_request_target` med kodeutsjekking, delte pnpm-cache mellom workflows, eller usignerte installasjonsskript hentet via `curl | sh`. Skriptene kjøres som en del av CI på hver pull request, slik at en utilsiktet konfigurasjonsendring blir fanget før den når hovedgrenen.
>
> Det fjerde tiltaket er Dependabot. Den er konfigurert til å åpne pull requests for sikkerhetsoppdateringer på npm-pakker umiddelbart via GitHub Advisory Database, samtidig som ordinære versjonsoppdateringer for npm håndteres i samle-PR-er via en egen workflow (`update-dependencies.yml`) for å unngå mange parallelle PR-er som strider mot hverandre. GitHub Actions-versjoner oppdateres separat av Dependabot ukentlig.
>
> Samlet utgjør disse tiltakene en strategi i dybden mot forsyningskjedeangrep. Ingen enkelt tiltak er fullstendig, men kombinasjonen gjør terskelen for et vellykket angrep mot StudyWise vesentlig høyere. Denne typen tiltak er fortsatt uvanlige selv i kommersielle prosjekter, og prosjektet kan derfor brukes som referansemateriale for andre studentgrupper som ønsker å bygge inn forsyningskjedeforsvar fra starten av.

### 1c. Nye kildeoppføringer i kapittel 6

Plassering: alfabetisk i litteraturlisten.

> ENISA. (2021). *ENISA threat landscape for supply chain attacks*. European Union Agency for Cybersecurity. https://www.enisa.europa.eu/publications/threat-landscape-for-supply-chain-attacks
>
> Ohm, M., Plate, H., Sykosch, A., & Meier, M. (2020). Backstabber's knife collection: A review of open source software supply chain attacks. I C. Maurice, L. Bilge, G. Stringhini, & N. Neves (Red.), *Detection of intrusions and malware, and vulnerability assessment (DIMVA 2020)* (s. 23–43). Springer. https://doi.org/10.1007/978-3-030-52683-2_2

---

## 2. Dependabot og automatisert avhengighetsoppdatering

### 2a. Tillegg i 3.5.6 (Pentesting og sårbarhetsskann)

Plassering: legg til som ekstra kulepunkt under "Automatisert i CI" i 3.5.6, eller som eget avsnitt etter listen.

> I tillegg til skannene over kjører Dependabot på repoet. Den er konfigurert i `.github/dependabot.yml` til å åpne pull requests for sikkerhetsoppdateringer i npm-pakker umiddelbart via GitHub Advisory Database, samtidig som ordinære versjonsoppdateringer for npm håndteres i samle-PR-er via en egen workflow (`update-dependencies.yml` som kjører `pnpm update:safe` med påfølgende typecheck, lint og build). Dette unngår at vi drukner i parallelle PR-er som strider mot hverandre i lockfile. GitHub Actions-versjoner oppdateres separat ukentlig, gruppert per økosystem.

### 2b. Tillegg i Tabell 6 (CI/CD-kontroller)

Plassering: ny rad i Tabell 6.

| CI/CD kontroll | Hva den gjør |
|---|---|
| **Dependabot** | Åpner PR-er for npm-sikkerhetsoppdateringer umiddelbart og GitHub Actions-versjoner ukentlig. Ordinære npm-oppdateringer går via `update-dependencies.yml` som samle-PR. |

---

## 3. Docker

### 3a. Tillegg i 3.4.1 (Verktøyoversikt)

Plassering: legg til en ekstra rad i Tabell 4.

| Lag | Teknologi | Rolle |
|---|---|---|
| **Lokal utvikling og portabilitet** | Docker, docker-compose | Containerisert lokalt utviklingsmiljø med MongoDB, Redis, backend og frontend startet i én kommando. |

### 3b. Valgfritt tillegg som kort avsnitt i 3.3 eller 3.4

Plassering: kort avsnitt i 3.3 eller 3.4, der det passer best.

> For lokal utvikling tilbyr prosjektet også et containerisert miljø via `Dockerfile` og `docker-compose.yml`. Med én `docker compose up`-kommando startes MongoDB, Redis, backend og frontend som koblede containere. Dette gjør det enklere å sette opp et fungerende utviklingsmiljø uten å installere alle avhengigheter manuelt på lokal maskin, og brukes blant annet av nye bidragsytere som skal teste løsningen før de begynner å utvikle.

---

## 4. GitHub Copilot eksplisitt nevnt

### 4a. Liten edit i 4.8.2 (Ansvarlig bruk av KI i selve utviklingen)

Plassering: bytt ut første setning i andre avsnitt av 4.8.2.

Eksisterende:
> KI-assistenter har vært brukt i kodegjennomgang, refaktorering, feilsøking, dokumentasjonsskriving og utforsking av alternative løsninger.

Foreslått erstatning:
> KI-assistenter har vært brukt aktivt i prosjektet. GitHub Copilot ble brukt i editor for inline-forslag, mens Claude Code (via styringsdokumentet `CLAUDE.md` beskrevet senere i dette avsnittet) ble brukt til mer omfattende oppgaver som kodegjennomgang, refaktorering, feilsøking, dokumentasjonsskriving og utforsking av alternative løsninger.

---

## 5. Vedlegg — prosjektskisse, prosjektbeskrivelse og Google Forms-PDF

### 5a. Tre nye vedleggsoppføringer

Plassering: legg til i vedleggslisten etter Vedlegg I.

> ### Vedlegg J — Prosjektskisse
>
> Den opprinnelige prosjektskissen ble levert som del av milepæl M1 (27.01.2026). Skissen ligger som `filer_prosjekt/BOP-Prosjektskisse-Gruppe3-1.pdf` i prosjektets repo. Skissen viser hvordan problemstillingen, omfanget og teknologivalgene var formulert ved prosjektstart, og kan sammenlignes med den endelige problemstillingen i 1.2 for å se hvordan retningen ble justert underveis.
>
> ### Vedlegg K — Prosjektbeskrivelse
>
> Den utvidede prosjektbeskrivelsen ble levert i forprosjektrapporten (milepæl M2, 10.02.2026). Dokumentet ligger som `filer_prosjekt/Prosjektbeskrivelse_gruppe3.pdf` i prosjektets repo, og utdyper bakgrunn, mål, omfang og metode slik de var planlagt ved prosjektstart.
>
> ### Vedlegg L — Brukertestskjema (Google Forms-eksport)
>
> Den faktiske eksporten av Google Forms-skjemaet som ble brukt i brukertesten ligger som `filer_prosjekt/StudyWise – Brukertest - Google Skjemaer.pdf` i prosjektets repo. PDF-en viser skjemaet slik deltakerne så det, inkludert alle spørsmål, svaralternativer og rekkefølge. Strukturen er oppsummert i Vedlegg D.

NB: hvis disse legges til, må eksisterende Vedlegg J, K og I omnummereres, eller — enklere — legg de nye etter eksisterende vedlegg som Vedlegg J, K og L i den nummereringen som passer dagens innholdsfortegnelse.

---

## 6. GitHub Education

### 6a. Kort merknad i 3.1.4 (GitHub som operativsentral)

Plassering: legg til som siste avsnitt i 3.1.4.

> Som studenter ved USN hadde gruppa også tilgang til GitHub Education, som ga utvidet kvote på GitHub Actions, gratis tilgang til GitHub Copilot Pro og enkelte andre studentfordeler. Dette gjorde det mulig å kjøre en mer omfattende CI/CD-pipeline enn det gratisplanen normalt ville tillatt, uten kostnad for gruppa. Tilgang til Copilot Pro er også grunnen til at vi kunne bruke det aktivt i utvikling, slik som drøftet i 4.8.2.

---

## 7. Rapportstruktur knyttet til Johannessen

### 7a. Tillegg i 1.5 (Oppgavens struktur)

Plassering: ny innledende setning i 1.5, før den eksisterende oversikten over kapitlene.

> Rapportens struktur følger en variant av den klassiske IMRaD-modellen som Johannessen mfl. (2021) beskriver som vanlig i samfunnsvitenskapelige og praksisnære fagrapporter: introduksjon, teoretisk grunnlag (her kalt bakgrunnslitteratur), metode og gjennomføring, drøfting og konklusjon. Strukturen er valgt fordi den både gir leseren en forventet leseflyt og gjør det enklere å skille mellom hva som er etablert teori, hva som er våre konkrete valg, og hva som er vår egen drøfting.

### 7b. Valgfritt: utdypende avsnitt i 3.5.7 (Metodisk grunnlag)

Plassering: tillegg etter eksisterende første avsnitt i 3.5.7.

> Selve oppbyggingen av rapporten er også forankret i samfunnsvitenskapelig metode. Johannessen mfl. beskriver hvordan en fagrapport bør gjøre tydelig skille mellom teoretisk grunnlag, metodisk tilnærming, empiriske funn og fortolkende drøfting (Johannessen mfl., 2021, s. 18–22). I praksis betyr dette for vår rapport at kapittel 2 etablerer teorien, kapittel 3 dokumenterer hvordan teorien er anvendt i konkrete valg, kapittel 4 drøfter styrker og svakheter, og kapittel 5 konkluderer mot forskningsspørsmålene. Denne strukturen er ikke valgt for å være formell, men for at sensor skal kunne følge resonnementet fra teori til konklusjon på en etterprøvbar måte.

---

## Avsluttende sjekkliste før innlevering

Bruk denne som siste sjekk når du har limt inn tekstene over i Word:

- [ ] Supply chain-avsnitt i 2.5.2 er på plass, og kildene Ohm mfl. (2020) + ENISA (2021) er lagt til i litteraturlisten.
- [ ] Nytt underkapittel 3.6.3 om forsyningskjedetiltak er på plass.
- [ ] Dependabot er nevnt i 3.5.6 og i Tabell 6.
- [ ] Docker-rad er lagt til i Tabell 4.
- [ ] 4.8.2 nevner GitHub Copilot eksplisitt ved siden av Claude Code/CLAUDE.md.
- [ ] Vedlegg J (Prosjektskisse), K (Prosjektbeskrivelse) og L (Google Forms-PDF) er lagt inn, og innholdsfortegnelsen er oppdatert tilsvarende.
- [ ] 3.1.4 nevner GitHub Education.
- [ ] 1.5 (og evt. 3.5.7) refererer til Johannessen mfl. (2021) som forankring av rapportstrukturen.

Når alle punktene er huket av, er rapporten på linje med det faktiske arbeidet som er gjort i kodebasen.
