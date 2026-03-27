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

function parseLocalizedNumber(value: string): number {
    const parsed = Number.parseFloat(value.replace(",", "."));
    return Number.isFinite(parsed) ? parsed : 0;
}

/** Parse tidsstreng til antall timer (f.eks. "2 timer" → 2, "1.5 timer" → 1.5). Ekstraherer kun det numeriske tallet. */
export function parseTimerStreng(tid: string): number {
    const normalized = tid.trim().toLowerCase();
    if (!normalized) return 0;

    const clockMatch = normalized.match(/\b(\d{1,2}):(\d{2})\b/);
    if (clockMatch) {
        const hours = Number.parseInt(clockMatch[1], 10);
        const minutes = Number.parseInt(clockMatch[2], 10);
        if (Number.isFinite(hours) && Number.isFinite(minutes)) {
            return hours + minutes / 60;
        }
    }

    const hourRangeMatch = normalized.match(
        /(\d+(?:[.,]\d+)?)\s*(?:-|til)\s*(\d+(?:[.,]\d+)?)\s*(?:t|time|timer|h|hr|hrs|hour|hours)\b/,
    );
    if (hourRangeMatch) {
        return (
            parseLocalizedNumber(hourRangeMatch[1]) +
            parseLocalizedNumber(hourRangeMatch[2])
        ) / 2;
    }

    const minuteRangeMatch = normalized.match(
        /(\d+(?:[.,]\d+)?)\s*(?:-|til)\s*(\d+(?:[.,]\d+)?)\s*(?:min|mins|minute|minutes|minutt|minutter)\b/,
    );
    if (minuteRangeMatch) {
        return (
            parseLocalizedNumber(minuteRangeMatch[1]) +
            parseLocalizedNumber(minuteRangeMatch[2])
        ) / 120;
    }

    let totalHours = 0;
    let foundUnit = false;

    const hourMatches = normalized.matchAll(
        /(\d+(?:[.,]\d+)?)\s*(?:t|time|timer|h|hr|hrs|hour|hours)\b/g,
    );
    for (const match of hourMatches) {
        totalHours += parseLocalizedNumber(match[1]);
        foundUnit = true;
    }

    const minuteMatches = normalized.matchAll(
        /(\d+(?:[.,]\d+)?)\s*(?:min|mins|minute|minutes|minutt|minutter)\b/g,
    );
    for (const match of minuteMatches) {
        totalHours += parseLocalizedNumber(match[1]) / 60;
        foundUnit = true;
    }

    if (foundUnit) {
        return totalHours;
    }

    const numericMatch = normalized.match(/(\d+(?:[.,]\d+)?)/);
    if (!numericMatch) return 0;

    return parseLocalizedNumber(numericMatch[1]);
}
