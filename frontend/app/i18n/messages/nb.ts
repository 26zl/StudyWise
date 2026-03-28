export const nbMessages = {
  common: {
    actions: {
      askAi: "Spør KI",
      backToSignIn: "Tilbake til innlogging",
      cancel: "Avbryt",
      change: "Endre",
      close: "Lukk",
      clearAll: "Slett alle",
      delete: "Slett",
      editProfileSecurity: "Rediger profil og sikkerhet",
      goToDashboard: "Gå til dashboard",
      goToSettings: "Gå til innstillinger",
      hide: "Skjul",
      markAllAsRead: "Marker alle som lest",
      newConversation: "Ny samtale",
      reload: "Last inn på nytt",
      retry: "Prøv igjen",
      restoreConnection: "Gjenopprett tilkobling",
      save: "Lagre",
      sendCode: "Send kode",
      completeReset: "Sett nytt passord",
      show: "Vis",
      signOut: "Logg ut",
      start: "Start",
      verifyCode: "Bekreft kode",
    },
    labels: {
      canvasUser: "Canvas bruker",
      notSignedIn: "Ikke innlogget",
    },
    loading: {
      aiChat: "Laster KI-chat...",
      assignments: "Laster oppgaver...",
      calendar: "Laster kalender...",
      canvas: "Laster Canvas...",
      chatHistory: "Laster samtalehistorikk...",
      dashboard: "Laster dashboard...",
      generic: "Laster...",
      notifications: "Laster varsler...",
      overview: "Laster oversikt...",
      profile: "Laster profil...",
      quiz: "Laster quiz...",
      redirectingToDashboard: "Sender deg videre til dashboardet...",
      redirectingToSignIn: "Sender deg til innlogging...",
      settings: "Laster innstillinger...",
      userData: "Laster brukerdata...",
    },
  },
  dashboard: {
    sections: {
      admin: "administrasjon",
      aiChat: "KI-chat",
      calendar: "kalender",
      canvas: "Canvas",
      notifications: "varslinger",
      quiz: "quiz",
      settings: "innstillinger",
    },
    sidebar: {
      admin: "Administrasjon",
      aiAssistant: "KI Assistent",
      announcements: "Kunngjøringer",
      assignments: "Oppgaver",
      calendar: "Kalender",
      canvas: "Canvas",
      bookmarks: "Festet",
      chatHistory: "Samtaler",
      courses: "Emner",
      noChatsYet: "Ingen samtaler ennå",
      noBookmarksYet: "Ingen festede samtaler ennå",
      notifications: "Varslinger",
      overview: "Oversikt",
      navigationTitle: "Dashboard-navigasjon",
      quiz: "Quiz / Flashcards",
      settings: "Innstillinger",
      taskBreakdown: "Oppgavedeling med KI",
    },
  },
  chatHistory: {
    clearConfirmDescription:
      "Alle lagrede samtaler fjernes. Dette kan ikke angres.",
    clearConfirmTitle: "Slett hele samtalehistorikken?",
    clearError: "Kunne ikke slette historikken",
    clearSuccess: "Samtalehistorikk slettet",
    deleteError: "Kunne ikke slette samtalen",
    deleteSuccess: "Samtale slettet",
    saveError: "Kunne ikke lagre samtalen",
  },
  auth: {
    forgotPassword: {
      complete: {
        description:
          "Passordet ditt er oppdatert, og du sendes videre til dashboardet.",
        title: "Passord oppdatert",
      },
      code: {
        descriptionEmail:
          "Skriv inn koden vi sendte til e-postadressen som er koblet til kontoen din.",
        label: "Bekreftelseskode",
        placeholder: "123456",
      },
      description:
        "Har du glemt passordet ditt? Skriv inn e-postadressen din, bekreft koden vi sender, og velg et nytt passord.",
      emailOnly: "Kun e-post",
      eyebrow: "Konto-gjenoppretting",
      identifier: {
        description:
          "Bruk e-postadressen som er knyttet til StudyWise-kontoen din.",
        emailLabel: "E-postadresse",
        emailPlaceholder: "navn@example.com",
      },
      mfa: {
        description:
          "Passordet er oppdatert, men kontoen krever totrinnsbekreftelse før innloggingen kan fullføres. Gå tilbake til innlogging for å fortsette.",
        title: "Tofaktor kreves",
      },
      setCredential: {
        description: "Velg et nytt passord for e-postinnloggingen din.",
        label: "Nytt passord",
        placeholder: "Skriv inn nytt passord",
      },
      sent: {
        emailDescription:
          "Vi har sendt en gjenopprettingskode til e-posten din.",
        emailTitle: "Kode sendt på e-post",
      },
      steps: {
        identify: "Finn kontoen",
        setCredential: "Velg nytt passord",
        verify: "Bekreft kode",
      },
      thirdParty: {
        description:
          "Hvis du vanligvis logger inn med Microsoft eller Google, trenger du som regel ikke å nullstille passord her. Gå tilbake til innlogging og velg samme metode som før.",
        title: "Bruker du Microsoft eller Google?",
      },
      support:
        "Hvis du ikke mottar koden, sjekk spamfilteret ditt. Bruker du vanligvis Microsoft eller Google, går du tilbake og logger inn med samme metode.",
      title: "Glemt passord?",
    },
    signIn: {
      forgotPasswordAction: "Gjenopprett tilgang",
      forgotPasswordDescription:
        "For e-postinnlogging. Bruker du Microsoft eller Google, fortsetter du med samme leverandør i stedet.",
      forgotPasswordTitle: "Glemt passord?",
    },
    humanCheck: {
      eyebrow: "Cloudflare Turnstile",
      title: "Botbeskyttelse",
      description:
        "Denne kontrollen er integrert sammen med innlogging og registrering for å redusere automatisert misbruk.",
      verifying: "Verifiserer...",
      widgetError:
        "Vi klarte ikke å laste Cloudflare Turnstile. Last siden på nytt og prøv igjen.",
    },
  },
  errors: {
    boundary: {
      description:
        "Noe gikk galt i denne delen av siden. Prøv å laste inn på nytt, eller gå tilbake til dashboardet.",
      title: "En feil oppstod",
    },
    canvas: {
      network: "Kunne ikke koble til Canvas. Sjekk internettforbindelsen din.",
      notFound: "Ressursen ble ikke funnet i Canvas.",
      permissionDenied: "Du har ikke tilgang til denne ressursen i Canvas.",
      rateLimit:
        "For mange forespørsler til Canvas. Vent noen sekunder og prøv igjen.",
      tokenInvalid:
        "Canvas API-tokenet ditt er ugyldig, utløpt eller slettet i Canvas. Gå til Innstillinger for å legge til et nytt token.",
      tokenMissing:
        "Du må knytte en Canvas API-token for å bruke denne funksjonen. Gå til Innstillinger for å legge til token.",
      timeout: "Henting av Canvas-data tok for lang tid. Prøv igjen.",
      validation:
        "Sjekk at Canvas-institusjon og URL er riktig, og prøv igjen.",
    },
    generic: {
      auth: "Du må logge inn på nytt.",
      conflict: "Ressursen finnes allerede.",
      default: "Noe gikk galt. Prøv igjen.",
      forbidden: "Du har ikke tilgang til denne ressursen.",
      network: "Nettverksfeil. Sjekk internettforbindelsen din.",
      notFound: "Ressursen ble ikke funnet.",
      rateLimit: "For mange forespørsler. Vent litt og prøv igjen.",
      retry: "Prøv igjen.",
      server: "Serverfeil. Prøv igjen om litt.",
      timeout: "Forespørselen tok for lang tid. Prøv igjen.",
      validation: "Ugyldig data. Sjekk at alle felt er fylt ut riktig.",
    },
    section: {
      load: "Kunne ikke laste {section}. Prøv å laste siden på nytt.",
    },
    userData: {
      generic:
        "Kunne ikke laste brukerdata. Sjekk internettforbindelsen og prøv igjen.",
      sessionExpired: "Sesjonen har utløpt. Logg inn på nytt.",
    },
  },
  notifications: {
    allMarkedAsRead: "Alle varsler markert som lest",
    deadlineAt: "Frist: {date}",
    empty: {
      all: "Ingen varslinger for øyeblikket.",
      announcements: "Ingen kunngjøringer for øyeblikket.",
      deadlines: "Ingen frister for øyeblikket.",
      events: "Ingen hendelser for øyeblikket.",
    },
    markAllAsRead: "Marker alle som lest",
    loadMore: "Hent flere ({count} igjen)",
    missingCanvasToken:
      "Du må lagre en Canvas API-token for å hente varslinger.",
    partialLoadFallback: "Noen varsler kunne ikke lastes. Resten vises under.",
    remaining: "{time} igjen",
    submitted: "Innlevert",
    manuallySubmitted: "Manuelt innlevert",
    markAsSubmitted: "Marker som innlevert",
    unmarkAsSubmitted: "Fjern innlevert-markering",
    tabs: {
      all: "Alle",
      announcements: "Kunngjøringer",
      deadlines: "Frister",
      events: "Hendelser",
    },
    title: "Varslinger",
    toast: {
      action: "Se varsler",
      description: "Klikk for å åpne varslinger.",
      manyUnread: "Du har {count} uleste varsler",
      oneUnread: "Du har 1 ulest varsel",
    },
  },
  landing: {
    actions: {
      continueToDashboard: "Fortsett til dashboard",
      signInOrRegister: "Logg inn / Registrer",
    },
    features: {
      aiPartner: {
        description:
          "Står du fast? Få umiddelbar hjelp, forklaringer og studietips fra din personlige KI-assistent.",
        title: "KI-Studiepartner",
      },
      canvasIntegration: {
        description:
          "Koble til Canvas én gang og få tilgang til alle dine emner, moduler, filer og kunngjøringer direkte i dashboardet.",
        title: "Sømløs Canvas-integrasjon",
      },
      heading: "Funksjoner",
      overview: {
        description:
          "Se alt som skjer i dag og de neste dagene. Dine personlige gjøremål og frister fra skolen samlet på ett sted.",
        title: "Total Oversikt",
      },
    },
    hero: {
      description:
        "StudyWise samler alt du trenger på ett sted. Få full oversikt over Canvas, dine kommende oppgaver, og få hjelp av KI til å studere smartere – ikke hardere.",
      title: "Din intelligente studieassistent",
    },
  },
  overview: {
    missingCanvasPlanner:
      "Du må knytte en Canvas API-token for å hente oppgaver og generere ukeplan med KI. Gå til Innstillinger for å legge til token.",
    noAssignments: {
      description:
        "Koble til Canvas for å se dine oppgaver og få KI-forslag til ukeplan",
      title: "Ingen oppgaver funnet",
    },
    openChat: "KI Chat",
    quickAccess: {
      title: "Rask tilgang",
    },
    quickActions: {
      aiAssistant: {
        description: "Få hjelp med studier og oppgaver",
        title: "KI Assistent",
      },
      courses: {
        description: "Se alle dine Canvas-emner",
        title: "Emner",
      },
      taskBreakdown: {
        description: "Bryt ned oppgaver i mindre deler",
        title: "Oppgavedeling med KI",
      },
    },
    stats: {
      activeCourses: "Aktive emner",
      totalAssignments: "Totalt oppgaver",
      totalCourses: "Emner totalt",
      upcomingAssignments: "Kommende oppgaver",
    },
    tabs: {
      ariaLabel: "Oversikt: Min arbeidsplan eller KI-ukeplangenerator",
      aiWeekPlan: "KI Ukeplangenerator",
      myWorkPlan: "Min arbeidsplan",
    },
    title: "Oversikt",
    upcomingDeadlines: "Kommende frister (neste {days} dager)",
  },
  settings: {
    accountSecurity: {
      action: "Åpne konto",
      connectionHint:
        "Hvis Google eller Microsoft viser en rød feilmelding under tilkoblede kontoer, er kontoen ikke koblet. Det betyr vanligvis at den eksterne kontoen allerede er i bruk av en annen bruker.",
      description:
        "Åpne kontosiden for å administrere brukernavn, fornavn, etternavn, e-post, passord, to-faktor (2FA) og tilkoblede innloggingsmetoder (Google, Microsoft). Der kan du også slette StudyWise-kontoen din.",
      title: "Konto og sikkerhet",
    },
    appearance: {
      darkMode: {
        description: "Bytt mellom lyst og mørkt tema",
        disable: "Deaktiver mørk modus",
        enable: "Aktiver mørk modus",
        label: "Mørk modus",
      },
      title: "Utseende",
    },
    canvasContext: {
      description:
        "Velg hvilken Canvas-data AI-en skal ha tilgang til når du chatter.",
      selector: {
        emptySelection:
          "Ingen data valgt. AI kan ikke svare på Canvas-spørsmål før du velger minst ett datasett.",
        options: {
          announcements: {
            description: "Kunngjøringer fra forelesere",
            label: "Nyheter",
          },
          assignments: {
            description: "Frister og innleveringer",
            label: "Oppgaver",
          },
          courses: {
            description: "Dine aktive emner",
            label: "Emner",
          },
          events: {
            description: "Kalender og møter",
            label: "Hendelser",
          },
        },
        title: "Gi AI tilgang til:",
      },
      title: "AI Canvas-kontekst",
    },
    canvasToken: {
      alreadyConnectedDescription:
        "Hvis dette er din konto, kan du gjenopprette tilkoblingen her.",
      alreadyConnectedTitle: "Canvas-kontoen er allerede koblet",
      chooseInstitutionDescription:
        "Velg en Canvas-institusjon før du lagrer tokenet.",
      chooseInstitutionTitle: "Velg institusjon",
      connected: "Canvas-token er koblet til kontoen din.",
      currentInstitution: "Din institusjon: {institution}",
      deleteConfirm: "Er du sikker?",
      deleteConnection: "Slett tilkobling",
      deleteErrorTitle: "Kunne ikke slette token",
      deleteSuccessDescription: "Canvas-tilkoblingen er fjernet.",
      deleteSuccessTitle: "Canvas-token slettet",
      deleting: "Sletter...",
      deletingButton: "Ja, slett Canvas API Token",
      description:
        "Koble til din Canvas-konto for å hente emner, kunngjøringer, frister og forelesninger. Velg institusjon under før du lagrer tokenet. Listen dekker de støttede norske Canvas-instansene i StudyWise.",
      hide: "Skjul",
      howTo: {
        step1: "Logg inn på Canvas",
        step2: "Gå til Innstillinger → Godkjente integrasjoner",
        step3: 'Klikk "Ny tilgangstoken"',
        step4: "Kopier token og lim inn her",
        title: "Slik får du en API token:",
      },
      institutionLabel: "Institusjon (Canvas)",
      institutionPlaceholder: "Velg institusjon",
      institutionRequired: "Velg institusjon før du lagrer tokenet.",
      invalidUrlDescription: "Skriv inn en gyldig Canvas-instans.",
      invalidUrlTitle: "Ugyldig Canvas-URL",
      placeholder: "Lim inn din Canvas API token",
      restoreConnection: "Gjenopprett tilkobling",
      restoring: "Gjenoppretter...",
      save: "Lagre token",
      saveErrorTitle: "Kunne ikke lagre token",
      saveSuccessDescription: "Canvas-data blir tilgjengelig om kort tid.",
      saveSuccessTitle: "Canvas-token lagret",
      saving: "Lagrer...",
      show: "Vis",
      title: "Canvas API Token",
    },
    chatHistory: {
      clearAll: "Slett alle samtaler",
      countOne: "{count} samtale",
      countOther: "{count} samtaler",
      description: "Samtalene lagres kryptert. Du kan slette alt her.",
      loading: "Laster...",
      savedChats: "Lagrede samtaler",
      title: "Samtalehistorikk",
    },
    deleteAccount: {
      cancel: "Avbryt",
      confirmInstruction: "Skriv {keyword} for å bekrefte.",
      confirmKeyword: "SLETT",
      confirmPlaceholder: "SLETT",
      deleteErrorTitle: "Kunne ikke slette konto",
      deletePartialDescription:
        "Dataene er slettet, men innloggingskontoen kunne ikke fjernes automatisk. Vi logger deg ut nå.",
      deletePartialTitle: "StudyWise-konto slettet",
      deletePermanent: "Slett konto permanent",
      deleteSuccessDescription:
        "StudyWise-kontoen og tilknyttet data er slettet.",
      deleteSuccessTitle: "Konto slettet",
      deleting: "Sletter konto...",
      description:
        "Dette sletter StudyWise-kontoen din, Canvas-koblinger, preferanser, arbeidsplaner og samtalehistorikk. Handlingen kan ikke angres.",
      manualSignOutDescription:
        "StudyWise-dataene er slettet, men vi klarte ikke å avslutte innloggingssesjonen automatisk.",
      manualSignOutTitle: "Manuell utlogging kreves",
      start: "Start kontosletting",
      title: "Slett konto",
    },
    cookies: {
      accepted: "Godtatt",
      declined: "Kun nødvendige",
      description:
        "Nødvendige cookies er alltid aktive. Valgfrie ytelsesmålinger (Vercel Speed Insights) krever ditt samtykke.",
      status: {
        accepted: "Du har godtatt valgfrie ytelsesmålinger.",
        declined: "Du bruker kun nødvendige cookies.",
        unknown: "Du har ikke tatt et valg ennå.",
      },
      title: "Informasjonskapsler",
      toggle: "Endre valg",
    },
    language: {
      help: "Velg språk for statiske tekster i grensesnittet.",
      label: "Språk",
      options: {
        en: "Engelsk",
        nb: "Norsk",
      },
      title: "Språk",
    },
    profile: {
      avatarAltCanvas: "Profilbilde for Canvas-konto",
      avatarAltStudyWise: "Profilbilde for StudyWise-konto",
      canvasConnection: "Canvas-tilkobling",
      connectedSince: "Tilkoblet siden {date}",
      notConnected: "Ikke tilkoblet. Legg til Canvas API-token nedenfor.",
      studywiseAccount: "StudyWise-konto",
      title: "Kontooversikt",
      username: "Brukernavn",
      usernameNotSet: "Ikke satt",
    },
    title: "Innstillinger",
  },
  admin: {
    title: "Administrasjon",
    tabs: {
      stats: "Statistikk",
      users: "Brukere",
      audit: "Revisjonslogg",
    },
    stats: {
      totalUsers: "Totalt brukere",
      adminUsers: "Administratorer",
      regularUsers: "Vanlige brukere",
      canvasUsers: "Med Canvas-tilkobling",
      totalChats: "Samtaler",
      totalTasks: "Oppgaveoppdelinger",
      totalEmbeddings: "Dokumentfragmenter",
    },
    users: {
      email: "E-post",
      role: "Rolle",
      name: "Navn",
      created: "Opprettet",
      canvas: "Canvas",
      provider: "Innlogging",
      actions: "Handlinger",
      searchPlaceholder: "Søk på e-post...",
      noUsers: "Ingen brukere funnet.",
      changeRole: "Endre rolle",
      deleteUser: "Slett bruker",
      deleteConfirm:
        "Er du sikker på at du vil slette denne brukeren? All data slettes permanent.",
      roleChanged: "Rolle endret",
      userDeleted: "Bruker slettet",
      cannotChangeSelf: "Du kan ikke endre din egen rolle",
      cannotDeleteSelf: "Du kan ikke slette din egen konto herfra",
      you: "(deg)",
    },
    audit: {
      action: "Handling",
      category: "Kategori",
      outcome: "Resultat",
      actor: "Utfører",
      time: "Tidspunkt",
      noEntries: "Ingen revisjonslogg-oppføringer.",
    },
    loading: "Laster administrasjon...",
    errors: {
      statsFailed: "Kunne ikke hente statistikk",
      usersFailed: "Kunne ikke hente brukere",
      auditFailed: "Kunne ikke hente revisjonslogg",
    },
  },
  quiz: {
    title: "Quiz / Flashcards",
    subtitle:
      "Tren på Canvas-innholdet ditt med KI-genererte spørsmål og kort.",
    noCoursesFound: "Ingen Canvas-emner funnet. Koble til Canvas først.",
    noModulesFound: "Ingen moduler funnet for dette emnet.",
    loadingCourses: "Laster emner...",
    loadingModules: "Laster moduler...",
    selectCourse: "Velg et emne...",
    selectModules: "Velg moduler...",
    selectCourseLabel: "1. Velg emne",
    selectModulesLabel: "2. Velg moduler",
    questionCountLabel: "3. Antall spørsmål",
    cardCountLabel: "3. Antall kort",
    modulesSelected: "{count} moduler valgt",
    couldNotGenerateQuiz: "Kunne ikke generere quiz.",
    couldNotGenerateFlashcards: "Kunne ikke generere flashcards.",
    noQuestionsGenerated: "Ingen spørsmål ble generert",
    noFlashcardsGenerated: "Ingen flashcards ble generert",
    requestTimeout: "Forespørselen tok for lang tid",
    couldNotGenerate: "Kunne ikke generere {contentType}",
  },
  arbeidsplan: {
    loadingPlan: "Laster arbeidsplan...",
    loadError: "Kunne ikke laste arbeidsplan. Prøv igjen senere.",
    deleteUndone: "Sletting angret",
    planDeleted: "Arbeidsplan slettet",
    planSaved: "Arbeidsplan lagret!",
    planSaveError: "Kunne ikke lagre arbeidsplan. Prøv igjen.",
    selectAtLeastOneDay: "Velg minst én dag",
    addToWorkplanError: "Kunne ikke legge til i arbeidsplan",
    addToWorkplanErrorDescription:
      "Prøv igjen eller kontakt support hvis feilen vedvarer",
  },
  aiBreakdown: {
    assignmentContext: {
      course: "Emne: {course}.",
      dueDate: "Frist: {date}.",
      points: "Poengverdi: {points}.",
      title: "Oppgavekontekst",
    },
    assignmentMeta: {
      dueDate: "Frist {date}",
      points: "{points} poeng",
    },
    collapseAll: "Lukk alle",
    empty: {
      description:
        "Vi fant ingen ikke-innleverte Canvas-oppgaver å bryte ned akkurat nå.",
      title: "Ingen aktive oppgaver funnet",
    },
    errors: {
      loadAssignments: "Kunne ikke hente oppgaver fra Canvas.",
    },
    expandAll: "Utvid alle",
    stats: {
      activeAssignments: "Aktive oppgaver",
      overdue: "Forsinket",
      withDeadline: "Med frist",
      withoutDeadline: "Uten frist",
    },
    subtitle: "Bryt ned Canvas-oppgaver i konkrete deloppgaver",
    title: "Oppgavedeling med KI",
  },
  taskBreakdown: {
    actions: {
      approve: "Godkjenn",
      delete: "Slett",
      edit: "Rediger",
      reject: "Avvis",
    },
    approval: {
      approveAll: "Godkjenn alle",
      description:
        "Gå gjennom forslagene og godkjenn, avvis, eller rediger dem etter din arbeidsstil.",
      rejectAll: "Avvis alle",
      reviewManually: "Gå gjennom manuelt",
      title: "KI-assistenten har generert {count} deloppgaver for deg",
    },
    saveError: "Kunne ikke lagre deloppgavene. Prøv igjen.",
    allApproved: "Alle deloppgaver godkjent!",
    allRejected: "Alle deloppgaver avvist",
    editor: {
      addToWorkplan: "Legg til i arbeidsplan ({count})",
      addToWorkplanShort: "Arbeidsplan ({count})",
      newShort: "Ny",
      newTask: "Ny oppgave",
      regenerate: "Regenerer deloppgaver",
      title: "KI-foreslåtte deloppgaver",
    },
    fields: {
      descriptionPlaceholder: "Beskrivelse",
      titlePlaceholder: "Tittel",
    },
    generateAction: "Få KI til å foreslå deloppgaver",
    generatedError: "KI-generering feilet. Prøv igjen.",
    generatedSuccess: "KI-assistenten genererte {count} deloppgaver!",
    generating: "Genererer deloppgaver med AI...",
    loadingSaved: "Laster lagrede deloppgaver...",
    newTaskTitle: "Ny deloppgave",
    priority: {
      high: "Høy prioritet",
      low: "Lav prioritet",
      medium: "Middels prioritet",
    },
    progress: {
      approved: "Godkjent",
      completed: "Fullført",
      hours: "{completed} / {total} timer",
      percentComplete: "{percent}% fullført",
      remaining: "Gjenstår",
      summary: "{completed} av {approved} deloppgaver fullført",
      title: "Fremdrift",
    },
  },
  chat: {
    saveBeforeNewError:
      "Kunne ikke lagre samtale før ny chat ble opprettet. Du kan fortsette med ny chat.",
    oneAttachmentOnly: "Kun ett vedlegg om gangen",
    oneAttachmentOnlyDescription: "Jeg bruker bare det første vedlegget.",
    documentAnalysisFailed: "Dokumentanalyse feilet",
    documentAnalysisEmpty:
      "Dokumentanalysen returnerte et tomt svar. Prøv igjen.",
    aiResponseFailed: "KI-svar feilet",
    aiResponseEmpty: "KI-assistenten returnerte et tomt svar. Prøv igjen.",
    saveBeforeShare: "Lagre samtalen først for å dele den.",
    shareLinkCopied: "Delingslenke kopiert",
    shareLinkDescription:
      "Lenken viser hele samtalen slik den ser ut na. Alle med lenken kan lese bruker- og KI-meldinger.",
    couldNotShareChat: "Kunne ikke dele chatten.",
    couldNotShareChatFallback: "Kunne ikke dele chatten",
    answerDownloaded: "Svar lastet ned",
    copiedToClipboard: "Kopiert til utklippstavle",
    couldNotCopy: "Kunne ikke kopiere",
    conversationDownloaded: "Samtale lastet ned som Markdown",
    analyzingDocument: "Analyserer dokument...",
    aiConnectionError:
      "Kunne ikke koble til KI-assistenten. Prøv igjen senere.",
    loadingGeneric: "Laster...",
    loadingChatHistory: "Laster samtalehistorikk...",
  },
  sharedChat: {
    missingShareLink: "Mangler delingslenke.",
    notFoundOrExpired: "Denne samtalen finnes ikke eller er ikke lenger delt.",
    fetchError: "Kunne ikke hente samtalen. Prøv igjen senere.",
    invalidServerData: "Ugyldig data fra server. Prøv igjen senere.",
    genericFetchError: "Noe gikk galt ved henting av samtalen.",
    notFound: "Den delte samtalen finnes ikke.",
    loading: "Laster delt samtale...",
    sharedAt: "Delt {date}",
    expiresAt: "Utløper {date}",
    badge: "StudyWise delt chat",
    disclaimer:
      "Denne lenken viser hele chatten slik den ble delt, inkludert brukerens egne meldinger og KI-svar.",
    footer: "Denne siden viser et delt snapshot av hele StudyWise-chatten.",
  },
  profil: {
    loading: "Laster profil...",
  },
} as const;
