/**
 * Shared Types für das Overlay-System.
 *
 * Wichtig: liegt in lib/ statt app/overlay/[token]/ damit andere Files
 * (settings/overlay-preferences.tsx, settings/overlay-actions.ts)
 * ohne Bracket-Path importieren können.
 *
 * Hintergrund: Turbopack kann Imports MIT [bracket] im Path
 * (z.B. '../overlay/[token]/overlay-client') nicht zuverlässig auflösen.
 * Lösung: alle Shared-Types liegen unter @/lib/overlay-types.
 *
 * Files in app/overlay/[token]/ können trotzdem aus @/lib importieren —
 * nur der IMPORT-PATH darf keine Brackets haben, das ZIEL kann beliebig sein.
 */

// ────────────────────────────────────────────────────────────
// LAYOUT-TYPES
// ────────────────────────────────────────────────────────────

export type OverlayLayout = 'bar' | 'card';
// Future: 'compact' | 'cockpit' | 'glass' (Phase 5+)

/**
 * Card-Position auf dem Stream-Bild.
 * Nur relevant wenn Layout='card'.
 */
export type CardPosition =
  | 'top-left'
  | 'top-right'
  | 'bottom-left'
  | 'bottom-right';

// ────────────────────────────────────────────────────────────
// FLIGHT-PHASE-TYPES
// ────────────────────────────────────────────────────────────

/**
 * Aktuell aktive Phasen (8 von 12 geplanten).
 *
 * ACARS-pending Phasen (auskommentiert) brauchen zusätzliche Daten:
 *   pushback, takeoff-roll, landing-roll, taxi-in
 *
 * Bei ACARS-Integration:
 *   1. Type-Members einkommentieren
 *   2. DEFAULT_PHASE_COLORS erweitern (siehe unten)
 *   3. Settings-UI PHASE_ORDER + PHASE_LABELS erweitern
 */
export type FlightPhaseId =
  | 'preflight'
  // | 'pushback'
  | 'taxi-out'
  // | 'takeoff-roll'
  | 'initial-climb'
  | 'climb'
  | 'cruise'
  | 'descent'
  | 'approach'
  // | 'landing-roll'
  // | 'taxi-in'
  | 'arrived';

// ────────────────────────────────────────────────────────────
// COLOR-TYPES
// ────────────────────────────────────────────────────────────

export type PhaseColor = {
  bg: string;  // Hex CSS color, e.g. "#3B82F6"
  fg: string;  // Hex CSS color
};

/**
 * User kann pro Phase Override-Colors setzen.
 * Partial = User muss nicht alle 8 Phasen setzen, nur die die er ändern will.
 * Defaults werden für nicht-überschriebene Phasen genutzt.
 */
export type PhaseColorMap = Partial<Record<FlightPhaseId, PhaseColor>>;

// ────────────────────────────────────────────────────────────
// DEFAULT COLORS
// ────────────────────────────────────────────────────────────

export const DEFAULT_PHASE_COLORS: Record<FlightPhaseId, PhaseColor> = {
  'preflight':     { bg: '#64748B', fg: '#FFFFFF' },  // slate
  'taxi-out':      { bg: '#94A3B8', fg: '#0F172A' },  // light slate
  'initial-climb': { bg: '#22C55E', fg: '#FFFFFF' },  // green
  'climb':         { bg: '#10B981', fg: '#FFFFFF' },  // emerald
  'cruise':        { bg: '#3B82F6', fg: '#FFFFFF' },  // blue
  'descent':       { bg: '#8B5CF6', fg: '#FFFFFF' },  // violet
  'approach':      { bg: '#F59E0B', fg: '#0F172A' },  // amber
  'arrived':       { bg: '#06B6D4', fg: '#FFFFFF' },  // cyan
  // ACARS-pending:
  // 'pushback':      { bg: '#A78BFA', fg: '#0F172A' },
  // 'takeoff-roll':  { bg: '#34D399', fg: '#0F172A' },
  // 'landing-roll':  { bg: '#FB923C', fg: '#0F172A' },
  // 'taxi-in':       { bg: '#A1A1AA', fg: '#0F172A' },
};

// ────────────────────────────────────────────────────────────
// OBS BROWSER-SOURCE GRÖSSEN-EMPFEHLUNGEN
// ────────────────────────────────────────────────────────────

/**
 * Empfohlene Browser-Source-Größen in OBS.
 *
 * Background ist transparent — die Bar/Card positioniert sich selbst
 * absolute-positioned innerhalb des Containers. Daher: Browser-Source
 * = Stream-Auflösung machen.
 */
export const OBS_BROWSER_SOURCE_SIZES = [
  { label: '1080p (Full HD)', width: 1920, height: 1080 },
  { label: '1440p (QHD)',     width: 2560, height: 1440 },
  { label: '4K (UHD)',        width: 3840, height: 2160 },
] as const;
