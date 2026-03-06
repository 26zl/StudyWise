/*
 * useVarsler – data, lest/ulest, popup-toast og frist-toasts for varsler.
 * Brukes av DashboardView (popup) og VarslingerSection (siden).
 */

import { useEffect, useMemo, useRef } from "react";
import { toast, showToast } from "../components/Toaster";
import type { AssignmentMedEmne } from "../canvas/canvas-api";
import {
    useCanvasAllAssignments,
    useCanvasAnnouncements,
    useCanvasUpcomingEvents,
    useCanvasCourses,
} from "../canvas/canvas-api";
import { erInnlevert } from "../canvas/canvasUtils";
import {
    buildFrister,
    buildKunngjøringer,
    buildHendelser,
    buildAlleElementer,
    type FristElement,
    type KunngjoringElement,
    type HendelseElement,
    type VarslingElement,
} from "../lib/varsler";
import { FRIST_VINDU_TIMER, klassifiserFrist, formaterTid, type FristStatus } from "../lib/varsler";
import { useUIStore } from "../store/uiStore";

export type VarslingTab = "alle" | "frister" | "kunngjøringer" | "hendelser";
// Hoved-hook for å hente og organisere varsler-data, samt håndtere lest/ulest-status.
export interface UseVarslerResult {
    frister: FristElement[];
    kunngjøringer: KunngjoringElement[];
    hendelser: HendelseElement[];
    alleElementer: VarslingElement[];
    ulesteCount: number;
    lestIds: Set<string>;
    markAsLest: (id: string) => void;
    markAllAsLest: () => void;
    isLoading: boolean;
}
// Hoved-hook for å hente og organisere varsler-data, samt håndtere lest/ulest-status.
export function useVarsler(harCanvasToken: boolean): UseVarslerResult {
    const assignmentsQuery = useCanvasAllAssignments({ enabled: harCanvasToken });
    const announcementsQuery = useCanvasAnnouncements(harCanvasToken);
    const eventsQuery = useCanvasUpcomingEvents(harCanvasToken);
    const coursesQuery = useCanvasCourses(harCanvasToken);

    const lestIds = useUIStore((s) => s.varslerLestIds);
    const markAllAsLestStore = useUIStore((s) => s.markAllVarslerAsLest);
    const addLest = useUIStore((s) => s.addVarslerLest);

    const emneNavnMap = useMemo(() => {
        const courses = coursesQuery.data?.courses ?? [];
        const map = new Map<string, string>();
        for (const c of courses) map.set(`course_${c.id}`, c.name);
        return map;
    }, [coursesQuery.data]);

    const frister = useMemo(() => buildFrister(assignmentsQuery.data ?? []), [assignmentsQuery.data]);
    const kunngjøringer = useMemo(
        () => buildKunngjøringer(announcementsQuery.data?.announcements ?? [], emneNavnMap),
        [announcementsQuery.data, emneNavnMap],
    );
    const hendelser = useMemo(() => buildHendelser(eventsQuery.data?.events ?? []), [eventsQuery.data]);
    const alleElementer = useMemo(
        () => buildAlleElementer(frister, kunngjøringer, hendelser),
        [frister, kunngjøringer, hendelser],
    );

    const ulesteCount = useMemo(
        () => alleElementer.filter((e) => !lestIds.has(e.id)).length,
        [alleElementer, lestIds],
    );

    const markAllAsLest = useMemo(
        () => () => markAllAsLestStore(alleElementer.map((e) => e.id)),
        [markAllAsLestStore, alleElementer],
    );
    const markAsLest = useMemo(() => (id: string) => addLest([id]), [addLest]);

    const isLoading =
        assignmentsQuery.isLoading || announcementsQuery.isLoading || eventsQuery.isLoading;

    return {
        frister,
        kunngjøringer,
        hendelser,
        alleElementer,
        ulesteCount,
        lestIds,
        markAsLest,
        markAllAsLest,
        isLoading,
    };
}

// —— Popup-toast (samme fil, deler useVarsler) ——

export const VARSLER_TOAST_VIST_KEY = "studywise:varsler-toast-vist";
const TOAST_DELAY_MS = 2500;

