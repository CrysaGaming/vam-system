'use client';

/**
 * Welle O / O3 — Overlay v2 widgets.
 *
 * Additive UI-layer on top of the existing /overlay/[token] route.
 * Activated via URL param `?v2=on` so existing OBS-scenes don't change
 * shape unless the streamer explicitly opts in. All three widgets are
 * layout-agnostic — they render as fixed-position siblings to the
 * chosen bar/card/cockpit layout.
 *
 * # Widgets
 *
 * 1. RouteProgressBar — bottom-edge horizontal bar showing what % of
 *    the flight has been covered. Anchors on the first-seen distance-
 *    to-arrival as "total route distance"; everything since counts
 *    as progress. Hidden during taxi/block.
 *
 * 2. WindComponentBadge — top-edge headwind/tailwind/crosswind
 *    decomposition. Useful for cruise + descent monitoring. The
 *    cockpit layout shows raw "270°/15kt", which is true but doesn't
 *    tell you *how* it's affecting your groundspeed. This badge does.
 *
 * 3. PhaseTransitionToast — full-width slide-in toast that announces
 *    phase changes ("Top of Climb · Cruise reached"). Fires once per
 *    transition, auto-dismisses after 5s. Reads phase.id from the
 *    same poll-loop the layouts use; no separate event channel.
 *
 * # Why a separate file
 *
 * `overlay-client.tsx` is already ~2000 LOC. Layering v2 features in-
 * line would push it past 2300 and bury the new components. Keeping
 * them in `_v2-overlays.tsx` makes them grep-discoverable and means
 * O3 commits don't have to touch the legacy layout code.
 *
 * # Why all three are gated together
 *
 * Streamers either want the v2 look (more dynamic, more information)
 * or they don't. Splitting the gates into per-widget query params
 * (?progress=on&wind=on&toast=on) would balloon the URL surface and
 * encourage half-configured overlays. One toggle, all-or-nothing.
 */

import { useEffect, useRef, useState } from 'react';

// ────────────────────────────────────────────────────────────
// MINIMAL TYPE-SUBSET
// ────────────────────────────────────────────────────────────
// We intentionally don't import OverlayData from overlay-client.tsx.
// That type is defined inline there and isn't exported; importing
// would require either exporting it (broader refactor) or moving the
// type into a shared file. Both are out of scope for O3. The widgets
// only read 4 fields, so a local minimal type is cleaner.

export type V2OverlayInput = {
  phase: { id: string; label: string };
  progress: {
    distanceKm: number | null;
    etaMinutes: number | null;
    etaFormatted: string | null;
  };
  position: { heading: number };
  telemetry: {
    windSpeedKts: number | null;
    windDirection: number | null;
  };
};

// ────────────────────────────────────────────────────────────
// 1. ROUTE PROGRESS BAR
// ────────────────────────────────────────────────────────────

/**
 * Phases during which we don't render the progress bar. Block /
 * taxi-out have no meaningful "distance to go" yet; the airport's
 * own coordinates are the reference and the distance flips around
 * as the aircraft moves a few meters. Showing "0% complete" during
 * a 20-minute pushback gives an unhelpful impression of stasis.
 *
 * Once we're TAKEOFF or later, the bar appears and never goes away
 * until the session ends — even during taxi-in, we keep showing
 * "near 100%" rather than yanking the bar mid-flight.
 */
const PROGRESS_HIDDEN_PHASES = new Set(['BLOCK', 'TAXI_OUT']);

