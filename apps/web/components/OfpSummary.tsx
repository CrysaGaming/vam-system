import type { ReactNode } from 'react';

/**
 * Structural subtype of FlightPlanCache covering only the fields rendered
 * by the summary. Keeping this local (instead of importing the Prisma
 * model) means consumers can pass anything shaped like this — which keeps
 * the component cheap to reuse outside the booking-detail page later
 * (e.g. PIREP debrief, dispatch overlay) without dragging in the full
 * Prisma row type.
 */
export type OfpSummaryCache = {
  ofpId: string;
  blockTimeMin: number | null;
  fuelKg: number | null;
  generatedAt: Date;
  routeString: string | null;
  /**
   * Optional cache-validity deadline. When provided and in the past, the
   * component renders a "Stale" badge so the pilot knows the OFP's
   * weather + AIRAC snapshot may be out of date — typically 6h after
   * generation per actions.ts. Older callers that don't pass this still
   * work; they just don't get the staleness hint.
   */
  expiresAt?: Date;
};

/**
 * Optional actuals for Plan-vs-Actual comparison on PIREP detail pages.
 * When provided, the component renders a "Plan vs Actual" footer row
 * showing per-metric deltas with absolute and percentage values. Both
 * fields nullable — partial actuals (e.g. flight time recorded but no
 * fuel data) still produce a row for the field that is known.
 *
 * Booking-Detail callers omit this entirely (the booking has no actuals
 * yet, so the comparison would be meaningless).
 */
export type OfpSummaryActual = {
  /** Actual block / flight time in minutes, from PIREP.flightTimeMin */
  flightTimeMin: number | null;
  /** Actual fuel used in kg, from PIREP.fuelUsedKg */
  fuelUsedKg: number | null;
};

export interface OfpSummaryProps {
  cache: OfpSummaryCache;
  /**
   * Optional action row rendered below the route string. When omitted the
   * whole section is muted (opacity-75) to signal a read-only historical
   * view — the convention is "actions present ⇒ live, actions absent ⇒
   * archive". Booking-Detail uses the muted form for final-state bookings
   * (Cancelled/Completed/Expired), the active form for in-progress ones.
   */
  actions?: ReactNode;
  /**
   * Optional actuals → renders Plan-vs-Actual comparison footer. PIREP
   * detail page passes this so the pilot can see how close they got to
   * plan. Booking-Detail never passes it (no actuals yet at booking
   * stage).
   */
  actual?: OfpSummaryActual;
}

function formatBlockTime(min: number | null): string {
  if (min === null) return '—';
  const h = Math.floor(min / 60);
  const m = min % 60;
  return h > 0 ? `${h}h ${m}min` : `${m}min`;
}

/**
 * Format a delta in minutes as a signed string. Used in the Plan-vs-
 * Actual comparison: positive = took longer than plan, negative = faster.
 * Distinct formatter from formatBlockTime because deltas are typically
 * single-unit (rarely multi-hour) and the sign carries semantic weight.
 */
function formatDeltaMin(delta: number): string {
  const sign = delta > 0 ? '+' : delta < 0 ? '−' : '';
  const abs = Math.abs(delta);
  if (abs >= 60) {
    const h = Math.floor(abs / 60);
    const m = abs % 60;
    return m === 0 ? `${sign}${h}h` : `${sign}${h}h ${m}min`;
  }
  return `${sign}${abs}min`;
}

/**
 * Render a single Plan-vs-Actual metric row. Decides delta-color based
 * on direction: lower-than-plan is green for both time and fuel (faster
 * flight, less burn). Exact-on-plan or within ±2% is gray (neutral).
 * Above-plan is orange (notable), >10% over is red (significant).
 *
 * Returns null when either side is unknown — partial data is suppressed
 * rather than rendering "—" placeholders that don't add information.
 */
function PlanActualRow({
  label,
  planned,
  actual,
  format,
  formatDelta,
}: {
  label: string;
  planned: number | null;
  actual: number | null;
  format: (n: number) => string;
  formatDelta: (delta: number) => string;
}) {
  if (planned === null || actual === null) return null;

  const delta = actual - planned;
  const pct = planned !== 0 ? (delta / planned) * 100 : 0;
  const absPct = Math.abs(pct);

  // Color logic — both "block time over plan" and "fuel over plan" are
  // bad in equal measure (pilot took longer than expected / burned more
  // than expected), so we use the same scale for both metrics.
  let deltaColor = 'text-gray-400';
  if (delta < 0 && absPct >= 2) deltaColor = 'text-green-400';
  else if (absPct >= 10) deltaColor = 'text-red-400';
  else if (absPct >= 2) deltaColor = 'text-orange-400';

  return (
    <div className="flex items-baseline gap-3 flex-wrap">
      <span className="text-xs uppercase tracking-wider text-gray-500 w-24 shrink-0">
        {label}
      </span>
      <span className="text-sm text-gray-400 tabular-nums">
        {format(planned)}
      </span>
      <span className="text-gray-600">→</span>
      <span className="text-sm font-semibold tabular-nums">
        {format(actual)}
      </span>
      <span className={`text-xs tabular-nums ${deltaColor}`}>
        {formatDelta(delta)}
        {planned !== 0 && (
          <span className="ml-1 opacity-70">
            ({pct >= 0 ? '+' : '−'}
            {absPct.toFixed(1)}%)
          </span>
        )}
      </span>
    </div>
  );
}

