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
