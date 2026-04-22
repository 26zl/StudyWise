/**
 * Aktiv tid-beregning: slår sammen tidsintervaller fra ChatHistory-oppdateringer
 * og ActivityLog-heartbeats til én sammenhengende serie, og returnerer totalt
 * antall timer i vinduet.
 *
 * Viktig designvalg for chat-intervaller:
 *   `ChatHistory.createdAt` / `updatedAt` er dokumentnivå på hele samtalen.
 *   En samtale som ble opprettet for dager siden og oppdatert én gang i dag,
 *   representerer IKKE timelang aktivitet — den representerer ett berøringspunkt
 *   (meldinger ble sendt rundt `updatedAt`). Vi bruker derfor et 2-minutters
 *   markeringsintervall `[updatedAt - 2min, updatedAt]`, ikke `[createdAt, updatedAt]`.
 *   Heartbeats dekker den egentlige sittetiden; chat-markeren fanger kort aktivitet
 *   som heartbeats kan ha rukket å miste.
 */

/** Chat-tidsstempel som brukes som markør (kun `updatedAt` leses). */
export interface ChatTidsstempel {
  createdAt?: Date | null;
  updatedAt?: Date | null;
}

/** Heartbeat-intervall fra ActivityLog. */
export interface AktivitetsIntervall {
  start: Date;
  end: Date;
}

/** Varighet av markør-intervallet vi legger per chat-oppdatering. */
export const CHAT_MARKER_MS = 2 * 60_000;

/**
 * Beregner sum av aktive timer i et gitt tidsvindu ved å slå sammen chat- og
 * heartbeat-intervaller og regne overlapp én gang.
 *
 * @param chats chat-dokumenter med `updatedAt` (createdAt ignoreres bevisst)
 * @param activities heartbeat-intervaller fra ActivityLog
 * @param vindusStartMs inklusiv startgrense (ms siden epoch) — alt før klippes bort
 * @returns timer, avrundet til 1 desimal
 */
export function beregnAktivTimer(
  chats: readonly ChatTidsstempel[],
  activities: readonly AktivitetsIntervall[],
  vindusStartMs: number,
): number {
  interface Periode {
    start: number;
    slutt: number;
  }
  const perioder: Periode[] = [];

  for (const c of chats) {
    const updatedAt = c.updatedAt ? new Date(c.updatedAt).getTime() : null;
    if (updatedAt == null) continue;
    const sluttTs = updatedAt;
    const startTs = Math.max(sluttTs - CHAT_MARKER_MS, vindusStartMs);
    if (sluttTs <= startTs) continue;
    perioder.push({ start: startTs, slutt: sluttTs });
  }

  for (const a of activities) {
    const startTs = Math.max(new Date(a.start).getTime(), vindusStartMs);
    const sluttTs = new Date(a.end).getTime();
    if (sluttTs <= startTs) continue;
    perioder.push({ start: startTs, slutt: sluttTs });
  }

  perioder.sort((a, b) => a.start - b.start);
  const slatt: Periode[] = [];
  for (const p of perioder) {
    const sist = slatt[slatt.length - 1];
    if (sist && p.start <= sist.slutt) {
      sist.slutt = Math.max(sist.slutt, p.slutt);
    } else {
      slatt.push({ ...p });
    }
  }
  const ms = slatt.reduce((sum, p) => sum + (p.slutt - p.start), 0);
  return Math.round((ms / 3_600_000) * 10) / 10;
}

/**
 * Returnerer antall unike kalenderdager (server-local tid) med aktivitet.
 * For intervaller som krysser midnatt telles begge datoer.
 */
export function beregnAktiveDager(
  chats: readonly ChatTidsstempel[],
  activities: readonly AktivitetsIntervall[],
  vindusStartMs: number,
): number {
  interface Periode {
    start: number;
    slutt: number;
  }
  const perioder: Periode[] = [];

  for (const c of chats) {
    const updatedAt = c.updatedAt ? new Date(c.updatedAt).getTime() : null;
    if (updatedAt == null) continue;
    const sluttTs = updatedAt;
    const startTs = Math.max(sluttTs - CHAT_MARKER_MS, vindusStartMs);
    if (sluttTs <= startTs) continue;
    perioder.push({ start: startTs, slutt: sluttTs });
  }
  for (const a of activities) {
    const startTs = Math.max(new Date(a.start).getTime(), vindusStartMs);
    const sluttTs = new Date(a.end).getTime();
    if (sluttTs <= startTs) continue;
    perioder.push({ start: startTs, slutt: sluttTs });
  }
  if (perioder.length === 0) return 0;
  perioder.sort((a, b) => a.start - b.start);
  const dager = new Set<string>();
  for (const p of perioder) {
    const d = new Date(p.start);
    dager.add(`${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`);
    const e = new Date(p.slutt);
    dager.add(`${e.getFullYear()}-${e.getMonth()}-${e.getDate()}`);
  }
  return dager.size;
}
