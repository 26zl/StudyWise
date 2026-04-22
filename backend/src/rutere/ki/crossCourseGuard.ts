/**
 * Cross-course-guard: avgjør om retrieval-resultatet inneholder innhold fra
 * et annet kurs enn samtalens primær-kurs, og bygger en advarselblokk som
 * kan appendes til system-prompten når dette skjer.
 *
 * Bakgrunn: tidligere kunne en samtale om f.eks. MET1020 ende opp med å
 * presentere innhold fra 6105N som om det var svaret — fordi retrieval
 * søkte på tvers av alle brukerens emner uten å skille mellom primær og
 * sekundær kurskontekst. Den denne modulen sikrer at modellen eksplisitt
 * må varsle brukeren i stedet for å skjule kryssempnekilder.
 */

export interface CrossCourseSource {
  courseId?: string;
  courseName?: string;
}

export interface CrossCourseGuardInput {
  /** Primær-kurset som er etablert for samtalen (ChatHistory.primaryCourseId). */
  primaryCourseId: string | null;
  /** Lesbar form av primær-kurset (kurs-kode/-navn), brukes i prompten. */
  primaryCourseHint: string | null;
  /** Kildelisten returnert fra retrieval. */
  kilder: readonly CrossCourseSource[];
  /**
   * Hvis brukeren eksplisitt refererte til et annet kurs i meldingen
   * (f.eks. "i 6105N, modul 7"), skal ikke guarden utløses — brukeren
   * styrer selv at samtalen flytter seg.
   */
  userExplicitlyReferencedOtherCourse: boolean;
}

export interface CrossCourseGuardResult {
  triggered: boolean;
  inScopeCount: number;
  outOfScopeCount: number;
  foreignCourseIds: string[];
  promptBlock: string | null;
}

/**
 * Returner en guard-beslutning. Når `triggered=true` inneholder `promptBlock`
 * et ferdigformatert Markdown-avsnitt som skal appendes til system-prompten.
 */
export function evaluateCrossCourseGuard(
  input: CrossCourseGuardInput,
): CrossCourseGuardResult {
  const { primaryCourseId, primaryCourseHint, kilder, userExplicitlyReferencedOtherCourse } = input;

  const empty: CrossCourseGuardResult = {
    triggered: false,
    inScopeCount: 0,
    outOfScopeCount: 0,
    foreignCourseIds: [],
    promptBlock: null,
  };

  if (!primaryCourseId || kilder.length === 0 || userExplicitlyReferencedOtherCourse) {
    return empty;
  }

  const outOfScope = kilder.filter(
    (k) => k.courseId != null && k.courseId !== primaryCourseId,
  );
  const inScope = kilder.filter((k) => k.courseId === primaryCourseId);

  if (outOfScope.length === 0) return empty;

  const primaryCourseLabel = primaryCourseHint
    ? `${primaryCourseHint} (kurs-id ${primaryCourseId})`
    : `kurs-id ${primaryCourseId}`;

  const foreignCourseLabels = [
    ...new Set(
      outOfScope.map(
        (k) => `${k.courseName || "(ukjent navn)"} (kurs-id ${k.courseId})`,
      ),
    ),
  ].join(", ");

  const inScopeLine =
    inScope.length === 0
      ? `NO content from ${primaryCourseLabel} was retrieved for this query.`
      : `Some content from ${primaryCourseLabel} was also retrieved — prefer that.`;

  const promptBlock = `

## Cross-Course Content Guard (CRITICAL)

This chat's primary course is **${primaryCourseLabel}**. The retrieval found content
below from a DIFFERENT course: ${foreignCourseLabels}.
${inScopeLine}

MANDATORY behavior:
1. Do NOT present content from ${foreignCourseLabels} as if it answers a question about ${primaryCourseLabel}.
2. If you have NO content from ${primaryCourseLabel}, respond like this and stop:
   "Jeg finner ikke innhold om dette i ${primaryCourseLabel}. Det jeg fant var fra ${foreignCourseLabels} — vil du at jeg skal svare på det i stedet, eller mente du et annet kapittel/modul i ${primaryCourseLabel}?"
3. If you DO have content from ${primaryCourseLabel}, answer from that and ignore the foreign-course chunks.
4. NEVER silently mix — the student expects answers scoped to their current chat's course.
5. Do NOT apologize or say "Beklager forvirringen" — just ask the clarifying question directly.
`;

  return {
    triggered: true,
    inScopeCount: inScope.length,
    outOfScopeCount: outOfScope.length,
    foreignCourseIds: [...new Set(outOfScope.map((k) => String(k.courseId)))],
    promptBlock,
  };
}
