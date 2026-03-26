/*
 * useVarsler – data, lest/ulest og popup-toast for varsler.
 * Brukes av DashboardView (popup) og VarslingerSection (siden).
 */

import { useEffect, useMemo, useRef } from "react";
import { type VarslerState, normalizeVarslerState } from "common/auth";
import { showToast } from "@/app/components/ui/Toaster";
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
import { useManuellInnlevering } from "./useManuellInnlevering";
import { useOppdaterVarslerState } from "../auth/auth-api";
import { useLanguage } from "../i18n";

function createVarslerStateSignature(state: VarslerState): string {
    const lestSignature = [...state.lestIds].sort().join("|");
    const toastSignature = [...state.toastVistIds].sort().join("|");
    return `${lestSignature}::${toastSignature}`;
}

export type VarslingTab = "alle" | "frister" | "kunngjøringer" | "hendelser";
// Hoved-hook for å hente og organisere varsler-data, samt håndtere lest/ulest-status.
export interface UseVarslerResult {
    frister: FristElement[];
    kunngjøringer: KunngjoringElement[];
    hendelser: HendelseElement[];
    alleElementer: VarslingElement[];
    ulesteCount: number;
    lestIds: Set<string>;
    markAllAsLest: () => void;
    isLoading: boolean;
    isError: boolean;
    hasPartialError: boolean;
    error: unknown;
    isHydrated: boolean;
}

export function useVarslerStateSync(authReady: boolean, serverState?: VarslerState) {
    const setVarslerState = useUIStore((s) => s.setVarslerState);
    const varslerLestIds = useUIStore((s) => s.varslerLestIds);
    const varslerToastVistIds = useUIStore((s) => s.varslerToastVistIds);
    const varslerStateHydrated = useUIStore((s) => s.varslerStateHydrated);
    const {
        mutate: persistVarslerState,
        isPending: persistererVarslerState,
        failureCount: varslerPersistFailureCount,
    } = useOppdaterVarslerState();

    const normalizedServerState = useMemo(
        () => normalizeVarslerState(serverState),
        [serverState],
    );
    const serverSignature = useMemo(
        () => createVarslerStateSignature(normalizedServerState),
        [normalizedServerState],
    );
    const normalizedLocalState = useMemo(
        () =>
            normalizeVarslerState({
                lestIds: Array.from(varslerLestIds),
                toastVistIds: Array.from(varslerToastVistIds),
            }),
        [varslerLestIds, varslerToastVistIds],
    );
    const localSignature = useMemo(
        () => createVarslerStateSignature(normalizedLocalState),
        [normalizedLocalState],
    );
    const lastSyncedSignatureRef = useRef<string | null>(null);

    // Hydrer fra server, men overskriv ikke lokale endringer som ennå ikke er synket
    useEffect(() => {
        if (!authReady) return;
        const hasUnsyncedLocalChanges =
            varslerStateHydrated && localSignature !== lastSyncedSignatureRef.current;
        if (hasUnsyncedLocalChanges) return;
        lastSyncedSignatureRef.current = serverSignature;
        setVarslerState(normalizedServerState);
    }, [authReady, normalizedServerState, serverSignature, setVarslerState, varslerStateHydrated, localSignature]);

    useEffect(() => {
        if (!authReady || !varslerStateHydrated) return;
        if (localSignature === lastSyncedSignatureRef.current) return;
        if (persistererVarslerState) return;

        // Debounce første persist (500 ms) for å unngå mange PUT ved rask bruk; retry bruker backoff
        const retryDelayMs =
            varslerPersistFailureCount > 0
                ? Math.min(5000, 1000 * 2 ** (varslerPersistFailureCount - 1))
                : 500;

        const timeoutId = window.setTimeout(() => {
            persistVarslerState(normalizedLocalState, {
                onSuccess: (data) => {
                    const persistedState = normalizeVarslerState(
                        data.varslerState ?? normalizedLocalState,
                    );
                    lastSyncedSignatureRef.current =
                        createVarslerStateSignature(persistedState);
                },
            });
        }, retryDelayMs);

        return () => window.clearTimeout(timeoutId);
    }, [
        authReady,
        localSignature,
        normalizedLocalState,
        persistVarslerState,
        persistererVarslerState,
        varslerPersistFailureCount,
        varslerStateHydrated,
    ]);
}

