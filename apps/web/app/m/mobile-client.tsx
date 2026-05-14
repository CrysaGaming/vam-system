'use client';

import { useEffect, useRef, useState } from 'react';

/**
 * MobileState — the JSON shape returned by GET /api/mobile/state.
 *
 * Kept exported so the RSC parent can construct an initialState of
 * the exact same shape on first render (avoiding a flash of empty
 * data before the first poll lands). When changing fields here,
 * apps/web/app/api/mobile/state/route.ts must move in lockstep.
 *
 * Date fields are ISO strings — Next.js's default JSON serializer
 * emits Date as ISO, and the RSC parent does .toISOString() to match.
 * The client only needs them as strings for `new Date(...)` math, so
 * the type contract matches the wire format exactly.
 */
export type MobileState = {
  serverTime: string;
  session: MobileSessionSnapshot | null;
};

export type MobileSessionSnapshot = {
  id: string;
  callsign: string;
  network: string;
  dataSource: string;
  flightNumber: string | null;
  departureIcao: string | null;
  arrivalIcao: string | null;
  alternateIcao: string | null;
  flightRules: string | null;
  cruiseAltitude: number | null;
  aircraftType: string | null;
  aircraftRegistration: string | null;
  currentPhase: string | null;
  currentPhaseEnteredAt: string | null;
  latitude: number;
  longitude: number;
  altitude: number;
  altitudeAglFt: number | null;
  groundSpeed: number;
  indicatedAirspeed: number | null;
  heading: number;
  onGround: boolean;
  verticalSpeedFpm: number | null;
  mach: number | null;
  engineN1Avg: number | null;
  fuelTotalKg: number | null;
  fuelFlowPph: number | null;
  flapsPercent: number | null;
  gearDown: boolean | null;
  spoilersDeployed: boolean | null;
  parkingBrake: boolean | null;
  autopilotMaster: boolean | null;
  windSpeedKts: number | null;
  windDirection: number | null;
  oatCelsius: number | null;
  connectedAt: string;
  lastUpdatedAt: string;
  lastAcarsHeartbeat: string | null;
};

/**
 * Polling interval in milliseconds. 5s is the sweet spot: fast enough
 * that the pilot can glance at the phone and trust the data; slow
 * enough to keep server load reasonable (~720 reqs/hour/active-pilot)
 * and to not drain phone battery. The ACARS client itself heartbeats
 * server-side every 1-2 seconds, so 5s is at most 4s of latency.
 */
const POLL_INTERVAL_MS = 5000;

/**
 * Threshold beyond which we consider the heartbeat stale and warn the
 * user visually. ACARS heartbeats are 1-2s; 30s without one means
 * something is wrong (sim crashed, network dropped, tray-app closed).
 * Below this threshold the dot is green; above, amber. The actual
 * lastUpdatedAt is shown either way so the user can see exact age.
 */
const STALE_HEARTBEAT_THRESHOLD_S = 30;

/**
 * Welle E / E3 — client component for the mobile-companion route.
 *
 * Polls /api/mobile/state every 5s and renders the active LiveSession
 * as a single mobile-optimized card. Falls back to a "Keine aktive
 * Sitzung"-empty-state when the pilot isn't currently flying.
 *
 * Design philosophy: ONE big readable surface, no nav, no tabs, no
 * scrollable sub-areas if avoidable. The pilot glances at this from
 * across the desk and needs to read it without reaching for the
 * phone. Hero zone shows callsign + phase; below it, route + key
 * telemetry in large legible numbers.
 *
 * # Re-render cadence
 *
 * Two interleaved cadences:
 *   1. Polling at POLL_INTERVAL_MS (5s) refetches the full snapshot.
 *   2. A 1Hz tick (setInterval) drives a re-render so the "X seconds
 *      ago" age string updates smoothly between polls. Without this,
 *      the age would show "3s ago" until the next poll, then jump to
 *      "0s ago" — feeling laggy.
 *
 * # Error handling
 *
 * Network errors during polling are silently swallowed (logged to
 * console for debugging). The page keeps showing the last good
 * snapshot until the next successful poll. This is intentionally
 * forgiving — phones on cellular drop momentarily and a hard error
 * banner would constantly flicker. The lastUpdatedAt age serves as
 * the implicit "is the data fresh" indicator.
 *
 * If the poll returns 401 (the session-cookie expired), we let the
 * page stay on the last good snapshot but stop polling — a hard
 * redirect would yank the user out of what they were watching.
 */
