import { create } from 'zustand';

/**
 * UI Store - Global tilstand for brukergrensesnitt
 * Bruker Zustand for enkel state management på tvers av komponenter.
 * Dette erstatter behovet for "prop drilling" av sidebar-status.
 * 
 * Canvas-kontekst preferanser synkroniseres med backend via /api/user/me
 * og /api/user/preferences endepunktene.
 */

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
    reset: () => set({
        isVenstreMenyOpen: false,
        selectedChatId: null,
        newChatToken: 0,
        canvasContext: "",
        hasCanvasContext: false,
        canvasContextSelection: defaultSelection,
        canvasTokenInvalid: false,
    }),
}));
