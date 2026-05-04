'use client';

/**
 * OverlayPreferences - Settings-UI für Overlay-Anpassung
 *
 * Sections:
 *   1. Layout-Wahl (Bar/Card)
 *   2. Card-Position (nur sichtbar wenn Layout=Card)
 *   3. Phase-Farben (Color-Picker pro Phase + Live-Preview)
 *   4. Setup-Anleitung (How to use in OBS)
 *
 * Theme-Note: Admin-UI (Sektionen, Buttons, Tabellen) ist theme-aware
 * (light/dark via Tailwind dark: variants). Die PreviewPanel + die
 * Bar/Card overlay-mockups innen drin behalten ABSICHTLICH inline-
 * styles mit hardcoded dunklen farben — sie simulieren das echte OBS-
 * overlay das auf dem livestream erscheint, und das ist immer dunkel
 * unabhängig von der user-app-theme.
 */

import React, { useState, useTransition } from 'react';
import {
  updateOverlayLayout,
  updateOverlayCardPosition,
  updateOverlayPhaseColors,
  resetOverlayPhaseColors,
  updateOverlayBranding,
  resetOverlayBranding,
  type OverlayBranding,
} from './overlay-actions';
import {
  DEFAULT_PHASE_COLORS,
  OBS_BROWSER_SOURCE_SIZES,
  type CardPosition,
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

const CARD_POSITIONS: { id: CardPosition; label: string }[] = [
  { id: 'top-left',     label: 'Oben Links' },
  { id: 'top-right',    label: 'Oben Rechts' },
  { id: 'bottom-left',  label: 'Unten Links' },
  { id: 'bottom-right', label: 'Unten Rechts' },
];

export function OverlayPreferences({
  initialLayout,
  initialCardPosition,
  initialColors,
  initialBranding,
  callsign,
  overlayUrl,
}: {
  initialLayout: OverlayLayout;
  initialCardPosition: CardPosition;
  initialColors: PhaseColorMap | null;
  initialBranding: OverlayBranding;
  callsign?: string | null;
  /** Vollständige Overlay-URL für Setup-Anleitung */
  overlayUrl?: string;
}) {
  const [layout, setLayout] = useState<OverlayLayout>(initialLayout);
  const [cardPosition, setCardPosition] = useState<CardPosition>(initialCardPosition);
  const [colors, setColors] = useState<Record<FlightPhaseId, PhaseColor>>(() => ({
    ...DEFAULT_PHASE_COLORS,
    ...(initialColors ?? {}),
  }));
  const [previewPhase, setPreviewPhase] = useState<FlightPhaseId>('cruise');
  const [isPending, startTransition] = useTransition();
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saved' | 'error'>('idle');

  // Welle 10 commit 10D: Branding state. Initial values mirror the saved
  // user-prefs (or empty strings for null). Empty-string is the "no value"
  // marker on the input layer; we map back to null when sending to the
  // server-action so the column gets cleared cleanly.
  const [logoUrl, setLogoUrl] = useState<string>(initialBranding.logoUrl ?? '');
  const [primaryColor, setPrimaryColor] = useState<string>(
    initialBranding.primaryColor ?? '#00BFFF',
  );
  const [accentColor, setAccentColor] = useState<string>(
    initialBranding.accentColor ?? '#10B981',
  );
  const [brandingError, setBrandingError] = useState<string | null>(null);

  function updatePhaseBg(phase: FlightPhaseId, color: string) {
    setColors((prev) => ({ ...prev, [phase]: { ...prev[phase], bg: color } }));
  }

  function updatePhaseFg(phase: FlightPhaseId, color: string) {
    setColors((prev) => ({ ...prev, [phase]: { ...prev[phase], fg: color } }));
  }

  function handleLayoutChange(newLayout: OverlayLayout) {
    setLayout(newLayout);
    startTransition(async () => {
      const result = await updateOverlayLayout(newLayout);
      setSaveStatus(result.success ? 'saved' : 'error');
      setTimeout(() => setSaveStatus('idle'), 2000);
    });
  }

  function handlePositionChange(newPosition: CardPosition) {
    setCardPosition(newPosition);
    startTransition(async () => {
      const result = await updateOverlayCardPosition(newPosition);
      setSaveStatus(result.success ? 'saved' : 'error');
      setTimeout(() => setSaveStatus('idle'), 2000);
    });
  }

  function handleSaveColors() {
    startTransition(async () => {
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

  function handleSaveBranding() {
    setBrandingError(null);
    startTransition(async () => {
      // Empty-string logo means "clear this field". For colors we always
      // send the value — clearing colors happens via Reset.
      const result = await updateOverlayBranding({
        logoUrl: logoUrl.trim() === '' ? null : logoUrl.trim(),
        primaryColor,
        accentColor,
      });
      if (result.success) {
        setSaveStatus('saved');
      } else {
        setSaveStatus('error');
        setBrandingError(result.error);
      }
      setTimeout(() => setSaveStatus('idle'), 2000);
    });
  }

  function handleResetBranding() {
    setBrandingError(null);
    startTransition(async () => {
      setLogoUrl('');
      setPrimaryColor('#00BFFF');
      setAccentColor('#10B981');
      const result = await resetOverlayBranding();
      setSaveStatus(result.success ? 'saved' : 'error');
      setTimeout(() => setSaveStatus('idle'), 2000);
    });
  }

  return (
    <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-lg p-6">
      <div className="flex items-baseline justify-between mb-4">
        <h2 className="text-lg font-semibold m-0">OBS-Overlay Anpassung</h2>
        <SaveStatusBadge status={saveStatus} pending={isPending} />
      </div>
      <p className="text-sm text-gray-500 dark:text-gray-400 mb-6 mt-0">
        Wähle ein Layout und passe die Farben pro Flight-Phase an.
        Änderungen werden live gespeichert.
      </p>

      {/* Layout-Wahl */}
      <Section title="Layout">
        <div className="flex gap-3">
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
          <LayoutOption
            id="cockpit"
            label="Cockpit"
            description="MFD-style mit ACARS-Telemetrie"
            selected={layout === 'cockpit'}
            onSelect={() => handleLayoutChange('cockpit')}
          />
        </div>
      </Section>

      {/* Position-picker — gilt für card UND cockpit (beide nutzen 4-Ecken) */}
      {(layout === 'card' || layout === 'cockpit') && (
        <Section title={layout === 'cockpit' ? 'Cockpit Position' : 'Card Position'}>
          <div className="grid grid-cols-2 gap-2">
            {CARD_POSITIONS.map((pos) => (
              <PositionOption
                key={pos.id}
                position={pos.id}
                label={pos.label}
                selected={cardPosition === pos.id}
                onSelect={() => handlePositionChange(pos.id)}
              />
            ))}
          </div>
        </Section>
      )}

      {/* Phase-Colors */}
      <Section title="Phasen-Farben">
        <div className="grid grid-cols-2 gap-6">
          {/* Linke Spalte: Color-Picker pro Phase */}
          <div className="flex flex-col gap-2">
            {PHASE_ORDER.map((phase) => {
              const meta = PHASE_LABELS[phase];
              const color = colors[phase];
              const isPreviewing = previewPhase === phase;
              return (
                <div
                  key={phase}
                  onMouseEnter={() => setPreviewPhase(phase)}
                  className={`flex items-center gap-2 p-2 rounded transition-colors ${
                    isPreviewing
                      ? 'bg-gray-100 dark:bg-white/[0.04]'
                      : 'bg-transparent'
                  }`}
                >
                  {/* Phase-pill — uses user-configured colors, stays inline */}
                  <span
                    style={{
                      background: color.bg,
                      color: color.fg,
                    }}
                    className="px-2 py-0.5 rounded text-[11px] font-bold tracking-[0.05em] font-mono min-w-[40px] text-center"
                  >
                    {meta.shortLabel}
                  </span>
                  <span className="flex-1 text-sm text-gray-700 dark:text-gray-200">
                    {meta.label}
                  </span>
                  <ColorInput label="BG" value={color.bg} onChange={(v) => updatePhaseBg(phase, v)} />
                  <ColorInput label="FG" value={color.fg} onChange={(v) => updatePhaseFg(phase, v)} />
                </div>
              );
            })}

            <div className="flex gap-2 mt-2">
              <button
                onClick={handleSaveColors}
                disabled={isPending}
                className="flex-1 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white border-0 rounded-md text-sm font-semibold cursor-pointer disabled:opacity-60 disabled:cursor-wait transition"
              >
                Farben speichern
              </button>
              <button
                onClick={handleResetColors}
                disabled={isPending}
                className="px-4 py-2 bg-transparent text-gray-500 dark:text-gray-400 border border-gray-300 dark:border-gray-600 rounded-md text-sm font-medium cursor-pointer disabled:opacity-60 disabled:cursor-wait transition hover:bg-gray-100 dark:hover:bg-white/[0.04]"
              >
                Reset
              </button>
            </div>
          </div>

          {/* Rechte Spalte: Live Preview */}
          <div className="flex flex-col">
            <div className="text-xs uppercase tracking-[0.05em] text-gray-500 dark:text-gray-500 mb-2">
              Preview ({PHASE_LABELS[previewPhase].label})
            </div>
            <PreviewPanel
              layout={layout}
              cardPosition={cardPosition}
              phase={previewPhase}
              phaseColors={colors}
              callsign={callsign ?? 'DLH123'}
            />
          </div>
        </div>
      </Section>

      {/* Custom Branding (Welle 10 commit 10D) */}
      <Section title="Custom Branding (optional)">
        <p className="text-xs text-gray-500 dark:text-gray-400 mb-3 mt-0">
          Eigenes Logo + Farben für deinen Stream. Logo wird oben-links im
          Overlay angezeigt, Primary färbt den Akzent-Rahmen, Accent färbt
          die Phase-Pills wenn keine Phase-spezifische Farbe gesetzt ist.
        </p>

        <div className="grid grid-cols-1 sm:grid-cols-[1fr_auto_auto] gap-3 items-end">
          {/* Logo URL */}
          <div className="flex flex-col gap-1">
            <label className="text-[0.7rem] uppercase tracking-[0.05em] text-gray-500 dark:text-gray-500">
              Logo-URL
            </label>
            <input
              type="url"
              value={logoUrl}
              onChange={(e) => setLogoUrl(e.target.value)}
              placeholder="https://example.com/logo.png"
              className="px-3 py-2 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-700 rounded-md text-sm text-gray-900 dark:text-white placeholder:text-gray-400 dark:placeholder:text-gray-500 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
              maxLength={500}
            />
          </div>

          {/* Primary Color */}
          <div className="flex flex-col gap-1">
            <label className="text-[0.7rem] uppercase tracking-[0.05em] text-gray-500 dark:text-gray-500">
              Primary
            </label>
            <input
              type="color"
              value={primaryColor}
              onChange={(e) => setPrimaryColor(e.target.value)}
              className="w-12 h-9 border border-gray-300 dark:border-gray-700 rounded cursor-pointer p-0 bg-transparent"
            />
          </div>

          {/* Accent Color */}
          <div className="flex flex-col gap-1">
            <label className="text-[0.7rem] uppercase tracking-[0.05em] text-gray-500 dark:text-gray-500">
              Accent
            </label>
            <input
              type="color"
              value={accentColor}
              onChange={(e) => setAccentColor(e.target.value)}
              className="w-12 h-9 border border-gray-300 dark:border-gray-700 rounded cursor-pointer p-0 bg-transparent"
            />
          </div>
        </div>

        {/* Logo Preview when set */}
        {logoUrl && (
          <div className="mt-3 flex items-center gap-3">
            <span className="text-[0.7rem] uppercase tracking-[0.05em] text-gray-500 dark:text-gray-500">
              Vorschau
            </span>
            <div
              className="px-2 py-1 rounded bg-gray-900 border-l-2 flex items-center gap-2"
              style={{ borderLeftColor: primaryColor }}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={logoUrl}
                alt="Logo preview"
                className="h-6 w-auto max-w-[80px] object-contain"
                onError={(e) => {
                  // Hide broken-image marker so the user sees clear feedback
                  // (the URL is wrong) without a giant placeholder.
                  e.currentTarget.style.display = 'none';
                }}
                onLoad={(e) => {
                  // Restore in case URL was previously broken then fixed.
                  e.currentTarget.style.display = '';
                }}
              />
              <span
                className="text-xs font-mono font-bold"
                style={{ color: accentColor }}
              >
                DLH123
              </span>
            </div>
          </div>
        )}

        {/* Error message */}
        {brandingError && (
          <div className="mt-2 text-xs text-red-600 dark:text-red-400">
            {brandingError === 'invalid_logo_url' &&
              'Logo-URL ungültig. Muss https://… sein und auf .png/.jpg/.gif/.webp/.svg enden (query-string erlaubt).'}
            {brandingError === 'invalid_primary_color' &&
              'Primary-Farbe muss ein 6-stelliger Hex-Code sein (#RRGGBB).'}
            {brandingError === 'invalid_accent_color' &&
              'Accent-Farbe muss ein 6-stelliger Hex-Code sein (#RRGGBB).'}
            {!['invalid_logo_url', 'invalid_primary_color', 'invalid_accent_color'].includes(
              brandingError,
            ) && `Fehler: ${brandingError}`}
          </div>
        )}

        <div className="flex gap-2 mt-4">
          <button
            onClick={handleSaveBranding}
            disabled={isPending}
            className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white border-0 rounded-md text-sm font-semibold cursor-pointer disabled:opacity-60 disabled:cursor-wait transition"
          >
            Branding speichern
          </button>
          <button
            onClick={handleResetBranding}
            disabled={isPending}
            className="px-4 py-2 bg-transparent text-gray-500 dark:text-gray-400 border border-gray-300 dark:border-gray-600 rounded-md text-sm font-medium cursor-pointer disabled:opacity-60 disabled:cursor-wait transition hover:bg-gray-100 dark:hover:bg-white/[0.04]"
          >
            Reset
          </button>
        </div>
      </Section>

      {/* Setup-Anleitung */}
      <SetupGuide layout={layout} cardPosition={cardPosition} overlayUrl={overlayUrl} />
    </div>
  );
}

// ────────────────────────────────────────────────────────────
// Sub-Components — admin UI, theme-aware
// ────────────────────────────────────────────────────────────

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mb-6">
      <h3 className="text-xs uppercase tracking-[0.05em] text-gray-500 dark:text-gray-500 mb-3 mt-0">
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
      className={`flex-1 px-4 py-3 rounded-md cursor-pointer text-left transition-all border ${
        selected
          ? 'bg-indigo-500/15 border-indigo-500'
          : 'bg-gray-50 dark:bg-gray-800 border-gray-300 dark:border-gray-700'
      }`}
    >
      <div
        className={`text-sm font-semibold ${
          selected
            ? 'text-indigo-700 dark:text-indigo-300'
            : 'text-gray-900 dark:text-white'
        }`}
      >
        {label}
      </div>
      <div className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
        {description}
      </div>
    </button>
  );
}

function PositionOption({
  position,
  label,
  selected,
  onSelect,
}: {
  position: CardPosition;
  label: string;
  selected: boolean;
  onSelect: () => void;
}) {
  // ASCII-Visualisierung der Position
  const positionDot = {
    'top-left':     ['●', '·', '·', '·'],
    'top-right':    ['·', '●', '·', '·'],
    'bottom-left':  ['·', '·', '●', '·'],
    'bottom-right': ['·', '·', '·', '●'],
  }[position];

  return (
    <button
      onClick={onSelect}
      className={`px-3 py-2.5 rounded-md cursor-pointer flex items-center gap-2 transition-all border ${
        selected
          ? 'bg-indigo-500/15 border-indigo-500'
          : 'bg-gray-50 dark:bg-gray-800 border-gray-300 dark:border-gray-700'
      }`}
    >
      {/* Mini-Position-Indicator (2×2 Grid) */}
      <div className="grid grid-cols-2 grid-rows-2 gap-[2px] w-5 h-5">
        {positionDot.map((dot, i) => (
          <span
            key={i}
            className={`text-[10px] leading-[8px] text-center ${
              dot === '●'
                ? 'text-indigo-700 dark:text-indigo-300'
                : 'text-gray-400 dark:text-gray-600'
            }`}
          >
            {dot}
          </span>
        ))}
      </div>
      <span
        className={`text-[0.8rem] font-medium ${
          selected
            ? 'text-indigo-700 dark:text-indigo-300'
            : 'text-gray-900 dark:text-white'
        }`}
      >
        {label}
      </span>
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
    <div className="flex items-center gap-1">
      <span className="text-[0.65rem] text-gray-500 dark:text-gray-500 font-mono">
        {label}
      </span>
      <input
        type="color"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-7 h-6 border border-gray-300 dark:border-gray-700 rounded cursor-pointer p-0 bg-transparent"
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
      <span className="text-xs text-gray-500 dark:text-gray-400 italic">
        Speichern...
      </span>
    );
  }
  if (status === 'saved') {
    return (
      <span className="text-xs text-emerald-700 dark:text-emerald-400 font-semibold">
        ✓ Gespeichert
      </span>
    );
  }
  if (status === 'error') {
    return (
      <span className="text-xs text-red-600 dark:text-red-400 font-semibold">
        ✗ Fehler
      </span>
    );
  }
  return null;
}

// ────────────────────────────────────────────────────────────
// Setup Guide — admin UI, theme-aware
// ────────────────────────────────────────────────────────────

function SetupGuide({
  layout,
  cardPosition,
  overlayUrl,
}: {
  layout: OverlayLayout;
  cardPosition: CardPosition;
  overlayUrl?: string;
}) {
  // URL ggf. mit aktuellen Parametern bauen für Custom-URL
  const fullUrl = overlayUrl
    ? layout === 'card' || layout === 'cockpit'
      ? `${overlayUrl}?layout=${layout}&position=${cardPosition}`
      : overlayUrl
    : null;

  return (
    <Section title="OBS Setup-Anleitung">
      <div className="bg-gray-50 dark:bg-black/25 border border-gray-200 dark:border-white/[0.06] rounded-lg p-4">
        {/* Schritt-für-Schritt */}
        <ol className="m-0 mb-5 pl-5 text-sm leading-[1.7] text-gray-700 dark:text-gray-200 list-decimal">
          <li>
            In OBS: <strong>+</strong> unter <strong>Quellen</strong> →{' '}
            <strong>Browser</strong> hinzufügen
          </li>
          <li>
            URL einfügen (siehe oben in der Token-Karte oder die Custom-URL unten)
          </li>
          <li>
            Breite und Höhe auf deine Stream-Auflösung setzen (siehe Tabelle)
          </li>
          <li>
            <strong>Quelle aktualisieren wenn aktiv:</strong> aus (für stabile Performance)
          </li>
          <li>
            <strong>OK</strong>. Beim nächsten Flug erscheint das Overlay automatisch.
          </li>
        </ol>

        {/* Custom-URL für aktuelles Layout */}
        {fullUrl && (
          <div className="mb-5">
            <div className="text-[0.7rem] uppercase tracking-[0.05em] text-gray-500 dark:text-gray-500 mb-1.5">
              URL für aktuelles Layout
            </div>
            <div className="font-mono text-xs bg-gray-100 dark:bg-black/40 px-3 py-2.5 rounded text-indigo-700 dark:text-indigo-300 break-all">
              {fullUrl}
            </div>
            <div className="text-[0.7rem] text-gray-500 dark:text-gray-500 mt-1 italic">
              Diese URL überschreibt das Default-Layout aus den Settings via URL-Parameter.
              Praktisch wenn du verschiedene Browser-Sources mit unterschiedlichen Layouts haben willst.
            </div>
          </div>
        )}

        {/* Browser-Source Größen-Tabelle */}
        <div>
          <div className="text-[0.7rem] uppercase tracking-[0.05em] text-gray-500 dark:text-gray-500 mb-1.5">
            Browser-Source Größe (an Stream-Auflösung anpassen)
          </div>
          <div className="grid grid-cols-[1fr_auto_auto] gap-x-4 gap-y-1.5 text-[0.8rem] font-mono">
            <div className="text-gray-500 dark:text-gray-500 font-semibold">Stream</div>
            <div className="text-gray-500 dark:text-gray-500 font-semibold">Width</div>
            <div className="text-gray-500 dark:text-gray-500 font-semibold">Height</div>

            {OBS_BROWSER_SOURCE_SIZES.map((size) => (
              <React.Fragment key={size.label}>
                <div className="text-gray-700 dark:text-gray-200">
                  {size.label}
                </div>
                <div className="text-indigo-700 dark:text-indigo-300">
                  {size.width}
                </div>
                <div className="text-indigo-700 dark:text-indigo-300">
                  {size.height}
                </div>
              </React.Fragment>
            ))}
          </div>
          <div className="text-[0.7rem] text-gray-500 dark:text-gray-500 mt-2 italic">
            Hintergrund ist transparent. Bar/Card positionieren sich automatisch im Container,
            also Browser-Source = Stream-Auflösung machen.
          </div>
        </div>
      </div>
    </Section>
  );
}

// ────────────────────────────────────────────────────────────
// Preview Panel — simulates the actual OBS overlay rendering on the
// user's livestream. Inline-styles intentionally retained because
// these colors must look the same in light + dark app-theme — the
// preview is a slice of the OBS scene which is dark + transparent
// regardless of where the user is looking at the settings page.
// ────────────────────────────────────────────────────────────

function PreviewPanel({
  layout,
  cardPosition,
  phase,
  phaseColors,
  callsign,
}: {
  layout: OverlayLayout;
  cardPosition: CardPosition;
  phase: FlightPhaseId;
  phaseColors: Record<FlightPhaseId, PhaseColor>;
  callsign: string;
}) {
  const phaseColor = phaseColors[phase];
  const meta = PHASE_LABELS[phase];

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

  // Card-Position-Style für Preview (kleinere Offsets als echtes Overlay)
  const previewPositionStyle = (() => {
    switch (cardPosition) {
      case 'top-left':     return { top: '12px', left: '12px' };
      case 'top-right':    return { top: '12px', right: '12px' };
      case 'bottom-left':  return { bottom: '12px', left: '12px' };
      case 'bottom-right': return { bottom: '12px', right: '12px' };
    }
  })();

  return (
    <div
      style={{
        flex: 1,
        background: 'linear-gradient(135deg, rgb(17, 24, 39) 0%, rgb(30, 41, 59) 100%)',
        border: '1px solid rgb(55, 65, 81)',
        borderRadius: '0.375rem',
        padding: '1rem',
        position: 'relative',
        minHeight: '180px',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
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

      {layout === 'card' && (
        <div
          style={{
            position: 'absolute',
            ...previewPositionStyle,
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
