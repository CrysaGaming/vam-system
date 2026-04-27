'use client';

/**
 * OverlayPreferences - Settings-UI für Overlay-Anpassung
 *
 * In /settings einbinden (z.B. nach OverlayCard).
 *
 * Features:
 *   - Radio-Buttons: Bar / Card Layout
 *   - Color-Picker pro Phase (8 aktive Phasen)
 *   - Live-Preview rechts daneben
 *   - Reset auf Defaults
 *   - Save via Server-Actions
 */

import { useState, useTransition } from 'react';
import {
  updateOverlayLayout,
  updateOverlayPhaseColors,
  resetOverlayPhaseColors,
} from './overlay-actions';
import {
  DEFAULT_PHASE_COLORS,
  type OverlayLayout,
  type FlightPhaseId,
  type PhaseColor,
  type PhaseColorMap,
} from '@/lib/overlay-types';

const PHASE_LABELS: Record<FlightPhaseId, { label: string; shortLabel: string }> = {
  'preflight':     { label: 'Preflight',      shortLabel: 'PRE' },
  'taxi-out':      { label: 'Taxi Out',       shortLabel: 'TXO' },
  'initial-climb': { label: 'Initial Climb',  shortLabel: 'ICL' },
  'climb':         { label: 'Climb',          shortLabel: 'CLB' },
  'cruise':        { label: 'Cruise',         shortLabel: 'CRZ' },
  'descent':       { label: 'Descent',        shortLabel: 'DES' },
  'approach':      { label: 'Approach',       shortLabel: 'APP' },
  'arrived':       { label: 'Arrived',        shortLabel: 'ARR' },
};

const PHASE_ORDER: FlightPhaseId[] = [
  'preflight',
  'taxi-out',
  'initial-climb',
  'climb',
  'cruise',
  'descent',
  'approach',
  'arrived',
];

