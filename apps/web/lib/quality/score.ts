/**
 * Welle I / I2 — Flight-Quality-Score.
 *
 * Pure-function scoring system. Berechnet einen 0-100 quality-score pro
 * approved PIREP basierend auf landing-rate, anti-cheat-flags, und
 * completion-status. KEINE persistence — score wird beim read on-the-fly
 * berechnet aus den existing PIREP-feldern (landingRateFpm, flags, status).
 *
 * # Why no persistence
 *
 * Score-thresholds könnten sich ändern (admin tuning, neue heuristics).
 * Wenn wir den score persisten würden, müssten wir bei jedem
 * algorithmus-update einen migration-backfill machen. On-the-fly-compute
 * ist O(1) pro row und ändert sich automatisch mit der formula.
 *
 * # Score breakdown (0-100 overall)
 *
 *   landing-component   40% weight  — smooth landing = high score
 *   flags-component     35% weight  — clean anti-cheat = high
 *   completion-component 25% weight — approved = full credit
 *
 * # Landing-rate scoring (40%)
 *
 * Real-world feel: -100 bis -300 fpm = greaser/normal touchdown.
 * Stärkere sinks = härtere landung. Positive werte (sehr selten) sind
 * sim-artefakte oder touch-and-go.
 *
 *   |landingRateFpm|  Score
 *   ─────────────────────────
 *   -100 to -300     100  (greaser/normal)
 *   -300 to -500     80   (firm but ok)
 *   -500 to -700     50   (hard)
 *   -700 to -1000    20   (severe)
 *   < -1000          0    (crash)
 *   > 0 or null      50   (neutral, no data)
 *
 * # Flags scoring (35%)
 *
 * Starts at 100, jeder set flag deducts. Pirep.flags ist nullable JSON
 * mit shape { simRate?, pauseSec?, replayFlags?, hardLanding? }.
 *
 *   No flags / NULL       100
 *   simRate > 1.01        -30
 *   pauseSec > 60         -15
 *   replayFlags non-empty -20 per flag (max -40)
 *   hardLanding present   -15 ('severe' deducts -25)
 *
 * # Completion scoring (25%)
 *
 *   Approved   100
 *   Submitted  75   (assume will be approved)
 *   Draft      50   (work-in-progress)
 *   Rejected   0
 *
 * # Pure functions
 *
 * Alle scoring-funktionen sind reine inputs-zu-zahl funktionen ohne
 * side-effects. Testbar als unit-tests ohne DB-setup. Aggregator-helper
 * (getQualityHistory/getQualityAverages) machen die DB-zugriffe und
 * delegieren das scoring an die pure functions.
 */

import { prisma } from '@vam/db';

// ─────────────────────────────────────────────────────────────────────
// Pure scoring functions
// ─────────────────────────────────────────────────────────────────────

/**
 * Score the landing-rate (vertical-speed at touchdown).
 *
 * Returnt 0-100. Smooth landings (between -100 and -300 fpm) bekommen
 * volle credits; extremere werte fallen ab. Null/positive values (sehr
 * selten — touch-and-go oder fehlende daten) bekommen einen neutralen
 * 50er score statt 0 — wir wollen kein hartes "nichts gemessen = crap".
 */
export function scoreLandingRate(fpm: number | null): number {
  if (fpm === null || fpm > 0) return 50;
  const abs = Math.abs(fpm);
  if (abs <= 300) return 100;
  if (abs <= 500) return 80;
  if (abs <= 700) return 50;
  if (abs <= 1000) return 20;
  return 0;
}

/**
 * Anti-cheat flags shape — mirror von `Pirep.flags` JSON.
 *
 * Alle felder optional. Wenn das ganze object null/undefined ist
 * (Pirep.flags === null), war der PIREP clean.
 */
type PirepFlags = {
  simRate?: number;
  pauseSec?: number;
  replayFlags?: string[];
  hardLanding?: { severity?: 'hard' | 'severe'; vsFpm?: number };
};

/**
 * Parse die JSON-flags von Pirep.flags sicher. Returnt null wenn input
 * leer/invalid. Forward-compatible: unbekannte keys werden ignoriert.
 */
