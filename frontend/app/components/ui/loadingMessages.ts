/**
 * Meldingspool for RotatingStatusMessage.
 *
 * Fire kategorier:
 * - status: Profesjonelle statusmeldinger (hva som skjer "bak kulissene")
 * - visste-du-at: Studieteknikk- og hjernefakta (lærerike småinntrykk)
 * - motivasjon: Støttende "vi jobber for deg"-tekster
 * - pause: Humoristiske pauseforslag (kaffe, TikTok, strekke seg)
 *
 * Tekstene er bevisst korte (≤ 70 tegn) for å få plass i smal loading-UI.
 * Alle kategorier er universelle — ikke IT-spesifikke — siden StudyWise
 * støtter studenter på tvers av alle norske studier.
 *
 * Pool-størrelse er stor (~175 entries totalt) slik at lange KI-operasjoner
 * (2-3 min) ikke viser samme melding to ganger under samme session. Ved
 * tilfeldig stokking per mount blir brukeropplevelsen variert og fersk.
 */

export type LoadingMessageCategory =
  | "status"
  | "visste-du-at"
  | "motivasjon"
  | "pause";

export const LOADING_MESSAGES: Record<LoadingMessageCategory, string[]> = {
  status: [
    // Input-behandling
    "Analyserer spørsmålet ditt",
    "Leser kursmaterialet ditt trygt…",
    "Strukturerer innhold fra dine fag",
    "Identifiserer relevante kapitler",
    // Søk og matching
    "Søker gjennom pensum",
    "Matcher mot riktig leksjon",
    "Vekter kildene etter faglig relevans",
    "Finner det mest relevante innholdet",
    "Prioriterer faglig dybde",
    "Kobler sammen temaene",
    "Sjekker fagtermer mot pensum",
    // Kontekst-bygging
    "Bygger kontekst for best mulig svar",
    "Organiserer fakta og begreper",
    "Kobler teori til praksis",
    "Refererer til riktig del av kursmaterialet",
    "Bygger struktur og sammenhenger",
    // Svargenerering
    "Komponerer svaret steg for steg",
    "Verifiserer detaljene",
    "Kontrollerer at svaret er komplett",
    "Optimaliserer svarets dybde",
    "Formaterer tabeller og lister",
    "Renser svaret for unøyaktigheter",
    "Aktiverer dypt svar-modus",
    "Henter detaljene som betyr noe",
    "Kontrollerer kursdataen",
    // Ekstra status-meldinger
    "Filtrerer gjennom søkeresultater",
    "Sammenligner kapitler på tvers av kurset",
    "Henter relevante eksamensoppgaver",
    "Verifiserer mot pensum og notater",
    "Leser Canvas-modulene dine nøye",
    "Aktiverer dypt fokus på faginnholdet",
    "Setter sammen svaret som en historie",
    "Rydder opp i lange setninger",
    "Skreddersyr forklaringen for deg",
    "Bygger en klar faglig struktur",
    "Forankrer svaret i pensum",
    "Dobbeltsjekker viktige detaljer",
  ],
  "visste-du-at": [
    // Klassiske studieteknikker
    "Visste du at hjernen lærer best når du forklarer ting med egne ord?",
    "Visste du at korte pauser hvert 25. minutt øker konsentrasjonen?",
    "Visste du at søvn er like viktig for læring som selve studien?",
    "Visste du at håndskrevne notater ofte gir bedre hukommelse enn PC?",
    "Visste du at å lære bort noe er en av de kraftigste læringsmetodene?",
    "Visste du at hjernen ikke multitasker — den bytter bare raskt?",
    "Visste du at 90 % glemmes innen 30 dager uten repetisjon?",
    "Visste du at tegning under lesing kan øke forståelsen med ~30 %?",
    "Visste du at å blande emner slår det å pugge ett om gangen?",
    "Visste du at flashcards bygger langtidshukommelse via spaced repetition?",
    "Visste du at koffein bruker ~20 min på å virke? Timing matters!",
    "Visste du at bevegelse mellom lesning bedrer konsentrasjonen?",
    "Visste du at kroppen er 75 % vann — gi hjernen drikke!",
    "Visste du at du lærer mer av testoppgaver enn av å repetere?",
    "Visste du at mørk modus faktisk reduserer øyestress om kvelden?",
    // Mer avanserte
    "Visste du at Feynman-teknikken er en av verdens kraftigste læringsmetoder?",
    "Visste du at hjernen trenger 6+ timer søvn for å konsolidere læring?",
    "Visste du at å variere studiested gir bedre hukommelse?",
    "Visste du at bøker på papir aktiverer flere hjerneområder enn skjermer?",
    "Visste du at hjernen bruker ~20 % av energien du spiser?",
    "Visste du at dagdrømming faktisk hjelper kreativ problemløsning?",
    "Visste du at kroppsholdning påvirker hvor sikker du føler deg?",
    "Visste du at nysgjerrighet aktiverer samme belønningssystem som sjokolade?",
    "Visste du at å pugge rett før du sovner gir bedre innlæring?",
    "Visste du at hjernen jobber mer aktivt etter en gåtur enn i ro?",
    // Helse og rutiner
    "Visste du at 20 minutter daglig bevegelse øker læringsevnen?",
    "Visste du at musikk uten tekst forbedrer konsentrasjonen for de fleste?",
    "Visste du at naturbilder i bakgrunnen øker fokus med ~20 %?",
    "Visste du at latter faktisk bedrer hukommelsen?",
    "Visste du at dagslys i 20 min kan resette døgnrytmen din?",
    "Visste du at å skrive ned tankene før eksamen reduserer angst?",
    "Visste du at mørk sjokolade kan forbedre hjernefunksjonen kortvarig?",
    "Visste du at varmt bad før leggetid faktisk gir bedre søvn?",
    "Visste du at tyggegummi under pugging kan øke hukommelsen litt?",
    "Visste du at frisk luft i rommet senker hjernetrettheten?",
    // Interessante fakta
    "Visste du at hjernen er mer aktiv under drømmer enn når du er våken?",
    "Visste du at vi ikke bruker 10 %, men nær 100 % av hjernen daglig?",
    "Visste du at nervesignaler kan løpe opptil 430 km/t?",
    "Visste du at hjernen har ~86 milliarder nevroner?",
    "Visste du at stress blokkerer læring — kortisol hemmer hukommelsen?",
    // Ekstra studieteknikk-fakta
    "Visste du at 10 min meditasjon kan øke arbeidsminnet ditt?",
    "Visste du at sulten hjerne glemmer — spis før du leser!",
    "Visste du at interleaving (variere fag) slår massepugging?",
    "Visste du at selvtester øker læring mer enn å lese to ganger?",
    "Visste du at arbeidsminnet bare holder ~4 elementer samtidig?",
    "Visste du at dopamin slippes ut når du krysser av oppgaver?",
    "Visste du at å drikke vann kan gi opptil 14 % bedre fokus?",
    "Visste du at kroppstemperaturen peaker kl 16 — god studietid?",
    "Visste du at planlagt forglemmelse faktisk styrker hukommelsen?",
    "Visste du at 15 min sosial kontakt senker stressnivåene?",
    "Visste du at å se grønt i 40 sek kan resette fokuset?",
    "Visste du at ditt beste tidspunkt å lære på er unikt for deg?",
    "Visste du at eksamensangst dempes ved dyp pusting i 2 min?",
    "Visste du at hjernen trenger vann for å danne nye synapser?",
    "Visste du at å forklare med eksempler festner kunnskapen?",
    "Visste du at du husker 90 % av det du lærer bort til andre?",
  ],
  motivasjon: [
    // Kvalitet og tid
    "Kvalitet tar tid — vi bygger svaret du fortjener",
    "Ditt beste svar kommer, bit for bit",
    "Dypt innhold kan ikke rushes",
    "Nøyaktighet over hastighet",
    "Gode svar starter med grundig forberedelse",
    "Vi jobber hardt så du kan forstå lett",
    "Smart arbeid slår langt arbeid",
    // Studievennlig motivasjon
    "Små fremskritt er store seire",
    "Hvert sekund her sparer deg timer senere",
    "Du er ett steg nærmere eksamenssuksess",
    "Læring er en superkraft — fortsett!",
    "Vi gjør arbeidet så du kan fokusere på det viktige",
    "Fokus nå — belønning kommer",
    "Bedre svar, bedre karakterer",
    "Hver studieøkt er en investering i deg selv",
    "Du har allerede kommet langt i dag",
    "Din fremtid takker deg for dette",
    // Selvtro og utholdenhet
    "Små steg, stor fremgang",
    "Hjernen din er sterkere enn du tror",
    "Fortsett — du er på riktig spor",
    "Disiplin i dag, frihet i morgen",
    "Hver feil er en læringssnarvei",
    "Du trenger ikke være perfekt, bare fortsette",
    "Studier tar tid, men du tar kontroll",
    "Fokuset ditt er superkraften din",
    "Tålmodighet er kunsten å bli sterk",
    "Det du lærer nå, glemmer du aldri helt",
    // Ekstra motivasjon
    "Kunnskap er den beste investeringen du kan gjøre",
    "Hver side du leser bringer deg nærmere målet",
    "Du har bestemt deg — det er halve jobben",
    "Eksamen er bare ett steg på din vei",
    "Du bygger grunnmuren for din karriere",
    "Fokus skiller gode fra eksepsjonelle studenter",
    "Energi investert nå = frihet senere",
    "Ditt beste deg er nærmere enn du tror",
    "Hver studieøkt er en stein i grunnmuren",
    "Du er sterkere enn gårsdagens deg",
    "Gode vaner bygger store resultater",
    "Tenk langsiktig — belønningen kommer",
  ],
  pause: [
    // Koffein og mat
    "Dette kan ta en kaffekopps tid ☕",
    "Kos deg med en snack 🍎",
    "Unn deg litt mørk sjokolade 🍫",
    "En varm kopp te er godt akkurat nå 🍵",
    "Drikk et glass vann — hjernen trenger det 💧",
    // Sosiale medier
    "Perfekt tid for en kort TikTok-pause 📱",
    "Snapchat-streak kan holdes imens vi jobber 🔥",
    "Kanskje en rask Instagram-scroll? 📸",
    "YouTube Shorts venter — du har tid 🎬",
    "En rask BeReal-sjekk? 📸",
    "Sjekk meldingene dine — vi er straks tilbake 💬",
    "Kikk innom Reddit i 30 sek 🐸",
    "Twitch-pause, kanskje? 🎮",
    // Kropp og bevegelse
    "Strekk litt på deg mens vi henter stoffet 🧘",
    "Rist på skuldrene, vi jobber for deg 💪",
    "Rist løs rygg og nakke — kroppen takker deg 🤸",
    "Rull hodet forsiktig i en sirkel 🔄",
    "En rask stretch av håndleddene? ✋",
    "Reis deg opp i 30 sekunder 🚶",
    "Push-up? Burpee? Du velger 💥",
    // Avspenning
    "Pust inn i 4, ut i 6 — beroligende ❤️",
    "Lukk øynene i 10 sek — syn takker deg 👁️",
    "Ta et dypt pust, vi har kontroll 😌",
    "Se ut av vinduet et øyeblikk 🌳",
    "Åpne vinduet for frisk luft 🌬️",
    "Smil til deg selv 😊",
    // Hygge
    "Sett på favorittsangen din i bakgrunnen 🎵",
    "En runde Wordle imens? 🔤",
    "Duolingo-streak kan holdes 🔥",
    "Les en side i en bok du liker 📖",
    "Finn en ny podcast-anbefaling? 🎧",
    "Send en melding til en venn 💌",
    "Godt jobbet til nå — ta to minutter 👏",
    // Ekstra pauseforslag
    "Nynn en sang du liker 🎶",
    "Rist løs trøtte PC-hender 💻",
    "Gå en kort runde rundt pulten 🚶",
    "Rull øynene i en sirkel — øyehvile 👀",
    "Klapp tre ganger — gir energiboost 👏",
    "Rull skuldrene baklengs tre ganger 🔄",
    "Sett på favorittspillelisten i bakgrunnen 🎧",
    "Spis en frukt imens — hjernemat 🍌",
    "Tell til ti — du har fortjent det 🔢",
    "Sjekk værmeldingen for morgendagen 🌤️",
    "Fikk en idé? Skriv den ned fort ✏️",
    "Strekk armene over hodet — lett yoga 🙆",
    "Ta en slurk kaldt vann for våkenhet 🧊",
    "Kikk på noe langt unna — øynene takker 👓",
  ],
};

/**
 * Returnerer sammenslått liste fra valgte kategorier, stokket tilfeldig.
 * Tomt array-argument betyr "alle kategorier".
 */
export function buildMessagePool(
  categories: LoadingMessageCategory[] = [],
): string[] {
  const selected =
    categories.length === 0
      ? (Object.keys(LOADING_MESSAGES) as LoadingMessageCategory[])
      : categories;
  const pool = selected.flatMap((cat) => LOADING_MESSAGES[cat]);
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return pool;
}
