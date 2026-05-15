'use client';

/**
 * OverlayClient - Client Component für /overlay/[token]
 *
 * Verantwortlich für:
 *  - Polling /api/overlay/[token]/data alle 5s
 *  - Layout-Switching (bar vs. card)
 *  - Card-Position (4 Ecken)
 *  - Inactive-State (komplett unsichtbar)
 *  - Phase-aware Coloring (Defaults oder User-Override)
 *  - Smooth Transitions zwischen Updates
 *
 * Types kommen aus @/lib/overlay-types damit Settings-UI sie auch
 * importieren kann (Turbopack mag keine Imports MIT [bracket] im Path).
 */

import { useEffect, useState, useRef, useCallback } from 'react';
import {
  DEFAULT_PHASE_COLORS,
  type CardPosition,
  type FlightPhaseId,
  type OverlayLayout,
  type PhaseColor,
  type PhaseColorMap,
} from '@/lib/overlay-types';
import {
  RouteProgressBar,
  WindComponentBadge,
  PhaseTransitionToast,
  type V2OverlayInput,
} from './_v2-overlays';

// Re-Exports für convenience
export {
  DEFAULT_PHASE_COLORS,
  type CardPosition,
  type FlightPhaseId,
  type OverlayLayout,
  type PhaseColor,
  type PhaseColorMap,
};

// ────────────────────────────────────────────────────────────
// API-RESPONSE TYPE (mirror /api/overlay/[token]/data)
// ────────────────────────────────────────────────────────────

/**
 * ACARS-only telemetry block (Welle 10 commit 10A).
 *
 * VATSIM/IVAO-feeds füllen die felder nicht (network-feeds liefern nur
 * basics) → bei `dataSource !== 'ACARS_CLIENT'` sind alle felder null.
 * Layouts, die telemetry rendern (cockpit, future), müssen null-tolerant
 * sein. Die default-layouts 'bar' und 'card' ignorieren telemetry.
 */
export type OverlayTelemetry = {
  altitudeAglFt: number | null;
  indicatedAirspeed: number | null;
  trueAirspeed: number | null;
  mach: number | null;
  verticalSpeedFpm: number | null;
  pitch: number | null;
  bank: number | null;
  engineN1Avg: number | null;
  engineN2Avg: number | null;
  fuelFlowPph: number | null;
  fuelTotalKg: number | null;
  flapsPercent: number | null;
  gearDown: boolean | null;
  spoilersDeployed: boolean | null;
  parkingBrake: boolean | null;
  autopilotMaster: boolean | null;
  gForce: number | null;
  windSpeedKts: number | null;
  windDirection: number | null;
  oatCelsius: number | null;
  landingRateFpm: number | null;
};

/** Where the telemetry-stream is coming from. Drives the quality-tier
 * badge in cockpit/glass layouts: ACARS_CLIENT = 🟢 1-2s, network-API
 * = 🟡 30s, MANUAL/REPLAY = ⚪ admin-injected. Mirrors LiveSession.dataSource. */
export type OverlayDataSource =
  | 'VATSIM_API'
  | 'IVAO_API'
  | 'ACARS_CLIENT'
  | 'MANUAL'
  | 'REPLAY';

/**
 * Custom-branding for streamer-overlay (Welle 10 commit 10D).
 *
 * Resolved server-side from User.overlayLogoUrl/PrimaryColor/AccentColor
 * in /overlay/[token]/page.tsx. Each field is independent — a user might
 * set just a logo, just colors, or a full brand kit. Layouts that opt
 * into branding pick up `--brand-primary` / `--brand-accent` from the
 * CSS-vars on the wrapper; the logo is rendered as a fixed-position
 * image by `<BrandLogo>` regardless of layout choice.
 *
 * `null` everywhere = pilot has not set up branding yet → default theme.
 */
export type OverlayBranding = {
  logoUrl: string | null;
  primaryColor: string | null;
  accentColor: string | null;
};

/**
 * Track 1 #8 Phase 5 — Wetter-block für eine einzelne station.
 * Mirror der server-side OverlayWeather (apps/web/app/api/overlay/
 * [token]/data/route.ts). Slim selection des bot's METAR-cache;
 * alle felder nullable damit das UI null-tolerant rendern kann.
 */
export type OverlayWeather = {
  icao: string;
  raw: string;
  flightCategory: 'VFR' | 'MVFR' | 'IFR' | 'LIFR' | null;
  wind: {
    direction: number | null;
    speed: number;
    gust: number | null;
  } | null;
  visibility: string | null;
  weather: string[];
  cloudCeilingFt: number | null;
  temperature: number | null;
  dewpoint: number | null;
  qnhHpa: number | null;
  fetchedAt: string;
};

type OverlayData =
  | {
      active: true;
      user: {
        callsign: string | null;
        name: string | null;
        rank: string | null;
      };
      network: 'VATSIM' | 'IVAO' | 'Offline';
      // 9E (committed b599803): wurde im API hinzugefügt aber das client-type
      // nicht synchronisiert. 10A schließt diesen typ-mismatch.
      dataSource: OverlayDataSource;
      aircraft: {
        type: string | null;
        registration: string | null;
      };
      flightPlan: {
        departure: string | null;
        arrival: string | null;
        alternate: string | null;
        cruiseAltitude: number | null;
        flightRules: string | null;
      };
      position: {
        latitude: number;
        longitude: number;
        altitude: number;
        groundSpeed: number;
        heading: number;
        onGround: boolean;
      };
      // 10A: extended telemetry. Object always present, fields nullable.
      telemetry: OverlayTelemetry;
      phase: {
        id: FlightPhaseId;
        label: string;
        shortLabel: string;
      };
      duration: { minutes: number; formatted: string };
      progress: {
        distanceKm: number | null;
        etaMinutes: number | null;
        etaFormatted: string | null;
      };
      // Track 1 #8 Phase 5: METAR für departure + arrival aus dem bot's
      // cache. Beide einträge können null sein — UI rendert die weather-
      // section nur wenn mindestens einer gesetzt ist. Optional auf dem
      // type-level damit ältere server-versionen ohne diesen block
      // backward-compatible bleiben (kein hard-fail beim parsing).
      weather?: {
        departure: OverlayWeather | null;
        arrival: OverlayWeather | null;
      };
      timestamp: string;
    }
  | {
      active: false;
      user: { callsign: string | null; name: string | null; rank: string | null };
      message: string;
    };

// ────────────────────────────────────────────────────────────
// CONSTANTS
// ────────────────────────────────────────────────────────────

const POLL_INTERVAL_MS = 5000;
const FETCH_TIMEOUT_MS = 4500;

/**
 * Track 1 #8 Phase 6: SSE-stream-endpoint. Wir versuchen primary
 * EventSource → polling als fallback. Nach SSE_FAIL_THRESHOLD failed
 * connection-attempts ohne erfolgreiches data-event geben wir SSE auf
 * und fallen auf polling zurück (für die restliche session). Das schützt
 * gegen proxies die SSE-streams blockieren oder buffern (alte corporate
 * firewalls, manche reverse-proxies ohne no-transform).
 *
 * Threshold = 2 mit EventSource's default 3s reconnect-delay = ~6s
 * grace-period bevor wir polling starten. Wenn SSE in den ersten 6s
 * keinen einzigen frame liefert ist es vermutlich permanent kaputt.
 */
const SSE_FAIL_THRESHOLD = 2;

// Welle 10 commit 10C: trail polls slower than data because the trail
// only changes incrementally (one new point per heartbeat). 10s gives
// the streamer a smooth-feeling polyline without burning rate-limit on
// the shared bucket. The trail-fetch and data-fetch are independent
// loops — they don't await each other.
const TRAIL_POLL_INTERVAL_MS = 10000;
const TRAIL_FETCH_TIMEOUT_MS = 8000;

// ────────────────────────────────────────────────────────────
// TRAIL TYPES (mirror /api/overlay/[token]/trail)
// ────────────────────────────────────────────────────────────

