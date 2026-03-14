/**
 * dateUtils – delte dato-hjelpefunksjoner for frontend og backend (uke, ukenummer, tidsintervall).
 */

/** Millisekunder for 14 dager (brukes f.eks. for «neste 14 dager»-vinduer). */
export const TWO_WEEKS_MS = 14 * 24 * 60 * 60 * 1000;

function getIsoWeekDate(date: Date): Date {
    const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
    const dayNum = d.getUTCDay() || 7;
    d.setUTCDate(d.getUTCDate() + 4 - dayNum);
    return d;
}

/** Beregn ISO 8601 ukenummer og ukeår for en gitt dato */
export function getIsoWeekInfo(date: Date): { weekNumber: number; weekYear: number } {
    const d = getIsoWeekDate(date);
    const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
    return {
        weekNumber: Math.ceil((((d.getTime() - yearStart.getTime()) / 86400000) + 1) / 7),
        weekYear: d.getUTCFullYear(),
    };
}

/** Beregn ISO 8601 ukenummer for en gitt dato */
export function getWeekNumber(date: Date): number {
    return getIsoWeekInfo(date).weekNumber;
}

/** Parse tidsstreng til antall timer (f.eks. "2 timer" → 2, "1.5 timer" → 1.5). Ekstraherer kun det numeriske tallet. */
export function parseTimerStreng(tid: string): number {
    const match = tid.match(/(\d+(?:[.,]\d+)?)/);
    if (!match) return 0;

    const parsed = Number.parseFloat(match[1].replace(",", "."));
    return Number.isFinite(parsed) ? parsed : 0;
}
