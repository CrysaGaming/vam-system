/**
 * Track 5 #1 — Shared PIREP-metric helpers.
 *
 * Bisher lebte computeSmoothnessScore inline in /pireps/[id]/page.tsx.
 * Mit der Comparison-Page (Track 5 #1) brauchen mehrere call-sites
 * den selben score → hierher extrahiert + zusätzliche delta-helpers
 * für side-by-side-vergleiche.
 *
 * # computeSmoothnessScore (extracted)
 *
 * Originally defined in Track 4 #7. Kombiniert touchdown-vsi (50%),
 * stabilization (30%), glideslope (20%) zu einem 0-100 score. Wenn
 * eine component fehlt, werden die weights re-normalisiert.
 *
 * # Delta-helpers (new for #1)
 *
 * computeDelta(a, b, direction) gibt strukturiertes objekt zurück mit
 * numerischer differenz, percent-change und classification für die UI.
 * classification ist direction-aware: bei flight-time + fuel ist
 * NIEDRIGER besser, bei landing-rate ist DICHTER AN ZERO besser,
 * bei smoothness ist HÖHER besser. Caller specifiziert das via
 * MetricDirection.
 */

/**
 * Smoothness-score 0-100 aus approach+landing-components.
 * Returns null wenn keine component verfügbar.
 *
 *   touchdownFpm        weight 0.5  (gear-stress, am stärksten gefühlt)
 *   stabilizationPercent weight 0.3  (FAA stable-approach criteria)
 *   glideslopePercent   weight 0.2  (3°-deviation from ILS)
 *
 * Touchdown-VSI curve: score = max(0, 100 - |fpm|/15).
 * 0 fpm → 100, 200 fpm → 87, 600 fpm → 60, 1500 fpm → 0.
 */
export function computeSmoothnessScore(
  touchdownFpm: number | null | undefined,
  stabilizationPercent: number | null | undefined,
  glideslopePercent: number | null | undefined,
): number | null {
  const components: { score: number; weight: number }[] = [];

  if (touchdownFpm !== null && touchdownFpm !== undefined) {
    const absFpm = Math.abs(touchdownFpm);
    const tdScore = Math.max(0, 100 - absFpm / 15);
    components.push({ score: tdScore, weight: 0.5 });
  }
  if (stabilizationPercent !== null && stabilizationPercent !== undefined) {
    components.push({ score: stabilizationPercent, weight: 0.3 });
  }
  if (glideslopePercent !== null && glideslopePercent !== undefined) {
    components.push({ score: glideslopePercent, weight: 0.2 });
  }

  if (components.length === 0) return null;

  const totalWeight = components.reduce((sum, c) => sum + c.weight, 0);
  const weighted = components.reduce(
    (sum, c) => sum + c.score * (c.weight / totalWeight),
    0,
  );
  return Math.round(weighted);
}

// ─────────────────────────────────────────────────────────────────────────
// Delta-helpers (Track 5 #1 Comparison-Mode)
// ─────────────────────────────────────────────────────────────────────────

/**
 * Direction-of-goodness pro metric. Used by computeDelta zum klassifizieren.
 *
 *   preferLower  — fuel-used, flight-time (effizienz)
 *   preferZero   — touchdown-vsi (smooth landing = nahe 0)
 *   preferHigher — smoothness-score, glideslope%, stabilization%
 *   neutral      — passenger-count, IAS@1000 (kein "besser"-direction)
 */
export type MetricDirection =
  | 'preferLower'
  | 'preferZero'
  | 'preferHigher'
  | 'neutral';

export type DeltaClassification = 'better' | 'worse' | 'neutral' | 'tie';

export type DeltaResult = {
  /** numerische differenz: a - b */
  diff: number;
  /** percent-change: (a - b) / |b| * 100 (null wenn b=0 oder direction=preferZero) */
  percent: number | null;
  /** A relative zu B */
  classification: DeltaClassification;
};

/**
 * Compute delta zwischen zwei werten mit direction-aware classification.
 *
 * Returns null wenn entweder a oder b null/undefined ist — caller rendert
 * dann em-dash oder skipped die delta-anzeige.
 *
 * # TIE-tolerance
 * Bei preferLower/preferHigher: tie nur wenn diff===0.
 * Bei preferZero: tie wenn |a| === |b| (beide gleich smooth bzgl mitte,
 * egal mit welchem vorzeichen).
 *
 * # percent=null wenn
 * b=0 (division-by-zero) oder direction=preferZero (percent macht hier
 * keinen semantischen sinn — "200% mehr smooth" ist absurd).
 */
export function computeDelta(
  a: number | null | undefined,
  b: number | null | undefined,
  direction: MetricDirection,
): DeltaResult | null {
  if (a === null || a === undefined || b === null || b === undefined) {
    return null;
  }

  const diff = a - b;
  const percent =
    b !== 0 && direction !== 'preferZero'
      ? Math.round((diff / Math.abs(b)) * 1000) / 10
      : null;

  let classification: DeltaClassification;
  if (direction === 'neutral') {
    classification = diff === 0 ? 'tie' : 'neutral';
  } else if (direction === 'preferZero') {
    const absA = Math.abs(a);
    const absB = Math.abs(b);
    if (absA === absB) classification = 'tie';
    else if (absA < absB) classification = 'better';
    else classification = 'worse';
  } else if (direction === 'preferLower') {
    if (diff === 0) classification = 'tie';
    else if (diff < 0) classification = 'better';
    else classification = 'worse';
  } else {
    if (diff === 0) classification = 'tie';
    else if (diff > 0) classification = 'better';
    else classification = 'worse';
  }

  return { diff, percent, classification };
}

/**
 * Tailwind-color-classes für eine classification. Subtle damit das
 * ganze nicht wie "competitive trash-talk" wirkt — grün+rot in der
 * mittel-intensität.
 */
export function classificationStyles(c: DeltaClassification): string {
  switch (c) {
    case 'better':
      return 'text-emerald-700 dark:text-emerald-400';
    case 'worse':
      return 'text-red-700 dark:text-red-400';
    case 'tie':
      return 'text-gray-500 dark:text-gray-500';
    case 'neutral':
      return 'text-gray-600 dark:text-gray-400';
  }
}

/**
 * Format a delta-value mit leading +/- sign damit der user direction
 * sofort sieht. Decimals werden auf precision gerundet.
 *
 *   formatDelta(-12, 'min')   → "-12min"
 *   formatDelta(+340, 'fpm')  → "+340fpm"
 *   formatDelta(0, 'min')     → "±0min"
 */
export function formatDelta(
  diff: number,
  unit?: string,
  precision = 0,
): string {
  const sign = diff > 0 ? '+' : diff < 0 ? '' : '±';
  const rounded =
    precision === 0 ? Math.round(diff).toString() : diff.toFixed(precision);
  return unit ? `${sign}${rounded}${unit}` : `${sign}${rounded}`;
}
