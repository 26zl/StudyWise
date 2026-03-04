/*
 * Frist-klassifisering og tidsformatering
 * Delte hjelpefunksjoner brukt av useFristVarsler og VarslingerSection
 */

// Terskler for fristklassifisering (timer)
export const FRIST_VINDU_TIMER = 72;
export const FRIST_KRITISK_TIMER = 24;
export const FRIST_SNART_TIMER = 48;

export type FristStatus = "kritisk" | "snart" | "kommende";

/** Klassifiser en frist basert på timer igjen */
export function klassifiserFrist(timerIgjen: number): FristStatus {
  if (timerIgjen < FRIST_KRITISK_TIMER) return "kritisk";
  if (timerIgjen < FRIST_SNART_TIMER) return "snart";
  return "kommende";
}

/** Formater timer igjen til lesbar norsk tekst */
export function formaterTid(timer: number): string {
  if (timer < 1) return "under 1 time";
  if (timer < 24) return `${Math.round(timer)} timer`;
  const dager = Math.floor(timer / 24);
  const restTimer = Math.round(timer % 24);
  if (dager === 1)
    return restTimer > 0 ? `1 dag og ${restTimer} timer` : "1 dag";
  return restTimer > 0
    ? `${dager} dager og ${restTimer} timer`
    : `${dager} dager`;
}