export function OverlayPreferences({
  initialLayout,
  initialColors,
  callsign,
}: {
  initialLayout: OverlayLayout;
  initialColors: PhaseColorMap | null;
  /** Optional: aktueller User-Callsign für Preview */
  callsign?: string | null;
}) {
  const [layout, setLayout] = useState<OverlayLayout>(initialLayout);
  // State ist Vollständig (alle 8 Phasen), gemerged mit User-Override
  const [colors, setColors] = useState<Record<FlightPhaseId, PhaseColor>>(() => ({
    ...DEFAULT_PHASE_COLORS,
    ...(initialColors ?? {}),
  }));
  const [previewPhase, setPreviewPhase] = useState<FlightPhaseId>('cruise');
  const [isPending, startTransition] = useTransition();
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saved' | 'error'>('idle');

  function updatePhaseBg(phase: FlightPhaseId, color: string) {
    setColors((prev) => ({
      ...prev,
      [phase]: { ...prev[phase], bg: color },
    }));
  }

  function updatePhaseFg(phase: FlightPhaseId, color: string) {
    setColors((prev) => ({
      ...prev,
      [phase]: { ...prev[phase], fg: color },
    }));
  }

  function handleLayoutChange(newLayout: OverlayLayout) {
    setLayout(newLayout);
    startTransition(async () => {
      const result = await updateOverlayLayout(newLayout);
      setSaveStatus(result.success ? 'saved' : 'error');
      setTimeout(() => setSaveStatus('idle'), 2000);
    });
  }

  function handleSaveColors() {
    startTransition(async () => {
      // Nur die Override-Differenzen zu Defaults speichern
      const overrides: PhaseColorMap = {};
      for (const phase of PHASE_ORDER) {
        const current = colors[phase];
        const def = DEFAULT_PHASE_COLORS[phase];
        if (current.bg !== def.bg || current.fg !== def.fg) {
          overrides[phase] = current;
        }
      }
      const toSave = Object.keys(overrides).length > 0 ? overrides : null;
      const result = await updateOverlayPhaseColors(toSave);
      setSaveStatus(result.success ? 'saved' : 'error');
      setTimeout(() => setSaveStatus('idle'), 2000);
    });
  }

  function handleResetColors() {
    startTransition(async () => {
      setColors({ ...DEFAULT_PHASE_COLORS });
      const result = await resetOverlayPhaseColors();
      setSaveStatus(result.success ? 'saved' : 'error');
      setTimeout(() => setSaveStatus('idle'), 2000);
    });
  }

  return (
    <div
      style={{
        background: 'rgb(17, 24, 39)',
        border: '1px solid rgb(31, 41, 55)',
        borderRadius: '0.5rem',
        padding: '1.5rem',
        color: 'white',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'baseline',
          justifyContent: 'space-between',
          marginBottom: '1rem',
        }}
      >
        <h2 style={{ fontSize: '1.125rem', fontWeight: 600, margin: 0 }}>
          OBS-Overlay Anpassung
        </h2>
        <SaveStatusBadge status={saveStatus} pending={isPending} />
      </div>
      <p
        style={{
          fontSize: '0.875rem',
          color: 'rgb(156, 163, 175)',
          marginBottom: '1.5rem',
          marginTop: 0,
        }}
      >
        Wähle ein Layout und passe die Farben pro Flight-Phase an.
        Änderungen werden live gespeichert.
      </p>

      {/* Layout-Wahl */}
      <Section title="Layout">
        <div style={{ display: 'flex', gap: '0.75rem' }}>
          <LayoutOption
            id="bar"
            label="Live-Bar"
            description="Schmale Leiste oben am Stream"
            selected={layout === 'bar'}
            onSelect={() => handleLayoutChange('bar')}
          />
          <LayoutOption
            id="card"
            label="Card"
            description="Kompakte Box, frei positionierbar"
            selected={layout === 'card'}
            onSelect={() => handleLayoutChange('card')}
          />
        </div>
      </Section>

      {/* Phase-Colors */}
      <Section title="Phasen-Farben">
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: '1fr 1fr',
            gap: '1.5rem',
          }}
        >
          {/* Linke Spalte: Color-Picker pro Phase */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
            {PHASE_ORDER.map((phase) => {
              const meta = PHASE_LABELS[phase];
              const color = colors[phase];
              const isPreviewing = previewPhase === phase;
              return (
                <div
                  key={phase}
                  onMouseEnter={() => setPreviewPhase(phase)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.5rem',
                    padding: '0.5rem',
                    borderRadius: '0.25rem',
                    backgroundColor: isPreviewing
                      ? 'rgba(255, 255, 255, 0.04)'
                      : 'transparent',
                    transition: 'background-color 120ms',
                  }}
                >
                  <span
                    style={{
                      padding: '2px 8px',
                      background: color.bg,
                      color: color.fg,
                      borderRadius: '4px',
                      fontSize: '11px',
                      fontWeight: 700,
                      letterSpacing: '0.05em',
                      fontFamily: 'monospace',
                      minWidth: '40px',
                      textAlign: 'center',
                    }}
                  >
                    {meta.shortLabel}
                  </span>
                  <span
                    style={{
                      flex: 1,
                      fontSize: '0.875rem',
                      color: 'rgb(229, 231, 235)',
                    }}
                  >
                    {meta.label}
                  </span>
                  <ColorInput
                    label="BG"
                    value={color.bg}
                    onChange={(v) => updatePhaseBg(phase, v)}
                  />
                  <ColorInput
                    label="FG"
                    value={color.fg}
                    onChange={(v) => updatePhaseFg(phase, v)}
                  />
                </div>
              );
            })}

            <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.5rem' }}>
              <button
                onClick={handleSaveColors}
                disabled={isPending}
                style={{
                  flex: 1,
                  padding: '0.5rem 1rem',
                  background: 'rgb(99, 102, 241)',
                  color: 'white',
                  border: 'none',
                  borderRadius: '0.375rem',
                  fontSize: '0.875rem',
                  fontWeight: 600,
                  cursor: isPending ? 'wait' : 'pointer',
                  opacity: isPending ? 0.6 : 1,
                }}
              >
                Farben speichern
              </button>
              <button
                onClick={handleResetColors}
                disabled={isPending}
                style={{
                  padding: '0.5rem 1rem',
                  background: 'transparent',
                  color: 'rgb(156, 163, 175)',
                  border: '1px solid rgb(75, 85, 99)',
                  borderRadius: '0.375rem',
                  fontSize: '0.875rem',
                  fontWeight: 500,
                  cursor: isPending ? 'wait' : 'pointer',
                  opacity: isPending ? 0.6 : 1,
                }}
              >
                Reset
              </button>
            </div>
          </div>

          {/* Rechte Spalte: Live Preview */}
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            <div
              style={{
                fontSize: '0.75rem',
                textTransform: 'uppercase',
                letterSpacing: '0.05em',
                color: 'rgb(107, 114, 128)',
                marginBottom: '0.5rem',
              }}
            >
              Preview ({PHASE_LABELS[previewPhase].label})
            </div>
            <PreviewPanel
              layout={layout}
              phase={previewPhase}
              phaseColors={colors}
              callsign={callsign ?? 'DLH123'}
            />
          </div>
        </div>
      </Section>
    </div>
  );
}