type TrailPoint = {
  lat: number;
  lng: number;
  alt: number;
  t: string;
  phase: string | null;
};

type TrailAirport = {
  icao: string;
  lat: number;
  lng: number;
};

type TrailData =
  | {
      active: true;
      sessionId: string;
      points: TrailPoint[];
      departure: TrailAirport | null;
      arrival: TrailAirport | null;
      current: { lat: number; lng: number; heading: number };
    }
  | { active: false };

// ────────────────────────────────────────────────────────────
// MAIN COMPONENT
// ────────────────────────────────────────────────────────────

export function OverlayClient({
  token,
  initialLayout,
  cardPosition = 'top-right',
  phaseColorOverride,
  showTrail = false,
  branding,
  showV2Widgets = false,
}: {
  token: string;
  initialLayout: OverlayLayout;
  /** Position für Card-Layout (default: top-right) */
  cardPosition?: CardPosition;
  /** Optional User-Override für Phase-Colors (sonst Defaults) */
  phaseColorOverride?: PhaseColorMap | null;
  /**
   * Welle 10 commit 10C: mini-map activation. URL-only opt-in via
   * `?map=on` — page.tsx resolves the param and passes the boolean.
   * When true, the client runs an additional 10s poll-loop against
   * `/api/overlay/[token]/trail` and renders a small SVG-polyline map
   * in the bottom-right corner. Independent of the layout-choice.
   */
  showTrail?: boolean;
  /**
   * Welle 10 commit 10D: optional custom-branding (logo + brand colors).
   * Resolved in page.tsx from User.overlay{Logo,Primary,Accent}*.
   * When omitted (legacy callers) we treat as fully-null — same as
   * "no branding configured", default theme everywhere.
   */
  branding?: OverlayBranding;
  /**
   * Welle O / O3: enables v2 overlay widgets (route-progress bar,
   * wind-component badge, phase-transition toast). URL-only opt-in
   * via `?v2=on`. All three widgets render as fixed-position siblings
   * to the chosen layout, layout-agnostic. Default false so existing
   * streamer-overlays are unchanged unless explicitly opted in.
   */
  showV2Widgets?: boolean;
}) {
  const [data, setData] = useState<OverlayData | null>(null);
  const [hasError, setHasError] = useState(false);
  const isFetchingRef = useRef(false);

  // Trail state runs in parallel to data state with its own poll
  // loop. We don't gate the trail-fetch on data being loaded — both
  // routes have the same auth (token in path), and starting both
  // loops simultaneously means the polyline appears as soon as the
  // overlay mounts.
  const [trail, setTrail] = useState<TrailData | null>(null);
  const isFetchingTrailRef = useRef(false);

  const phaseColors: Record<FlightPhaseId, PhaseColor> = {
    ...DEFAULT_PHASE_COLORS,
    ...(phaseColorOverride ?? {}),
  };

  const fetchData = useCallback(async () => {
    if (isFetchingRef.current) return;
    isFetchingRef.current = true;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

    try {
      const res = await fetch(`/api/overlay/${token}/data`, {
        signal: controller.signal,
        cache: 'no-store',
      });

      if (!res.ok) {
        setHasError(true);
        setData(null);
        return;
      }

      const json: OverlayData = await res.json();
      setData(json);
      setHasError(false);
    } catch (err) {
      if ((err as Error).name !== 'AbortError') {
        console.error('Overlay fetch failed:', err);
      }
      setHasError(true);
    } finally {
      clearTimeout(timeout);
      isFetchingRef.current = false;
    }
  }, [token]);

  /**
   * Welle 10 commit 10C: trail-fetch loop. Independent from the data-
   * fetch — separate ref-guard against overlapping requests, separate
   * error handling. We deliberately don't reset trail to null on a
   * single failed fetch; the polyline staying briefly stale is
   * preferable to flickering off and on if a transient network blip
   * happens. If the session goes inactive (active: false), we DO clear
   * — the trail isn't relevant when there's no flight.
   */
  const fetchTrail = useCallback(async () => {
    if (isFetchingTrailRef.current) return;
    isFetchingTrailRef.current = true;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), TRAIL_FETCH_TIMEOUT_MS);

    try {
      const res = await fetch(`/api/overlay/${token}/trail`, {
        signal: controller.signal,
        cache: 'no-store',
      });
      if (!res.ok) {
        // Don't blank the trail on transient errors — keep last good
        // polyline visible. Real auth failures (401) will repeat at
        // every interval and are visible in dev-tools console.
        return;
      }
      const json: TrailData = await res.json();
      setTrail(json);
    } catch (err) {
      if ((err as Error).name !== 'AbortError') {
        console.error('Overlay trail fetch failed:', err);
      }
    } finally {
      clearTimeout(timeout);
      isFetchingTrailRef.current = false;
    }
  }, [token]);

  /**
   * Track 1 #8 Phase 6: SSE-stream als primary-channel mit polling-
   * fallback. Strategy:
   *
   * 1. Auf mount: EventSource gegen /api/overlay/[token]/stream öffnen
   * 2. onmessage: payload parsen → setData (failCount reset)
   * 3. onerror: failCount++, EventSource auto-reconnects (default 3s)
   * 4. Nach SSE_FAIL_THRESHOLD failures: SSE permanent close, polling-
   *    fallback start. Bleibt für rest der session im polling-mode.
   *
   * Cleanup auf unmount schließt beide (EventSource + setInterval).
   */
  useEffect(() => {
    let cancelled = false;
    let eventSource: EventSource | null = null;
    let pollInterval: ReturnType<typeof setInterval> | null = null;
    let failCount = 0;
    let inPollingFallback = false;

    const startPolling = () => {
      if (pollInterval !== null || cancelled) return;
      inPollingFallback = true;
      void fetchData();
      pollInterval = setInterval(() => void fetchData(), POLL_INTERVAL_MS);
    };

    const stopSse = () => {
      if (eventSource) {
        eventSource.close();
        eventSource = null;
      }
    };

    const startSse = () => {
      try {
        eventSource = new EventSource(`/api/overlay/${token}/stream`);
      } catch (err) {
        // EventSource constructor doesn't usually throw, but if the
        // browser doesn't support it (extremely old) we fall straight
        // through to polling.
        console.error('Overlay SSE constructor failed:', err);
        startPolling();
        return;
      }

      eventSource.onmessage = (ev) => {
        if (cancelled) return;
        try {
          const json = JSON.parse(ev.data) as OverlayData;
          setData(json);
          setHasError(false);
          // Successful frame — reset fail-count. Means proxies that
          // intermittently flake won't kick us out of SSE-mode.
          failCount = 0;
        } catch (err) {
          console.error('Overlay SSE parse failed:', err);
        }
      };

      // Server-sent named "error" event (non-recoverable, e.g. DB-fail
      // in the stream loop). EventSource treats this as a regular event
      // and DOESN'T close itself; we close manually and switch to
      // polling so the user keeps seeing data.
      eventSource.addEventListener('error', () => {
        if (cancelled || inPollingFallback) return;
        console.warn('Overlay SSE got server-side error, falling back to polling');
        stopSse();
        startPolling();
      });

      // EventSource's onerror fires both for transient connection-
      // drops (auto-reconnects) and for permanent failures (auth fail,
      // route 404). We only count it as a "fail" if there's no
      // pending reconnect — but EventSource doesn't expose that
      // directly. readyState === CLOSED means it gave up; CONNECTING
      // means it's mid-retry. We tally either way and bail at threshold.
      eventSource.onerror = () => {
        if (cancelled || inPollingFallback) return;
        failCount++;
        if (failCount >= SSE_FAIL_THRESHOLD) {
          console.warn(
            `Overlay SSE failed ${failCount}× — falling back to polling`,
          );
          stopSse();
          startPolling();
        }
        // Otherwise let EventSource auto-reconnect (default 3s).
      };
    };

    startSse();

    return () => {
      cancelled = true;
      stopSse();
      if (pollInterval !== null) {
        clearInterval(pollInterval);
        pollInterval = null;
      }
    };
  }, [token, fetchData]);

  useEffect(() => {
    if (!showTrail) {
      // showTrail can change (parent re-renders with different prop)
      // — stop polling and clear when disabled. The fetch-ref-guard
      // means an in-flight request will still complete and may set
      // state once, but the next render-pass with showTrail=false
      // won't render <MiniMap/> anyway.
      setTrail(null);
      return;
    }
    void fetchTrail();
    const interval = setInterval(() => void fetchTrail(), TRAIL_POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [fetchTrail, showTrail]);

  if (!data || data.active === false || hasError) {
    return null;
  }

  // Layout-element selected first; mini-map (when enabled + trail
  // available) is appended as a sibling so layouts and the map don't
  // share positioning/z-index decisions.
  const layoutEl = (() => {
    switch (initialLayout) {
      case 'card':
        return (
          <CardLayout data={data} phaseColors={phaseColors} position={cardPosition} />
        );
      case 'cockpit':
        return (
          <CockpitLayout data={data} phaseColors={phaseColors} position={cardPosition} />
        );
      case 'bar':
      default:
        return <BarLayout data={data} phaseColors={phaseColors} />;
    }
  })();

  // Mini-map only when explicitly enabled AND we have trail-data with
  // at least one point. A single point is enough to render the
  // current-position-marker (the polyline gets one segment of length
  // 0, harmless).
  const showMiniMap =
    showTrail &&
    trail !== null &&
    trail.active === true &&
    trail.points.length >= 1;

  return (
    <>
      {/*
        Welle 10 commit 10D: branding-CSS-var injection. Sets
        --brand-primary and --brand-accent on a zero-size root div
        so they cascade to all fixed-position children below. Layouts
        don't currently consume these vars in their inline-styles
        (would require touching every layout-renderer), but the vars
        are present in the cascade for any current/future inline
        `style={{ color: 'var(--brand-primary, #7DD3FC)' }}` patterns
        — providing future layouts a styling-knob without further
        plumbing. Cost is one empty <div>; no perf or layout impact.
      */}
      {(branding?.primaryColor || branding?.accentColor) && (
        <div
          style={
            {
              position: 'fixed',
              width: 0,
              height: 0,
              overflow: 'hidden',
              ...(branding.primaryColor && {
                ['--brand-primary' as string]: branding.primaryColor,
              }),
              ...(branding.accentColor && {
                ['--brand-accent' as string]: branding.accentColor,
              }),
            } as React.CSSProperties
          }
          aria-hidden="true"
        />
      )}
      {layoutEl}
      {showMiniMap && trail.active && (
        <MiniMap trail={trail} layoutPosition={cardPosition} layout={initialLayout} />
      )}
      {branding?.logoUrl && (
        <BrandLogo logoUrl={branding.logoUrl} layoutPosition={cardPosition} layout={initialLayout} />
      )}
      {/*
        Welle O / O3 — v2 widgets, opt-in via ?v2=on. All three pull
        their data from the same poll-loop state above; no separate
        fetch. The route-progress bar tracks its own baseline-ref
        across renders, the wind-badge derives head/cross from
        heading + windDir each frame, the phase-toast watches phase.id
        transitions. We pass a narrowed V2OverlayInput rather than
        the full OverlayData so the widget module stays decoupled
        from this file's internal type-shape.
      */}
      {showV2Widgets && (
        <>
          <RouteProgressBar data={data as V2OverlayInput} />
          <WindComponentBadge data={data as V2OverlayInput} />
          <PhaseTransitionToast data={data as V2OverlayInput} />
        </>
      )}
    </>
  );
}

// ────────────────────────────────────────────────────────────
// LAYOUT 1: LIVE-BAR (oben am Stream)
// ────────────────────────────────────────────────────────────

function BarLayout({
  data,
  phaseColors,
}: {
  data: Extract<OverlayData, { active: true }>;
  phaseColors: Record<FlightPhaseId, PhaseColor>;
}) {
  const phaseColor = phaseColors[data.phase.id] ?? { bg: '#64748B', fg: '#FFFFFF' };
  const flLabel = data.flightPlan.cruiseAltitude
    ? `FL${(data.flightPlan.cruiseAltitude / 100).toFixed(0).padStart(3, '0')}`
    : data.position.altitude > 18000
      ? `FL${(data.position.altitude / 100).toFixed(0).padStart(3, '0')}`
      : `${data.position.altitude.toLocaleString()}ft`;

  return (
    <div
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        display: 'flex',
        justifyContent: 'center',
        padding: '12px 16px',
        pointerEvents: 'none',
        fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '14px',
          padding: '8px 16px',
          background: 'rgba(15, 25, 41, 0.85)',
          backdropFilter: 'blur(12px)',
          WebkitBackdropFilter: 'blur(12px)',
          border: '1px solid rgba(255, 255, 255, 0.08)',
          borderRadius: '8px',
          boxShadow: '0 4px 24px rgba(0, 0, 0, 0.5)',
          color: '#FFFFFF',
          fontSize: '13px',
          fontWeight: 500,
          letterSpacing: '0.02em',
          whiteSpace: 'nowrap',
        }}
      >
        <span style={{ fontSize: '14px', opacity: 0.9 }}>✈</span>
        <span style={{ fontWeight: 700, fontFamily: 'monospace', fontSize: '14px' }}>
          {data.user.callsign}
        </span>

        <Divider />

        {(data.flightPlan.departure || data.flightPlan.arrival) && (
          <>
            <span style={{ fontFamily: 'monospace', fontWeight: 600 }}>
              {data.flightPlan.departure ?? '????'}
              {' → '}
              {data.flightPlan.arrival ?? '????'}
            </span>
            <Divider />
          </>
        )}

        {data.aircraft.type && (
          <>
            <span style={{ opacity: 0.85 }}>{data.aircraft.type}</span>
            <Divider />
          </>
        )}

        <span style={{ fontFamily: 'monospace' }}>{flLabel}</span>

        <Divider />

        <span style={{ fontFamily: 'monospace' }}>
          {data.position.groundSpeed}<span style={{ opacity: 0.6 }}>kt</span>
        </span>

        <Divider />

        <span
          style={{
            padding: '2px 8px',
            background: phaseColor.bg,
            color: phaseColor.fg,
            borderRadius: '4px',
            fontSize: '11px',
            fontWeight: 700,
            letterSpacing: '0.05em',
            fontFamily: 'monospace',
          }}
        >
          {data.phase.shortLabel}
        </span>

        {data.progress.etaFormatted && (
          <>
            <Divider />
            <span style={{ opacity: 0.85 }}>
              ETA <span style={{ fontFamily: 'monospace', fontWeight: 600 }}>{data.progress.etaFormatted}</span>
            </span>
          </>
        )}

        <Divider />
        <span style={{ opacity: 0.7, fontFamily: 'monospace', fontSize: '12px' }}>
          {data.duration.formatted}
        </span>
      </div>
    </div>
  );
}

