import { create } from 'zustand';

/**
 * UI Store - Global tilstand for brukergrensesnitt
 * Bruker Zustand for enkel state management på tvers av komponenter.
 * Dette erstatter behovet for "prop drilling" av sidebar-status.
 */
interface UIState {
    // Holder styr på om sidebaren er åpen (true) eller lukket (false) på mobil
    isSidebarOpen: boolean;
    toggleSidebar: () => void;
    closeSidebar: () => void;
    setSidebarOpen: (isOpen: boolean) => void;
}
// Oppretter storen som en hook (useUIStore) som kan brukes i alle komponenter
export const useUIStore = create<UIState>((set) => ({
    isSidebarOpen: false,
    toggleSidebar: () => set((state) => ({ isSidebarOpen: !state.isSidebarOpen })),
    closeSidebar: () => set({ isSidebarOpen: false }),
    setSidebarOpen: (isOpen) => set({ isSidebarOpen: isOpen }),
}));
