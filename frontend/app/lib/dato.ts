/**
 * Felles dato- og klokkeslettformatering for frontend.
 * Støtter norsk og engelsk locale for brukerrettet dato/klokkeslett.
 */

import type { Language } from "@/app/i18n/types";

const LOCALES: Record<Language, string> = {
  en: "en-US",
  nb: "no-NO",
};

function tilDato(verdi: Date | string | number): Date {
  return verdi instanceof Date ? verdi : new Date(verdi);
}

function getLocale(language: Language = "nb"): string {
  return LOCALES[language];
}

/** Tall med locale: "10 000" / "10,000" */
export function formaterTall(verdi: number, language: Language = "nb"): string {
  return new Intl.NumberFormat(getLocale(language)).format(verdi);
}

/** Kort dato: "5. des." */
export function formaterDatoShort(
  d: Date | string | number,
  language: Language = "nb",
): string {
  return tilDato(d).toLocaleDateString(getLocale(language), {
    day: "numeric",
    month: "short",
  });
}

/** Lang dato: "5. desember 2025" */
export function formaterDatoLong(
  d: Date | string | number,
  language: Language = "nb",
): string {
  return tilDato(d).toLocaleDateString(getLocale(language), {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

/** Full dato med ukedag: "fredag 5. desember 2025" */
export function formaterDatoFull(
  d: Date | string | number,
  language: Language = "nb",
): string {
  return tilDato(d).toLocaleDateString(getLocale(language), {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

/** Dato med klokkeslett: "5. des. kl. 14:30" */
export function formaterDatoMedTid(
  d: Date | string | number,
  language: Language = "nb",
): string {
  const date = tilDato(d);
  const locale = getLocale(language);
  const dato = date.toLocaleDateString(locale, {
    day: "numeric",
    month: "short",
  });
  const tid = date.toLocaleTimeString(locale, {
    hour: "2-digit",
    minute: "2-digit",
  });
  return `${dato} ${tid}`;
}

/** Kun klokkeslett: "14:30" */
export function formaterKlokkeslett(
  d: Date | string | number,
  language: Language = "nb",
): string {
  return tilDato(d).toLocaleTimeString(getLocale(language), {
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** Dato og tid for eksport/visning: "5. desember 2025, 14:30" */
export function formaterDatoOgTid(
  d: Date | string | number,
  language: Language = "nb",
): string {
  const date = tilDato(d);
  const locale = getLocale(language);
  const dato = date.toLocaleDateString(locale, {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
  const tid = date.toLocaleTimeString(locale, {
    hour: "2-digit",
    minute: "2-digit",
  });
  return `${dato}, ${tid}`;
}

const MS_PER_DAY = 1000 * 60 * 60 * 24;

/** Antall hele dager fra i dag (UTC-midnatt). Positiv = fremtid, negativ = fortid. */
export function dagerFraIdag(d: Date | string | number): number {
  const now = new Date();
  const todayUTC = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const other = tilDato(d);
  const otherUTC = Date.UTC(other.getUTCFullYear(), other.getUTCMonth(), other.getUTCDate());
  return Math.round((otherUTC - todayUTC) / MS_PER_DAY);
}

/** Tekst for frist/hendelse: "I dag", "I morgen", "Om X dager", "X dag/dager siden". */
export function formaterDagerRelativtFrist(
  dager: number,
  language: Language = "nb",
): string {
  if (language === "en") {
    if (dager < 0) {
      const n = Math.abs(dager);
      return n === 1 ? "1 day ago" : `${n} days ago`;
    }
    if (dager === 0) return "Today";
    if (dager === 1) return "Tomorrow";
    return `In ${dager} days`;
  }

  if (dager < 0) {
    const n = Math.abs(dager);
    return n === 1 ? "1 dag siden" : `${n} dager siden`;
  }
  if (dager === 0) return "I dag";
  if (dager === 1) return "I morgen";
  return `Om ${dager} dager`;
}