/**
 * OFP Summary card.
 *
 * Renders the four canonical headline fields from a SimBrief OFP — id,
 * block time, block fuel, generation timestamp — plus the route string
 * if present. Both Pattern α and Pattern Z funnel into the same
 * FlightPlanCache shape (see actions.ts), so this component is pattern-
 * agnostic: it just knows how to display a cached plan.
 *
 * On PIREP pages, callers also pass `actual` to enable a Plan-vs-Actual
 * footer row showing deltas between the plan and the flown values.
 */
export function OfpSummary({ cache, actions, actual }: OfpSummaryProps) {
  const muted = !actions;
  // Server component — Date.now() is the request time, which is the
  // correct frame of reference: the staleness indicator should reflect
  // "is this cache stale at the moment this page is rendered" rather
  // than drifting on the client clock. If the user keeps the page open
  // past the deadline they'll see the badge after a refresh, which is
  // also when they have the option to act on it.
  const isStale =
    cache.expiresAt !== undefined && cache.expiresAt.getTime() < Date.now();

  // Pre-compute whether we have any actual to render. Both being null
  // means "actuals object was passed but no useful data" — render the
  // section header anyway with an empty-state hint, since the user
  // arrived at this page knowing it's a PIREP and would otherwise
  // wonder why no comparison appears.
  const hasAnyActual =
    actual !== undefined &&
    (actual.flightTimeMin !== null || actual.fuelUsedKg !== null);
  const showActualSection = actual !== undefined;

  return (
    <section
      className={`bg-gray-900 border border-gray-800 rounded-lg p-6 mb-8${
        muted ? ' opacity-75' : ''
      }`}
    >
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-sm uppercase tracking-wider text-gray-500">
          OFP Summary
        </h2>
        {isStale && (
          <span
            className="px-2 py-1 rounded text-xs font-semibold bg-yellow-500/10 border border-yellow-500/30 text-yellow-400"
            title={`Cache abgelaufen am ${cache.expiresAt!.toLocaleString('de-DE')}`}
          >
            ⚠ Abgelaufen
          </span>
        )}
      </div>
      <div className="grid grid-cols-2 gap-6 mb-6">
        <div>
          <p className="text-xs uppercase tracking-wider text-gray-500 mb-1">
            OFP ID
          </p>
          <p className="font-mono">{cache.ofpId}</p>
        </div>
        <div>
          <p className="text-xs uppercase tracking-wider text-gray-500 mb-1">
            Block Time
          </p>
          <p>{formatBlockTime(cache.blockTimeMin)}</p>
        </div>
        <div>
          <p className="text-xs uppercase tracking-wider text-gray-500 mb-1">
            Block Fuel
          </p>
          <p>{cache.fuelKg ? `${cache.fuelKg} kg` : '—'}</p>
        </div>
        <div>
          <p className="text-xs uppercase tracking-wider text-gray-500 mb-1">
            Generiert
          </p>
          <p>{new Date(cache.generatedAt).toLocaleString('de-DE')}</p>
        </div>
      </div>
      {cache.routeString && (
        <div className={actions || showActualSection ? 'mb-6' : ''}>
          <p className="text-xs uppercase tracking-wider text-gray-500 mb-2">
            Route
          </p>
          <p className="font-mono text-sm bg-gray-950 border border-gray-800 rounded p-3 break-all">
            {cache.routeString}
          </p>
        </div>
      )}
      {showActualSection && (
        <div className="pt-4 border-t border-gray-800">
          <p className="text-xs uppercase tracking-wider text-gray-500 mb-3">
            Plan vs Actual
          </p>
          {hasAnyActual ? (
            <div className="space-y-2">
              <PlanActualRow
                label="Block Time"
                planned={cache.blockTimeMin}
                actual={actual.flightTimeMin}
                format={(n) => formatBlockTime(n)}
                formatDelta={formatDeltaMin}
              />
              <PlanActualRow
                label="Block Fuel"
                planned={cache.fuelKg}
                actual={actual.fuelUsedKg}
                format={(n) => `${n} kg`}
                formatDelta={(d) =>
                  `${d > 0 ? '+' : d < 0 ? '−' : ''}${Math.abs(d)} kg`
                }
              />
            </div>
          ) : (
            <p className="text-xs text-gray-500 italic">
              Keine Vergleichsdaten — PIREP enthält weder Flugzeit noch
              Treibstoff-Verbrauch.
            </p>
          )}
        </div>
      )}
      {actions && (
        <div className="flex gap-3 pt-4 border-t border-gray-800">
          {actions}
        </div>
      )}
    </section>
  );
}
