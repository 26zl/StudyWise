/*
 * Varsler – felles logikk for popup-toast og varslinger-siden.
 * Inkluderer frist-klassifisering, tidsformatering, typer og bygging av lister.
 * Lest/ulest håndteres i uiStore. Canvas-oppgave-utils (f.eks. erInnlevert) importeres fra canvasUtils.
 */

import type { AssignmentMedEmne } from "../canvas/canvas-api";
import { erInnlevert } from "../canvas/canvasUtils";
import type { Assignment } from "common/calendar-ui";
import type { Language } from "@/app/i18n/types";

// —— Frist-terrkler og -typer ——

/** Antall dager frem i tid vi viser frister (varslinger, oversikt, kontekst). Brukes overalt for konsistens. */
export const FRIST_VINDU_DAGER = 7;
export const FRIST_VINDU_TIMER = FRIST_VINDU_DAGER * 24;
export const FRIST_KRITISK_TIMER = 24;
export const FRIST_SNART_TIMER = 48;

export type FristStatus = "kritisk" | "snart" | "kommende";

export function klassifiserFrist(timerIgjen: number): FristStatus {
    if (timerIgjen < FRIST_KRITISK_TIMER) return "kritisk";
    if (timerIgjen < FRIST_SNART_TIMER) return "snart";
    return "kommende";
}

export function erInnenforFristVindu(
    dato: string | Date | null | undefined,
    nå = Date.now(),
): boolean {
    if (!dato) return false;
    const timer = (new Date(dato).getTime() - nå) / (1000 * 60 * 60);
    return timer > 0 && timer <= FRIST_VINDU_TIMER;
}

/** Formater timer igjen til lesbar tekst på valgt språk */
export function formaterTid(timer: number, language: Language = "nb"): string {
    if (language === "en") {
        if (timer < 1) return "under 1 hour";
        if (timer < 24) {
            const hours = Math.round(timer);
            return hours === 1 ? "1 hour" : `${hours} hours`;
        }
        const days = Math.floor(timer / 24);
        const remainingHours = Math.round(timer % 24);
        if (days === 1) {
            if (remainingHours <= 0) return "1 day";
            return remainingHours === 1 ? "1 day and 1 hour" : `1 day and ${remainingHours} hours`;
        }
        if (remainingHours <= 0) return `${days} days`;
        return remainingHours === 1 ? `${days} days and 1 hour` : `${days} days and ${remainingHours} hours`;
    }

    if (timer < 1) return "under 1 time";
    if (timer < 24) return `${Math.round(timer)} timer`;
    const dager = Math.floor(timer / 24);
    const restTimer = Math.round(timer % 24);
    if (dager === 1) return restTimer > 0 ? `1 dag og ${restTimer} timer` : "1 dag";
    return restTimer > 0 ? `${dager} dager og ${restTimer} timer` : `${dager} dager`;
}

// —— Typer ——

export interface FristElement {
    type: "frist";
    id: string;
    tittel: string;
    emne: string;
    dato: Date;
    timerIgjen: number;
    status: FristStatus;
    erInnlevert: boolean;
}

export interface OppgaveElement {
  type: "oppgave";
  id: string;
  assignmentId: number | null;
  tittel: string;
  emne: string;
  dato: Date;
  timerIgjen: number;
  status: FristStatus;
  erInnlevert: boolean;
  url: string | null;
}

export interface KunngjoringElement {
  type: "kunngjoring";
  id: string;
  tittel: string;
  emne: string;
  dato: Date;
  melding: string;
}

export interface HendelseElement {
  type: "hendelse";
  id: string;
  tittel: string;
  dato: Date;
  sluttDato: Date | null;
  lokasjon: string | null;
  emne?: string;
  url?: string | null;
}

export type VarslingElement =
  | FristElement
  | OppgaveElement
  | KunngjoringElement
  | HendelseElement;

// —— Bygg varsler-lister (bruker erInnlevert fra canvasUtils) ——

export function buildFrister(oppgaver: AssignmentMedEmne[]): FristElement[] {
  const nå = Date.now();
  return oppgaver
    .filter((o) => {
      if (erInnlevert(o)) return false;
      return erInnenforFristVindu(o.due_at, nå);
    })
    .map((o) => {
      const timerIgjen =
        (new Date(o.due_at!).getTime() - nå) / (1000 * 60 * 60);
      return {
        type: "frist" as const,
        id: `oppgave-${o.id}`,
        tittel: o.name,
        emne: o.course_name,
        dato: new Date(o.due_at!),
        timerIgjen,
        status: klassifiserFrist(timerIgjen),
        erInnlevert: false, // Alltid false — innleverte oppgaver er allerede filtrert bort over
      };
    })
    .sort((a, b) => a.timerIgjen - b.timerIgjen);
}