function Divider() {
  return (
    <span
      style={{
        width: '1px',
        height: '14px',
        background: 'rgba(255, 255, 255, 0.15)',
      }}
    />
  );
}

// ────────────────────────────────────────────────────────────
// LAYOUT 2: CARD-STYLE (kompakte Box, 4-Ecken-Position)
// ────────────────────────────────────────────────────────────

function getCardPositionStyle(position: CardPosition): React.CSSProperties {
  const offset = '20px';
  switch (position) {
    case 'top-left':
      return { top: offset, left: offset };
    case 'top-right':
      return { top: offset, right: offset };
    case 'bottom-left':
      return { bottom: offset, left: offset };
    case 'bottom-right':
      return { bottom: offset, right: offset };
  }
}

function CardLayout({
  data,
  phaseColors,
  position,
}: {
  data: Extract<OverlayData, { active: true }>;
  phaseColors: Record<FlightPhaseId, PhaseColor>;
  position: CardPosition;
}) {
  const phaseColor = phaseColors[data.phase.id] ?? { bg: '#64748B', fg: '#FFFFFF' };
  const positionStyle = getCardPositionStyle(position);

  return (
    <div
      style={{
        position: 'fixed',
        ...positionStyle,
        pointerEvents: 'none',
        fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
      }}
    >
      <div
        style={{
          width: '320px',
          background: 'rgba(15, 25, 41, 0.88)',
          backdropFilter: 'blur(12px)',
          WebkitBackdropFilter: 'blur(12px)',
          border: '1px solid rgba(255, 255, 255, 0.1)',
          borderRadius: '12px',
          boxShadow: '0 8px 32px rgba(0, 0, 0, 0.6)',
          color: '#FFFFFF',
          overflow: 'hidden',
        }}
      >
        {/* Header */}
        <div
          style={{
            padding: '12px 16px',
            background: 'rgba(255, 255, 255, 0.04)',
            borderBottom: '1px solid rgba(255, 255, 255, 0.08)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <span style={{ fontSize: '16px', opacity: 0.9 }}>✈</span>
            <div>
              <div style={{ fontWeight: 700, fontSize: '16px', fontFamily: 'monospace' }}>
                {data.user.callsign}
              </div>
              {data.aircraft.type && (
                <div style={{ fontSize: '11px', opacity: 0.6, marginTop: '1px' }}>
                  {data.aircraft.type}
                  {data.aircraft.registration && ` · ${data.aircraft.registration}`}
                </div>
              )}
            </div>
          </div>
          <span
            style={{
              padding: '4px 10px',
              background: phaseColor.bg,
              color: phaseColor.fg,
              borderRadius: '6px',
              fontSize: '11px',
              fontWeight: 700,
              letterSpacing: '0.05em',
              fontFamily: 'monospace',
            }}
          >
            {data.phase.shortLabel}
          </span>
        </div>

        {/* Route */}
        {(data.flightPlan.departure || data.flightPlan.arrival) && (
          <div
            style={{
              padding: '12px 16px',
              borderBottom: '1px solid rgba(255, 255, 255, 0.06)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              fontFamily: 'monospace',
              fontSize: '18px',
              fontWeight: 700,
            }}
          >
            <span>{data.flightPlan.departure ?? '????'}</span>
            <span style={{ opacity: 0.4, fontSize: '14px' }}>→</span>
            <span>{data.flightPlan.arrival ?? '????'}</span>
          </div>
        )}

        {/* Stats Grid */}
        <div
          style={{
            padding: '12px 16px',
            display: 'grid',
            gridTemplateColumns: '1fr 1fr',
            gap: '10px',
          }}
        >
          <Stat label="Altitude" value={`${data.position.altitude.toLocaleString()}ft`} />
          <Stat label="Speed" value={`${data.position.groundSpeed}kt`} />
          <Stat label="Heading" value={`${String(data.position.heading).padStart(3, '0')}°`} />
          <Stat
            label="Status"
            value={data.position.onGround ? 'On Ground' : 'Airborne'}
            valueColor={data.position.onGround ? '#FBBF24' : '#34D399'}
          />
        </div>

        {/* Progress */}
        {(data.progress.distanceKm !== null || data.progress.etaFormatted) && (
          <div
            style={{
              padding: '10px 16px',
              borderTop: '1px solid rgba(255, 255, 255, 0.06)',
              display: 'flex',
              justifyContent: 'space-between',
              fontSize: '12px',
            }}
          >
            {data.progress.distanceKm !== null && (
              <div>
                <span style={{ opacity: 0.5 }}>DIST </span>
                <span style={{ fontFamily: 'monospace', fontWeight: 600 }}>
                  {data.progress.distanceKm}km
                </span>
              </div>
            )}
            {data.progress.etaFormatted && (
              <div>
                <span style={{ opacity: 0.5 }}>ETA </span>
                <span style={{ fontFamily: 'monospace', fontWeight: 600, color: '#34D399' }}>
                  {data.progress.etaFormatted}
                </span>
              </div>
            )}
            <div>
              <span style={{ opacity: 0.5 }}>FLIGHT </span>
              <span style={{ fontFamily: 'monospace', fontWeight: 600 }}>
                {data.duration.formatted}
              </span>
            </div>
          </div>
        )}

        {/* Weather (Track 1 #8 Phase 5).
            Departure + arrival METAR-badges, eine zeile pro station.
            Section nur wenn mindestens ein METAR verfügbar — section-
            chrome (border-top + padding) wird bei beiden null
            unterdrückt damit kein leerer streifen unter der card sitzt. */}
        {data.weather && (data.weather.departure || data.weather.arrival) && (
          <div
            style={{
              padding: '10px 16px',
              borderTop: '1px solid rgba(255, 255, 255, 0.06)',
              display: 'flex',
              flexDirection: 'column',
              gap: '6px',
            }}
          >
            {data.weather.departure && <WeatherBadge weather={data.weather.departure} />}
            {data.weather.arrival && <WeatherBadge weather={data.weather.arrival} />}
          </div>
        )}
      </div>
    </div>
  );
}

function Stat({
  label,
  value,
  valueColor,
}: {
  label: string;
  value: string;
  valueColor?: string;
}) {
  return (
    <div>
      <div
        style={{
          fontSize: '10px',
          textTransform: 'uppercase',
          letterSpacing: '0.05em',
          opacity: 0.5,
          marginBottom: '2px',
        }}
      >
        {label}
      </div>
      <div
        style={{
          fontFamily: 'monospace',
          fontWeight: 700,
          fontSize: '14px',
          color: valueColor ?? '#FFFFFF',
        }}
      >
        {value}
      </div>
    </div>
  );
}

// ────────────────────────────────────────────────────────────
// LAYOUT 3: COCKPIT (MFD-style telemetry-rich panel — Welle 10 commit 10B)
// ────────────────────────────────────────────────────────────

/**
 * Cockpit-layout — rendert ACARS-telemetry in MFD-style. Ist absichtlich
 * dichter und größer als card-layout: ein streamer der ACARS-data hat,
 * möchte die data ZEIGEN. IAS, Mach, VS, Pitch, Bank, AP-state, Flaps,
 * Gear, Spoilers, N1, Fuel, Wind, OAT, AGL — alles inklusive.
 *
 * Design-philosophie:
 *   - Glass-cockpit-PFD-feel: dunkler hintergrund, cyan-accents auf
 *     monospace, klare hierarchie zwischen primary (IAS/ALT/HDG) und
 *     secondary (engines/wind) info.
 *   - Null-tolerant: bei VATSIM/IVAO-feeds (kein ACARS) zeigen wir
 *     "—" für telemetry-felder. Layout-höhe bleibt stabil damit's
 *     im stream nicht jumpt.
 *   - Quality-tier-badge oben: 🟢 ACARS / 🟡 30s feed / ⚪ admin-injected.
 *     Streamer + viewers sehen sofort welche datenquelle.
 *   - Hard-Landing-indicator: rote pulsierende bar oben wenn der
 *     letzte TOUCHDOWN-event landingRate < -800fpm hatte. Bleibt
 *     sichtbar während der gesamten taxi-in-phase bis BLOCK_ON die
 *     session schließt.
 *   - 4-eckig-positionierbar via card-position-prop (geteilt mit
 *     card-layout). Default top-right.
 */
function CockpitLayout({
  data,
  phaseColors,
  position,
}: {
  data: Extract<OverlayData, { active: true }>;
  phaseColors: Record<FlightPhaseId, PhaseColor>;
  position: CardPosition;
}) {
  const phaseColor = phaseColors[data.phase.id] ?? { bg: '#64748B', fg: '#FFFFFF' };
  const positionStyle = getCardPositionStyle(position);
  const t = data.telemetry;

  // Hard-landing detection. Threshold -800fpm matches industry standard
  // (above this, structural inspection typically required). The flag
  // stays visible from TOUCHDOWN until BLOCK_ON closes the session.
  const isHardLanding = t.landingRateFpm !== null && t.landingRateFpm < -800;

  // Altitude-line: prefer FL above FL180 (matches ATC convention).
  const altLine =
    data.position.altitude > 18000
      ? `FL${(data.position.altitude / 100).toFixed(0).padStart(3, '0')}`
      : `${data.position.altitude.toLocaleString()}ft`;

  // Vertical-speed: ↑/↓ arrow + magnitude. Bigger fonts on extreme rates.
  const vsArrow = t.verticalSpeedFpm === null
    ? null
    : t.verticalSpeedFpm > 100
      ? '↑'
      : t.verticalSpeedFpm < -100
        ? '↓'
        : '→';
  const vsAbs = t.verticalSpeedFpm !== null ? Math.abs(t.verticalSpeedFpm) : null;

  // Quality-tier badge content
  const tier = (() => {
    switch (data.dataSource) {
      case 'ACARS_CLIENT':
        return { dot: '#22C55E', label: 'ACARS', sub: '1-2s' };
      case 'VATSIM_API':
      case 'IVAO_API':
        return { dot: '#FBBF24', label: data.network, sub: '30s' };
      case 'MANUAL':
      case 'REPLAY':
        return { dot: '#94A3B8', label: data.dataSource, sub: 'admin' };
    }
  })();

  return (
    <div
      style={{
        position: 'fixed',
        ...positionStyle,
        pointerEvents: 'none',
        fontFamily: '"SF Mono", "Monaco", "Cascadia Code", "Roboto Mono", monospace',
      }}
    >
      <div
        style={{
          width: '380px',
          background: 'rgba(2, 12, 24, 0.92)',
          backdropFilter: 'blur(14px)',
          WebkitBackdropFilter: 'blur(14px)',
          border: '1px solid rgba(0, 200, 220, 0.2)',
          borderRadius: '10px',
          boxShadow: '0 12px 40px rgba(0, 0, 0, 0.7), inset 0 0 0 1px rgba(0,200,220,0.05)',
          color: '#E0F2F4',
          overflow: 'hidden',
        }}
      >
        {/* Hard-Landing-Indicator (oben, sichtbar nur wenn flag) */}
        {isHardLanding && (
          <div
            style={{
              padding: '6px 14px',
              background: 'linear-gradient(90deg, rgba(220,38,38,0.95), rgba(185,28,28,0.95))',
              color: '#FFFFFF',
              fontSize: '11px',
              fontWeight: 800,
              letterSpacing: '0.12em',
              textAlign: 'center',
              animation: 'cockpit-pulse 1.4s ease-in-out infinite',
            }}
          >
            ⚠ HARD LANDING — {t.landingRateFpm} FPM
          </div>
        )}

        {/* Header: callsign + phase + quality-tier */}
        <div
          style={{
            padding: '10px 14px',
            background: 'rgba(0, 200, 220, 0.06)',
            borderBottom: '1px solid rgba(0, 200, 220, 0.15)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '8px',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', minWidth: 0 }}>
            <span
              style={{
                fontWeight: 800,
                fontSize: '15px',
                color: '#7DD3FC',
                letterSpacing: '0.04em',
              }}
            >
              {data.user.callsign}
            </span>
            {data.aircraft.type && (
              <span style={{ fontSize: '11px', opacity: 0.55, whiteSpace: 'nowrap' }}>
                {data.aircraft.type}
                {data.aircraft.registration && ` ${data.aircraft.registration}`}
              </span>
            )}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <span
              title={`${tier.label} (${tier.sub})`}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '4px',
                fontSize: '9px',
                fontWeight: 700,
                letterSpacing: '0.08em',
                opacity: 0.85,
              }}
            >
              <span
                style={{
                  width: '6px',
                  height: '6px',
                  borderRadius: '50%',
                  background: tier.dot,
                  boxShadow: `0 0 6px ${tier.dot}`,
                }}
              />
              {tier.label}
            </span>
            <span
              style={{
                padding: '3px 8px',
                background: phaseColor.bg,
                color: phaseColor.fg,
                borderRadius: '4px',
                fontSize: '10px',
                fontWeight: 700,
                letterSpacing: '0.06em',
              }}
            >
              {data.phase.shortLabel}
            </span>
          </div>
        </div>

        {/* Route + cruise-altitude */}
        {(data.flightPlan.departure || data.flightPlan.arrival) && (
          <div
            style={{
              padding: '8px 14px',
              borderBottom: '1px solid rgba(0, 200, 220, 0.08)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              fontSize: '15px',
              fontWeight: 700,
              color: '#7DD3FC',
            }}
          >
            <span>{data.flightPlan.departure ?? '????'}</span>
            <span style={{ opacity: 0.35, fontSize: '11px' }}>►</span>
            <span>{data.flightPlan.arrival ?? '????'}</span>
            {data.flightPlan.cruiseAltitude && (
              <span
                style={{
                  fontSize: '10px',
                  opacity: 0.65,
                  fontWeight: 500,
                }}
              >
                FL{(data.flightPlan.cruiseAltitude / 100).toFixed(0).padStart(3, '0')}
              </span>
            )}
          </div>
        )}

        {/* Primary flight data: IAS / ALT / HDG (PFD-style row) */}
        <div
          style={{
            padding: '10px 14px',
            display: 'grid',
            gridTemplateColumns: '1fr 1fr 1fr',
            gap: '8px',
            borderBottom: '1px solid rgba(0, 200, 220, 0.08)',
          }}
        >
          <PrimaryReadout
            label="IAS"
            value={t.indicatedAirspeed !== null ? `${t.indicatedAirspeed}` : '—'}
            unit="kt"
            secondary={t.mach !== null && t.mach > 0.3 ? `M ${t.mach.toFixed(2)}` : null}
          />
          <PrimaryReadout
            label="ALT"
            value={altLine}
            unit=""
            secondary={t.altitudeAglFt !== null ? `${t.altitudeAglFt} agl` : null}
          />
          <PrimaryReadout
            label="HDG"
            value={String(data.position.heading).padStart(3, '0')}
            unit="°"
            secondary={null}
          />
        </div>

        {/* Secondary row: VS / GS / TAS */}
        <div
          style={{
            padding: '8px 14px',
            display: 'grid',
            gridTemplateColumns: '1fr 1fr 1fr',
            gap: '8px',
            borderBottom: '1px solid rgba(0, 200, 220, 0.08)',
            fontSize: '11px',
          }}
        >
          <SecondaryReadout
            label="V/S"
            value={
              vsAbs !== null && vsArrow !== null
                ? `${vsArrow} ${vsAbs}`
                : '—'
            }
            unit="fpm"
            valueColor={
              t.verticalSpeedFpm === null
                ? undefined
                : t.verticalSpeedFpm > 0
                  ? '#34D399'
                  : t.verticalSpeedFpm < 0
                    ? '#FBBF24'
                    : '#94A3B8'
            }
          />
          <SecondaryReadout label="GS" value={String(data.position.groundSpeed)} unit="kt" />
          <SecondaryReadout
            label="TAS"
            value={t.trueAirspeed !== null ? String(t.trueAirspeed) : '—'}
            unit="kt"
          />
        </div>

        {/* State-row: AP / FLAPS / GEAR / SPOILERS */}
        <div
          style={{
            padding: '8px 14px',
            display: 'flex',
            justifyContent: 'space-between',
            gap: '4px',
            borderBottom: '1px solid rgba(0, 200, 220, 0.08)',
            fontSize: '10px',
            fontWeight: 600,
          }}
        >
          <StatePill label="AP" on={t.autopilotMaster} />
          <StatePill
            label="FLAPS"
            value={t.flapsPercent !== null ? `${t.flapsPercent}%` : null}
          />
          <StatePill
            label="GEAR"
            on={t.gearDown === true}
            offLabel="UP"
            onLabel="DN"
            forced={t.gearDown !== null}
          />
          <StatePill label="SPLR" on={t.spoilersDeployed} />
          <StatePill label="PB" on={t.parkingBrake} dim />
        </div>

        {/* Engines + Fuel + Wind/OAT row */}
        <div
          style={{
            padding: '8px 14px',
            display: 'grid',
            gridTemplateColumns: '1fr 1fr',
            gap: '6px 12px',
            fontSize: '11px',
            opacity: 0.92,
          }}
        >
          <MetaLine label="N1" value={t.engineN1Avg !== null ? `${t.engineN1Avg.toFixed(0)}%` : '—'} />
          <MetaLine label="FUEL" value={t.fuelTotalKg !== null ? `${t.fuelTotalKg.toLocaleString()} kg` : '—'} />
          <MetaLine
            label="WIND"
            value={
              t.windSpeedKts !== null && t.windDirection !== null
                ? `${String(t.windDirection).padStart(3, '0')}° / ${t.windSpeedKts}kt`
                : '—'
            }
          />
          <MetaLine
            label="OAT"
            value={t.oatCelsius !== null ? `${t.oatCelsius >= 0 ? '+' : ''}${t.oatCelsius}°C` : '—'}
          />
        </div>

        {/* Weather (Track 1 #8 Phase 5).
            METAR-row für departure + arrival. Sitzt zwischen meta-row
            und footer damit der visuelle flow IAS→engines→weather→ETA
            natürlich ist (was der pilot in dieser reihenfolge konsultiert).
            Kein border-top wenn beide null — section verschwindet
            silently statt einen leeren streifen zu hinterlassen. */}
        {data.weather && (data.weather.departure || data.weather.arrival) && (
          <div
            style={{
              padding: '8px 14px',
              borderTop: '1px solid rgba(0, 200, 220, 0.08)',
              display: 'flex',
              flexDirection: 'column',
              gap: '5px',
            }}
          >
            {data.weather.departure && <WeatherBadge weather={data.weather.departure} />}
            {data.weather.arrival && <WeatherBadge weather={data.weather.arrival} />}
          </div>
        )}

        {/* Footer: distance + ETA + flight time */}
        <div
          style={{
            padding: '8px 14px',
            background: 'rgba(0, 200, 220, 0.04)',
            borderTop: '1px solid rgba(0, 200, 220, 0.1)',
            display: 'flex',
            justifyContent: 'space-between',
            fontSize: '11px',
          }}
        >
          {data.progress.distanceKm !== null ? (
            <span>
              <span style={{ opacity: 0.5 }}>DIST </span>
              <span style={{ fontWeight: 700 }}>{data.progress.distanceKm}km</span>
            </span>
          ) : (
            <span style={{ opacity: 0.4 }}>—</span>
          )}
          {data.progress.etaFormatted ? (
            <span>
              <span style={{ opacity: 0.5 }}>ETA </span>
              <span style={{ fontWeight: 700, color: '#34D399' }}>
                {data.progress.etaFormatted}
              </span>
            </span>
          ) : (
            <span style={{ opacity: 0.4 }}>—</span>
          )}
          <span>
            <span style={{ opacity: 0.5 }}>T+ </span>
            <span style={{ fontWeight: 700 }}>{data.duration.formatted}</span>
          </span>
        </div>
      </div>

      {/* Hard-landing pulse-keyframes. Inlined as <style> rather than
          a global stylesheet so the overlay-page stays self-contained
          (it's literally an OBS-source — no external CSS chain). */}
      <style>{`
        @keyframes cockpit-pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.5; }
        }
      `}</style>
    </div>
  );
}

