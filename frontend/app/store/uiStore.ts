import { create } from "zustand";
import {
    type CanvasContextPreferences,
    type VarslerState,
    createDefaultCanvasContextPreferences,
    normalizeVarslerState,
} from "common/auth";
import type { ExplanationLevel } from "common/ki";

/**
 * UI Store - Global tilstand for brukergrensesnitt
 * Bruker Zustand for enkel state management på tvers av komponenter.
 * Dette erstatter behovet for "prop drilling" av sidebar-status.
 * Canvas-kontekst og varslerstatus synkroniseres med backend via /api/user/me
 * og /api/user/preferences.
 */

function toVarslerIdSet(ids: readonly string[]): Set<string> {
    return new Set(ids);
}

/** Alias for common/auth – brukes i UI-store og komponenter. */
export type CanvasContextSelection = CanvasContextPreferences;

interface PendingKIMelding {
    melding: string;
    skipCanvasValidation?: boolean;
}

interface UIState {
    // Holder styr på om sidebaren er åpen (true) eller lukket (false) på mobil
    isVenstreMenyOpen: boolean;
    toggleVenstreMeny: () => void;
    lukkVenstreMeny: () => void;
    settVenstreMenyOpen: (isOpen: boolean) => void;
    // Håndter valgt chat-id for å laste fra sidebar
    selectedChatId: string | null;
    setSelectedChatId: (id: string | null) => void;
    currentChatId: string | null;
    setCurrentChatId: (id: string | null) => void;
    // Signal for å starte ny chat
    newChatToken: number;
    requestNewChat: () => void;
    // Midlertidig KI-handoff mellom visninger (f.eks. Canvas -> chat)
    pendingKIMelding: PendingKIMelding | null;
    setPendingKIMelding: (melding: PendingKIMelding | null) => void;
    clearPendingKIMelding: () => void;
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
    // Forklaringsnivå for KI-svar
    explanationLevel: ExplanationLevel;
    setExplanationLevel: (level: ExplanationLevel) => void;
    // Modellvalg i chat: "auto" = dynamisk miks (Haiku/Sonnet), ellers fast modell
    selectedChatModel: string;
    setSelectedChatModel: (model: string) => void;
    // Flagg for pågående utlogging — komponenter viser lastespinner i stedet for feilmeldinger
    isLoggingOut: boolean;
    setIsLoggingOut: (value: boolean) => void;
    // Nullstiller all UI-tilstand (brukes ved utlogging)
    reset: () => void;
}

// Default preferanser (samme form som common/auth CanvasContextPreferences)
const defaultSelection: CanvasContextPreferences = {
    ...createDefaultCanvasContextPreferences(),
};

// Oppretter storen som en hook (useUIStore) som kan brukes i alle komponenter
export const useUIStore = create<UIState>()((set) => ({
    // Default LUKKET — må være konstant for å matche SSR (window finnes ikke på server).
    // Sidebar.tsx åpner den på desktop ved mount via et media-query-effect.
    isVenstreMenyOpen: false,
    toggleVenstreMeny: () => set((state) => ({ isVenstreMenyOpen: !state.isVenstreMenyOpen })),
    lukkVenstreMeny: () => set({ isVenstreMenyOpen: false }),
    settVenstreMenyOpen: (isOpen) => set({ isVenstreMenyOpen: isOpen }),
    selectedChatId: null,
    setSelectedChatId: (id) => set({ selectedChatId: id }),
    currentChatId: null,
    setCurrentChatId: (id) => set({ currentChatId: id }),
    newChatToken: 0,
    requestNewChat: () => set((state) => ({
        newChatToken: state.newChatToken + 1,
        selectedChatId: null,
        currentChatId: null,
    })),
    pendingKIMelding: null,
    setPendingKIMelding: (melding) => set({ pendingKIMelding: melding }),
    clearPendingKIMelding: () => set({ pendingKIMelding: null }),
    canvasContextSelection: defaultSelection,
    setCanvasContextSelection: (selection) => set({ canvasContextSelection: selection }),
    canvasTokenInvalid: false,
    setCanvasTokenInvalid: (invalid) => set({ canvasTokenInvalid: invalid }),
    explanationLevel: "standard" as ExplanationLevel,
    setExplanationLevel: (level) => set({ explanationLevel: level }),
    selectedChatModel: "auto",
    setSelectedChatModel: (model) => set({ selectedChatModel: model }),
    isLoggingOut: false,
    setIsLoggingOut: (value) => set({ isLoggingOut: value }),
    varslerLestIds: new Set(),
    varslerToastVistIds: new Set(),
    varslerStateHydrated: false,
    setVarslerState: (state) => {
        const normalized = normalizeVarslerState(state);
        set({
            varslerLestIds: toVarslerIdSet(normalized.lestIds),
            varslerToastVistIds: toVarslerIdSet(normalized.toastVistIds),
            varslerStateHydrated: true,
        });
    },
    markAllVarslerAsLest: (ids) => {
        if (ids.length === 0) return;
        set((s) => {
            const normalized = normalizeVarslerState({
                lestIds: [...s.varslerLestIds, ...ids],
                toastVistIds: [...s.varslerToastVistIds],
            });
            return { varslerLestIds: toVarslerIdSet(normalized.lestIds) };
        });
    },
    addVarslerToastVist: (ids) => {
        if (ids.length === 0) return;
        set((s) => {
            const normalized = normalizeVarslerState({
                lestIds: [...s.varslerLestIds],
                toastVistIds: [...s.varslerToastVistIds, ...ids],
            });
            return { varslerToastVistIds: toVarslerIdSet(normalized.toastVistIds) };
        });
    },
    reset: () => {
        set({
            isVenstreMenyOpen: true,
            selectedChatId: null,
            currentChatId: null,
            newChatToken: 0,
            pendingKIMelding: null,
            canvasContextSelection: createDefaultCanvasContextPreferences(),
            canvasTokenInvalid: false,
            explanationLevel: "standard" as ExplanationLevel,
            selectedChatModel: "auto",
            varslerLestIds: new Set(),
            varslerToastVistIds: new Set(),
            varslerStateHydrated: false,
            isLoggingOut: false,
        });
    },
}));