export function RouteProgressBar({ data }: { data: V2OverlayInput }) {
  // Baseline distance — captured the first time we see a non-null
  // distanceKm. After that, percentage = (baseline - current) / baseline.
  // useRef instead of useState because we don't want re-renders when
  // it gets set (the data-poll already triggers re-render). It only
  // gets written once per flight.
  const baselineKm = useRef<number | null>(null);

  // Reset baseline if the session goes inactive between renders. The
  // parent already returns null in that case, but if we ever get
  // remounted on a fresh session, the ref persists across mounts on
  // some hot-reload paths — defensive cleanup.
  useEffect(() => {
    return () => {
      baselineKm.current = null;
    };
  }, []);

  const current = data.progress.distanceKm;
  if (current === null) return null;
  if (PROGRESS_HIDDEN_PHASES.has(data.phase.id)) return null;

  // Capture baseline. We bump it if the current distance is *higher*
  // than baseline — that means the pilot diverted further away (e.g.
  // course-reversal hold), so the old baseline is no longer the route's
  // max extent. Without this guard the bar would go negative.
  if (baselineKm.current === null || current > baselineKm.current) {
    baselineKm.current = current;
  }

  const baseline = baselineKm.current;
  // baseline can be 0 if pilot is sitting on the destination runway
  // with no movement — guard the divide.
  const pct =
    baseline > 0
      ? Math.max(0, Math.min(100, ((baseline - current) / baseline) * 100))
      : 0;

  // ETA gets its own pill on the right side of the bar. Some flights
  // never have an ETA (groundspeed too low to extrapolate); in that
  // case we drop the pill entirely rather than show "—".
  const etaPill = data.progress.etaFormatted ?? null;

  return (
    <div
      style={{
        position: 'fixed',
        left: 24,
        right: 24,
        bottom: 16,
        zIndex: 50,
        // 8% font-size matches the cockpit layout's secondary readouts.
        // The bar itself is height-fixed at 8px; the text pills are
        // positioned absolutely above/beside it.
        pointerEvents: 'none',
      }}
      aria-label="Flight progress"
    >
      <div
        style={{
          position: 'relative',
          height: 10,
          background: 'rgba(15, 23, 42, 0.7)',
          borderRadius: 4,
          overflow: 'hidden',
          border: '1px solid rgba(125, 211, 252, 0.25)',
          backdropFilter: 'blur(4px)',
        }}
      >
        {/* Filled portion */}
        <div
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            height: '100%',
            width: `${pct}%`,
            background:
              'linear-gradient(90deg, rgba(125, 211, 252, 0.85), rgba(56, 189, 248, 0.95))',
            transition: 'width 800ms ease-out',
          }}
        />
        {/* Current-position indicator dot */}
        <div
          style={{
            position: 'absolute',
            top: '50%',
            left: `${pct}%`,
            transform: 'translate(-50%, -50%)',
            width: 14,
            height: 14,
            borderRadius: '50%',
            background: '#7DD3FC',
            boxShadow: '0 0 8px rgba(125, 211, 252, 0.8)',
            transition: 'left 800ms ease-out',
          }}
        />
      </div>

      {/* Pills row above the bar */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: 4,
          fontFamily: 'ui-monospace, SFMono-Regular, monospace',
          fontSize: 11,
          color: '#E2E8F0',
          letterSpacing: '0.05em',
          textShadow: '0 1px 2px rgba(0, 0, 0, 0.8)',
        }}
      >
        <span>
          {pct.toFixed(0)}% · {current} km to go
        </span>
        {etaPill && <span>ETA {etaPill}</span>}
      </div>
    </div>
  );
}

// ────────────────────────────────────────────────────────────
// 2. WIND COMPONENT BADGE
// ────────────────────────────────────────────────────────────

/**
 * Decompose wind into headwind/tailwind + crosswind components
 * relative to the aircraft's track.
 *
 * # Math
 *
 * Wind direction (METAR convention) is the *bearing the wind is
 * blowing FROM*. Heading is where the nose is pointed. So a wind
 * from 090° hitting an aircraft heading 090° is a pure headwind.
 *
 * Relative angle θ = windDirection - heading (normalized -180..180).
 *   headwind  = windSpeed * cos(θ)   positive = headwind, negative = tail
 *   crosswind = windSpeed * sin(θ)   positive = from right, negative = from left
 *
 * # Caveats
 *
 * - Heading vs. true-track: at high crab angles these differ by a
 *   few degrees. We use heading (what the aircraft is pointed at,
 *   from the sim's compass) since that's what the streamer cares
 *   about visually. A track-based calc would technically be the
 *   "correct" groundspeed decomposition but is overkill here.
 *
 * - METAR winds use magnetic at most stations but VATSIM/IVAO
 *   typically deliver true. Mismatch produces a few degrees of
 *   bias — acceptable for an overlay widget; perfectionists can
 *   read the raw wind in the cockpit layout's WIND line.
 */