export function parsePirepFlags(raw: unknown): PirepFlags | null {
  if (raw === null || raw === undefined) return null;
  if (typeof raw !== 'object' || Array.isArray(raw)) return null;
  const obj = raw as Record<string, unknown>;
  const out: PirepFlags = {};
  if (typeof obj.simRate === 'number') out.simRate = obj.simRate;
  if (typeof obj.pauseSec === 'number') out.pauseSec = obj.pauseSec;
  if (Array.isArray(obj.replayFlags)) {
    out.replayFlags = obj.replayFlags.filter(
      (s): s is string => typeof s === 'string',
    );
  }
  if (obj.hardLanding && typeof obj.hardLanding === 'object') {
    const hl = obj.hardLanding as Record<string, unknown>;
    const sev =
      hl.severity === 'hard' || hl.severity === 'severe'
        ? hl.severity
        : undefined;
    out.hardLanding = {
      severity: sev,
      vsFpm: typeof hl.vsFpm === 'number' ? hl.vsFpm : undefined,
    };
  }
  return Object.keys(out).length === 0 ? null : out;
}

/**
 * Score the anti-cheat flags. Returnt 0-100.
 *
 * Starts at 100 und zieht für jeden detected flag punkte ab. Untere
 * grenze ist 0 (clamping).
 */
export function scoreFlags(flags: PirepFlags | null): number {
  if (!flags) return 100;
  let score = 100;
  if (typeof flags.simRate === 'number' && flags.simRate > 1.01) score -= 30;
  if (typeof flags.pauseSec === 'number' && flags.pauseSec > 60) score -= 15;
  if (flags.replayFlags && flags.replayFlags.length > 0) {
    score -= Math.min(40, flags.replayFlags.length * 20);
  }
  if (flags.hardLanding) {
    score -= flags.hardLanding.severity === 'severe' ? 25 : 15;
  }
  return Math.max(0, score);
}

/**
 * Score the PIREP-status. Approved = full credit, Rejected = 0.
 *
 * Wir mappen den enum aufs raw-status-string-name damit das hier nicht
 * vom Prisma-PirepStatus-enum-import abhängt (vereinfacht testing).
 */
export function scoreCompletion(status: string): number {
  switch (status) {
    case 'Approved':
      return 100;
    case 'Submitted':
      return 75;
    case 'Draft':
      return 50;
    case 'Rejected':
      return 0;
    default:
      return 50;
  }
}

// ─────────────────────────────────────────────────────────────────────
// Composite scoring
// ─────────────────────────────────────────────────────────────────────

/**
 * Combined-score-shape: top-level overall plus per-component breakdown
 * für UI-display (radar/bar-chart).
 */
export type FlightScore = {
  overall: number;
  landing: number;
  flags: number;
  completion: number;
};

/**
 * Compute the overall flight-quality-score from PIREP fields.
 *
 * Weights: landing 40%, flags 35%, completion 25%. Sum = 100, also
 * gibt das overall-result direkt einen 0-100 scale ohne renormalisation.
 *
 * Math.round damit der UI keine 87.34999-werte zeigt.
 */
export function computeFlightScore(input: {
  landingRateFpm: number | null;
  flags: unknown;
  status: string;
}): FlightScore {
  const landing = scoreLandingRate(input.landingRateFpm);
  const flagsScore = scoreFlags(parsePirepFlags(input.flags));
  const completion = scoreCompletion(input.status);
  const overall = Math.round(landing * 0.4 + flagsScore * 0.35 + completion * 0.25);
  return { overall, landing, flags: flagsScore, completion };
}

// ─────────────────────────────────────────────────────────────────────
// Aggregators (DB-side)
// ─────────────────────────────────────────────────────────────────────

export type QualityHistoryEntry = {
  pirepId: string;
  submittedAt: Date;
  departureIcao: string;
  arrivalIcao: string;
  flightNumber: string | null;
  score: FlightScore;
};

/**
 * Listet die letzten N PIREPs eines users mit on-the-fly computed score.
 *
 * Default limit 50. Nur PIREPs mit status != Draft werden geladen
 * (Drafts sind nicht aussagekräftig fürs quality-tracking, der pilot
 * hat sie noch nicht published).
 */
