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
    isError: boolean;
    hasPartialError: boolean;
    error: unknown;
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
    const errors = [
        assignmentsQuery.error,
        announcementsQuery.error,
        eventsQuery.error,
    ].filter(Boolean);
    const hasAnyData = alleElementer.length > 0;
    const error = errors[0] ?? null;
    const isError = errors.length > 0 && !hasAnyData;
    const hasPartialError = errors.length > 0 && hasAnyData;

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
        isError,
        hasPartialError,
        error,
    };
}

// —— Popup-toast (samme fil, deler useVarsler) ——

export const VARSLER_TOAST_VIST_KEY = "studywise:varsler-toast-vist";
const TOAST_DELAY_MS = 2500;
const MAX_VISTE_VARSLER = 500;

function loadVisteVarsler(): Set<string> {
    if (typeof window === "undefined") return new Set();
    try {
        const raw = sessionStorage.getItem(VARSLER_TOAST_VIST_KEY);
        if (!raw) return new Set();
        const parsed = JSON.parse(raw) as unknown;
        if (!Array.isArray(parsed)) return new Set();
        return new Set(parsed.filter((value): value is string => typeof value === "string"));
    } catch {
        return new Set();
    }
}

function saveVisteVarsler(ids: Set<string>) {
    if (typeof window === "undefined") return;
    try {
        sessionStorage.setItem(
            VARSLER_TOAST_VIST_KEY,
            JSON.stringify([...ids].slice(-MAX_VISTE_VARSLER)),
        );
    } catch {
        // ignore
    }
}

export interface UseVarslerPopupsOptions {
    onGåTilVarslinger?: () => void;
}
// Viser en toast hvis det finnes uleste varsler (som ikke er markert lest i UI-storen).
export function useVarslerPopups(harCanvasToken: boolean, options: UseVarslerPopupsOptions = {}) {
    const { onGåTilVarslinger } = options;
    const planlagtSignaturRef = useRef<string | null>(null);
    const onGåRef = useRef(onGåTilVarslinger);
    onGåRef.current = onGåTilVarslinger;
    const ulesteCountRef = useRef(0);

    const { ulesteCount, alleElementer, lestIds, markAllAsLest, isLoading, isError } = useVarsler(harCanvasToken);
    const markAllRef = useRef(markAllAsLest);
    markAllRef.current = markAllAsLest;
    const ulesteIds = useMemo(
        () =>
            alleElementer
                .filter((element) => !lestIds.has(element.id))
                .map((element) => element.id)
                .sort(),
        [alleElementer, lestIds],
    );
    const ulesteSignatur = useMemo(() => ulesteIds.join("|"), [ulesteIds]);

    useEffect(() => {
        ulesteCountRef.current = ulesteCount;

        if (!harCanvasToken) {
            planlagtSignaturRef.current = null;
            try {
                sessionStorage.removeItem(VARSLER_TOAST_VIST_KEY);
            } catch {
                // ignore
            }
            return;
        }

        if (isLoading || isError || ulesteCount <= 0 || ulesteIds.length === 0) {
            if (ulesteCount <= 0) {
                planlagtSignaturRef.current = null;
            }
            return;
        }

        const visteIds = loadVisteVarsler();
        const harNyeUleste = ulesteIds.some((id) => !visteIds.has(id));
        if (!harNyeUleste || planlagtSignaturRef.current === ulesteSignatur) return;

        planlagtSignaturRef.current = ulesteSignatur;
        try {
            const t = setTimeout(() => {
                if (ulesteCountRef.current <= 0) return;
                ulesteIds.forEach((id) => visteIds.add(id));
                saveVisteVarsler(visteIds);

                const melding =
                    ulesteCountRef.current === 1
                        ? "Du har 1 ulest varsel"
                        : `Du har ${ulesteCountRef.current} uleste varsler`;

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

            return () => {
                clearTimeout(t);
                if (planlagtSignaturRef.current === ulesteSignatur) {
                    planlagtSignaturRef.current = null;
                }
            };
        } catch {
            planlagtSignaturRef.current = null;
        }
    }, [harCanvasToken, isLoading, isError, ulesteCount, ulesteIds, ulesteSignatur]);
}
