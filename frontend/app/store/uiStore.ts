import { create } from "zustand";
import { type CanvasContextPreferences, type VarslerState, VARSLER_MAX_IDS } from "common/auth";

/**
 * UI Store - Global tilstand for brukergrensesnitt
 * Bruker Zustand for enkel state management på tvers av komponenter.
 * Dette erstatter behovet for "prop drilling" av sidebar-status.
 * Canvas-kontekst og varslerstatus synkroniseres med backend via /api/user/me
 * og /api/user/preferences.
 */

function trimVarslerIds(ids: Iterable<string>): Set<string> {
    return new Set(Array.from(new Set(ids)).slice(-VARSLER_MAX_IDS));
}

/** Alias for common/auth – brukes i UI-store og komponenter. */
export type CanvasContextSelection = CanvasContextPreferences;

interface UIState {
    // Holder styr på om sidebaren er åpen (true) eller lukket (false) på mobil
    isVenstreMenyOpen: boolean;
    toggleVenstreMeny: () => void;
    lukkVenstreMeny: () => void;
    settVenstreMenyOpen: (isOpen: boolean) => void;
    // Håndter valgt chat-id for å laste fra sidebar
    selectedChatId: string | null;
    setSelectedChatId: (id: string | null) => void;
    // Signal for å starte ny chat
    newChatToken: number;
    requestNewChat: () => void;
    // Canvas-kontekst for KI-chat (settes fra SettingsSection)
    canvasContext: string;
    hasCanvasContext: boolean;
    setCanvasContext: (context: string, hasContext: boolean) => void;
    // Canvas-kontekst valg (hvilke datatyper som er valgt)
    canvasContextSelection: CanvasContextPreferences;
    setCanvasContextSelection: (selection: CanvasContextPreferences) => void;
    // Canvas token status - stopper fetching ved ugyldig/slettet token
    canvasTokenInvalid: boolean;
    setCanvasTokenInvalid: (invalid: boolean) => void;
    // Varsler lest/ulest (delt mellom popup og varslinger-siden)
    varslerLestIds: Set<string>;
    varslerToastVistIds: Set<string>;
    varslerStateHydrated: boolean;
    setVarslerState: (state?: VarslerState | null) => void;
    markAllVarslerAsLest: (ids: string[]) => void;
    addVarslerToastVist: (ids: string[]) => void;
    // Nullstiller all UI-tilstand (brukes ved utlogging)
    reset: () => void;
}

// Default preferanser (samme form som common/auth CanvasContextPreferences)
const defaultSelection: CanvasContextPreferences = {
    announcements: true,
    courses: true,
    assignments: true,
    events: true,
};

// Oppretter storen som en hook (useUIStore) som kan brukes i alle komponenter
export const useUIStore = create<UIState>()((set) => ({
    isVenstreMenyOpen: false,
    toggleVenstreMeny: () => set((state) => ({ isVenstreMenyOpen: !state.isVenstreMenyOpen })),
    lukkVenstreMeny: () => set({ isVenstreMenyOpen: false }),
    settVenstreMenyOpen: (isOpen) => set({ isVenstreMenyOpen: isOpen }),
    selectedChatId: null,
    setSelectedChatId: (id) => set({ selectedChatId: id }),
    newChatToken: 0,
    requestNewChat: () => set((state) => ({ newChatToken: state.newChatToken + 1 })),
    canvasContext: "",
    hasCanvasContext: false,
    setCanvasContext: (context, hasContext) => set({ canvasContext: context, hasCanvasContext: hasContext }),
    canvasContextSelection: defaultSelection,
    setCanvasContextSelection: (selection) => set({ canvasContextSelection: selection }),
    canvasTokenInvalid: false,
    setCanvasTokenInvalid: (invalid) => set({ canvasTokenInvalid: invalid }),
    varslerLestIds: new Set(),
    varslerToastVistIds: new Set(),
    varslerStateHydrated: false,
    setVarslerState: (state) => set({
        varslerLestIds: trimVarslerIds(state?.lestIds ?? []),
        varslerToastVistIds: trimVarslerIds(state?.toastVistIds ?? []),
        varslerStateHydrated: true,
    }),
    markAllVarslerAsLest: (ids) => {
        if (ids.length === 0) return;
        set((s) => {
            const next = trimVarslerIds([...s.varslerLestIds, ...ids]);
            return { varslerLestIds: next };
        });
    },
    addVarslerToastVist: (ids) => {
        if (ids.length === 0) return;
        set((s) => {
            const next = trimVarslerIds([...s.varslerToastVistIds, ...ids]);
            return { varslerToastVistIds: next };
        });
    },
    reset: () => {
        set({
            isVenstreMenyOpen: false,
            selectedChatId: null,
            newChatToken: 0,
            canvasContext: "",
            hasCanvasContext: false,
            canvasContextSelection: defaultSelection,
            canvasTokenInvalid: false,
            varslerLestIds: new Set(),
            varslerToastVistIds: new Set(),
            varslerStateHydrated: false,
        });
    },
}));