export function MobileCompanion({
  initialState,
  pilotName,
}: {
  initialState: MobileState;
  pilotName: string;
}) {
  const [state, setState] = useState<MobileState>(initialState);
  // Lock state used by the 1Hz tick to force re-render of the age
  // string without mutating the underlying state object. Cheap —
  // single integer increment per second, single React render.
  const [, setTickCounter] = useState(0);
  // Tracks whether polling should stop (after a 401). One-shot flag,
  // not unsettable from the UI — user has to manually refresh after
  // re-auth.
  const stoppedRef = useRef(false);

  // Polling loop. Setup once on mount; cleanup on unmount. We use
  // setTimeout-recursion instead of setInterval so we never have
  // overlapping requests if one poll runs long (e.g. cellular hiccup).
  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    async function poll() {
      if (cancelled || stoppedRef.current) return;
      try {
        const res = await fetch('/api/mobile/state', {
          // Cookie-based auth: include credentials so the NextAuth
          // session cookie rides along on every poll. 'same-origin'
          // is the default for fetch but explicit is safer if the
          // page were ever served from a CDN sub-domain.
          credentials: 'same-origin',
          cache: 'no-store',
        });
        if (res.status === 401) {
          // Session-cookie expired or revoked. Stop polling rather
          // than spamming 401s for the rest of the session.
          stoppedRef.current = true;
          return;
        }
        if (res.ok) {
          const json = (await res.json()) as MobileState;
          if (!cancelled) setState(json);
        }
      } catch (err) {
        // Swallow + log. We don't surface transient network errors
        // because they'd flicker on every cellular hiccup. The
        // lastUpdatedAt age is the user-facing freshness indicator.
        // eslint-disable-next-line no-console
        console.warn('[mobile-companion] poll failed:', err);
      } finally {
        if (!cancelled && !stoppedRef.current) {
          timer = setTimeout(poll, POLL_INTERVAL_MS);
        }
      }
    }

    // First poll happens immediately on mount (don't wait the full
    // interval). initialState is already the SSR snapshot, but this
    // tightens any race between SSR render and first real poll —
    // if the user navigated here mid-flight, the SSR fetch could
    // already be a few seconds old by paint-time.
    timer = setTimeout(poll, POLL_INTERVAL_MS);

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, []);

  // 1Hz tick to update the "X seconds ago" age display between polls.
  // setTickCounter forces re-render; the actual value is unused.
  useEffect(() => {
    const tick = setInterval(() => {
      setTickCounter((n) => n + 1);
    }, 1000);
    return () => clearInterval(tick);
  }, []);

  if (!state.session) {
    return <EmptyState pilotName={pilotName} />;
  }

  return <ActiveState state={state} pilotName={pilotName} />;
}

// ─────────────────────────────────────────────────────────────────────
// Empty state — no active flight
// ─────────────────────────────────────────────────────────────────────

