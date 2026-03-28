const COURSE_OVERVIEW_PATTERNS = [
  /\b(?:hvilke|alle|mine|oversikt|liste|list opp|vis)\b.*\b(?:emner|fag|kurs)\b/i,
  /\b(?:emner|fag|kurs)\b.*\b(?:registrert|påmeldt|meldt opp)\b/i,
  /\b(?:registrert|påmeldt|meldt opp)\b.*\b(?:emner|fag|kurs)\b/i,
];

const STRUCTURED_CANVAS_QUERY_PATTERNS = [
  ...COURSE_OVERVIEW_PATTERNS,
  /\b(?:neste|kommende)\b.*\b(?:frist|frister|oppgave|oppgaver|innlevering|innleveringer|hendelse|hendelser|kunngjøring(?:er|ene)?)\b/i,
  /\b(?:hvilke|vis|liste|oversikt)\b.*\b(?:oppgaver|innleveringer|frister|kunngjøringer|hendelser)\b/i,
  /\boppsummer\b.*\b(?:kunngjøring(?:er|ene)?|beskjed(?:er)?|endring(?:er)?)\b/i,
  /\b(?:kunngjøring(?:er|ene)?|beskjed(?:er)?|endring(?:er)?)\b.*\boppsummer\b/i,
  /\b(?:kalender|timeplan|todo|gjøremål)\b/i,
  /\bnår er\b.*\b(?:frist|frister|eksamen|innlevering|oppgave)\b/i,
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

export function isStructuredCanvasQuery(message: string): boolean {
  const normalized = normaliserCanvasSporsmal(message);
  return STRUCTURED_CANVAS_QUERY_PATTERNS.some((pattern) => pattern.test(normalized));
}