/** Big-font readout for the PFD-style primary row (IAS, ALT, HDG). */
function PrimaryReadout({
  label,
  value,
  unit,
  secondary,
}: {
  label: string;
  value: string;
  unit: string;
  secondary: string | null;
}) {
  return (
    <div>
      <div
        style={{
          fontSize: '9px',
          letterSpacing: '0.1em',
          opacity: 0.55,
          marginBottom: '1px',
        }}
      >
        {label}
      </div>
      <div
        style={{
          fontWeight: 700,
          fontSize: '18px',
          color: '#7DD3FC',
          lineHeight: 1.1,
        }}
      >
        {value}
        {unit && <span style={{ fontSize: '11px', opacity: 0.55, marginLeft: '2px' }}>{unit}</span>}
      </div>
      {secondary && (
        <div style={{ fontSize: '9px', opacity: 0.55, marginTop: '1px', letterSpacing: '0.05em' }}>
          {secondary}
        </div>
      )}
    </div>
  );
}

/** Smaller-font readout for the secondary row (V/S, GS, TAS). */
function SecondaryReadout({
  label,
  value,
  unit,
  valueColor,
}: {
  label: string;
  value: string;
  unit: string;
  valueColor?: string;
}) {
  return (
    <div>
      <div
        style={{
          fontSize: '9px',
          letterSpacing: '0.1em',
          opacity: 0.55,
          marginBottom: '1px',
        }}
      >
        {label}
      </div>
      <div
        style={{
          fontWeight: 700,
          fontSize: '13px',
          color: valueColor ?? '#E0F2F4',
        }}
      >
        {value}
        <span style={{ fontSize: '9px', opacity: 0.5, marginLeft: '2px' }}>{unit}</span>
      </div>
    </div>
  );
}

