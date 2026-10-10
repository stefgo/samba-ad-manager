import { create } from "zustand";
import { persist } from "zustand/middleware";
import { STORAGE_KEYS } from "../lib/storageKeys";

interface UIState {
    isSidebarCollapsed: boolean;
    toggleSidebarCollapsed: () => void;
    setSidebarCollapsed: (collapsed: boolean) => void;
}

export const useUIStore = create<UIState>()(
    persist(
        (set) => ({
            isSidebarCollapsed: false,
            toggleSidebarCollapsed: () =>
                set((state) => ({
                    isSidebarCollapsed: !state.isSidebarCollapsed,
                })),
            setSidebarCollapsed: (collapsed) =>
                set({ isSidebarCollapsed: collapsed }),
        }),
        {
            name: STORAGE_KEYS.ui,
        },
    ),
);
