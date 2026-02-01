import { create } from 'zustand';

/**
 * UI Store - Global tilstand for brukergrensesnitt
 * Bruker Zustand for enkel state management på tvers av komponenter.
 * Dette erstatter behovet for "prop drilling" av sidebar-status.
 */
interface UIState {
    // Holder styr på om sidebaren er åpen (true) eller lukket (false) på mobil
    isVenstreMenyOpen: boolean;
    toggleVenstreMeny: () => void;
    lukkVenstreMeny: () => void;
    settVenstreMenyOpen: (isOpen: boolean) => void;
    // Håndter valgt chat-id for å laste fra sidebar
    selectedChatId: string | null;
    setSelectedChatId: (id: string | null) => void;
    // Nullstiller all UI-tilstand (brukes ved utlogging)
    reset: () => void;
}
// Oppretter storen som en hook (useUIStore) som kan brukes i alle komponenter
export const useUIStore = create<UIState>((set) => ({
    isVenstreMenyOpen: false,
    toggleVenstreMeny: () => set((state) => ({ isVenstreMenyOpen: !state.isVenstreMenyOpen })),
    lukkVenstreMeny: () => set({ isVenstreMenyOpen: false }),
    settVenstreMenyOpen: (isOpen) => set({ isVenstreMenyOpen: isOpen }),
    selectedChatId: null,
    setSelectedChatId: (id) => set({ selectedChatId: id }),
    reset: () => set({ isVenstreMenyOpen: false, selectedChatId: null }),
}));
