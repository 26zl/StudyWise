/**
 * Felles dato- og klokkeslettformatering for frontend.
 * Bruker norsk locale (no-NO) konsistent på tvers av komponenter.
 */

const LOCALE = "no-NO";

function tilDato(verdi: Date | string | number): Date {
  return verdi instanceof Date ? verdi : new Date(verdi);
}

/** Kort dato: "5. des." */
export function formaterDatoShort(d: Date | string | number): string {
  return tilDato(d).toLocaleDateString(LOCALE, {
    day: "numeric",
    month: "short",
  });
}

/** Lang dato: "5. desember 2025" */
export function formaterDatoLong(d: Date | string | number): string {
  return tilDato(d).toLocaleDateString(LOCALE, {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

/** Full dato med ukedag: "fredag 5. desember 2025" */
export function formaterDatoFull(d: Date | string | number): string {
  return tilDato(d).toLocaleDateString(LOCALE, {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

/** Dato med klokkeslett: "5. des. kl. 14:30" */
export function formaterDatoMedTid(d: Date | string | number): string {
  const date = tilDato(d);
  const dato = date.toLocaleDateString(LOCALE, {
    day: "numeric",
    month: "short",
  });
  const tid = date.toLocaleTimeString(LOCALE, {
    hour: "2-digit",
    minute: "2-digit",
  });
  return `${dato} ${tid}`;
}

/** Kun klokkeslett: "14:30" */
export function formaterKlokkeslett(d: Date | string | number): string {
  return tilDato(d).toLocaleTimeString(LOCALE, {
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** Standard dato (locale default), f.eks. "05.12.2025" */
export function formaterDato(d: Date | string | number): string {
  return tilDato(d).toLocaleDateString(LOCALE);
}

/** Dato og tid for eksport/visning: "5. desember 2025, 14:30" */
export function formaterDatoOgTid(d: Date | string | number): string {
  const date = tilDato(d);
  const dato = date.toLocaleDateString(LOCALE, {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
  const tid = date.toLocaleTimeString(LOCALE, {
    hour: "2-digit",
    minute: "2-digit",
  });
  return `${dato}, ${tid}`;
}

const MS_PER_DAY = 1000 * 60 * 60 * 24;

/** Antall hele dager fra i dag (midnatt). Positiv = fremtid, negativ = fortid. */
export function dagerFraIdag(d: Date | string | number): number {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const other = new Date(tilDato(d));
  other.setHours(0, 0, 0, 0);
  return Math.round((other.getTime() - today.getTime()) / MS_PER_DAY);
}

/** Tekst for frist/hendelse: "I dag", "I morgen", "Om X dager", "X dager siden". */
export function formaterDagerRelativtFrist(dager: number): string {
  if (dager < 0) return `${Math.abs(dager)} dager siden`;
  if (dager === 0) return "I dag";
  if (dager === 1) return "I morgen";
  return `Om ${dager} dager`;
}