// ────────────────────────────────────────────────────────────
// Sub-Components
// ────────────────────────────────────────────────────────────

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: '1.5rem' }}>
      <h3
        style={{
          fontSize: '0.75rem',
          textTransform: 'uppercase',
          letterSpacing: '0.05em',
          color: 'rgb(107, 114, 128)',
          marginBottom: '0.75rem',
          marginTop: 0,
        }}
      >
        {title}
      </h3>
      {children}
    </div>
  );
}

function LayoutOption({
  id,
  label,
  description,
  selected,
  onSelect,
}: {
  id: string;
  label: string;
  description: string;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      onClick={onSelect}
      style={{
        flex: 1,
        padding: '0.75rem 1rem',
        background: selected ? 'rgba(99, 102, 241, 0.15)' : 'rgb(31, 41, 55)',
        border: `1px solid ${selected ? 'rgb(99, 102, 241)' : 'rgb(55, 65, 81)'}`,
        borderRadius: '0.375rem',
        cursor: 'pointer',
        textAlign: 'left',
        transition: 'all 120ms',
      }}
    >
      <div
        style={{
          fontSize: '0.875rem',
          fontWeight: 600,
          color: selected ? 'rgb(165, 180, 252)' : 'white',
        }}
      >
        {label}
      </div>
      <div
        style={{
          fontSize: '0.75rem',
          color: 'rgb(156, 163, 175)',
          marginTop: '0.125rem',
        }}
      >
        {description}
      </div>
    </button>
  );
}

function ColorInput({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
      <span
        style={{
          fontSize: '0.65rem',
          color: 'rgb(107, 114, 128)',
          fontFamily: 'monospace',
        }}
      >
        {label}
      </span>
      <input
        type="color"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        style={{
          width: '28px',
          height: '24px',
          border: '1px solid rgb(55, 65, 81)',
          borderRadius: '0.25rem',
          cursor: 'pointer',
          padding: 0,
          background: 'transparent',
        }}
      />
    </div>
  );
}

function SaveStatusBadge({
  status,
  pending,
}: {
  status: 'idle' | 'saved' | 'error';
  pending: boolean;
}) {
  if (pending) {
    return (
      <span
        style={{
          fontSize: '0.75rem',
          color: 'rgb(156, 163, 175)',
          fontStyle: 'italic',
        }}
      >
        Speichern...
      </span>
    );
  }
  if (status === 'saved') {
    return (
      <span
        style={{
          fontSize: '0.75rem',
          color: '#34D399',
          fontWeight: 600,
        }}
      >
        ✓ Gespeichert
      </span>
    );
  }
  if (status === 'error') {
    return (
      <span
        style={{
          fontSize: '0.75rem',
          color: '#EF4444',
          fontWeight: 600,
        }}
      >
        ✗ Fehler
      </span>
    );
  }
  return null;
}

// ────────────────────────────────────────────────────────────
// Preview Panel
// ────────────────────────────────────────────────────────────