function decomposeWind(
  heading: number,
  windDirection: number,
  windSpeedKts: number,
): { headwind: number; crosswind: number } {
  let relDeg = windDirection - heading;
  // Normalize to -180..180 so cos/sin behave naturally
  while (relDeg > 180) relDeg -= 360;
  while (relDeg < -180) relDeg += 360;
  const relRad = (relDeg * Math.PI) / 180;
  const headwind = windSpeedKts * Math.cos(relRad);
  const crosswind = windSpeedKts * Math.sin(relRad);
  return { headwind, crosswind };
}

export function WindComponentBadge({ data }: { data: V2OverlayInput }) {
  const { windSpeedKts, windDirection } = data.telemetry;
  if (windSpeedKts === null || windDirection === null) return null;
  // < 3kt total wind = noise (sim air-mass jitter, taxi-out gusts).
  // Show nothing rather than flicker between H1/T1 every poll.
  if (windSpeedKts < 3) return null;

  const { headwind, crosswind } = decomposeWind(
    data.position.heading,
    windDirection,
    windSpeedKts,
  );

  // Sign convention for display:
  //   headwind > 0  → "H" (headwind, slowing groundspeed)
  //   headwind < 0  → "T" (tailwind, boosting groundspeed)
  //   crosswind > 0 → "R" (wind from right side)
  //   crosswind < 0 → "L" (wind from left side)
  const headLabel = headwind >= 0 ? 'H' : 'T';
  const crossLabel = crosswind >= 0 ? 'R' : 'L';

  // Color the head/tail value by impact:
  //   tailwind any size  → emerald (always good for groundspeed)
  //   headwind 0-15      → slate (mild)
  //   headwind 15-30     → amber (notable)
  //   headwind 30+       → rose (significant)
  const headAbs = Math.abs(headwind);
  const headColor =
    headwind < 0
      ? '#34D399' // tailwind
      : headAbs < 15
        ? '#CBD5E1'
        : headAbs < 30
          ? '#FBBF24'
          : '#FB7185';

  return (
    <div
      style={{
        position: 'fixed',
        top: 16,
        right: 24,
        zIndex: 50,
        background: 'rgba(15, 23, 42, 0.75)',
        backdropFilter: 'blur(4px)',
        border: '1px solid rgba(125, 211, 252, 0.25)',
        borderRadius: 6,
        padding: '6px 10px',
        fontFamily: 'ui-monospace, SFMono-Regular, monospace',
        fontSize: 11,
        color: '#E2E8F0',
        letterSpacing: '0.05em',
        pointerEvents: 'none',
        display: 'flex',
        gap: 10,
        alignItems: 'center',
      }}
      aria-label="Wind components"
    >
      <span style={{ opacity: 0.6 }}>WIND</span>
      <span style={{ color: headColor, fontWeight: 600 }}>
        {headLabel}
        {Math.round(headAbs)}
      </span>
      <span style={{ color: '#94A3B8' }}>
        {crossLabel}
        {Math.round(Math.abs(crosswind))}
      </span>
    </div>
  );
}

// ────────────────────────────────────────────────────────────
// 3. PHASE TRANSITION TOAST
// ────────────────────────────────────────────────────────────

