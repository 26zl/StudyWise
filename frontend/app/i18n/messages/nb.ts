export const nbMessages = {
  common: {
    actions: {
      askAi: "Spør KI",
      backToSignIn: "Tilbake til innlogging",
      cancel: "Avbryt",
      change: "Endre",
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
      redirectingToSignIn: "Sender deg til innlogging...",
      settings: "Laster innstillinger...",
      userData: "Laster brukerdata...",
    },
  },
  dashboard: {
    sections: {
      aiChat: "KI-chat",
      calendar: "kalender",
      canvas: "Canvas",
      notifications: "varslinger",
      quiz: "quiz",
      settings: "innstillinger",
    },
    sidebar: {
      aiAssistant: "KI Assistent",
      announcements: "Kunngjøringer",
      assignments: "Oppgaver",
      calendar: "Kalender",
      canvas: "Canvas",
      chatHistory: "Samtalehistorikk",
      courses: "Emner",
      noChatsYet: "Ingen samtaler ennå",
      notifications: "Varslinger",
      overview: "Oversikt",
      quiz: "Quiz",
      settings: "Innstillinger",
      taskBreakdown: "Oppgavedeling med KI",
    },
  },
  chatHistory: {
    clearConfirmDescription: "Alle lagrede samtaler fjernes. Dette kan ikke angres.",
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
        description: "Passordet ditt er oppdatert, og du sendes videre til dashboardet.",
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
        emailDescription: "Vi har sendt en gjenopprettingskode til e-posten din.",
        emailTitle: "Kode sendt på e-post",
      },
      steps: {
        identify: "Finn kontoen",
        setCredential: "Velg nytt passord",
        verify: "Bekreft kode",
      },
      thirdParty: {
        description:
          "Hvis du vanligvis logger inn med Microsoft, Google eller Apple, trenger du som regel ikke å nullstille passord her. Gå tilbake til innlogging og velg samme metode som før.",
        title: "Bruker du Microsoft, Google eller Apple?",
      },
      support:
        "Hvis du ikke mottar koden, sjekk spamfilteret ditt. Bruker du vanligvis Microsoft, Google eller Apple, går du tilbake og logger inn med samme metode.",
      title: "Glemt passord?",
    },
    signIn: {
      forgotPasswordAction: "Gjenopprett tilgang",
      forgotPasswordDescription:
        "For e-postinnlogging. Bruker du Microsoft, Google eller Apple, fortsetter du med samme leverandør i stedet.",
      forgotPasswordTitle: "Glemt passord?",
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
      rateLimit: "For mange forespørsler til Canvas. Vent noen sekunder og prøv igjen.",
      tokenInvalid:
        "Canvas API-tokenet ditt er ugyldig, utløpt eller slettet i Canvas. Gå til Innstillinger for å legge til et nytt token.",
      tokenMissing:
        "Du må knytte en Canvas API-token for å bruke denne funksjonen. Gå til Innstillinger for å legge til token.",
      timeout: "Henting av Canvas-data tok for lang tid. Prøv igjen.",
      validation: "Sjekk at Canvas-institusjon og URL er riktig, og prøv igjen.",
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
    missingCanvasToken:
      "Du må lagre en Canvas API-token for å hente varslinger.",
    partialLoadFallback:
      "Noen varsler kunne ikke lastes. Resten vises under.",
    remaining: "{time} igjen",
    submitted: "Innlevert",
    tabs: {
      all: "Alle",
      announcements: "Kunngjøringer",
      deadlines: "Frister",
      events: "Hendelser",
    },
    title: "Varslinger",
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
      action: "Rediger profil og sikkerhet",
      description:
        "Endre e-post, passord, aktiver to-faktor (2FA) og administrer tilkoblede innloggingsmetoder (Google, Microsoft, Apple). Dette håndteres av innloggingsleverandøren vår (Clerk).",
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
      customUrlPlaceholder: "https://din-skole.instructure.com",
      deleteConfirm: "Er du sikker?",
      deleteConnection: "Slett tilkobling",
      deleteErrorTitle: "Kunne ikke slette token",
      deleteSuccessDescription: "Canvas-tilkoblingen er fjernet.",
      deleteSuccessTitle: "Canvas-token slettet",
      deleting: "Sletter...",
      deletingButton: "Ja, slett Canvas API Token",
      description:
        "Koble til din Canvas-konto for å hente emner, kunngjøringer, frister og forelesninger. Velg institusjon under før du lagrer tokenet. Listen dekker kjente norske Canvas-instanser, og du kan angi en annen Instructure-URL ved behov.",
      hide: "Skjul",
      howTo: {
        step1: "Logg inn på Canvas",
        step2: "Gå til Innstillinger → Godkjente integrasjoner",
        step3: 'Klikk "Ny tilgangstoken"',
        step4: "Kopier token og lim inn her",
        title: "Slik får du en API token:",
      },
      institutionLabel: "Institusjon (Canvas)",
      institutionOther: "Annen Instructure-instans",
      institutionPlaceholder: "Velg institusjon",
      institutionRequired:
        "Velg institusjon (eller angi URL) før du lagrer tokenet.",
      invalidUrlDescription: "Skriv inn en gyldig Canvas-instans.",
      invalidUrlTitle: "Ugyldig Canvas-URL",
      placeholder: "Lim inn din Canvas API token",
      restoreConnection: "Gjenopprett tilkobling",
      restoring: "Gjenoppretter...",
      save: "Lagre token",
      saveErrorTitle: "Kunne ikke lagre token",
      saveSuccessDescription:
        "Canvas-data blir tilgjengelig om kort tid.",
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
      notConnected:
        "Ikke tilkoblet. Legg til Canvas API-token nedenfor.",
      studywiseAccount: "StudyWise-konto",
      title: "Profil",
    },
    title: "Innstillinger",
  },
} as const;
