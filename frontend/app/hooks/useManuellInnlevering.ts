/*
 * Manuell innlevering – zustand-store med localStorage-persistens.
 * Lar bruker merke oppgaver som «ferdig/innlevert» selv om Canvas ikke rapporterer det.
 * Brukes i varslinger, oversikt, oppgaveliste og KI-nedbrytning.
 */

import { useMemo } from "react";
import { create } from "zustand";
import { persist } from "zustand/middleware";

interface ManuellInnleveringState {
    /** Canvas assignment-IDer manuelt merket som ferdig. */
    ferdigeIds: number[];
    /** Legg til / fjern manuell ferdig-markering for en oppgave. */
    toggleFerdig: (assignmentId: number) => void;
    /** Nullstill alle manuelle markeringer (f.eks. ved utlogging). */
    reset: () => void;
}

export const useManuellInnleveringStore = create<ManuellInnleveringState>()(
    persist(
        (set) => ({
            ferdigeIds: [],
            toggleFerdig: (assignmentId) =>
                set((state) => {
                    const finnes = state.ferdigeIds.includes(assignmentId);
                    return {
                        ferdigeIds: finnes
                            ? state.ferdigeIds.filter((id) => id !== assignmentId)
                            : [...state.ferdigeIds, assignmentId],
                    };
                }),
            reset: () => set({ ferdigeIds: [] }),
        }),
        {
            name: "studywise-manuell-innlevering",
            partialize: (state) => ({ ferdigeIds: state.ferdigeIds }),
        },
    ),
);

/** Hook som returnerer et Set for rask oppslag + toggle-funksjon. */
export function useManuellInnlevering() {
    const ferdigeIds = useManuellInnleveringStore((s) => s.ferdigeIds);
    const toggleFerdig = useManuellInnleveringStore((s) => s.toggleFerdig);
    const ferdigeIdSet = useMemo(() => new Set(ferdigeIds), [ferdigeIds]);
    return { ferdigeIdSet, toggleFerdig };
}