function EmptyState({ pilotName }: { pilotName: string }) {
  return (
    <div className="flex flex-col items-center justify-center min-h-screen px-6 py-10 text-center">
      <div className="text-7xl mb-6" aria-hidden="true">
        ✈️
      </div>
      <h1 className="text-2xl font-semibold mb-3">Keine aktive Sitzung</h1>
      <p className="text-gray-400 mb-2 max-w-sm leading-relaxed">
        Sobald du den VAM ACARS-Client startest und auf{' '}
        <span className="font-mono text-gray-200">Verbinden</span> klickst,
        erscheinen hier deine Flugdaten in Echtzeit.
      </p>
      <p className="text-xs text-gray-600 mt-8">Angemeldet als {pilotName}</p>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Active state — current flight card
// ─────────────────────────────────────────────────────────────────────

function ActiveState({
  state,
  pilotName,
}: {
  state: MobileState;
  pilotName: string;
}) {
  const s = state.session!;
  const lastBeat = s.lastAcarsHeartbeat ?? s.lastUpdatedAt;
  const lastBeatMs = new Date(lastBeat).getTime();
  // Age uses the device's Date.now() rather than state.serverTime so
  // the 1Hz tick visibly increments the value between polls. serverTime
  // is captured at poll-time and only updates every 5s. Small clock-
  // skew between server and device (sub-second on time-synced devices)
  // is acceptable for a freshness indicator — we're showing "vor 3s"
  // not a precise audit timestamp.
  const ageSeconds = Math.max(0, Math.floor((Date.now() - lastBeatMs) / 1000));
  const isStale = ageSeconds > STALE_HEARTBEAT_THRESHOLD_S;

  const phaseLabel = phaseDisplay(s.currentPhase);
  const networkBadge = networkLabel(s.network);
  const route = composeRoute(s.departureIcao, s.arrivalIcao);
  const altDisplay = formatAltitude(s.altitude);
  const speedDisplay = `${s.groundSpeed} kt`;
  const vsDisplay =
    s.verticalSpeedFpm !== null && s.verticalSpeedFpm !== 0
      ? `${s.verticalSpeedFpm > 0 ? '↑' : '↓'} ${Math.abs(s.verticalSpeedFpm)} fpm`
      : null;

  return (
    <div className="px-5 py-6 max-w-md mx-auto">
      {/* Hero zone: callsign + phase + freshness dot. Largest type
          on the page; readable from across the room. */}
      <div className="mb-7">
        <div className="flex items-baseline justify-between gap-3 mb-2">
          <h1 className="text-4xl font-bold font-mono tracking-tight">
            {s.callsign}
          </h1>
          <FreshnessIndicator ageSeconds={ageSeconds} isStale={isStale} />
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <PhasePill phase={phaseLabel} onGround={s.onGround} />
          <NetworkPill label={networkBadge} dataSource={s.dataSource} />
        </div>
      </div>

      {/* Route block. Centered DEP → ARR with cruise altitude as a
          subtitle. Falls back to "Free flight" if no plan filed. */}
      <div className="mb-7 rounded-2xl bg-gray-900 border border-gray-800 px-5 py-6 text-center">
        {route ? (
          <>
            <div className="flex items-center justify-center gap-3 sm:gap-4">
              <span className="text-3xl font-mono font-semibold">
                {s.departureIcao ?? '—'}
              </span>
              <span className="text-gray-600 text-xl" aria-hidden="true">
                →
              </span>
              <span className="text-3xl font-mono font-semibold">
                {s.arrivalIcao ?? '—'}
              </span>
            </div>
            {s.cruiseAltitude ? (
              <p className="text-sm text-gray-500 mt-2">
                Cruise FL{String(Math.round(s.cruiseAltitude / 100)).padStart(3, '0')}
              </p>
            ) : null}
          </>
        ) : (
          <p className="text-gray-500 italic">Free flight — kein Flugplan</p>
        )}
      </div>

      {/* Telemetry grid. Two columns of label/value pairs. Larger
          numbers, smaller labels. Items with null values are still
          rendered with "—" so the grid stays a stable 2×N shape and
          doesn't reflow as data lands. */}
      <div className="mb-7 grid grid-cols-2 gap-3">
        <Tile label="Höhe" value={altDisplay} />
        <Tile label="Speed" value={speedDisplay} />
        <Tile label="VS" value={vsDisplay ?? '—'} />
        <Tile label="Heading" value={`${String(s.heading).padStart(3, '0')}°`} />
        <Tile label="Aircraft" value={s.aircraftType ?? '—'} />
        <Tile
          label="Fuel"
          value={s.fuelTotalKg !== null ? `${s.fuelTotalKg} kg` : '—'}
        />
      </div>

      {/* Surface-state row. Inline pills showing AP / Gear / Flaps —
          purely informational, only rendered when the field is non-null
          (ACARS-only data, not present for VATSIM-tracker sessions). */}
      <div className="mb-7 flex flex-wrap gap-2">
        {s.autopilotMaster !== null && (
          <StatePill
            label="AP"
            on={s.autopilotMaster}
            offLabel="off"
            onLabel="on"
          />
        )}
        {s.gearDown !== null && (
          <StatePill
            label="GEAR"
            on={s.gearDown}
            offLabel="up"
            onLabel="down"
          />
        )}
        {s.flapsPercent !== null && s.flapsPercent > 0 && (
          <span className="px-3 py-1 rounded-full text-xs font-medium bg-blue-500/15 text-blue-300 border border-blue-500/30">
            FLAPS {s.flapsPercent}%
          </span>
        )}
        {s.parkingBrake === true && (
          <span className="px-3 py-1 rounded-full text-xs font-medium bg-amber-500/15 text-amber-300 border border-amber-500/30">
            P-BRK
          </span>
        )}
        {s.spoilersDeployed === true && (
          <span className="px-3 py-1 rounded-full text-xs font-medium bg-amber-500/15 text-amber-300 border border-amber-500/30">
            SPOILERS
          </span>
        )}
      </div>

      {/* Footer: pilot identity + connection age. Small, secondary
          type — info that helps orient but doesn't compete with the
          hero/telemetry zones for attention. */}
      <div className="pt-5 border-t border-gray-800 text-xs text-gray-500 flex items-center justify-between">
        <span>{pilotName}</span>
        <span>
          Update vor{' '}
          <span className={isStale ? 'text-amber-400' : 'text-gray-300'}>
            {ageSeconds}s
          </span>
        </span>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Sub-components
// ─────────────────────────────────────────────────────────────────────

function FreshnessIndicator({
  ageSeconds,
  isStale,
}: {
  ageSeconds: number;
  isStale: boolean;
}) {
  return (
    <span
      className="inline-flex items-center gap-1.5 text-xs font-medium"
      title={`Letzter Heartbeat: vor ${ageSeconds} Sekunden`}
    >
      <span
        className={`inline-block w-2 h-2 rounded-full ${
          isStale ? 'bg-amber-400' : 'bg-emerald-400 animate-pulse'
        }`}
        aria-hidden="true"
      />
      <span className={isStale ? 'text-amber-400' : 'text-emerald-400'}>
        {isStale ? 'STALE' : 'LIVE'}
      </span>
    </span>
  );
}

function PhasePill({
  phase,
  onGround,
}: {
  phase: string;
  onGround: boolean;
}) {
  // Color-code phase by "where in the flight" — ground-ops are amber,
  // airborne phases are blue, approach/landing are emerald. Keep it
  // dim enough to not overwhelm the hero zone.
  const tone = phaseTone(phase, onGround);
  const cls = {
    ground: 'bg-amber-500/15 text-amber-300 border-amber-500/30',
    air: 'bg-blue-500/15 text-blue-300 border-blue-500/30',
    arrival: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30',
    unknown: 'bg-gray-700/40 text-gray-400 border-gray-700',
  }[tone];

  return (
    <span
      className={`px-3 py-1 rounded-full text-xs font-semibold uppercase tracking-wider border ${cls}`}
    >
      {phase}
    </span>
  );
}

function NetworkPill({
  label,
  dataSource,
}: {
  label: string;
  dataSource: string;
}) {
  // Visual tone: live-network sessions get a brighter pill, offline /
  // tracker-only sessions get a muted one. ACARS_CLIENT marks fly-by-
  // wire data sources; useful info for the pilot at a glance.
  const isAcars = dataSource === 'ACARS_CLIENT';
  const cls = isAcars
    ? 'bg-purple-500/15 text-purple-300 border-purple-500/30'
    : 'bg-gray-700/40 text-gray-400 border-gray-700';
  return (
    <span
      className={`px-3 py-1 rounded-full text-xs font-medium border ${cls}`}
      title={`Quelle: ${dataSource}`}
    >
      {label}
    </span>
  );
}

function Tile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl bg-gray-900 border border-gray-800 px-4 py-3">
      <div className="text-[10px] uppercase tracking-wider text-gray-500 mb-1">
        {label}
      </div>
      <div className="text-xl font-mono font-semibold tabular-nums">
        {value}
      </div>
    </div>
  );
}

function StatePill({
  label,
  on,
  offLabel,
  onLabel,
}: {
  label: string;
  on: boolean;
  offLabel: string;
  onLabel: string;
}) {
  const cls = on
    ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30'
    : 'bg-gray-700/40 text-gray-500 border-gray-700';
  return (
    <span
      className={`px-3 py-1 rounded-full text-xs font-medium border ${cls}`}
    >
      {label} {on ? onLabel : offLabel}
    </span>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────

/**
 * Map the raw phase enum to a German display label. Keeps the UI
 * copy consistent with the rest of the app (which is mostly German).
 * Unknown phases fall through as-is — better to show the raw enum
 * value than mask a new phase introduced server-side with "Unbekannt".
 */
function phaseDisplay(phase: string | null): string {
  if (!phase) return 'Bereit';
  const map: Record<string, string> = {
    PreFlight: 'Pre-flight',
    Pushback: 'Pushback',
    Taxi: 'Taxi',
    Takeoff: 'Takeoff',
    Climb: 'Climb',
    Cruise: 'Cruise',
    Descent: 'Descent',
    Approach: 'Approach',
    Landing: 'Landing',
    TaxiIn: 'Taxi In',
    BlockOn: 'Block On',
  };
  return map[phase] ?? phase;
}

/**
 * Bucket phases into ground / air / arrival tones for visual tinting.
 * onGround=true overrides the phase mapping when the bird's still on
 * the ground despite being in (say) PreFlight (covers edge cases like
 * partial state transitions during heartbeat processing).
 */
function phaseTone(
  phase: string,
  onGround: boolean,
): 'ground' | 'air' | 'arrival' | 'unknown' {
  if (onGround) return 'ground';
  if (['Approach', 'Landing', 'Taxi In', 'Block On'].includes(phase)) {
    return 'arrival';
  }
  if (['Climb', 'Cruise', 'Descent', 'Takeoff'].includes(phase)) {
    return 'air';
  }
  if (phase === 'Bereit' || phase === 'Pre-flight' || phase === 'Pushback' || phase === 'Taxi') {
    return 'ground';
  }
  return 'unknown';
}

function networkLabel(network: string): string {
  // NetworkType enum: VATSIM / IVAO / POSCON / OFFLINE / etc. Title-
  // case for display; we don't translate "OFFLINE" because the term
  // is universally understood by pilots in either language.
  if (network === 'OFFLINE') return 'Offline';
  return network;
}

/**
 * Compose the DEP → ARR string. Returns null when both icaos are
 * missing, so the caller can fall back to a "Free flight" empty-state
 * cleanly. A single icao present (rare — only filed half the plan)
 * still renders; the missing side shows "—".
 */
function composeRoute(
  dep: string | null,
  arr: string | null,
): string | null {
  if (!dep && !arr) return null;
  return `${dep ?? '—'} → ${arr ?? '—'}`;
}

/**
 * Render altitude as FLxxx for ≥18000 ft (transition altitude in most
 * airspaces), otherwise as feet. Matches the convention pilots see in
 * the cockpit and on SimBrief OFPs.
 */
function formatAltitude(alt: number): string {
  if (alt >= 18000) {
    return `FL${String(Math.round(alt / 100)).padStart(3, '0')}`;
  }
  return `${alt.toLocaleString('de-DE')} ft`;
}
