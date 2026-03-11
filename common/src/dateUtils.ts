/*
 * Delte dato-hjelpefunksjoner for frontend og backend
 */

/** Millisekunder for 14 dager (brukes f.eks. for «neste 14 dager»-vinduer). */
export const TWO_WEEKS_MS = 14 * 24 * 60 * 60 * 1000;

/** Beregn ISO 8601 ukenummer for en gitt dato */
export function getWeekNumber(date: Date): number {
    const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
    const dayNum = d.getUTCDay() || 7;
    d.setUTCDate(d.getUTCDate() + 4 - dayNum);
    const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
    return Math.ceil((((d.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
}

/** Parse tidsstreng til antall timer (f.eks. "2t" → 2, "1.5t" → 1.5, "30min" → 0.5) */
export function parseTimerStreng(tid: string): number {
    const match = tid.match(/(\d+\.?\d*)/);
    return match ? parseFloat(match[1]) : 0;
}
