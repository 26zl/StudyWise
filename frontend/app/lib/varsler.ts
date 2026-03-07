/*
 * Varsler – felles logikk for popup-toast og varslinger-siden.
 * Inkluderer frist-klassifisering, tidsformatering, typer og bygging av lister.
 * Lest/ulest håndteres i uiStore. Canvas-oppgave-utils (f.eks. erInnlevert) importeres fra canvasUtils.
 */

import type { AssignmentMedEmne } from "../canvas/canvas-api";
import { erInnlevert } from "../canvas/canvasUtils";

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

/** Formater timer igjen til lesbar norsk tekst */
export function formaterTid(timer: number): string {
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
}

export type VarslingElement = FristElement | KunngjoringElement | HendelseElement;

// —— Bygg varsler-lister (bruker erInnlevert fra canvasUtils) ——

export function buildFrister(oppgaver: AssignmentMedEmne[]): FristElement[] {
    const nå = Date.now();
    return oppgaver
        .filter((o) => {
            if (!o.due_at) return false;
            const timer = (new Date(o.due_at).getTime() - nå) / (1000 * 60 * 60);
            return timer > 0 && timer <= FRIST_VINDU_TIMER;
        })
        .map((o) => {
            const timerIgjen = (new Date(o.due_at!).getTime() - nå) / (1000 * 60 * 60);
            return {
                type: "frist" as const,
                id: `frist-${o.id}`,
                tittel: o.name,
                emne: o.course_name,
                dato: new Date(o.due_at!),
                timerIgjen,
                status: klassifiserFrist(timerIgjen),
                erInnlevert: erInnlevert(o),
            };
        })
        .sort((a, b) => a.timerIgjen - b.timerIgjen);
}
// Kunngjøringer og hendelser bygges direkte fra API-data, med enkel datoformatering.
export function buildKunngjøringer(
    announcements: { id: number; title: string; message?: string | null; context_code?: string; posted_at?: string | null }[],
    emneNavnMap: Map<string, string>,
): KunngjoringElement[] {
    return announcements.map((a) => ({
        type: "kunngjoring" as const,
        id: `kunngjoring-${a.id}`,
        tittel: a.title,
        emne: (a.context_code && emneNavnMap.get(a.context_code)) ?? a.context_code?.replace("course_", "Emne ") ?? "",
        dato: a.posted_at ? new Date(a.posted_at) : new Date(),
        melding: a.message ?? "",
    }));
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
        .sort((a, b) => a.dato.getTime() - b.dato.getTime());
}
// Bygg en samlet liste av alle varslingselementer, sortert på dato
export function buildAlleElementer(
    frister: FristElement[],
    kunngjøringer: KunngjoringElement[],
    hendelser: HendelseElement[],
): VarslingElement[] {
    return [...frister, ...kunngjøringer, ...hendelser].sort(
        (a, b) => a.dato.getTime() - b.dato.getTime(),
    );
}
