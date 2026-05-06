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

import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';
import {
  DEFAULT_PHASE_COLORS,
  OBS_BROWSER_SOURCE_SIZES,
  type CardPosition,
  type OverlayLayout,
  type FlightPhaseId,
  type PhaseColor,
  type PhaseColorMap,
} from '@/lib/overlay-types';

import {
  updateOverlayLayout,
  updateOverlayCardPosition,
  updateOverlayPhaseColors,
  resetOverlayPhaseColors,
  updateOverlayBranding,
  resetOverlayBranding,
  type OverlayBranding,
} from './overlay-actions';

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
    <Card className="gap-0 p-6">
      <div className="mb-4 flex items-baseline justify-between">
        <h2 className="m-0 text-lg font-semibold">OBS-Overlay Anpassung</h2>
        <SaveStatusBadge status={saveStatus} pending={isPending} />
      </div>
      <p className="mb-6 mt-0 text-sm text-muted-foreground">
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
                  className={cn(
                    'flex items-center gap-2 rounded p-2 transition-colors',
                    isPreviewing ? 'bg-muted/50' : 'bg-transparent',
                  )}
                >
                  {/* Phase-pill — uses user-configured colors, stays inline */}
                  <span
                    style={{
                      background: color.bg,
                      color: color.fg,
                    }}
                    className="min-w-[40px] rounded px-2 py-0.5 text-center font-mono text-[11px] font-bold tracking-[0.05em]"
                  >
                    {meta.shortLabel}
                  </span>
                  <span className="flex-1 text-sm text-foreground">
                    {meta.label}
                  </span>
                  <ColorInput label="BG" value={color.bg} onChange={(v) => updatePhaseBg(phase, v)} />
                  <ColorInput label="FG" value={color.fg} onChange={(v) => updatePhaseFg(phase, v)} />
                </div>
              );
            })}

            <div className="mt-2 flex gap-2">
              <Button
                type="button"
                onClick={handleSaveColors}
                disabled={isPending}
                className="flex-1 bg-indigo-600 text-white hover:bg-indigo-700 dark:bg-indigo-600 dark:hover:bg-indigo-700"
              >
                Farben speichern
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={handleResetColors}
                disabled={isPending}
              >
                Reset
              </Button>
            </div>
          </div>

          {/* Rechte Spalte: Live Preview */}
          <div className="flex flex-col">
            <div className="mb-2 text-xs uppercase tracking-[0.05em] text-muted-foreground">
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
        <p className="mb-3 mt-0 text-xs text-muted-foreground">
          Eigenes Logo + Farben für deinen Stream. Logo wird oben-links im
          Overlay angezeigt, Primary färbt den Akzent-Rahmen, Accent färbt
          die Phase-Pills wenn keine Phase-spezifische Farbe gesetzt ist.
        </p>

        <div className="grid grid-cols-1 items-end gap-3 sm:grid-cols-[1fr_auto_auto]">
          {/* Logo URL */}
          <div className="flex flex-col gap-1">
            <Label
              htmlFor="branding-logo-url"
              className="text-[0.7rem] uppercase tracking-[0.05em] text-muted-foreground"
            >
              Logo-URL
            </Label>
            <Input
              id="branding-logo-url"
              type="url"
              value={logoUrl}
              onChange={(e) => setLogoUrl(e.target.value)}
              placeholder="https://example.com/logo.png"
              maxLength={500}
            />
          </div>

          {/* Primary Color */}
          <div className="flex flex-col gap-1">
            <Label
              htmlFor="branding-primary-color"
              className="text-[0.7rem] uppercase tracking-[0.05em] text-muted-foreground"
            >
              Primary
            </Label>
            <input
              id="branding-primary-color"
              type="color"
              value={primaryColor}
              onChange={(e) => setPrimaryColor(e.target.value)}
              className="h-9 w-12 cursor-pointer rounded border border-input bg-transparent p-0"
            />
          </div>

          {/* Accent Color */}
          <div className="flex flex-col gap-1">
            <Label
              htmlFor="branding-accent-color"
              className="text-[0.7rem] uppercase tracking-[0.05em] text-muted-foreground"
            >
              Accent
            </Label>
            <input
              id="branding-accent-color"
              type="color"
              value={accentColor}
              onChange={(e) => setAccentColor(e.target.value)}
              className="h-9 w-12 cursor-pointer rounded border border-input bg-transparent p-0"
            />
          </div>
        </div>

        {/* Logo Preview when set */}
        {logoUrl && (
          <div className="mt-3 flex items-center gap-3">
            <span className="text-[0.7rem] uppercase tracking-[0.05em] text-muted-foreground">
              Vorschau
            </span>
            <div
              className="flex items-center gap-2 rounded border-l-2 bg-gray-900 px-2 py-1"
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
                className="font-mono text-xs font-bold"
                style={{ color: accentColor }}
              >
                DLH123
              </span>
            </div>
          </div>
        )}

        {/* Error message */}
        {brandingError && (
          <Alert
            variant="destructive"
            className="mt-2 border-red-500/30 bg-red-500/10"
          >
            <AlertDescription className="text-xs text-red-700 dark:text-red-300">
              {brandingError === 'invalid_logo_url' &&
                'Logo-URL ungültig. Muss https://… sein und auf .png/.jpg/.gif/.webp/.svg enden (query-string erlaubt).'}
              {brandingError === 'invalid_primary_color' &&
                'Primary-Farbe muss ein 6-stelliger Hex-Code sein (#RRGGBB).'}
              {brandingError === 'invalid_accent_color' &&
                'Accent-Farbe muss ein 6-stelliger Hex-Code sein (#RRGGBB).'}
              {!['invalid_logo_url', 'invalid_primary_color', 'invalid_accent_color'].includes(
                brandingError,
              ) && `Fehler: ${brandingError}`}
            </AlertDescription>
          </Alert>
        )}

        <div className="mt-4 flex gap-2">
          <Button
            type="button"
            onClick={handleSaveBranding}
            disabled={isPending}
            className="bg-indigo-600 text-white hover:bg-indigo-700 dark:bg-indigo-600 dark:hover:bg-indigo-700"
          >
            Branding speichern
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={handleResetBranding}
            disabled={isPending}
          >
            Reset
          </Button>
        </div>
      </Section>

      {/* Setup-Anleitung */}
      <SetupGuide layout={layout} cardPosition={cardPosition} overlayUrl={overlayUrl} />
    </Card>
  );
}