function PreviewPanel({
  layout,
  phase,
  phaseColors,
  callsign,
}: {
  layout: OverlayLayout;
  phase: FlightPhaseId;
  phaseColors: Record<FlightPhaseId, PhaseColor>;
  callsign: string;
}) {
  const phaseColor = phaseColors[phase];
  const meta = PHASE_LABELS[phase];

  // Mock-Daten für Preview
  const mockData = {
    callsign,
    departure: 'EDDF',
    arrival: 'LOWW',
    aircraft: 'A320',
    altitude: 'FL370',
    speed: 450,
    eta: '38m',
    duration: '1h 24m',
  };

  return (
    <div
      style={{
        flex: 1,
        background:
          'linear-gradient(135deg, rgb(17, 24, 39) 0%, rgb(30, 41, 59) 100%)',
        border: '1px solid rgb(55, 65, 81)',
        borderRadius: '0.375rem',
        padding: '1rem',
        position: 'relative',
        minHeight: '180px',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: layout === 'bar' ? 'flex-start' : 'flex-start',
      }}
    >
      {/* Mockup-Background-Hint */}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: '0.65rem',
          color: 'rgb(75, 85, 99)',
          letterSpacing: '0.1em',
          textTransform: 'uppercase',
        }}
      >
        Stream-Vorschau
      </div>

      {/* Bar Preview */}
      {layout === 'bar' && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            padding: '6px 12px',
            background: 'rgba(15, 25, 41, 0.85)',
            backdropFilter: 'blur(12px)',
            border: '1px solid rgba(255, 255, 255, 0.08)',
            borderRadius: '6px',
            color: '#FFFFFF',
            fontSize: '11px',
            fontWeight: 500,
            position: 'relative',
            zIndex: 1,
            whiteSpace: 'nowrap',
            overflow: 'hidden',
          }}
        >
          <span style={{ fontSize: '11px' }}>✈</span>
          <span style={{ fontWeight: 700, fontFamily: 'monospace', fontSize: '11px' }}>
            {mockData.callsign}
          </span>
          <PreviewDivider />
          <span style={{ fontFamily: 'monospace', fontWeight: 600 }}>
            {mockData.departure} → {mockData.arrival}
          </span>
          <PreviewDivider />
          <span style={{ fontFamily: 'monospace' }}>{mockData.altitude}</span>
          <PreviewDivider />
          <span
            style={{
              padding: '1px 6px',
              background: phaseColor.bg,
              color: phaseColor.fg,
              borderRadius: '3px',
              fontSize: '9px',
              fontWeight: 700,
              fontFamily: 'monospace',
            }}
          >
            {meta.shortLabel}
          </span>
        </div>
      )}

      {/* Card Preview */}
      {layout === 'card' && (
        <div
          style={{
            position: 'absolute',
            top: '12px',
            right: '12px',
            width: '180px',
            background: 'rgba(15, 25, 41, 0.88)',
            border: '1px solid rgba(255, 255, 255, 0.1)',
            borderRadius: '8px',
            color: '#FFFFFF',
            overflow: 'hidden',
            zIndex: 1,
            fontSize: '10px',
          }}
        >
          <div
            style={{
              padding: '8px 10px',
              background: 'rgba(255, 255, 255, 0.04)',
              borderBottom: '1px solid rgba(255, 255, 255, 0.08)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
            }}
          >
            <span style={{ fontWeight: 700, fontFamily: 'monospace', fontSize: '11px' }}>
              {mockData.callsign}
            </span>
            <span
              style={{
                padding: '2px 6px',
                background: phaseColor.bg,
                color: phaseColor.fg,
                borderRadius: '3px',
                fontSize: '9px',
                fontWeight: 700,
                fontFamily: 'monospace',
              }}
            >
              {meta.shortLabel}
            </span>
          </div>
          <div
            style={{
              padding: '8px 10px',
              fontFamily: 'monospace',
              fontSize: '12px',
              fontWeight: 700,
              display: 'flex',
              justifyContent: 'space-between',
            }}
          >
            <span>{mockData.departure}</span>
            <span style={{ opacity: 0.4 }}>→</span>
            <span>{mockData.arrival}</span>
          </div>
        </div>
      )}
    </div>
  );
}

function PreviewDivider() {
  return (
    <span
      style={{
        width: '1px',
        height: '10px',
        background: 'rgba(255, 255, 255, 0.15)',
      }}
    />
  );
}
