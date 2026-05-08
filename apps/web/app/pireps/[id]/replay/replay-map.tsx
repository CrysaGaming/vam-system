'use client';

import { useEffect, useState, useRef, useMemo, useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import Map, {
  Marker,
  Source,
  Layer,
  NavigationControl,
  ScaleControl,
  type MapRef,
} from 'react-map-gl/mapbox';
import type { LineLayerSpecification } from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';

/**
 * Track 1 #5 (Replay-Mode, 9.2.7) — Client-side replay-map mit
 * time-slider und play-controls.
 *
 * # Daten-flow
 *
 * On-mount fetched die component /api/pireps/[id]/replay und kriegt
 * eine ReplayDataResult. Bei available=true rendern wir map + slider;
 * bei available=false (sollte praktisch nicht passieren weil die
 * server-page das schon abfängt, aber defensiv) zeigen wir eine
 * fehlermeldung.
 *
 * # Animation
 *
 * Statt eine echte zeitbasierte animation (die bei langen flügen
 * mit lücken in der recordedAt-sequenz ungleichmäßig wirken würde)
 * machen wir eine **frame-basierte** animation: jeder positions-eintrag
 * ist 1 frame, und wir steppen mit constant tickrate durch die liste.
 * Das gibt smooth-feeling visuals — bei 30s-VATSIM-poll genauso wie
 * bei 1Hz-ACARS — und der user kann via speed-control ahnen wie
 * "schnell" der echtzeit-vergleich ist.
 *
 * Speed: 1× = 1 frame/100ms (10fps). 2× = 5fps interval, etc. Speed-
 * dropdown geht 0.5× / 1× / 2× / 4× / 8×. Bei einer 1h-ACARS-flug
 * (3600 frames) bei 1× sind das 360s = 6min replay-zeit. Bei 8× nur
 * 45s. Genug spielraum für unterschiedliche use-cases.
 *
 * # Map-bounds
 *
 * Initial fit-bounds auf den ganzen trail. User kann zoomen/pannen
 * frei — wir folgen dem marker NICHT automatisch (das wäre disorienting
 * wenn der user manuell rumguckt). Es gibt einen "Folgen"-toggle der
 * die kamera dem marker folgen lässt; default off.
 */

// ─────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────

type Position = {
  id: string;
  latitude: number;
  longitude: number;
  altitude: number;
  groundSpeed: number;
  heading: number;
  onGround: boolean;
  altitudeAglFt: number | null;
  indicatedAirspeed: number | null;
  verticalSpeedFpm: number | null;
  pitch: number | null;
  bank: number | null;
  flapsPercent: number | null;
  gearDown: boolean | null;
  phase: string | null;
  recordedAt: string; // ISO from JSON
};

type ReplayDataAvailable = {
  available: true;
  matchType: 'acars' | 'heuristic';
  sessionId: string;
  sessionInfo: {
    network: 'VATSIM' | 'IVAO' | 'Offline';
    callsign: string;
    aircraftType: string | null;
    aircraftRegistration: string | null;
    connectedAt: string; // ISO
    lastUpdatedAt: string; // ISO
  };
  departure: { icao: string; name: string; latitude: number; longitude: number };
  arrival: { icao: string; name: string; latitude: number; longitude: number };
  positions: Position[];
};

type ReplayDataMissing = {
  available: false;
  reason: string;
};

type ApiResult = ReplayDataAvailable | ReplayDataMissing;

// ─────────────────────────────────────────────────────────────────────
// Animation constants
// ─────────────────────────────────────────────────────────────────────

const FRAME_INTERVAL_MS = 100; // 10fps base
const SPEED_OPTIONS = [0.5, 1, 2, 4, 8] as const;

// ─────────────────────────────────────────────────────────────────────
// Helper: trail GeoJSON für die Source
// ─────────────────────────────────────────────────────────────────────

function buildTrailGeoJson(
  positions: Position[],
  upToFrame: number,
): GeoJSON.FeatureCollection<GeoJSON.LineString> {
  const sliced = positions.slice(0, Math.max(2, upToFrame + 1));
  if (sliced.length < 2) {
    return { type: 'FeatureCollection', features: [] };
  }
  const coords: [number, number][] = sliced.map((p) => [p.longitude, p.latitude]);
  return {
    type: 'FeatureCollection',
    features: [
      {
        type: 'Feature',
        properties: {},
        geometry: { type: 'LineString', coordinates: coords },
      },
    ],
  };
}

const trailLineLayer: LineLayerSpecification = {
  id: 'replay-trail',
  type: 'line',
  source: 'replay-trail',
  layout: {
    'line-join': 'round',
    'line-cap': 'round',
  },
  paint: {
    'line-color': '#6366f1', // indigo-500
    'line-width': 3,
    'line-opacity': 0.8,
  },
};

// "Tail"-layer (vergangene strecke vor current frame, etwas dunkler/transparenter)
// optional — für jetzt nutzen wir einen einzigen layer für simplicity.

function formatDuration(ms: number): string {
  const totalSec = Math.floor(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${m}:${String(s).padStart(2, '0')}`;
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('de-DE', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

// ─────────────────────────────────────────────────────────────────────
// Component
// ─────────────────────────────────────────────────────────────────────

export function ReplayMap({
  pirepId,
  mapboxToken,
}: {
  pirepId: string;
  mapboxToken: string;
}) {
  // ─── Track 3 #11.2.3 vNext: TanStack Query demo ──────────────────
  // Vorher: useState<ApiResult>(null) + useState(true) + useState(null)
  // + useEffect mit cancelled-flag, ~28 zeilen für ein simples GET.
  // Jetzt: ein useQuery hook gibt uns data/loading/error inkl.
  // automatischem cleanup, dedup über mehrere component-mounts (z.B.
  // wenn der replay tab gewechselt wird und zurück), und retry-on-
  // failure (default 3x mit exponential backoff) — alles ohne extra
  // code. queryKey = ['pirep-replay', pirepId] sorgt dafür dass jede
  // pirep-id einen eigenen cache-eintrag bekommt.
  //
  // Destructure-alias hält die downstream-API stabil: data, loading,
  // error sind die gleichen variable-namen wie vorher, der rest der
  // component (line ~219 onwards) muss nichts ändern.
  const {
    data = null,
    isLoading: loading,
    error: queryError,
  } = useQuery({
    queryKey: ['pirep-replay', pirepId],
    queryFn: async () => {
      const res = await fetch(`/api/pireps/${pirepId}/replay`, {
        cache: 'no-store',
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return (await res.json()) as ApiResult;
    },
  });
  const error = queryError
    ? queryError instanceof Error
      ? queryError.message
      : 'Fetch failed'
    : null;

  const [frameIndex, setFrameIndex] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState<number>(1);
  const [follow, setFollow] = useState(false);

  const mapRef = useRef<MapRef>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // ─── Initial fit-bounds wenn data da ist ────────────────────────
  useEffect(() => {
    if (!data || !data.available || !mapRef.current) return;
    const positions = data.positions;
    if (positions.length === 0) return;

    // Bounds aus all positions + departure + arrival
    let minLat = data.departure.latitude;
    let maxLat = data.departure.latitude;
    let minLng = data.departure.longitude;
    let maxLng = data.departure.longitude;

    const expand = (lat: number, lng: number) => {
      if (lat < minLat) minLat = lat;
      if (lat > maxLat) maxLat = lat;
      if (lng < minLng) minLng = lng;
      if (lng > maxLng) maxLng = lng;
    };

    expand(data.arrival.latitude, data.arrival.longitude);
    for (const p of positions) {
      expand(p.latitude, p.longitude);
    }

    mapRef.current.fitBounds(
      [
        [minLng, minLat],
        [maxLng, maxLat],
      ],
      { padding: 80, duration: 800 },
    );
  }, [data]);

  // ─── Play/pause animation loop ──────────────────────────────────
  useEffect(() => {
    if (!playing) return;
    if (!data || !data.available) return;

    const positions = data.positions;
    const intervalMs = FRAME_INTERVAL_MS / speed;

    intervalRef.current = setInterval(() => {
      setFrameIndex((current) => {
        if (current >= positions.length - 1) {
          // Ende erreicht — stop
          setPlaying(false);
          return current;
        }
        return current + 1;
      });
    }, intervalMs);

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [playing, speed, data]);

  // ─── Follow-mode: kamera auf marker ─────────────────────────────
  const currentPosition = useMemo(() => {
    if (!data || !data.available) return null;
    return data.positions[Math.min(frameIndex, data.positions.length - 1)] ?? null;
  }, [data, frameIndex]);

  useEffect(() => {
    if (!follow || !currentPosition || !mapRef.current) return;
    mapRef.current.easeTo({
      center: [currentPosition.longitude, currentPosition.latitude],
      duration: 200,
    });
  }, [follow, currentPosition]);

  // ─── Trail GeoJSON memo ─────────────────────────────────────────
  const trailGeoJson = useMemo(() => {
    if (!data || !data.available) {
      return { type: 'FeatureCollection', features: [] } as GeoJSON.FeatureCollection<GeoJSON.LineString>;
    }
    return buildTrailGeoJson(data.positions, frameIndex);
  }, [data, frameIndex]);

  // ─── Controls handlers ──────────────────────────────────────────
  const togglePlay = useCallback(() => {
    if (!data || !data.available) return;
    // Wenn am ende, beim play wieder von vorne starten
    if (frameIndex >= data.positions.length - 1) {
      setFrameIndex(0);
    }
    setPlaying((p) => !p);
  }, [data, frameIndex]);

  const onSliderChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      setFrameIndex(Number(e.target.value));
      // Wenn user manuell scrubbt, pausen
      setPlaying(false);
    },
    [],
  );

  // ─── Track 4 #20: Jump-to-Phase + Keyboard-Shortcuts ────────────
  //
  // # Phase-marker computation
  //
  // Position.phase ist optional und wird vom ACARS-client (oder
  // heuristik bei nicht-ACARS sessions) gesetzt. Werte sind canonical
  // upper-case strings (BOARDING, PUSHBACK, TAXI_OUT, TAKEOFF, CLIMB,
  // CRUISE, DESCENT, APPROACH, LANDING, TAXI_IN, ARRIVED). Der
  // user-facing replay-control möchte schnell zu "wann hat der
  // takeoff angefangen" springen können.
  //
  // Wir scannen die positions linear und merken uns das erste frame
  // pro unique phase-string. Die reihenfolge der markers folgt dem
  // chronologischen ablauf (erst-occurrence → ascending frame-index).
  // Falls die phase im laufe des fluges wechselt und zurück (z.B.
  // CLIMB → CRUISE → DESCENT → CRUISE → DESCENT bei step-climbs),
  // zeigen wir nur den ersten match — das ist die typische "jump to
  // beginning of phase"-semantik die user erwarten.
  const phaseMarkers = useMemo(() => {
    if (!data || !data.available) return [];
    const seen = new Set<string>();
    const markers: Array<{ phase: string; frameIndex: number }> = [];
    data.positions.forEach((p, idx) => {
      if (p.phase && !seen.has(p.phase)) {
        seen.add(p.phase);
        markers.push({ phase: p.phase, frameIndex: idx });
      }
    });
    // Bereits chronologisch durch forEach in array-order, aber
    // explizit sortieren falls jemand in zukunft die scan-reihenfolge
    // ändert.
    markers.sort((a, b) => a.frameIndex - b.frameIndex);
    return markers;
  }, [data]);

  // # Time-based seek
  //
  // Frame-rate ist nicht konstant: ACARS feeds positions ~1Hz, network-
  // polling ~30s, manche frames können fehlen. Stattdessen über die
  // recordedAt-timestamps suchen wir das frame das ±5s vom aktuellen
  // entfernt liegt. Linear scan ist O(n) aber n ist <few-thousand
  // frames; binary search wäre overkill für die typischen
  // replay-längen.
  //
  // Pause beim seek — sonst würde der play-loop direkt wieder
  // weiterspielen und der jump wäre kaum sichtbar.
  const seekByMs = useCallback(
    (deltaMs: number) => {
      if (!data || !data.available || data.positions.length === 0) return;
      const positions = data.positions;
      const currentIdx = Math.min(frameIndex, positions.length - 1);
      const currentMs = new Date(positions[currentIdx].recordedAt).getTime();
      const targetMs = currentMs + deltaMs;

      // Find frame closest to targetMs. Early-exit wenn wir an targetMs
      // vorbei sind (positions sind chronologisch sortiert).
      let bestIdx = 0;
      let bestDiff = Infinity;
      for (let i = 0; i < positions.length; i++) {
        const ms = new Date(positions[i].recordedAt).getTime();
        const diff = Math.abs(ms - targetMs);
        if (diff < bestDiff) {
          bestDiff = diff;
          bestIdx = i;
        } else if (ms > targetMs) {
          // Schon über target hinaus — distance kann nur wachsen
          break;
        }
      }
      setFrameIndex(bestIdx);
      setPlaying(false);
    },
    [data, frameIndex],
  );

  // # Phase-jump helper
  const jumpToPhase = useCallback((targetFrame: number) => {
    setFrameIndex(targetFrame);
    setPlaying(false);
  }, []);

  // # Keyboard shortcuts
  //
  //   Space    → play/pause toggle
  //   ←/→      → seek -5s / +5s
  //   Home/End → jump to start / end
  //
  // Skip wenn focus in input/textarea/contenteditable — sonst kollidiert
  // Space mit text-input. preventDefault auf den keys verhindert
  // page-scroll (Space) und browser-history-back (←).
  useEffect(() => {
    if (!data || !data.available) return;
    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target) {
        const tag = target.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA' || target.isContentEditable) {
          return;
        }
      }

      if (e.key === ' ' || e.code === 'Space') {
        e.preventDefault();
        togglePlay();
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        seekByMs(-5000);
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        seekByMs(5000);
      } else if (e.key === 'Home') {
        e.preventDefault();
        setFrameIndex(0);
        setPlaying(false);
      } else if (e.key === 'End') {
        e.preventDefault();
        setFrameIndex(data.positions.length - 1);
        setPlaying(false);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [data, togglePlay, seekByMs]);

  // ─── Render ─────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="absolute inset-0 flex items-center justify-center bg-gray-100 dark:bg-gray-900">
        <p className="text-gray-500">Lädt Replay-Daten …</p>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="absolute inset-0 flex items-center justify-center bg-gray-100 dark:bg-gray-900">
        <p className="text-rose-600 dark:text-rose-400">
          Fehler beim Laden: {error ?? 'unbekannt'}
        </p>
      </div>
    );
  }

  if (!data.available) {
    return (
      <div className="absolute inset-0 flex items-center justify-center bg-gray-100 dark:bg-gray-900">
        <p className="text-gray-500">Keine Replay-Daten verfügbar.</p>
      </div>
    );
  }

  const totalFrames = data.positions.length;
  const startMs = new Date(data.positions[0].recordedAt).getTime();
  const currentMs = currentPosition
    ? new Date(currentPosition.recordedAt).getTime()
    : startMs;
  const elapsedMs = currentMs - startMs;
  const totalMs =
    new Date(data.positions[totalFrames - 1].recordedAt).getTime() - startMs;

  return (
    <div className="absolute inset-0">
      <Map
        ref={mapRef}
        mapboxAccessToken={mapboxToken}
        initialViewState={{
          longitude: data.departure.longitude,
          latitude: data.departure.latitude,
          zoom: 4,
        }}
        mapStyle="mapbox://styles/mapbox/dark-v11"
        style={{ width: '100%', height: '100%' }}
      >
        <NavigationControl position="top-right" />
        <ScaleControl position="bottom-left" />

        {/* Departure marker */}
        <Marker
          longitude={data.departure.longitude}
          latitude={data.departure.latitude}
          anchor="bottom"
        >
          <div
            className="px-2 py-0.5 rounded bg-emerald-600 text-white text-xs font-mono font-semibold shadow"
            title={data.departure.name}
          >
            {data.departure.icao}
          </div>
        </Marker>

        {/* Arrival marker */}
        <Marker
          longitude={data.arrival.longitude}
          latitude={data.arrival.latitude}
          anchor="bottom"
        >
          <div
            className="px-2 py-0.5 rounded bg-rose-600 text-white text-xs font-mono font-semibold shadow"
            title={data.arrival.name}
          >
            {data.arrival.icao}
          </div>
        </Marker>

        {/* Trail-line */}
        <Source id="replay-trail" type="geojson" data={trailGeoJson}>
          <Layer {...trailLineLayer} />
        </Source>

        {/* Aircraft-position marker */}
        {currentPosition && (
          <Marker
            longitude={currentPosition.longitude}
            latitude={currentPosition.latitude}
            anchor="center"
          >
            <div
              style={{ transform: `rotate(${currentPosition.heading}deg)` }}
              className="w-7 h-7 flex items-center justify-center"
              aria-label={`Aircraft heading ${currentPosition.heading}°`}
            >
              <svg
                viewBox="0 0 24 24"
                className="w-7 h-7 drop-shadow-lg"
                fill="#facc15"
                stroke="#000"
                strokeWidth="0.5"
                aria-hidden="true"
              >
                <path d="M12 2 L14 9 L22 11 L22 13 L14 15 L13 21 L11 21 L10 15 L2 13 L2 11 L10 9 Z" />
              </svg>
            </div>
          </Marker>
        )}
      </Map>

      {/* Match-warning overlay (top-left) */}
      {data.matchType === 'heuristic' && (
        <div className="absolute top-4 left-4 max-w-xs bg-amber-50 dark:bg-amber-950/40 border border-amber-300 dark:border-amber-700 text-amber-900 dark:text-amber-200 text-xs px-3 py-2 rounded shadow">
          Approximative Zuordnung — diese Replay basiert auf der wahrscheinlichsten
          Live-Session zu diesem Flug.
        </div>
      )}

      {/* Telemetry HUD (top-right) */}
      {currentPosition && (
        <div className="absolute top-4 right-16 bg-white/90 dark:bg-gray-900/90 backdrop-blur border border-gray-200 dark:border-gray-800 rounded-lg p-3 text-xs font-mono space-y-0.5 shadow">
          <div>
            ALT:{' '}
            <span className="text-indigo-700 dark:text-indigo-400">
              {currentPosition.altitude.toLocaleString('en-US')} ft
            </span>
          </div>
          <div>
            GS:{' '}
            <span className="text-indigo-700 dark:text-indigo-400">
              {currentPosition.groundSpeed} kt
            </span>
          </div>
          <div>
            HDG:{' '}
            <span className="text-indigo-700 dark:text-indigo-400">
              {String(currentPosition.heading).padStart(3, '0')}°
            </span>
          </div>
          {currentPosition.verticalSpeedFpm !== null && (
            <div>
              VSI:{' '}
              <span className="text-indigo-700 dark:text-indigo-400">
                {currentPosition.verticalSpeedFpm > 0 ? '+' : ''}
                {currentPosition.verticalSpeedFpm} fpm
              </span>
            </div>
          )}
          {currentPosition.phase && (
            <div className="pt-1 border-t border-gray-200 dark:border-gray-800">
              <span className="text-gray-500">Phase:</span>{' '}
              <span className="text-amber-700 dark:text-amber-400">
                {currentPosition.phase}
              </span>
            </div>
          )}
          {currentPosition.onGround && (
            <div className="pt-1 text-emerald-700 dark:text-emerald-400">
              ON GROUND
            </div>
          )}
        </div>
      )}

      {/* Bottom controls bar */}
      <div className="absolute bottom-0 left-0 right-0 bg-white/95 dark:bg-gray-900/95 backdrop-blur border-t border-gray-200 dark:border-gray-800 p-4">
        <div className="max-w-5xl mx-auto space-y-2">
          {/* Track 4 #20: Phase-jump chips. Nur rendern wenn die positions
              überhaupt phase-werte haben (sonst leere row mit nur dem
              shortcut-hint, was hässlich ist). Aktive phase
              (frameIndex >= phaseMarker.frameIndex && < nächster marker)
              wird highlighted. */}
          {phaseMarkers.length > 0 && (
            <div className="flex items-center gap-1.5 flex-wrap text-xs">
              <span className="text-gray-500 dark:text-gray-400 font-medium mr-1">
                Phasen:
              </span>
              {phaseMarkers.map((m, idx) => {
                // Aktiv = current frame liegt zwischen diesem marker und
                // dem nächsten (oder ende des trails wenn das hier der
                // letzte marker ist).
                const nextStart =
                  idx < phaseMarkers.length - 1
                    ? phaseMarkers[idx + 1].frameIndex
                    : totalFrames;
                const isActive =
                  frameIndex >= m.frameIndex && frameIndex < nextStart;
                return (
                  <button
                    key={m.phase}
                    type="button"
                    onClick={() => jumpToPhase(m.frameIndex)}
                    className={[
                      'px-2 py-0.5 rounded font-mono transition',
                      isActive
                        ? 'bg-amber-500 text-white shadow'
                        : 'bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:bg-amber-100 dark:hover:bg-amber-900/40 hover:text-amber-900 dark:hover:text-amber-200',
                    ].join(' ')}
                    aria-label={`Springe zu phase ${m.phase} bei frame ${m.frameIndex + 1}`}
                    title={`Frame ${m.frameIndex + 1} · ${formatTime(data.positions[m.frameIndex].recordedAt)}`}
                  >
                    {m.phase}
                  </button>
                );
              })}
              <span className="ml-auto text-[10px] text-gray-400 dark:text-gray-500 font-mono hidden sm:inline">
                Space = Play/Pause · ←/→ = ±5s · Home/End = Start/Ende
              </span>
            </div>
          )}

          {/* Hauptzeile: play + slider + speed + follow + meta */}
          <div className="flex items-center gap-4 flex-wrap">
          <button
            type="button"
            onClick={togglePlay}
            className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded text-sm font-medium transition shrink-0"
          >
            {playing ? '❚❚ Pause' : '▶ Play'}
          </button>

          <div className="flex-1 min-w-[200px]">
            <input
              type="range"
              min={0}
              max={totalFrames - 1}
              value={frameIndex}
              onChange={onSliderChange}
              className="w-full"
              aria-label="Replay-Position"
            />
            <div className="flex justify-between text-xs text-gray-500 dark:text-gray-400 mt-1 font-mono">
              <span>
                Frame {frameIndex + 1} / {totalFrames} ·{' '}
                {currentPosition && formatTime(currentPosition.recordedAt)}
              </span>
              <span>
                {formatDuration(elapsedMs)} / {formatDuration(totalMs)}
              </span>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <label className="text-xs text-gray-600 dark:text-gray-400">
              Speed:
            </label>
            <select
              value={speed}
              onChange={(e) => setSpeed(Number(e.target.value))}
              className="px-2 py-1 bg-gray-100 dark:bg-gray-800 border border-gray-300 dark:border-gray-700 rounded text-sm"
            >
              {SPEED_OPTIONS.map((s) => (
                <option key={s} value={s}>
                  {s}×
                </option>
              ))}
            </select>
          </div>

          <label className="flex items-center gap-2 shrink-0 text-xs text-gray-600 dark:text-gray-400 cursor-pointer">
            <input
              type="checkbox"
              checked={follow}
              onChange={(e) => setFollow(e.target.checked)}
              className="cursor-pointer"
            />
            Kamera folgen
          </label>

          <div className="text-xs text-gray-500 dark:text-gray-400 font-mono shrink-0">
            {data.sessionInfo.callsign}
            {data.sessionInfo.aircraftType && ` · ${data.sessionInfo.aircraftType}`}
            {' · '}
            <span
              className={
                data.sessionInfo.network === 'VATSIM'
                  ? 'text-blue-600 dark:text-blue-400'
                  : data.sessionInfo.network === 'IVAO'
                    ? 'text-emerald-600 dark:text-emerald-400'
                    : 'text-gray-600 dark:text-gray-400'
              }
            >
              {data.sessionInfo.network}
            </span>
          </div>
          </div>
        </div>
      </div>
    </div>
  );
}
