/**
 * Live-map filters store — Track 3 #11.2.3 v1.
 *
 * Aktuell (vor migration): live-map.tsx hat einen lokalen useState mit
 * filters-objekt — siehe apps/web/app/live/live-map.tsx ~line 204. Das
 * ist client-only und geht beim page-reload verloren.
 *
 * Ziel: filters in zustand-store mit persist, damit der user seine
 * settings beim refresh behält. Migration der live-map kommt als own
 * commit (#11.2.3 Phase 2/3) — dieser store legt nur das schema fest.
 *
 * Was filtert die live-map:
 * - networkVATSIM / networkIVAO / networkACARS: pilot-source-filter
 * - showMETAR / showRadar: weather-overlay toggle
 * - showHeatmap: PIREP-heatmap-layer toggle
 * - membersOnly: nur own-airline-pilots
 *
 * Persist: localStorage 'vam:live-map-store'. Selectivity: alle filter
 * werden persistiert (sind alle user-preferences, nicht ephemeral).
 */

import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';

interface LiveMapFilters {
  networkVATSIM: boolean;
  networkIVAO: boolean;
  networkACARS: boolean;
  showMETAR: boolean;
  showRadar: boolean;
  showHeatmap: boolean;
  membersOnly: boolean;
}

interface LiveMapState extends LiveMapFilters {
  setFilter: <K extends keyof LiveMapFilters>(key: K, value: LiveMapFilters[K]) => void;
  resetFilters: () => void;
}

const DEFAULT_FILTERS: LiveMapFilters = {
  networkVATSIM: true,
  networkIVAO: true,
  networkACARS: true,
  showMETAR: false,
  showRadar: false,
  showHeatmap: false,
  membersOnly: false,
};

export const useLiveMapStore = create<LiveMapState>()(
  persist(
    (set) => ({
      ...DEFAULT_FILTERS,
      setFilter: (key, value) => set({ [key]: value } as Partial<LiveMapState>),
      resetFilters: () => set(DEFAULT_FILTERS),
    }),
    {
      name: 'vam:live-map-store',
      storage: createJSONStorage(() => localStorage),
    }
  )
);