export async function getQualityHistory(
  userId: string,
  limit = 50,
): Promise<QualityHistoryEntry[]> {
  const pireps = await prisma.pirep.findMany({
    where: { userId, status: { not: 'Draft' } },
    orderBy: { submittedAt: 'desc' },
    take: limit,
    select: {
      id: true,
      submittedAt: true,
      status: true,
      landingRateFpm: true,
      flags: true,
      departure: { select: { icao: true } },
      arrival: { select: { icao: true } },
      route: { select: { flightNumber: true } },
    },
  });

  return pireps.map((p) => ({
    pirepId: p.id,
    submittedAt: p.submittedAt,
    departureIcao: p.departure.icao,
    arrivalIcao: p.arrival.icao,
    flightNumber: p.route?.flightNumber ?? null,
    score: computeFlightScore({
      landingRateFpm: p.landingRateFpm,
      flags: p.flags,
      status: p.status,
    }),
  }));
}

export type QualityAverages = {
  totalPireps: number;
  avgOverall: number;
  avgLast5: number;
  avgLast20: number;
  bestScore: number;
  worstScore: number;
  trend: 'up' | 'down' | 'flat'; // last5 vs prev5
};

/**
 * Berechnet aggregate-statistics über ALLE non-Draft PIREPs des users.
 *
 * Trend-flag: vergleicht den durchschnitt der letzten 5 PIREPs mit dem
 * durchschnitt der davor liegenden 5. Differenz > 5 punkte = up/down,
 * sonst flat.
 */
export async function getQualityAverages(
  userId: string,
): Promise<QualityAverages> {
  // Load ALL non-Draft PIREPs sorted desc; aggregat-felder die wir
  // brauchen sind nur status + landingRateFpm + flags (~ 100 bytes
  // per row × 1000 PIREPs = ~100KB, fine to hold in memory).
  const pireps = await prisma.pirep.findMany({
    where: { userId, status: { not: 'Draft' } },
    orderBy: { submittedAt: 'desc' },
    select: {
      status: true,
      landingRateFpm: true,
      flags: true,
    },
  });

  if (pireps.length === 0) {
    return {
      totalPireps: 0,
      avgOverall: 0,
      avgLast5: 0,
      avgLast20: 0,
      bestScore: 0,
      worstScore: 0,
      trend: 'flat',
    };
  }

  const scores = pireps.map((p) =>
    computeFlightScore({
      landingRateFpm: p.landingRateFpm,
      flags: p.flags,
      status: p.status,
    }).overall,
  );

  const avg = (arr: number[]): number =>
    arr.length === 0
      ? 0
      : Math.round(arr.reduce((a, b) => a + b, 0) / arr.length);

  const avgOverall = avg(scores);
  const avgLast5 = avg(scores.slice(0, 5));
  const avgLast20 = avg(scores.slice(0, 20));
  const avgPrev5 = avg(scores.slice(5, 10));
  const bestScore = Math.max(...scores);
  const worstScore = Math.min(...scores);

  // Trend nur wenn wir mindestens 10 PIREPs haben (sonst ist der
  // vergleich vom rauschen dominiert). Sonst flat.
  let trend: QualityAverages['trend'] = 'flat';
  if (pireps.length >= 10) {
    const diff = avgLast5 - avgPrev5;
    if (diff > 5) trend = 'up';
    else if (diff < -5) trend = 'down';
  }

  return {
    totalPireps: pireps.length,
    avgOverall,
    avgLast5,
    avgLast20,
    bestScore,
    worstScore,
    trend,
  };
}

// ─────────────────────────────────────────────────────────────────────
// Score-label helper für UI
// ─────────────────────────────────────────────────────────────────────

/**
 * Mapt einen 0-100 score auf ein human-readable label + CSS-color-class.
 *
 * Konsistente labels über alle UI-surfaces damit "85 = great" überall
 * gleich ist. Color-classes sind tailwind-utility-class-strings die
 * via cn() composed werden — der caller entscheidet bg/text/border.
 */
export function scoreLabel(score: number): {
  label: string;
  color: 'green' | 'lime' | 'yellow' | 'orange' | 'red';
} {
  if (score >= 90) return { label: 'Ausgezeichnet', color: 'green' };
  if (score >= 75) return { label: 'Gut', color: 'lime' };
  if (score >= 60) return { label: 'Ok', color: 'yellow' };
  if (score >= 40) return { label: 'Verbesserbar', color: 'orange' };
  return { label: 'Schlecht', color: 'red' };
}

// Type-export used elsewhere
export type { PirepFlags };
