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

/**
 * Default-Farben für jede Phase. Verwendet wenn User keine Overrides
 * in seinen Preferences gesetzt hat.
 *
 * Color-System: 8 sichtbar unterschiedliche Farben aus Tailwind-Palette.
 * Cruise = blau (häufigste Phase, neutral)
 * Approach = amber (Aufmerksamkeit erforderlich)
 * Climb/Descent = grün/violett (klare Richtungsindikation)
 */
export const DEFAULT_PHASE_COLORS: Record<FlightPhaseId, PhaseColor> = {
  'preflight':     { bg: '#64748B', fg: '#FFFFFF' },  // slate
  'taxi-out':      { bg: '#94A3B8', fg: '#0F172A' },  // light slate
  'initial-climb': { bg: '#22C55E', fg: '#FFFFFF' },  // green
  'climb':         { bg: '#10B981', fg: '#FFFFFF' },  // emerald
  'cruise':        { bg: '#3B82F6', fg: '#FFFFFF' },  // blue
  'descent':       { bg: '#8B5CF6', fg: '#FFFFFF' },  // violet
  'approach':      { bg: '#F59E0B', fg: '#0F172A' },  // amber
  'arrived':       { bg: '#06B6D4', fg: '#FFFFFF' },  // cyan
  // 'pushback':      { bg: '#A78BFA', fg: '#0F172A' },  // ACARS-pending
  // 'takeoff-roll':  { bg: '#34D399', fg: '#0F172A' },  // ACARS-pending
  // 'landing-roll':  { bg: '#FB923C', fg: '#0F172A' },  // ACARS-pending
  // 'taxi-in':       { bg: '#A1A1AA', fg: '#0F172A' },  // ACARS-pending
};