/**
 * Boolean-state pill (AP, GEAR, SPOILERS, parking brake).
 * `on` semantics:
 *   true  → highlighted (cyan)
 *   false → dimmed (gray)
 *   null  → "—" (telemetry not provided, e.g. VATSIM-feed)
 *
 * `value` overrides the on/off label for things that aren't binary
 * (FLAPS percent). `dim` makes the pill less prominent for less-
 * critical states (parking brake mostly matters at gate).
 */
function StatePill({
  label,
  on,
  value,
  onLabel = 'ON',
  offLabel = 'OFF',
  forced,
  dim,
}: {
  label: string;
  on?: boolean | null;
  value?: string | null;
  onLabel?: string;
  offLabel?: string;
  forced?: boolean;
  dim?: boolean;
}) {
  const isUnknown = value === null || value === undefined
    ? on === null || on === undefined
    : value === null;
  const display = (() => {
    if (value !== undefined && value !== null) return value;
    if (on === null || on === undefined) {
      // For boolean-style pills, only show "—" if the flag isn't
      // forced-relevant. forced=true means we have a real boolean
      // in `on` and should render onLabel/offLabel.
      if (forced) return on ? onLabel : offLabel;
      return '—';
    }
    return on ? onLabel : offLabel;
  })();

  const bgColor =
    isUnknown
      ? 'rgba(148, 163, 184, 0.15)'
      : on
        ? 'rgba(34, 197, 94, 0.2)'
        : dim
          ? 'rgba(148, 163, 184, 0.1)'
          : 'rgba(148, 163, 184, 0.18)';
  const textColor = isUnknown
    ? '#64748B'
    : on
      ? '#34D399'
      : dim
        ? '#64748B'
        : '#94A3B8';

  return (
    <div
      style={{
        flex: 1,
        padding: '4px 6px',
        background: bgColor,
        borderRadius: '4px',
        textAlign: 'center',
        minWidth: 0,
      }}
    >
      <div style={{ fontSize: '8px', opacity: 0.6, letterSpacing: '0.08em' }}>
        {label}
      </div>
      <div
        style={{
          fontSize: '10px',
          fontWeight: 700,
          color: textColor,
          letterSpacing: '0.04em',
          marginTop: '1px',
        }}
      >
        {display}
      </div>
    </div>
  );
}

