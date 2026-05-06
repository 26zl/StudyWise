/**
 * Regex-mønstre for å gjenkjenne strukturelle Canvas-spørsmål
 * (kursoversikter, frister, moduler, kunngjøringer) på norsk og engelsk.
 * Brukes til å rute spørsmål til Canvas-kontekst i stedet for ren KI-svar.
 */

const COURSE_OVERVIEW_PATTERNS = [
  // Norsk
  /\b(?:hvilke|alle|mine|oversikt|liste|list opp|vis)\b.*\b(?:emner|fag|kurs)\b/i,
  /\b(?:emner|fag|kurs)\b.*\b(?:registrert|påmeldt|meldt opp)\b/i,
  /\b(?:registrert|påmeldt|meldt opp)\b.*\b(?:emner|fag|kurs)\b/i,
  // Engelsk
  /\b(?:which|what|all|my|show|list|overview)\b.*\b(?:courses|subjects|classes)\b/i,
  /\b(?:courses|subjects|classes)\b.*\b(?:enrolled|registered|taking)\b/i,
  /\b(?:enrolled|registered|taking)\b.*\b(?:courses|subjects|classes)\b/i,
];

const STRUCTURED_CANVAS_QUERY_PATTERNS = [
  ...COURSE_OVERVIEW_PATTERNS,
  // Norsk — modul/leksjonsstruktur
  /\b(?:hvilke|vis|liste|oversikt|hva slags)\b.*\b(?:moduler|leksjoner|forelesninger|temaer|kapitler|ukeplaner|uker)\b/i,
  /\b(?:moduler|leksjoner|forelesninger|temaer|kapitler)\b.*\b(?:finnes|har|inneholder|kan du se|er det|ligger)\b/i,
  /\b(?:innhold|struktur|pensum|fagplan)\b.*\b(?:emnet|kurset|faget)\b/i,
  /\b(?:emnet|kurset|faget)\b.*\b(?:innhold|struktur|pensum|fagplan)\b/i,
  // Norsk — frister/oppgaver/hendelser
  /\b(?:neste|kommende)\b.*\b(?:frist|frister|oppgave|oppgaver|innlevering|innleveringer|hendelse|hendelser|kunngjøring(?:er|ene)?)\b/i,
  /\b(?:hvilke|vis|liste|oversikt)\b.*\b(?:oppgaver|innleveringer|frister|kunngjøringer|hendelser)\b/i,
  /\boppsummer\b.*\b(?:kunngjøring(?:er|ene)?|beskjed(?:er)?|endring(?:er)?)\b/i,
  /\b(?:kunngjøring(?:er|ene)?|beskjed(?:er)?|endring(?:er)?)\b.*\boppsummer\b/i,
  /\b(?:kalender|timeplan|todo|gjøremål)\b/i,
  /\bnår er\b.*\b(?:frist|frister|eksamen|innlevering|oppgave)\b/i,
  // Engelsk — module/lesson structure
  /\b(?:which|what|show|list|overview)\b.*\b(?:modules|lessons|lectures|topics|chapters|weeks)\b/i,
  /\b(?:modules|lessons|lectures|topics|chapters)\b.*\b(?:are there|does it have|contains|can you see)\b/i,
  /\b(?:content|structure|syllabus|curriculum)\b.*\b(?:course|subject|class)\b/i,
  // Engelsk — frister/oppgaver/hendelser
  /\b(?:next|upcoming)\b.*\b(?:deadline|deadlines|assignment|assignments|submission|submissions|event|events|announcement|announcements)\b/i,
  /\b(?:which|show|list|overview)\b.*\b(?:assignments|submissions|deadlines|announcements|events)\b/i,
  /\bsummar(?:y|ize)\b.*\b(?:announcements?|notifications?|changes?)\b/i,
  /\b(?:announcements?|notifications?|changes?)\b.*\bsummar(?:y|ize)\b/i,
  /\b(?:calendar|schedule|todo|to-do)\b/i,
  /\bwhen is\b.*\b(?:deadline|deadlines|exam|submission|assignment)\b/i,
];

export function normaliserCanvasSporsmal(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\wæøå\s-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function isCourseOverviewQuery(message: string): boolean {
  const normalized = normaliserCanvasSporsmal(message);
  return COURSE_OVERVIEW_PATTERNS.some((pattern) => pattern.test(normalized));
}

/**
 * Ord som indikerer at brukeren spør om FAGINNHOLD å studere/øve på,
 * ikke bare strukturen i kurset. Når disse er til stede sammen med en
 * struktur-pattern (f.eks. "hva slags moduler"), skal spørsmålet
 * IKKE klassifiseres som strukturelt — brukeren trenger faktisk
 * filinnhold via hybrid-retrieval, ikke bare modul-titler.
 */
const STUDY_INTENT_KEYWORDS = [
  // Norsk
  "eksamen", "øve", "øving", "lære", "forstå", "forklar",
  "forberede", "forberedelse", "pugge", "studere", "repetisjon", "repetere",
  "oppsummer", "pensum",
  // Engelsk
  "exam", "study", "studying", "learn", "understand", "explain",
  "prepare", "preparation", "practice", "review", "summarize", "summarise",
  "revise", "revision",
];

function harStudieIntent(text: string): boolean {
  return STUDY_INTENT_KEYWORDS.some((kw) => text.includes(kw));
}

export function isStructuredCanvasQuery(message: string): boolean {
  const normalized = normaliserCanvasSporsmal(message);
  // Hvis brukeren tydelig spør om eksamensforberedelse/læring, la struktur-
  // pattern slippe gjennom slik at intent-klassifikatoren kan eskalere til
  // canvas_full og hente faktisk filinnhold via hybrid-retrieval.
  if (harStudieIntent(normalized)) return false;
  return STRUCTURED_CANVAS_QUERY_PATTERNS.some((pattern) => pattern.test(normalized));
}
