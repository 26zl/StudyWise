import { create } from 'zustand';

/**
 * UI Store - Global tilstand for brukergrensesnitt
 * Bruker Zustand for enkel state management på tvers av komponenter.
 * Dette erstatter behovet for "prop drilling" av sidebar-status.
 * Canvas-kontekst preferanser synkroniseres med backend via /api/user/me
 * og /api/user/preferences. Varsler lest/ulest persisteres i localStorage.
 */

const VARSLER_LEST_KEY = "studywise:varsler-lest";
const MAX_VARSLER_LEST = 500;
// Hjelpefunksjon for å laste en Set av lest varsler fra localStorage
function loadVarslerLestIds(): Set<string> {
    if (typeof window === "undefined") return new Set();
    try {
        const raw = localStorage.getItem(VARSLER_LEST_KEY);
        if (!raw) return new Set();
        const arr = JSON.parse(raw) as unknown;
        if (!Array.isArray(arr)) return new Set();
        return new Set(arr.filter((x): x is string => typeof x === "string"));
    } catch {
        return new Set();
    }
}
// Lagrer en Set av lest varsler i localStorage (kun de siste 500 for å begrense størrelse)
function saveVarslerLestIds(ids: Set<string>) {
    if (typeof window === "undefined") return;
    try {
        localStorage.setItem(VARSLER_LEST_KEY, JSON.stringify([...ids].slice(-MAX_VARSLER_LEST)));
    } catch {
        // ignore
    }
}

// Type for Canvas-kontekst valg (må matche backend/common)
export interface CanvasContextSelection {
    announcements: boolean;
    courses: boolean;
    assignments: boolean;
    events: boolean;
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
    // Signal for å starte ny chat
    newChatToken: number;
    requestNewChat: () => void;
    // Canvas-kontekst for KI-chat (settes fra SettingsSection)
    canvasContext: string;
    hasCanvasContext: boolean;
    setCanvasContext: (context: string, hasContext: boolean) => void;
    // Canvas-kontekst valg (hvilke datatyper som er valgt)
    canvasContextSelection: CanvasContextSelection;
    setCanvasContextSelection: (selection: CanvasContextSelection) => void;
    // Canvas token status - stopper fetching ved ugyldig/slettet token
    canvasTokenInvalid: boolean;
    setCanvasTokenInvalid: (invalid: boolean) => void;
    // Varsler lest/ulest (delt mellom popup og varslinger-siden)
    varslerLestIds: Set<string>;
    addVarslerLest: (ids: string[]) => void;
    markAllVarslerAsLest: (ids: string[]) => void;
    // Nullstiller all UI-tilstand (brukes ved utlogging)
    reset: () => void;
}

// Default preferanser
const defaultSelection: CanvasContextSelection = {
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
    varslerLestIds: loadVarslerLestIds(),
    addVarslerLest: (ids) => {
        if (ids.length === 0) return;
        set((s) => {
            const next = new Set(s.varslerLestIds);
            ids.forEach((id) => next.add(id));
            saveVarslerLestIds(next);
            return { varslerLestIds: next };
        });
    },
    markAllVarslerAsLest: (ids) => {
        if (ids.length === 0) return;
        set((s) => {
            const next = new Set(s.varslerLestIds);
            ids.forEach((id) => next.add(id));
            saveVarslerLestIds(next);
            return { varslerLestIds: next };
        });
    },
    reset: () => {
        saveVarslerLestIds(new Set());
        set({
            isVenstreMenyOpen: false,
            selectedChatId: null,
            newChatToken: 0,
            canvasContext: "",
            hasCanvasContext: false,
            canvasContextSelection: defaultSelection,
            canvasTokenInvalid: false,
            varslerLestIds: new Set(),
        });
    },
}));