export function buildOppgaver(oppgaver: Assignment[]): OppgaveElement[] {
  const nå = Date.now();
  return oppgaver
    .filter((oppgave) => oppgave.dueDate.getTime() > nå)
    .map((oppgave) => {
      const timerIgjen = (oppgave.dueDate.getTime() - nå) / (1000 * 60 * 60);
      const assignmentId =
        oppgave.source === "assignment"
          ? (() => {
              const match = oppgave.id.match(/assignment-(\d+)$/);
              return match ? Number(match[1]) : null;
            })()
          : null;

      return {
        type: "oppgave" as const,
        id: `oppgave-${oppgave.id}`,
        assignmentId,
        tittel: oppgave.title,
        emne: oppgave.courseName ?? oppgave.courseCode,
        dato: oppgave.dueDate,
        timerIgjen,
        status: klassifiserFrist(timerIgjen),
        erInnlevert: oppgave.completed,
        url: oppgave.url ?? null,
      };
    })
    .sort((a, b) => a.dato.getTime() - b.dato.getTime());
}
// Kunngjøringer og hendelser bygges direkte fra API-data, med enkel datoformatering.
export function buildKunngjøringer(
    announcements: { id: number; title: string; message?: string | null; context_code?: string; posted_at?: string | null }[],
    emneNavnMap: Map<string, string>,
): KunngjoringElement[] {
    return announcements
        .map((a) => ({
            type: "kunngjoring" as const,
            id: `kunngjoring-${a.id}`,
            tittel: a.title,
            emne: (a.context_code && emneNavnMap.get(a.context_code)) ?? a.context_code?.replace("course_", "Emne ") ?? "",
            dato: a.posted_at ? new Date(a.posted_at) : new Date(),
            melding: a.message ?? "",
        }))
        .sort((a, b) => b.dato.getTime() - a.dato.getTime());
}
// Hendelser bygges fra kalenderdata, med ekstra håndtering
export function buildHendelser(
    events: { id: number; title: string; start_at?: string | null; end_at?: string | null; location_name?: string | null }[],
): HendelseElement[] {
    return events
        .filter((e) => e.start_at)
        .map((e) => ({
            type: "hendelse" as const,
            id: `hendelse-${e.id}`,
            tittel: e.title,
            dato: new Date(e.start_at!),
            sluttDato: e.end_at ? new Date(e.end_at) : null,
            lokasjon: e.location_name ?? null,
        }))
        .sort((a, b) => b.dato.getTime() - a.dato.getTime());
}

export function buildKalenderHendelser(hendelser: Assignment[]): HendelseElement[] {
    const nå = Date.now();
    return hendelser
        .filter((hendelse) => hendelse.dueDate.getTime() > nå)
        .map((hendelse) => ({
            type: "hendelse" as const,
            id: `hendelse-${hendelse.id}`,
            tittel: hendelse.title,
            dato: hendelse.dueDate,
            sluttDato: hendelse.endDate ?? null,
            lokasjon: hendelse.location ?? null,
            emne: hendelse.courseName ?? hendelse.courseCode,
            url: hendelse.url ?? null,
        }))
        .sort((a, b) => a.dato.getTime() - b.dato.getTime());
}

export function buildAlleAktiviteter(
    oppgaver: OppgaveElement[],
    kunngjøringer: KunngjoringElement[],
    hendelser: HendelseElement[],
): VarslingElement[] {
    const nå = Date.now();
    const relevans = (element: VarslingElement) => {
        const tidspunkt = element.dato.getTime();
        if (element.type === "kunngjoring") {
            return Math.abs(nå - tidspunkt);
        }
        return Math.max(0, tidspunkt - nå);
    };

    return [...oppgaver, ...kunngjøringer, ...hendelser].sort((a, b) => {
        const forskjell = relevans(a) - relevans(b);
        if (forskjell !== 0) return forskjell;
        return b.dato.getTime() - a.dato.getTime();
    });
}

export function lagVarslingForhandsvisning(
    innhold: string | null | undefined,
    maxLengde = 220,
): string {
    if (!innhold) return "";

    // Fjern style/script-blokker, deretter alle HTML-tagger, og dekod entiteter
    const renset = innhold
        .replace(/<style[^>]*>[^]*?<\/style\s*>/gi, " ")
        .replace(/<script[^>]*>[^]*?<\/script\s*>/gi, " ")
        .replace(/<br\s*\/?>/gi, " ")
        .replace(/<\/p\s*>/gi, " ")
        .replace(/<\/div\s*>/gi, " ")
        .replace(/<[^>]{0,500}>/g, " ")
        .replace(/&nbsp;/gi, " ")
        .replace(/&lt;/gi, "<")
        .replace(/&gt;/gi, ">")
        .replace(/&quot;/gi, "\"")
        .replace(/&#39;/gi, "'")
        .replace(/&amp;/gi, "&")
        .replace(/\s+/g, " ")
        .trim();

    if (renset.length <= maxLengde) {
        return renset;
    }

    return `${renset.slice(0, Math.max(0, maxLengde - 1)).trimEnd()}…`;
}
// Bygg en samlet liste av alle varslingselementer, sortert på dato (nyeste først)
export function buildAlleElementer(
    frister: FristElement[],
    kunngjøringer: KunngjoringElement[],
    hendelser: HendelseElement[],
): VarslingElement[] {
    return [...frister, ...kunngjøringer, ...hendelser].sort(
        (a, b) => b.dato.getTime() - a.dato.getTime(),
    );
}