/** Single-line key:value for the meta-row (N1, fuel, wind, OAT). */
function MetaLine({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: '6px' }}>
      <span style={{ opacity: 0.5, fontSize: '9px', letterSpacing: '0.1em' }}>{label}</span>
      <span style={{ fontWeight: 700 }}>{value}</span>
    </div>
  );
}

// ────────────────────────────────────────────────────────────
// WEATHER (Track 1 #8 Phase 5)
// ────────────────────────────────────────────────────────────

/**
 * flightCategory → color mapping, ICAO definitions:
 *   VFR  ≥ 5sm vis, ceiling ≥ 3000ft AGL  → green
 *   MVFR 3-5sm OR 1000-3000ft ceiling     → blue
 *   IFR  1-3sm OR 500-1000ft ceiling      → red
 *   LIFR < 1sm OR < 500ft ceiling         → magenta
 */
function flightCategoryColor(
  cat: 'VFR' | 'MVFR' | 'IFR' | 'LIFR' | null,
): { bg: string; fg: string } {
  switch (cat) {
    case 'VFR':
      return { bg: 'rgba(34, 197, 94, 0.25)', fg: '#34D399' };
    case 'MVFR':
      return { bg: 'rgba(59, 130, 246, 0.25)', fg: '#60A5FA' };
    case 'IFR':
      return { bg: 'rgba(220, 38, 38, 0.25)', fg: '#F87171' };
    case 'LIFR':
      return { bg: 'rgba(168, 85, 247, 0.3)', fg: '#C084FC' };
    default:
      return { bg: 'rgba(148, 163, 184, 0.18)', fg: '#94A3B8' };
  }
}