export interface UseVarslerPopupsOptions {
    onGåTilVarslinger?: () => void;
}
// Viser en toast hvis det finnes uleste varsler (som ikke er markert lest i UI-storen).
export function useVarslerPopups(harCanvasToken: boolean, options: UseVarslerPopupsOptions = {}) {
    const { onGåTilVarslinger } = options;
    const vistRef = useRef(false);
    const onGåRef = useRef(onGåTilVarslinger);
    onGåRef.current = onGåTilVarslinger;

    const { ulesteCount, markAllAsLest, isLoading } = useVarsler(harCanvasToken);
    const markAllRef = useRef(markAllAsLest);
    markAllRef.current = markAllAsLest;

    useEffect(() => {
        if (!harCanvasToken || isLoading || ulesteCount <= 0) return;
        try {
            if (sessionStorage.getItem(VARSLER_TOAST_VIST_KEY) === "1" || vistRef.current) return;
        } catch {
            return;
        }

        const t = setTimeout(() => {
            vistRef.current = true;
            try {
                sessionStorage.setItem(VARSLER_TOAST_VIST_KEY, "1");
            } catch {
                // ignore
            }
            const melding = ulesteCount === 1 ? "Du har 1 ulest melding" : `Du har ${ulesteCount} uleste meldinger`;
            toast.info(melding, {
                description: "Klikk for å åpne varslinger.",
                duration: 6000,
                action: onGåRef.current
                    ? {
                          label: "Se varsler",
                          onClick: () => {
                              markAllRef.current();
                              onGåRef.current?.();
                          },
                      }
                    : undefined,
            });
        }, TOAST_DELAY_MS);

        return () => clearTimeout(t);
    }, [harCanvasToken, isLoading, ulesteCount]);
}

// —— Frist-toasts (individuelle toasts per nærliggende frist, respekterer innleverte) ——

const FRIST_VARSLET_KEY = "studywise:frist-varsler";
const FRIST_SJEKK_INTERVAL_MS = 15 * 60 * 1000;
const FRIST_MAKS_TOASTS = 3;

function hentFristVarslet(): Set<number> {
    try {
        const raw = sessionStorage.getItem(FRIST_VARSLET_KEY);
        if (!raw) return new Set();
        const arr = JSON.parse(raw) as unknown;
        if (!Array.isArray(arr)) return new Set();
        return new Set(arr.filter((x): x is number => typeof x === "number" && !Number.isNaN(x)));
    } catch {
        return new Set();
    }
}
// Lagrer en Set av nærliggende frist-IDs som det allerede er vist toast for, i sessionStorage.
function lagreFristVarslet(ider: Set<number>) {
    try {
        sessionStorage.setItem(FRIST_VARSLET_KEY, JSON.stringify([...ider]));
    } catch {
        // ignore
    }
}
// Hjelpefunksjon for å finne oppgaver med nærliggende frister (innen 72t, ekskl. innleverte), og klassifisere dem.
function finnNærligendeFrister(oppgaver: AssignmentMedEmne[]): { id: number; navn: string; emne: string; timerIgjen: number; status: FristStatus }[] {
    const nå = Date.now();
    const resultater: { id: number; navn: string; emne: string; timerIgjen: number; status: FristStatus }[] = [];
    for (const o of oppgaver) {
        if (!o.due_at || erInnlevert(o)) continue;
        const timerIgjen = (new Date(o.due_at).getTime() - nå) / (1000 * 60 * 60);
        if (timerIgjen < 0 || timerIgjen > FRIST_VINDU_TIMER) continue;
        resultater.push({
            id: o.id,
            navn: o.name,
            emne: o.course_name,
            timerIgjen,
            status: klassifiserFrist(timerIgjen),
        });
    }
    resultater.sort((a, b) => a.timerIgjen - b.timerIgjen);
    return resultater;
}

/**
 * Viser toast per oppgave med nærliggende frist (innen 72t, ekskl. innleverte).
 * Sjekkes ved mount og hvert 15. min. Brukes ved behov ved siden av useVarslerPopups.
 */
export function useFristVarsler(oppgaver: AssignmentMedEmne[] | undefined) {
    const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

    useEffect(() => {
        if (!oppgaver?.length) return;

        const sjekk = () => {
            const nærliggende = finnNærligendeFrister(oppgaver);
            if (nærliggende.length === 0) return;
            const varslet = hentFristVarslet();
            const åVise = nærliggende.filter((o) => !varslet.has(o.id)).slice(0, FRIST_MAKS_TOASTS);
            if (åVise.length === 0) return;

            for (const o of åVise) {
                const tidTekst = formaterTid(o.timerIgjen);
                const beskrivelse = `${o.emne} - ${tidTekst} igjen`;
                if (o.status === "kritisk") showToast.error(`Frist snart: ${o.navn}`, beskrivelse);
                else if (o.status === "snart") showToast.warning(`Frist nærmer seg: ${o.navn}`, beskrivelse);
                else showToast.info(`Kommende frist: ${o.navn}`, beskrivelse);
                varslet.add(o.id);
            }
            lagreFristVarslet(varslet);
        };

        const t = setTimeout(sjekk, 2000);
        intervalRef.current = setInterval(sjekk, FRIST_SJEKK_INTERVAL_MS);
        return () => {
            clearTimeout(t);
            if (intervalRef.current) clearInterval(intervalRef.current);
        };
    }, [oppgaver]);
}
