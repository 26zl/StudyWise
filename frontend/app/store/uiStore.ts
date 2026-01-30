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
    // Nullstiller all UI-tilstand (brukes ved utlogging)
    reset: () => void;
}
// Oppretter storen som en hook (useUIStore) som kan brukes i alle komponenter
export const useUIStore = create<UIState>((set) => ({
    isVenstreMenyOpen: false,
    toggleVenstreMeny: () => set((state) => ({ isVenstreMenyOpen: !state.isVenstreMenyOpen })),
    lukkVenstreMeny: () => set({ isVenstreMenyOpen: false }),
    settVenstreMenyOpen: (isOpen) => set({ isVenstreMenyOpen: isOpen }),
    reset: () => set({ isVenstreMenyOpen: false }),
}));
