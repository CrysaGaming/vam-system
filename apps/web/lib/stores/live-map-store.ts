/**
 * Live-map filters store — Track 3 #11.2.3 v1 (mit migration zur echten
 * shape in #11.2.3 vNext).
 *
 * Aktuell: live-map.tsx hat einen lokalen useState mit filters-objekt.
 * Dieser store ersetzt das mit zustand + persist-middleware, damit der
 * user seine settings beim refresh behält.
 *
 * Field-list spiegelt EXAKT den state in apps/web/app/live/live-map.tsx
 * (~line 204). Bei sync-issues immer gegen den source-of-truth dort
 * checken — wenn live-map ein neues filter-flag bekommt, muss es auch
 * hier rein (sonst persist verloren). Wenn ein flag entfernt wird,
 * verbleibt es leise im persisted state — kein break, einfach unused.
 *
 * Defaults aus live-map.tsx übernommen:
 * - showVatsim/showIvao/showAirports/clustering: true (live-map zeigt
 *   per default alle relevanten layers)
 * - memberOnly, cockpitRain, cockpitSnow, weatherRadar, autoWeather,
 *   heatmap: false (analytische/spezial-toggles, off-by-default für
 *   clean-startup)
 *
 * Persist: localStorage 'vam:live-map-store'. Keine partialize — alle
 * filter sind user-preferences und sollen bleiben.
 */

import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';

interface LiveMapFilters {
  /** Nur eigene-airline-pilots zeigen (cross-VA-snooping deaktivieren). */
  memberOnly: boolean;
  /** VATSIM-pilots auf der map. */
  showVatsim: boolean;
  /** IVAO-pilots auf der map. */
  showIvao: boolean;
  /** Airport-marker (METAR-overlay-anchors). */
  showAirports: boolean;
  /** Cockpit-regen-effekt (Mapbox-native rain layer). */
  cockpitRain: boolean;
  /** Cockpit-schnee-effekt (Mapbox-native snow layer). */
  cockpitSnow: boolean;
  /** Wetterradar-overlay (RainViewer-tiles). */
  weatherRadar: boolean;
  /**
   * Auto-weather: cockpit-effekte automatisch aus nächstem METAR
   * abgeleitet (snow > rain > clear). Wenn on, werden cockpitRain
   * und cockpitSnow programmatisch gesetzt — der user-toggle bleibt
   * funktional, aber wird beim nächsten autoWeather-tick überschrieben.
   */
  autoWeather: boolean;
  /** Marker-clustering on/off (clustering reduziert visual-clutter). */
  clustering: boolean;
  /** PIREP-heatmap-layer (Track 1 #4 — historische flight-aktivität). */
  heatmap: boolean;
}

interface LiveMapState extends LiveMapFilters {
  /** Single-field setter. Type-safe — value muss zum field-type passen. */
  setFilter: <K extends keyof LiveMapFilters>(key: K, value: LiveMapFilters[K]) => void;
  /**
   * Multi-field setter. Für use-cases wo mehrere flags atomar gesetzt
   * werden müssen (z.B. autoWeather-tick: cockpitRain+cockpitSnow
   * gleichzeitig). Ein store-update statt N — verhindert unnötiges
   * re-render-flickering.
   */
  setFilters: (partial: Partial<LiveMapFilters>) => void;
  resetFilters: () => void;
}

const DEFAULT_FILTERS: LiveMapFilters = {
  memberOnly: false,
  showVatsim: true,
  showIvao: true,
  showAirports: true,
  cockpitRain: false,
  cockpitSnow: false,
  weatherRadar: false,
  autoWeather: false,
  clustering: true,
  heatmap: false,
};

export const useLiveMapStore = create<LiveMapState>()(
  persist(
    (set) => ({
      ...DEFAULT_FILTERS,
      setFilter: (key, value) => set({ [key]: value } as Partial<LiveMapState>),
      setFilters: (partial) => set(partial as Partial<LiveMapState>),
      resetFilters: () => set(DEFAULT_FILTERS),
    }),
    {
      name: 'vam:live-map-store',
      storage: createJSONStorage(() => localStorage),
      // partialize default = full-state. Alle filter sollen persistiert
      // sein. Setter (setFilter, setFilters, resetFilters) werden NICHT
      // serialisiert (zustand strippt funktionen automatisch aus dem
      // persisted JSON).
    }
  )
);
