/**
 * StudyWise – Brukertest Google Forms-bygger
 * Bacheloroppgave 2026
 */

function byggBrukertestSkjema() {
  var form = FormApp.create('StudyWise – Brukertest');

  form.setTitle('StudyWise – Brukertest');
  form.setDescription(
    'Bacheloroppgave 2026 – Brukertest av StudyWise\n\n' +
    'Tusen takk for at du tar deg tid til å hjelpe oss! StudyWise er en KI-basert ' +
    'studieassistent for høyere utdanning som vi utvikler som bacheloroppgave. Vi ' +
    'ønsker å forstå hvordan ekte studenter opplever appen i bruk.\n\n' +
    'Tidsbruk: ca. 25–30 minutter totalt (~15 min hands-on i appen + ~10–13 min på dette skjemaet, 53 spørsmål – de fleste raske avkryssninger).\n\n' +
    'Anonymitet: Svarene dine er anonyme. Vi samler ikke inn navn eller e-post. ' +
    'Dataene brukes kun i bacheloroppgaven og slettes etter sensur (juni 2026).\n\n' +
    'Samtykke: Ved å sende inn skjemaet bekrefter du at du har lest informasjonen ' +
    'over og samtykker til at svarene dine brukes i forskningsformål i tråd med GDPR.\n\n' +
    'FØR DU STARTER – gjør disse oppgavene på https://www.studwize.page :\n' +
    '1. Opprett en konto og logg inn – legg merke til hvordan du blir introdusert til appen første gang\n' +
    '2. Koble til Canvas (hopp over hvis du ikke har Canvas). Prøv KI-handlinger direkte på et Canvas-emne (oppsummer pensum, lag quiz fra emnet)\n' +
    '3. Still et spørsmål til KI-en, og gi tommel opp/ned på ett av svarene\n' +
    '4. Generer en quiz, lagre den og se resultatstatistikken. Se også på flashcards-funksjonen\n' +
    '5. Last opp en PDF til kunnskapsbasen og still et spørsmål om innholdet\n' +
    '6. Sett opp en arbeidsplan, og prøv å bryte ned en oppgave i delsteg\n' +
    '7. Utforsk innstillingene (språk, varsler, personvern)\n' +
    '8. Bonus: Bla gjennom tidligere samtaler, bokmerk én, og prøv å eksportere eller dele en samtale via lenke'
  );

  form.setProgressBar(true);
  form.setCollectEmail(false);
  form.setShowLinkToRespondAgain(false);
  form.setAllowResponseEdits(false);
  form.setAcceptingResponses(true);

  // ----------------------------------------------------------------
  // SEKSJON 1 – Bakgrunn
  // ----------------------------------------------------------------
  form.addPageBreakItem()
    .setTitle('Seksjon 1 – Bakgrunn')
    .setHelpText('Litt om deg som testperson.');

  form.addMultipleChoiceItem()
    .setTitle('1.1 Hvilket studienivå er du på?')
    .setChoiceValues(['Bachelor', 'Master', 'PhD', 'Annet'])
    .setRequired(true);

  form.addMultipleChoiceItem()
    .setTitle('1.2 Hvor ofte bruker du Canvas i studiehverdagen?')
    .setChoiceValues(['Daglig', 'Ukentlig', 'Månedlig', 'Sjelden', 'Aldri / har ikke Canvas'])
    .setRequired(true);

  form.addMultipleChoiceItem()
    .setTitle('1.3 Hvor ofte bruker du KI-verktøy (ChatGPT, Claude, Gemini, Copilot osv.) til studier?')
    .setChoiceValues(['Daglig', 'Ukentlig', 'Månedlig', 'Sjelden', 'Aldri'])
    .setRequired(true);

  form.addCheckboxItem()
    .setTitle('1.4 På hvilken enhet testet du StudyWise?')
    .setChoiceValues(['Laptop / stasjonær PC', 'Mobil', 'Nettbrett'])
    .setRequired(true);

  form.addTextItem()
    .setTitle('1.5 Hvilken studieretning eller hvilket fagområde studerer du?')
    .setHelpText('F.eks. "Informatikk", "Sykepleie", "Økonomi"')
    .setRequired(true);

  form.addMultipleChoiceItem()
    .setTitle('1.6 Hvor mye tid bruker du på studier per uke i snitt?')
    .setChoiceValues([
      'Mindre enn 10 timer',
      '10–20 timer',
      '20–30 timer',
      '30–40 timer',
      'Mer enn 40 timer'
    ])
    .setRequired(true);

  form.addCheckboxItem()
    .setTitle('1.7 Hvilke andre studieverktøy bruker du i dag?')
    .setHelpText('Marker alle som passer.')
    .setChoiceValues([
      'Notion',
      'OneNote / Microsoft 365',
      'Anki',
      'Quizlet',
      'ChatGPT / Claude / Gemini direkte',
      'Google Docs / Drive',
      'Obsidian / Logseq',
      'Andre',
      'Ingen'
    ])
    .setRequired(true);

  // ----------------------------------------------------------------
  // SEKSJON 2 – Oppgavebasert vurdering
  // ----------------------------------------------------------------
  form.addPageBreakItem()
    .setTitle('Seksjon 2 – Oppgavebasert vurdering')
    .setHelpText('For hver oppgave: vurder hvor lett det var, og om du klarte den. Detaljerte kommentarer kan du gi i slutten av skjemaet.');

  // Hjelpefunksjon for Likert 1–5
  var leggTilLikert = function(tittel, paakrevd) {
    return form.addScaleItem()
      .setTitle(tittel)
      .setBounds(1, 5)
      .setLabels('Veldig vanskelig', 'Veldig lett')
      .setRequired(!!paakrevd);
  };

  var leggTilLikertEnig = function(tittel, paakrevd) {
    return form.addScaleItem()
      .setTitle(tittel)
      .setBounds(1, 5)
      .setLabels('Helt uenig', 'Helt enig')
      .setRequired(!!paakrevd);
  };

  // Oppgave A
  form.addSectionHeaderItem().setTitle('Oppgave A – Opprette konto og logge inn');
  leggTilLikert('A.1 Hvor lett var dette?', true);
  form.addMultipleChoiceItem()
    .setTitle('A.2 Klarte du oppgaven?')
    .setChoiceValues([
      'Ja, uten problemer',
      'Ja, men med litt prøving og feiling',
      'Nei, jeg ga opp'
    ])
    .setRequired(true);
  leggTilLikertEnig('A.3 Etter første pålogging var det tydelig hva StudyWise kan brukes til.', true);

  // Oppgave B
  form.addSectionHeaderItem().setTitle('Oppgave B – Koble til Canvas');
  leggTilLikert('B.1 Hvor lett var dette? (hopp over hvis du ikke har Canvas)', false);
  form.addMultipleChoiceItem()
    .setTitle('B.2 Klarte du oppgaven?')
    .setChoiceValues([
      'Ja, uten problemer',
      'Ja, men med litt prøving og feiling',
      'Nei, jeg ga opp',
      'Hoppet over (har ikke Canvas)'
    ])
    .setRequired(true);
  leggTilLikertEnig('B.3 Forsto du hvilke data StudyWise får tilgang til når du kobler til Canvas?', false);
  leggTilLikertEnig('B.4 Det var tydelig hvilke KI-handlinger jeg kunne utføre direkte på et Canvas-emne (f.eks. oppsummere pensum, generere quiz fra emnet). Hopp over hvis du ikke prøvde.', false);

  // Oppgave C
  form.addSectionHeaderItem().setTitle('Oppgave C – Stille et spørsmål til KI-en');
  leggTilLikert('C.1 Hvor lett var dette?', true);
  form.addScaleItem()
    .setTitle('C.2 Var KI-svaret nyttig for deg?')
    .setBounds(1, 5)
    .setLabels('Helt unyttig', 'Veldig nyttig')
    .setRequired(true);
  leggTilLikertEnig('C.3 Stolte du på at svaret var riktig?', true);
  leggTilLikertEnig('C.4 Det var lett å gi tilbakemelding (tommel opp/ned) på et KI-svar. Hopp over hvis du ikke prøvde.', false);

  // Oppgave D
  form.addSectionHeaderItem().setTitle('Oppgave D – Generere en quiz og se på flashcards');
  leggTilLikert('D.1 Hvor lett var det å generere en quiz? (hopp over hvis du ikke prøvde)', false);
  leggTilLikertEnig('D.2 Var quizen relevant for stoffet du ville teste deg i?', false);
  leggTilLikertEnig('D.3 Forklaringene på riktige/gale svar var nyttige (hopp over hvis du ikke så forklaringer)', false);
  leggTilLikertEnig('D.4 Flashcards føltes nyttige for læring og repetisjon (hopp over hvis du ikke prøvde)', false);
  leggTilLikertEnig('D.5 Det var lett å lagre quizer/flashcards og se statistikk fra tidligere forsøk. Hopp over hvis du ikke prøvde.', false);

  // Oppgave E
  form.addSectionHeaderItem().setTitle('Oppgave E – Laste opp PDF til kunnskapsbasen');
  leggTilLikert('E.1 Hvor lett var dette? (hopp over hvis du ikke prøvde)', false);
  form.addMultipleChoiceItem()
    .setTitle('E.2 Klarte du oppgaven?')
    .setChoiceValues([
      'Ja, uten problemer',
      'Ja, men med litt prøving og feiling',
      'Nei, jeg ga opp',
      'Hoppet over'
    ])
    .setRequired(false);
  leggTilLikertEnig('E.3 Svarte KI-en basert på dokumentet du lastet opp?', false);

  // Oppgave F
  form.addSectionHeaderItem().setTitle('Oppgave F – Sette opp en arbeidsplan');
  leggTilLikert('F.1 Hvor lett var dette? (hopp over hvis du ikke prøvde)', false);
  leggTilLikertEnig('F.2 Virket den foreslåtte planen realistisk og nyttig?', false);

  // Oppgave G
  form.addSectionHeaderItem().setTitle('Oppgave G – Utforske innstillinger (språk, varsler, personvern)');
  leggTilLikert('G.1 Hvor lett var det å finne og endre innstillinger (språk, varsler, personvern)?', true);
  leggTilLikertEnig('G.2 Personverninnstillingene var lette å forstå.', true);

  // ----------------------------------------------------------------
  // SEKSJON 3 – SUS (System Usability Scale) – som grid
  // ----------------------------------------------------------------
  form.addPageBreakItem()
    .setTitle('Seksjon 3 – System Usability Scale (SUS)')
    .setHelpText('Tenk over hele opplevelsen din med StudyWise og angi hvor enig du er i hver påstand.');

  var susPaastander = [
    '3.1 Jeg tror jeg ville brukt StudyWise ofte hvis det var tilgjengelig.',
    '3.2 Jeg synes StudyWise var unødvendig komplisert.',
    '3.3 Jeg synes StudyWise var lett å bruke.',
    '3.4 Jeg tror jeg ville trengt teknisk hjelp for å bruke StudyWise.',
    '3.5 De ulike funksjonene i StudyWise virket godt integrert.',
    '3.6 Jeg synes det var for mye inkonsistens i StudyWise.',
    '3.7 Jeg tror folk flest vil lære seg StudyWise raskt.',
    '3.8 StudyWise var tungvint å bruke.',
    '3.9 Jeg følte meg trygg på at jeg brukte StudyWise riktig.',
    '3.10 Jeg måtte lære meg mye før jeg kom i gang med StudyWise.'
  ];

  form.addGridItem()
    .setTitle('Hvor enig er du i hver av påstandene?')
    .setHelpText('1 = Helt uenig, 5 = Helt enig')
    .setRows(susPaastander)
    .setColumns(['1', '2', '3', '4', '5'])
    .setRequired(true);

  // ----------------------------------------------------------------
  // SEKSJON 4 – Holdninger, tillit og personvern
  // ----------------------------------------------------------------
  form.addPageBreakItem()
    .setTitle('Seksjon 4 – Holdninger, tillit og personvern')
    .setHelpText('Hvor enig er du i hver påstand? (1 = Helt uenig, 5 = Helt enig)');

  var holdningPaastander = [
    '4.1 Jeg føler meg trygg på at dataene mine håndteres på en god måte.',
    '4.2 Jeg forstår hva som skjer med dataene mine hvis jeg sletter kontoen min.',
    '4.3 Jeg ville anbefalt StudyWise til en medstudent.',
    '4.4 Jeg ville valgt StudyWise fremfor å bruke ChatGPT/Claude direkte til studier.',
    '4.5 Det var lett å navigere mellom funksjonene (chat, kunnskapsbase, arbeidsplan, tidligere samtaler osv.).',
    '4.6 Jeg lærte noe nytt under denne testen.'
  ];

  form.addGridItem()
    .setTitle('Hvor enig er du i hver av påstandene?')
    .setHelpText('1 = Helt uenig, 5 = Helt enig')
    .setRows(holdningPaastander)
    .setColumns(['1', '2', '3', '4', '5'])
    .setRequired(true);

  leggTilLikertEnig('4.7 Jeg forsto pensumstoffet bedre etter å ha brukt KI-en. Hopp over hvis ikke aktuelt.', false);
  leggTilLikertEnig('4.8 Det var lett å eksportere eller dele en samtale med andre. Hopp over hvis du ikke prøvde.', false);

  form.addScaleItem()
    .setTitle('4.9 På en skala fra 0 til 10, hvor sannsynlig er det at du anbefaler StudyWise til en venn eller medstudent?')
    .setBounds(0, 10)
    .setLabels('Veldig usannsynlig', 'Veldig sannsynlig')
    .setRequired(true);

  // ----------------------------------------------------------------
  // SEKSJON 5 – Åpne tilbakemeldinger
  // ----------------------------------------------------------------
  form.addPageBreakItem()
    .setTitle('Seksjon 5 – Åpne tilbakemeldinger')
    .setHelpText('De siste fire spørsmålene er valgfrie tekstfelt. Vi setter stor pris på alt du ønsker å skrive!');

  form.addParagraphTextItem()
    .setTitle('5.1 Hva var det BESTE med StudyWise?')
    .setRequired(false);

  form.addParagraphTextItem()
    .setTitle('5.2 Hva var det mest FRUSTRERENDE eller forvirrende? Nevn gjerne hvilken oppgave eller funksjon.')
    .setRequired(false);

  form.addParagraphTextItem()
    .setTitle('5.3 Var det noe du FORVENTET skulle finnes, men som du ikke fant?')
    .setRequired(false);

  form.addParagraphTextItem()
    .setTitle('5.4 Møtte du tekniske feil, krasj eller treghet? Beskriv kort hva som skjedde og hvor i appen.')
    .setRequired(false);

  // ----------------------------------------------------------------
  // Logg URL-er til kjøringsloggen
  // ----------------------------------------------------------------
  Logger.log('Skjema opprettet!');
  Logger.log('Rediger skjemaet (admin):    ' + form.getEditUrl());
  Logger.log('Del med testpersoner (URL):  ' + form.getPublishedUrl());
}
