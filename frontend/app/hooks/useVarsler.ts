/*
 * useVarsler – data, lest/ulest og popup-toast for varsler.
 * Brukes av DashboardView (popup) og VarslingerSection (siden).
 */

import { useEffect, useMemo, useRef } from "react";
import { toast } from "../components/Toaster";
import {
    useCanvasAllAssignments,
    useCanvasAnnouncements,
    useCanvasUpcomingEvents,
    useCanvasCourses,
} from "../canvas/canvas-api";
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