/**
 * Track 1 #8 Phase 5 — Compact weather-badge für eine station.
 *
 * Layout: ICAO + flight-category-pill + wind + temp/QNH inline. Eine
 * zeile, monospace, kompakt genug für card/cockpit-layouts. Bei
 * fehlenden decoded-feldern werden die jeweiligen segmente weggelassen
 * (silent), kein "—"-clutter.
 *
 * Bewusst verzichtet auf:
 *   - Cloud-ceiling-display: zu detailliert für eine OBS-überlay-line.
 *     Bei IFR/LIFR siehts man eh am category-color, mehr braucht der
 *     viewer nicht.
 *   - Visibility-zahl: redundant zur category. CAVOK könnte wir zeigen
 *     aber das gibt weniger info als VFR direkt.
 *   - Weather-phenomena als emoji: hatten wir kurz erwogen (☔ für
 *     RA, ⚡ für TS) aber emoji-fonts sind unzuverlässig in OBS-
 *     browser-sources cross-OS. Stattdessen text-codes wenn welche
 *     da sind.
 */
function WeatherBadge({ weather }: { weather: OverlayWeather }) {
  const catColor = flightCategoryColor(weather.flightCategory);
  const windText = weather.wind
    ? weather.wind.direction === null
      ? `VRB ${weather.wind.speed}kt${weather.wind.gust ? `G${weather.wind.gust}` : ''}`
      : `${String(weather.wind.direction).padStart(3, '0')}°/${weather.wind.speed}${weather.wind.gust ? `G${weather.wind.gust}` : ''}kt`
    : null;

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '8px',
        fontSize: '11px',
        fontFamily: 'monospace',
        opacity: 0.92,
        flexWrap: 'wrap',
      }}
    >
      <span style={{ fontWeight: 700, opacity: 0.85 }}>{weather.icao}</span>
      {weather.flightCategory && (
        <span
          style={{
            padding: '1px 6px',
            background: catColor.bg,
            color: catColor.fg,
            borderRadius: '3px',
            fontSize: '9px',
            fontWeight: 800,
            letterSpacing: '0.06em',
          }}
        >
          {weather.flightCategory}
        </span>
      )}
      {windText && <span style={{ opacity: 0.85 }}>{windText}</span>}
      {weather.weather.length > 0 && (
        <span style={{ color: '#FBBF24', fontWeight: 700 }}>
          {weather.weather.join(' ')}
        </span>
      )}
      {weather.temperature !== null && (
        <span style={{ opacity: 0.75 }}>
          {weather.temperature >= 0 ? '+' : ''}
          {weather.temperature}°C
        </span>
      )}
      {weather.qnhHpa !== null && (
        <span style={{ opacity: 0.75 }}>Q{weather.qnhHpa}</span>
      )}
    </div>
  );
}

// ────────────────────────────────────────────────────────────
// MINI-MAP (Welle 10 commit 10C)
// ────────────────────────────────────────────────────────────

/**
 * Lightweight SVG-polyline mini-map for the overlay. Activated via
 * `?map=on` URL-param. Renders:
 *   - A polyline of the trail (last 100 LiveSessionPositions)
 *   - Departure + arrival markers with ICAO-labels (when known)
 *   - Current-position marker (pulsing cyan dot, oriented by heading)
 *
 * Projection: equirectangular (raw lat/lng with cosine-correction for
 * lng-degree-shrink at higher latitudes). For typical short/medium-haul
 * flights the distortion is sub-pixel. Long-haul or polar routes will
 * look stretched but the map's purpose is "show the streamer's general
 * path", not navigation-grade accuracy.
 *
 * Position: bottom-right by default. If the layout puts a card in the
 * bottom-right (CardLayout with position='bottom-right' or CockpitLayout
 * with position='bottom-right'), we shift the map to bottom-left to
 * avoid overlap. The bar-layout sits at the top so doesn't conflict.
 *
 * No external map-tile dependencies (Mapbox/Leaflet) — keeps the public
 * overlay-page free of API-key-leakage and works without internet
 * during a sim-flight (positions render even if mapbox.com is blocked).
 */
