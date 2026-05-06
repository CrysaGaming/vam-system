/**
 * UI-store: app-wide ephemeral UI state (sidebar/drawer/menu visibility,
 * collapsed-state-maps, etc.) — Track 3 #11.2.3 v1.
 *
 * Was hier hingehört:
 * - Sidebar-collapsed pro section (PILOT / AIRLINE / ADMIN — siehe
 *   AppShell NavSection)
 * - Mobile-nav-drawer open/closed
 * - Andere global-shared UI-toggles
 *
 * Was hier NICHT hingehört:
 * - Server-state (cached api responses) → TanStack Query
 * - Domain-data (user, airline, route) → server-component-props oder
 *   per-page-query
 * - Form-state → react-hook-form
 *
 * Persist-middleware: localStorage mit key 'vam:ui-store'. Hydration
 * läuft client-side — bei SSR liefert getServerSnapshot defaults.
 * Skipped wenn localStorage unavailable (private mode, SSR-edge-cases).
 */

import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';

interface UIState {
  /** Mobile-nav-drawer open state. Auto-managed (closes on navigation). */
  mobileNavOpen: boolean;
  setMobileNavOpen: (open: boolean) => void;

  /**
   * Sidebar-section-collapsed state. Map: section-title → collapsed.
   * Default-expanded (kein eintrag = expanded). NavSection in AppShell
   * konsumiert das später (Track 3 #11.2.4 sidebar-layout migration).
   */
  sidebarCollapsed: Record<string, boolean>;
  setSidebarCollapsed: (section: string, collapsed: boolean) => void;
  toggleSidebar: (section: string) => void;
}

export const useUIStore = create<UIState>()(
  persist(
    (set) => ({
      mobileNavOpen: false,
      setMobileNavOpen: (open) => set({ mobileNavOpen: open }),

      sidebarCollapsed: {},
      setSidebarCollapsed: (section, collapsed) =>
        set((state) => ({
          sidebarCollapsed: { ...state.sidebarCollapsed, [section]: collapsed },
        })),
      toggleSidebar: (section) =>
        set((state) => ({
          sidebarCollapsed: {
            ...state.sidebarCollapsed,
            [section]: !state.sidebarCollapsed[section],
          },
        })),
    }),
    {
      name: 'vam:ui-store',
      storage: createJSONStorage(() => localStorage),
      // Mobile-nav-drawer NICHT persisten — soll bei jedem page-load
      // reset zu closed sein. Nur sidebarCollapsed bleibt erhalten.
      partialize: (state) => ({ sidebarCollapsed: state.sidebarCollapsed }),
    }
  )
);