/**
 * Watches `phase.id` between renders. When it changes, capture the new
 * label, show a centered slide-in toast for 5s, then hide.
 *
 * # Why not announce *every* phase
 *
 * BLOCK and TAXI_OUT happen at startup; announcing them gives noise.
 * The user-facing milestones are TAKEOFF, CLIMB, CRUISE, DESCENT,
 * APPROACH, LANDING, TAXI_IN. We announce all of those; if the engine's
 * detection bounces between APPROACH and DESCENT in turbulence, the
 * toast deduplicates because we only set state on actual change.
 *
 * # Why client-side rather than server-emitted
 *
 * The SSE channel just re-pushes the full payload every 5s; it doesn't
 * have a "milestone" event-type. Adding one server-side would require
 * touching the build-payload pipeline and the SSE handler. Detecting
 * the transition client-side from the data we already have is
 * equivalent in effect with zero backend changes.
 */
const TOAST_DURATION_MS = 5000;
const ANNOUNCED_PHASES = new Set([
  'TAKEOFF',
  'CLIMB',
  'CRUISE',
  'DESCENT',
  'APPROACH',
  'LANDING',
  'TAXI_IN',
]);

const PHASE_EMOJI: Record<string, string> = {
  TAKEOFF: '🛫',
  CLIMB: '📈',
  CRUISE: '✈️',
  DESCENT: '📉',
  APPROACH: '🎯',
  LANDING: '🛬',
  TAXI_IN: '🅿️',
};

export function PhaseTransitionToast({ data }: { data: V2OverlayInput }) {
  const lastPhase = useRef<string | null>(null);
  const [toast, setToast] = useState<{ label: string; emoji: string } | null>(
    null,
  );
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const current = data.phase.id;
    const prev = lastPhase.current;

    // First render — just record the phase, don't toast. We don't
    // want a "Cruise reached" pop-up the moment the streamer loads
    // the overlay halfway through a flight.
    if (prev === null) {
      lastPhase.current = current;
      return;
    }

    if (prev !== current && ANNOUNCED_PHASES.has(current)) {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      setToast({
        label: data.phase.label,
        emoji: PHASE_EMOJI[current] ?? '✨',
      });
      timeoutRef.current = setTimeout(() => {
        setToast(null);
      }, TOAST_DURATION_MS);
    }

    lastPhase.current = current;
  }, [data.phase.id, data.phase.label]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, []);

  if (!toast) return null;

  return (
    <div
      style={{
        position: 'fixed',
        top: 24,
        left: '50%',
        transform: 'translateX(-50%)',
        zIndex: 60,
        background: 'rgba(15, 23, 42, 0.92)',
        backdropFilter: 'blur(8px)',
        border: '1px solid rgba(125, 211, 252, 0.5)',
        borderRadius: 8,
        padding: '12px 24px',
        fontFamily:
          '-apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif',
        color: '#F1F5F9',
        boxShadow: '0 8px 24px rgba(0, 0, 0, 0.4)',
        pointerEvents: 'none',
        animation: 'v2-toast-in 300ms ease-out',
        display: 'flex',
        alignItems: 'center',
        gap: 12,
      }}
      aria-live="polite"
      role="status"
    >
      <span style={{ fontSize: 24 }}>{toast.emoji}</span>
      <div>
        <div
          style={{
            fontSize: 10,
            textTransform: 'uppercase',
            letterSpacing: '0.15em',
            color: '#7DD3FC',
            opacity: 0.9,
          }}
        >
          Phase
        </div>
        <div style={{ fontSize: 16, fontWeight: 600 }}>{toast.label}</div>
      </div>
      {/*
        Keyframes injected inline to avoid touching global stylesheets.
        styled-jsx via <style jsx> would be cleaner but requires the
        styled-jsx pragma; this works in any client component.
      */}
      <style>{`
        @keyframes v2-toast-in {
          from { opacity: 0; transform: translate(-50%, -8px); }
          to { opacity: 1; transform: translate(-50%, 0); }
        }
      `}</style>
    </div>
  );
}