function MiniMap({
  trail,
  layoutPosition,
  layout,
}: {
  trail: Extract<TrailData, { active: true }>;
  layoutPosition: CardPosition;
  layout: OverlayLayout;
}) {
  const WIDTH = 240;
  const HEIGHT = 140;
  const PADDING = 12;

  // Collect all coordinates for bbox-calculation: trail points +
  // departure + arrival + current. The dep/arr matter especially when
  // the trail is short (just took off, only a handful of points) —
  // including them ensures the map shows context.
  const allLats: number[] = [];
  const allLngs: number[] = [];
  for (const p of trail.points) {
    allLats.push(p.lat);
    allLngs.push(p.lng);
  }
  if (trail.departure) {
    allLats.push(trail.departure.lat);
    allLngs.push(trail.departure.lng);
  }
  if (trail.arrival) {
    allLats.push(trail.arrival.lat);
    allLngs.push(trail.arrival.lng);
  }
  allLats.push(trail.current.lat);
  allLngs.push(trail.current.lng);

  let minLat = Math.min(...allLats);
  let maxLat = Math.max(...allLats);
  let minLng = Math.min(...allLngs);
  let maxLng = Math.max(...allLngs);

  // Guard against degenerate bbox (single-point flight pre-takeoff):
  // expand by a tiny amount so the projection-divisor isn't zero.
  if (maxLat - minLat < 0.001) {
    minLat -= 0.005;
    maxLat += 0.005;
  }
  if (maxLng - minLng < 0.001) {
    minLng -= 0.005;
    maxLng += 0.005;
  }

  // Apply cosine-of-mid-lat correction to lng-range so the rendered
  // shape isn't stretched horizontally at higher latitudes. Without
  // this, a flight at 60°N would appear roughly 2× wider than it
  // actually is.
  const midLat = (minLat + maxLat) / 2;
  const lngScale = Math.cos((midLat * Math.PI) / 180);
  const lngRange = (maxLng - minLng) * lngScale;
  const latRange = maxLat - minLat;

  // Fit-to-viewport: pick the larger axis-ratio so neither dimension
  // overflows the map-area. Then center the smaller axis with margins.
  const drawW = WIDTH - PADDING * 2;
  const drawH = HEIGHT - PADDING * 2;
  const aspectMap = lngRange / latRange;
  const aspectView = drawW / drawH;

  let scaleX: number;
  let scaleY: number;
  let offsetX: number;
  let offsetY: number;
  if (aspectMap > aspectView) {
    // Map wider than viewport: lng-axis fills, lat-axis centers.
    scaleX = drawW / lngRange;
    scaleY = scaleX;
    offsetX = PADDING;
    offsetY = PADDING + (drawH - latRange * scaleY) / 2;
  } else {
    // Map taller than viewport: lat-axis fills, lng-axis centers.
    scaleY = drawH / latRange;
    scaleX = scaleY;
    offsetX = PADDING + (drawW - lngRange * scaleX) / 2;
    offsetY = PADDING;
  }

  function project(lat: number, lng: number): { x: number; y: number } {
    // x: longitude → linear, scaled. y: latitude → linear, INVERTED
    // (north is up but SVG-y grows downward).
    const x = offsetX + (lng - minLng) * lngScale * scaleX;
    const y = offsetY + (maxLat - lat) * scaleY;
    return { x, y };
  }

  // Build polyline points-attribute. Single string of "x,y x,y x,y …".
  const polylinePoints = trail.points
    .map((p) => {
      const { x, y } = project(p.lat, p.lng);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');

  const dep = trail.departure ? project(trail.departure.lat, trail.departure.lng) : null;
  const arr = trail.arrival ? project(trail.arrival.lat, trail.arrival.lng) : null;
  const cur = project(trail.current.lat, trail.current.lng);

  // Position-resolution: avoid overlap with whatever layout has the
  // bottom-right corner. card and cockpit can sit there; bar always
  // sits at the top so doesn't conflict.
  const conflictsBottomRight =
    (layout === 'card' || layout === 'cockpit') && layoutPosition === 'bottom-right';
  const conflictsBottomLeft =
    (layout === 'card' || layout === 'cockpit') && layoutPosition === 'bottom-left';

  const mapStyle: React.CSSProperties = conflictsBottomRight
    ? { bottom: '20px', left: '20px' }
    : conflictsBottomLeft
      ? { bottom: '20px', right: '20px' }
      : { bottom: '20px', right: '20px' };

  return (
    <div
      style={{
        position: 'fixed',
        ...mapStyle,
        pointerEvents: 'none',
      }}
    >
      <svg
        width={WIDTH}
        height={HEIGHT}
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        style={{
          background: 'rgba(2, 12, 24, 0.78)',
          backdropFilter: 'blur(10px)',
          WebkitBackdropFilter: 'blur(10px)',
          border: '1px solid rgba(125, 211, 252, 0.18)',
          borderRadius: '8px',
          boxShadow: '0 8px 28px rgba(0, 0, 0, 0.6)',
        }}
      >
        {/* Trail polyline. Only render if 2+ points — a 1-point trail
            is just the current-position-marker, no line needed. */}
        {trail.points.length >= 2 && (
          <polyline
            points={polylinePoints}
            fill="none"
            stroke="#7DD3FC"
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
            opacity="0.75"
          />
        )}

        {/* Departure marker — green, square-ish */}
        {dep && (
          <g>
            <rect
              x={dep.x - 3}
              y={dep.y - 3}
              width="6"
              height="6"
              fill="#22C55E"
              stroke="rgba(0, 0, 0, 0.4)"
              strokeWidth="0.5"
              rx="1"
            />
            {trail.departure && (
              <text
                x={dep.x + 6}
                y={dep.y + 3}
                fontSize="8"
                fontFamily="monospace"
                fontWeight="700"
                fill="#22C55E"
              >
                {trail.departure.icao}
              </text>
            )}
          </g>
        )}

        {/* Arrival marker — amber/orange star-ish (just a different
            shape so it's visually distinct from departure). */}
        {arr && (
          <g>
            <circle
              cx={arr.x}
              cy={arr.y}
              r="3.5"
              fill="#F59E0B"
              stroke="rgba(0, 0, 0, 0.4)"
              strokeWidth="0.5"
            />
            {trail.arrival && (
              <text
                x={arr.x + 6}
                y={arr.y + 3}
                fontSize="8"
                fontFamily="monospace"
                fontWeight="700"
                fill="#F59E0B"
              >
                {trail.arrival.icao}
              </text>
            )}
          </g>
        )}

        {/* Current-position marker. Pulsing cyan dot oriented by
            heading. The triangle-rotation gives a "this is the plane,
            facing this way" affordance — viewers parse direction at a
            glance even at this scale. */}
        <g
          transform={`translate(${cur.x}, ${cur.y}) rotate(${trail.current.heading})`}
        >
          {/* Outer pulse-ring */}
          <circle
            cx="0"
            cy="0"
            r="6"
            fill="rgba(125, 211, 252, 0.35)"
            style={{ animation: 'minimap-pulse 2s ease-in-out infinite' }}
          />
          {/* Heading-triangle (points up before rotation = north) */}
          <polygon
            points="0,-5 4,4 0,2 -4,4"
            fill="#7DD3FC"
            stroke="#0F172A"
            strokeWidth="0.6"
          />
        </g>
      </svg>

      {/* Pulse keyframes inlined alongside cockpit-pulse. Both layouts
          can share the page; no namespace collision since the keyframe-
          name is unique to the minimap. */}
      <style>{`
        @keyframes minimap-pulse {
          0%, 100% { opacity: 0.7; r: 6; }
          50% { opacity: 0.3; r: 9; }
        }
      `}</style>
    </div>
  );
}

// ────────────────────────────────────────────────────────────
// BRAND LOGO (Welle 10 commit 10D)
// ────────────────────────────────────────────────────────────

/**
 * Custom-branding logo for the streamer-overlay. Rendered as a fixed-
 * position image positioned in the corner *opposite* to the active
 * card-layout, so it never overlaps with the data-panel.
 *
 * Position-resolution per layout:
 *   - bar-layout:    bar sits top-center; logo defaults to top-left.
 *     If the streamer wants it elsewhere they can crop in OBS.
 *   - card/cockpit:  diagonal-opposite of cardPosition. e.g.
 *     cardPosition='top-right' → logo='bottom-left'. Mini-map (10C)
 *     also picks a corner; logo + map can co-exist if they both end
 *     up in different corners after their own conflict-resolution.
 *
 * Sizing: capped at 80×80px with object-fit:contain. PNGs/JPGs/SVGs
 * with non-square aspect ratios scale to fit. The logo doesn't have
 * background-blur or border — just the raw image. Streamers that want
 * a frame should bake it into their image before upload.
 *
 * Rendered as plain <img>: no Next.js Image component because (a) the
 * URL points to an arbitrary external host that wasn't whitelisted
 * in next.config.js (we'd need next/image domains config), and (b) the
 * overlay is a one-shot render at OBS-source-load time, not a long-
 * lived gallery — Image's optimization story doesn't help here.
 *
 * Failure mode: if logoUrl 404s or has an invalid content-type, the
 * browser shows a broken-image icon. We don't try to detect this
 * client-side because the resulting flicker would be worse than the
 * silent-broken-image. Streamer notices once, fixes the URL, done.
 */
function BrandLogo({
  logoUrl,
  layoutPosition,
  layout,
}: {
  logoUrl: string;
  layoutPosition: CardPosition;
  layout: OverlayLayout;
}) {
  // Diagonal-opposite of cardPosition for card/cockpit. Bar sits at
  // the top, so we default logo to top-left there — top-right is
  // typically clear in a stream layout (chat/face-cam tends to live
  // bottom-right or be in a separate scene-area).
  const logoStyle: React.CSSProperties = (() => {
    if (layout === 'bar') {
      return { top: '20px', left: '20px' };
    }
    switch (layoutPosition) {
      case 'top-right':
        return { bottom: '20px', left: '20px' };
      case 'top-left':
        return { bottom: '20px', right: '20px' };
      case 'bottom-right':
        return { top: '20px', left: '20px' };
      case 'bottom-left':
        return { top: '20px', right: '20px' };
    }
  })();

  return (
    <div
      style={{
        position: 'fixed',
        ...logoStyle,
        pointerEvents: 'none',
        // Subtle drop-shadow so the logo reads against any stream
        // background (light skies, dark cockpits, gameplay scenes).
        // No blur-backdrop or frame — the streamer's logo is the
        // brand, not VAM's overlay-chrome.
        filter: 'drop-shadow(0 4px 12px rgba(0, 0, 0, 0.5))',
      }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={logoUrl}
        alt=""
        style={{
          maxWidth: '80px',
          maxHeight: '80px',
          objectFit: 'contain',
          display: 'block',
        }}
        // referrerpolicy='no-referrer' protects the streamer's overlay-
        // token from leaking into the logo-host's request logs (the
        // referrer header would otherwise carry the full overlay URL,
        // including the token).
        referrerPolicy="no-referrer"
      />
    </div>
  );
}
