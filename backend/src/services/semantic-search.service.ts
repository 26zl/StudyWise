/**
 * Semantic Search Service
 *
 * Keyword-basert søk i Canvas-innhold (PDF-tekst, moduler, oppgaver).
 * Bruker TF-basert scoring i stedet for vektorembeddings, siden prosjektet
 * kun har Anthropic Claude (ingen embeddings-API).
 *
 * Eksporterte funksjoner:
 *   - extractSearchTerms(text)   — tokeniser og filtrer stoppord
 *   - scoreText(text, terms)     — TF-score for en tekstblokk
 *   - formatCourseLabel(name, code) — felles formatering av emnenavn
 */

// ─── Norske stoppord (vanlige ord som ikke bidrar til søk) ──

const STOPPORD = new Set([
  // Artikler og pronomen
  "en", "ei", "et", "den", "det", "de", "vi", "du", "jeg", "han",
  "hun", "dem", "seg", "sin", "sitt", "sine", "ditt", "din", "dine",
  "vår", "vårt", "våre", "min", "mitt", "mine",
  // Preposisjoner og konjunksjoner
  "i", "på", "til", "for", "med", "om", "av", "fra", "som", "er",
  "var", "har", "kan", "vil", "skal", "må", "og", "eller", "men",
  "at", "da", "når", "hvis", "så", "etter", "under", "over", "mellom",
  "mot", "ved", "ut", "inn", "opp", "ned",
  // Hjelpeverb og vanlige verb
  "være", "bli", "blitt", "blir", "ble", "ha", "hadde", "hatt",
  "gjøre", "gjort", "gjør", "få", "fikk", "fått", "får",
  "si", "sier", "sa", "sagt", "se", "ser", "så", "sett",
  "ta", "tar", "tok", "tatt", "gi", "gir", "ga", "gitt",
  // Adverb og andre småord
  "ikke", "bare", "nå", "her", "der", "hva", "hvem", "hvor",
  "hvordan", "hvorfor", "dette", "denne", "disse", "noe",
  "noen", "alle", "alt", "annet", "andre", "mange", "mye",
  "mer", "mest", "også", "helt", "veldig", "svært",
  // KI-kontekst-ord (filtrerer prompt-relaterte ord)
  "oppsummer", "forklar", "beskriv", "fortell", "hjelp", "meg",
]);

/** Minimum ordlengde for søketerm (etter stoppord-filtrering) */
const MIN_TERM_LENGTH = 2;

// ─── Eksporterte funksjoner ────────────────────────────────

/**
 * Ekstraher søketermer fra en bruker-melding.
 * Fjerner stoppord, korte ord, og normaliserer til lowercase.
 */
export function extractSearchTerms(text: string): string[] {
  // Tokeniser: splitt på whitespace og tegnsetting, behold norske tegn
  const tokens = text
    .toLowerCase()
    .replace(/[.,;:!?()[\]{}"'«»/\\<>+=%#@&*~`|^$]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length >= MIN_TERM_LENGTH);

  // Filtrer stoppord
  const filtered = tokens.filter((t) => !STOPPORD.has(t));

  // Dedupliser
  return [...new Set(filtered)];
}

/**
 * Scorer en tekstblokk basert på term-forekomst (TF-scoring).
 * Høyere score = flere og sjeldnere termer funnet.
 *
 * @param text - Teksten som scores
 * @param terms - Søketermer fra extractSearchTerms()
 * @returns Score ≥ 0 (0 = ingen match)
 */
export function scoreText(text: string, terms: string[]): number {
  if (terms.length === 0 || text.length === 0) return 0;

  const lower = text.toLowerCase();
  let score = 0;
  let matchedTerms = 0;

  for (const term of terms) {
    // Tell forekomster (unngå regex for ytelse — bruk indexOf-loop)
    let count = 0;
    let pos = 0;
    while (pos < lower.length) {
      const idx = lower.indexOf(term, pos);
      if (idx === -1) break;
      count++;
      pos = idx + term.length;
    }

    if (count > 0) {
      matchedTerms++;
      // Log-dempet TF: log(1 + count) for å unngå at hyppige ord dominerer
      score += Math.log(1 + count) * (term.length / 3);
    }
  }

  // Bonus for å matche flere ulike termer (coverage)
  if (matchedTerms > 1) {
    score *= 1 + 0.3 * (matchedTerms / terms.length);
  }

  return score;
}

/**
 * Formaterer emnenavn med emnekode (felles hjelpefunksjon).
 */
export function formatCourseLabel(name: string, courseCode?: string): string {
  return courseCode ? `${name} (${courseCode})` : name;
}