// ────────────────────────────────────────────────────────────
// Sub-Components — admin UI, theme-aware
// ────────────────────────────────────────────────────────────

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mb-6">
      <h3 className="mb-3 mt-0 text-xs uppercase tracking-[0.05em] text-muted-foreground">
        {title}
      </h3>
      {children}
    </div>
  );
}

function LayoutOption({
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
      type="button"
      onClick={onSelect}
      className={cn(
        'flex-1 cursor-pointer rounded-md border px-4 py-3 text-left transition-all',
        selected
          ? 'border-indigo-500 bg-indigo-500/15'
          : 'border-input bg-muted/50 hover:bg-muted',
      )}
    >
      <div
        className={cn(
          'text-sm font-semibold',
          selected
            ? 'text-indigo-700 dark:text-indigo-300'
            : 'text-foreground',
        )}
      >
        {label}
      </div>
      <div className="mt-0.5 text-xs text-muted-foreground">
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
      type="button"
      onClick={onSelect}
      className={cn(
        'flex cursor-pointer items-center gap-2 rounded-md border px-3 py-2.5 transition-all',
        selected
          ? 'border-indigo-500 bg-indigo-500/15'
          : 'border-input bg-muted/50 hover:bg-muted',
      )}
    >
      {/* Mini-Position-Indicator (2×2 Grid) */}
      <div className="grid h-5 w-5 grid-cols-2 grid-rows-2 gap-[2px]">
        {positionDot.map((dot, i) => (
          <span
            key={i}
            className={cn(
              'text-center text-[10px] leading-[8px]',
              dot === '●'
                ? 'text-indigo-700 dark:text-indigo-300'
                : 'text-muted-foreground/60',
            )}
          >
            {dot}
          </span>
        ))}
      </div>
      <span
        className={cn(
          'text-[0.8rem] font-medium',
          selected
            ? 'text-indigo-700 dark:text-indigo-300'
            : 'text-foreground',
        )}
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
      <span className="font-mono text-[0.65rem] text-muted-foreground">
        {label}
      </span>
      <input
        type="color"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-6 w-7 cursor-pointer rounded border border-input bg-transparent p-0"
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
      <span className="text-xs italic text-muted-foreground">
        Speichern...
      </span>
    );
  }
  if (status === 'saved') {
    return (
      <span className="text-xs font-semibold text-emerald-700 dark:text-emerald-400">
        ✓ Gespeichert
      </span>
    );
  }
  if (status === 'error') {
    return (
      <span className="text-xs font-semibold text-red-600 dark:text-red-400">
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
      <div className="rounded-lg border border-border bg-muted/50 p-4">
        {/* Schritt-für-Schritt */}
        <ol className="m-0 mb-5 list-decimal pl-5 text-sm leading-[1.7] text-foreground">
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
            <div className="mb-1.5 text-[0.7rem] uppercase tracking-[0.05em] text-muted-foreground">
              URL für aktuelles Layout
            </div>
            <div className="break-all rounded bg-background/60 px-3 py-2.5 font-mono text-xs text-indigo-700 dark:text-indigo-300">
              {fullUrl}
            </div>
            <div className="mt-1 text-[0.7rem] italic text-muted-foreground">
              Diese URL überschreibt das Default-Layout aus den Settings via URL-Parameter.
              Praktisch wenn du verschiedene Browser-Sources mit unterschiedlichen Layouts haben willst.
            </div>
          </div>
        )}

        {/* Browser-Source Größen-Tabelle */}
        <div>
          <div className="mb-1.5 text-[0.7rem] uppercase tracking-[0.05em] text-muted-foreground">
            Browser-Source Größe (an Stream-Auflösung anpassen)
          </div>
          <div className="grid grid-cols-[1fr_auto_auto] gap-x-4 gap-y-1.5 font-mono text-[0.8rem]">
            <div className="font-semibold text-muted-foreground">Stream</div>
            <div className="font-semibold text-muted-foreground">Width</div>
            <div className="font-semibold text-muted-foreground">Height</div>

            {OBS_BROWSER_SOURCE_SIZES.map((size) => (
              <React.Fragment key={size.label}>
                <div className="text-foreground">
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
          <div className="mt-2 text-[0.7rem] italic text-muted-foreground">
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
