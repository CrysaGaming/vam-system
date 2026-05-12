/**
 * Track 5 #1 — Shared PIREP-metric helpers.
 * Track 5 #4 — Auto-Improvement-Suggestions added.
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

export type MetricDirection =
  | 'preferLower'
  | 'preferZero'
  | 'preferHigher'
  | 'neutral';

export type DeltaClassification = 'better' | 'worse' | 'neutral' | 'tie';

export type DeltaResult = {
  diff: number;
  percent: number | null;
  classification: DeltaClassification;
};

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

// ─────────────────────────────────────────────────────────────────────────
// Auto-Improvement-Suggestions (Track 5 #4)
// ─────────────────────────────────────────────────────────────────────────

/**
 * Regelbasierte hints aus ACARS-Metriken. Kein LLM. Severity:
 *  'warning' = klarer Handlungsbedarf (über industrie-threshold)
 *  'info'    = Verbesserungspotenzial
 *
 * Regeln:
 *  Landing >1000 fpm → warning severe
 *  Landing 600-1000  → warning hard
 *  Landing 400-600   → info firm
 *  Glideslope <50%   → warning
 *  Glideslope 50-70% → info
 *  Stabilization <50%  → warning
 *  Stabilization 50-70% → info
 *  Fuel >15% über Schnitt → info
 *  Fuel >10% über Schnitt → info
 *  Blockzeit >10% über Schnitt → info
 *  Smoothness <55  → info
 *  Smoothness <70  → info
 */
export type SuggestionSeverity = 'warning' | 'info';

export type Suggestion = {
  severity: SuggestionSeverity;
  title: string;
  detail?: string;
};

export type SuggestionsInput = {
  landingAnalysis?: { verticalFpmAtTouchdown?: number | null } | null;
  approachAnalysis?: {
    glideslopeQualityPercent?: number | null;
    stabilizationScorePercent?: number | null;
  } | null;
  routeAverages?: {
    avgFuelUsedKg?: number | null;
    avgFlightTimeMin?: number | null;
  } | null;
  pirep?: {
    fuelUsedKg?: number | null;
    flightTimeMin?: number | null;
    landingRateFpm?: number | null;
  } | null;
  smoothnessScore?: number | null;
};

export function computeSuggestions(input: SuggestionsInput): Suggestion[] {
  const out: Suggestion[] = [];

  // Landing rate
  const tdFpm =
    input.landingAnalysis?.verticalFpmAtTouchdown ??
    input.pirep?.landingRateFpm ??
    null;
  if (tdFpm !== null) {
    const abs = Math.abs(tdFpm);
    if (abs > 1000) {
      out.push({ severity: 'warning', title: `Touchdown-Sinkrate sehr hoch (${abs} fpm)`, detail: 'Über 1000 fpm = "severe". Flare deutlich früher beginnen, Gear-Check empfohlen.' });
    } else if (abs > 600) {
      out.push({ severity: 'warning', title: `Harte Landung (${abs} fpm)`, detail: 'Zielbereich: 200–400 fpm. Flare-Timing früher üben.' });
    } else if (abs > 400) {
      out.push({ severity: 'info', title: `Feste Landung (${abs} fpm)`, detail: 'Etwas mehr Back-Pressure kurz über der Schwelle.' });
    }
  }

  // Glideslope
  const gs = input.approachAnalysis?.glideslopeQualityPercent ?? null;
  if (gs !== null) {
    if (gs < 50) {
      out.push({ severity: 'warning', title: `Glideslope nur ${gs.toFixed(0)}% stabil`, detail: 'Häufige 3°-Abweichungen. ILS früher abfangen.' });
    } else if (gs < 70) {
      out.push({ severity: 'info', title: `Glideslope ${gs.toFixed(0)}% — verbesserbar`, detail: 'ILS-Intercept früher einleiten und Pfad gleichmäßiger halten.' });
    }
  }

  // Stabilization
  const stab = input.approachAnalysis?.stabilizationScorePercent ?? null;
  if (stab !== null) {
    if (stab < 50) {
      out.push({ severity: 'warning', title: `Anflug überwiegend nicht stabil (${stab.toFixed(0)}%)`, detail: 'VSI/Bank/Pitch unter 1000ft AGL häufig außerhalb Grenzen. Früher konfigurieren.' });
    } else if (stab < 70) {
      out.push({ severity: 'info', title: `Stabilization ${stab.toFixed(0)}% — verbesserbar`, detail: 'Konsistentere Endanflugkonfiguration beim Final-Turn anstreben.' });
    }
  }

  // Fuel vs. route average
  const ownFuel = input.pirep?.fuelUsedKg ?? null;
  const avgFuel = input.routeAverages?.avgFuelUsedKg ?? null;
  if (ownFuel !== null && avgFuel !== null && avgFuel > 0) {
    const pct = ((ownFuel - avgFuel) / avgFuel) * 100;
    if (pct > 15) {
      out.push({ severity: 'info', title: `Treibstoff ${pct.toFixed(0)}% über Schnitt`, detail: 'Step-Climb-Profil, optimale Reiseflugebene oder Mach-Zahl prüfen.' });
    } else if (pct > 10) {
      out.push({ severity: 'info', title: `Treibstoff leicht erhöht (+${pct.toFixed(0)}% vs. Schnitt)` });
    }
  }

  // Block-time vs. average
  const ownTime = input.pirep?.flightTimeMin ?? null;
  const avgTime = input.routeAverages?.avgFlightTimeMin ?? null;
  if (ownTime !== null && avgTime !== null && avgTime > 0) {
    const pct = ((ownTime - avgTime) / avgTime) * 100;
    if (pct > 10) {
      out.push({ severity: 'info', title: `Blockzeit ${pct.toFixed(0)}% über Schnitt`, detail: 'Mögliche Ursachen: Abflugzeitpunkt, Wind oder suboptimale Reiseflugebene.' });
    }
  }

  // Smoothness
  const score = input.smoothnessScore ?? null;
  if (score !== null) {
    if (score < 55) {
      out.push({ severity: 'info', title: `Smoothness ${score}/100 — gezielt üben`, detail: 'Kombination aus Sinkrate, Glideslope und Stabilization verbessern.' });
    } else if (score < 70) {
      out.push({ severity: 'info', title: `Smoothness ${score}/100 — Luft nach oben`, detail: 'Konsequente Stabilization-Praxis bringt dich in den 70+-Bereich.' });
    }
  }

  return out;
}