// Hoved-hook for å hente og organisere varsler-data, samt håndtere lest/ulest-status.
export function useVarsler(harCanvasToken: boolean): UseVarslerResult {
    const announcementsQuery = useCanvasAnnouncements(harCanvasToken);
    const eventsQuery = useCanvasUpcomingEvents(harCanvasToken);
    const coursesQuery = useCanvasCourses(harCanvasToken);
    const assignmentsQuery = useCanvasAllAssignments({
        enabled: harCanvasToken,
        courses: coursesQuery.data?.courses,
    });

    const lestIds = useUIStore((s) => s.varslerLestIds);
    const markAllAsLestStore = useUIStore((s) => s.markAllVarslerAsLest);
    const isHydrated = useUIStore((s) => s.varslerStateHydrated);

    const { ferdigeIdSet } = useManuellInnlevering();

    const emneNavnMap = useMemo(() => {
        const courses = coursesQuery.data?.courses ?? [];
        const map = new Map<string, string>();
        for (const c of courses) map.set(`course_${c.id}`, c.name);
        return map;
    }, [coursesQuery.data]);

    const ikkeManuelleOppgaver = useMemo(
        () => (assignmentsQuery.data ?? []).filter((o) => !ferdigeIdSet.has(o.id)),
        [assignmentsQuery.data, ferdigeIdSet],
    );
    const frister = useMemo(() => buildFrister(ikkeManuelleOppgaver), [ikkeManuelleOppgaver]);
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
        markAllAsLest,
        isLoading,
        isError,
        hasPartialError,
        error,
        isHydrated,
    };
}

// —— Popup-toast (samme fil, deler useVarsler) ——
const TOAST_DELAY_MS = 2500;

export interface UseVarslerPopupsOptions {
    onGåTilVarslinger?: () => void;
}
// Viser en toast hvis det finnes uleste varsler (som ikke er markert lest i UI-storen).
export function useVarslerPopups(harCanvasToken: boolean, options: UseVarslerPopupsOptions = {}) {
    const { t } = useLanguage();
    const { onGåTilVarslinger } = options;
    const planlagtSignaturRef = useRef<string | null>(null);
    const onGåRef = useRef(onGåTilVarslinger);
    onGåRef.current = onGåTilVarslinger;
    const ulesteCountRef = useRef(0);
    const visteIds = useUIStore((s) => s.varslerToastVistIds);
    const addToastVist = useUIStore((s) => s.addVarslerToastVist);

    const {
        ulesteCount,
        alleElementer,
        lestIds,
        markAllAsLest,
        isLoading,
        isError,
        isHydrated,
    } = useVarsler(harCanvasToken);
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
            return;
        }

        if (!isHydrated) return;

        if (isLoading || isError || ulesteCount <= 0 || ulesteIds.length === 0) {
            if (ulesteCount <= 0) {
                planlagtSignaturRef.current = null;
            }
            return;
        }

        const harNyeUleste = ulesteIds.some((id) => !visteIds.has(id));
        if (!harNyeUleste || planlagtSignaturRef.current === ulesteSignatur) return;

        planlagtSignaturRef.current = ulesteSignatur;
        try {
            const timeoutId = setTimeout(() => {
                if (ulesteCountRef.current <= 0) return;
                const nyeToastIds = ulesteIds.filter((id) => !visteIds.has(id));
                addToastVist(nyeToastIds);

                const melding =
                    ulesteCountRef.current === 1
                        ? t("notifications.toast.oneUnread")
                        : t("notifications.toast.manyUnread", {
                              count: ulesteCountRef.current,
                          });

                showToast.info(
                    melding,
                    t("notifications.toast.description"),
                    {
                        duration: 6000,
                        action: onGåRef.current
                            ? {
                                  label: t("notifications.toast.action"),
                                  onClick: () => {
                                      markAllRef.current();
                                      onGåRef.current?.();
                                  },
                              }
                            : undefined,
                    },
                );
            }, TOAST_DELAY_MS);

            return () => {
                clearTimeout(timeoutId);
                if (planlagtSignaturRef.current === ulesteSignatur) {
                    planlagtSignaturRef.current = null;
                }
            };
        } catch {
            planlagtSignaturRef.current = null;
        }
    }, [
        addToastVist,
        harCanvasToken,
        isHydrated,
        isLoading,
        isError,
        ulesteCount,
        ulesteIds,
        ulesteSignatur,
        visteIds,
        t,
    ]);
}
