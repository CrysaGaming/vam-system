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

type OverlayData =
  | {
      active: true;
      user: {
        callsign: string | null;
        name: string | null;
        rank: string | null;
      };
      network: 'VATSIM' | 'IVAO' | 'Offline';
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

// ────────────────────────────────────────────────────────────
// MAIN COMPONENT
// ────────────────────────────────────────────────────────────

export function OverlayClient({
  token,
  initialLayout,
  cardPosition = 'top-right',
  phaseColorOverride,
}: {
  token: string;
  initialLayout: OverlayLayout;
  /** Position für Card-Layout (default: top-right) */
  cardPosition?: CardPosition;
  /** Optional User-Override für Phase-Colors (sonst Defaults) */
  phaseColorOverride?: PhaseColorMap | null;
}) {
  const [data, setData] = useState<OverlayData | null>(null);
  const [hasError, setHasError] = useState(false);
  const isFetchingRef = useRef(false);

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

  useEffect(() => {
    void fetchData();
    const interval = setInterval(() => void fetchData(), POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [fetchData]);

  if (!data || data.active === false || hasError) {
    return null;
  }

  return initialLayout === 'card' ? (
    <CardLayout data={data} phaseColors={phaseColors} position={cardPosition} />
  ) : (
    <BarLayout data={data} phaseColors={phaseColors} />
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
