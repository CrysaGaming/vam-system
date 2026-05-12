import { auth } from '@/auth';
import { redirect, notFound } from 'next/navigation';
import Link from 'next/link';
import {
  prisma,
  getPirepApproachAnalysis,
  getPirepLandingAnalysis,
} from '@vam/db';
import { isApproverRole } from '@/lib/roles';
import {
  computeSmoothnessScore,
  computeDelta,
  classificationStyles,
  formatDelta,
  type DeltaResult,
} from '@/lib/pirep-metrics';

/**
 * Track 5 #1 — PIREP-Comparison-Mode.
 *
 * /pireps/compare?a=<pirepId>&b=<pirepId> — two-PIREP side-by-side
 * comparison. Both PIREPs müssen viewable sein (eigen ODER airline-
 * admin/instructor in der gleichen airline). Sonst redirect zu /pireps.
 *
 * # Layout
 *
 * Header mit den zwei flight-identities (flight-number, route, date,
 * pilot) als zwei spalten. Darunter eine "fact-sheet"-tabelle mit
 * 3 spalten:
 *
 *   | Metric          | A         | B         | Δ              |
 *
 * Eine zeile pro metric. Δ-spalte zeigt:
 *   - "—" wenn ein wert fehlt
 *   - "+12min" oder "-340fpm" mit color-classification (green=better,
 *     red=worse, gray=tie/neutral)
 *
 * # Metrics (in render-order)
 *
 *   1. Flight-Time      preferLower (efficient)
 *   2. Fuel-Used        preferLower
 *   3. Landing-Rate     preferZero (smaller magnitude = smoother)
 *   4. Passengers       neutral (kein "besser")
 *   5. IAS @ 1000ft     neutral
 *   6. Glideslope %     preferHigher
 *   7. Stabilization %  preferHigher
 *   8. VSI@Touchdown    preferZero
 *   9. GS@Touchdown     neutral
 *   10. Smoothness      preferHigher
 *
 * # Approach + Landing fetches
 *
 * Wir parallel-fetchen approachAnalysis + landingAnalysis für beide
 * PIREPs (4 helper-calls total). Bei PIREPs ohne ACARS-trail sind die
 * helpers null, dann zeigt die comparison-row "—" / "—" / "—".
 *
 * # Out-of-scope V1
 *
 * - Picker-UI auf /pireps/[id] zum starten der comparison. V1 erwartet
 *   beide IDs als query-params (manual oder vom future-picker-button).
 *   Picker kommt direkt nach diesem PR.
 * - Map-overlay mit beiden trails übereinander. Würde replay-data von
 *   beiden sessions in client-component laden — separater commit.
 * - 3-way oder N-way comparison. Schema-wise einfach (array-loop),
 *   aber UI-wise wird's bei N=4+ unleserlich auf mobile. V1 fix-2.
 */

export const dynamic = 'force-dynamic';

interface SearchParams {
  a?: string;
  b?: string;
}

function formatFlightTime(min: number | null): string {
  if (min === null) return '—';
  const h = Math.floor(min / 60);
  const m = min % 60;
  return h > 0 ? `${h}h ${m}min` : `${m}min`;
}

function formatDate(d: Date): string {
  return d.toLocaleDateString('de-DE', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
}

/**
 * Render the Δ-cell für eine metric-row. Bekommt das delta-result (von
 * computeDelta) und render-options (unit, precision). Wenn delta null
 * ist (= eine der beiden values war null), zeigen wir em-dash.
 *
 * Mit absoluter diff + signed prefix. Percent in klammern für context.
 */
function DeltaCell({
  delta,
  unit,
  precision = 0,
}: {
  delta: DeltaResult | null;
  unit?: string;
  precision?: number;
}) {
  if (!delta) {
    return <td className="px-4 py-3 text-right text-gray-400 dark:text-gray-600 font-mono text-sm">—</td>;
  }
  const colorClass = classificationStyles(delta.classification);
  const diffStr = formatDelta(delta.diff, unit, precision);
  const pctStr =
    delta.percent !== null && delta.percent !== 0
      ? ` (${delta.percent > 0 ? '+' : ''}${delta.percent.toFixed(1)}%)`
      : '';
  return (
    <td className={`px-4 py-3 text-right font-mono text-sm tabular-nums ${colorClass}`}>
      {diffStr}
      <span className="text-[10px] opacity-70">{pctStr}</span>
    </td>
  );
}

/**
 * Render einer metric-row mit label, two values, delta-cell. value-format
 * via renderValue-callback damit z.B. flight-time als "1h 23min" gerendert
 * werden kann statt raw integer.
 */
function MetricRow({
  label,
  valueA,
  valueB,
  formatValue,
  delta,
  unit,
  precision,
}: {
  label: string;
  valueA: number | null | undefined;
  valueB: number | null | undefined;
  formatValue: (v: number | null | undefined) => string;
  delta: DeltaResult | null;
  unit?: string;
  precision?: number;
}) {
  return (
    <tr className="border-b border-gray-200 dark:border-gray-800 last:border-0">
      <td className="px-4 py-3 text-sm text-gray-600 dark:text-gray-400 font-medium">
        {label}
      </td>
      <td className="px-4 py-3 text-right font-mono text-sm font-semibold tabular-nums">
        {formatValue(valueA)}
      </td>
      <td className="px-4 py-3 text-right font-mono text-sm font-semibold tabular-nums">
        {formatValue(valueB)}
      </td>
      <DeltaCell delta={delta} unit={unit} precision={precision} />
    </tr>
  );
}

/**
 * Section-header-row im comparison-table. Spans alle 4 columns mit einem
 * bold uppercase label.
 */
function SectionHeader({ label }: { label: string }) {
  return (
    <tr>
      <td
        colSpan={4}
        className="px-4 py-2 text-[10px] uppercase tracking-wider text-gray-500 font-semibold bg-gray-50 dark:bg-gray-800/40 border-b border-gray-200 dark:border-gray-800"
      >
        {label}
      </td>
    </tr>
  );
}

export default async function PirepComparePage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const session = await auth();
  if (!session?.user) {
    redirect('/');
  }

  const params = await searchParams;
  const aId = params.a;
  const bId = params.b;

  // Beide IDs required. Wenn eines fehlt → redirect zur PIREP-list
  // (kein 400 weil das eine human-navigation ist; user sollte einfach
  // einen normalen start-zustand haben).
  if (!aId || !bId) {
    redirect('/pireps');
  }
  if (aId === bId) {
    // Same PIREP-id auf beiden seiten ist sinnlos — back zur detail-page.
    redirect(`/pireps/${aId}`);
  }

  const currentUser = await prisma.user.findUnique({
    where: { id: session.user.id },
    include: { role: true },
  });
  if (!currentUser) {
    redirect('/');
  }

  const isApprover = isApproverRole(currentUser.role?.name);

  // Parallel-fetch beide PIREPs + alle 4 analysis-helpers (2 für jede
  // seite). Die analysis-helpers wären null-resolving wenn der PIREP
  // nicht existiert, daher resilient gegen nicht-gefundene PIREPs.
  const [pirepA, pirepB, approachA, approachB, landingA, landingB] =
    await Promise.all([
      prisma.pirep.findUnique({
        where: { id: aId },
        include: {
          route: true,
          departure: true,
          arrival: true,
          aircraft: true,
          airline: true,
          user: { include: { rank: true } },
        },
      }),
      prisma.pirep.findUnique({
        where: { id: bId },
        include: {
          route: true,
          departure: true,
          arrival: true,
          aircraft: true,
          airline: true,
          user: { include: { rank: true } },
        },
      }),
      getPirepApproachAnalysis(aId),
      getPirepApproachAnalysis(bId),
      getPirepLandingAnalysis(aId),
      getPirepLandingAnalysis(bId),
    ]);

  // 404 wenn einer der beiden nicht existiert.
  if (!pirepA || !pirepB) {
    notFound();
  }

  // Auth: beide PIREPs viewable sein müssen (eigen ODER approver in
  // gleicher airline). Selbe logic wie auf /pireps/[id]/page.tsx.
  const canViewA =
    pirepA.userId === currentUser.id ||
    (isApprover && pirepA.airlineId === currentUser.airlineId);
  const canViewB =
    pirepB.userId === currentUser.id ||
    (isApprover && pirepB.airlineId === currentUser.airlineId);
  if (!canViewA || !canViewB) {
    redirect('/pireps');
  }

  // Smoothness pro side berechnen.
  const smoothnessA = computeSmoothnessScore(
    landingA?.verticalFpmAtTouchdown,
    approachA?.stabilizationScorePercent,
    approachA?.glideslopeQualityPercent,
  );
  const smoothnessB = computeSmoothnessScore(
    landingB?.verticalFpmAtTouchdown,
    approachB?.stabilizationScorePercent,
    approachB?.glideslopeQualityPercent,
  );

  // Comparison-table rows. Direction pro metric:
  //   flightTime, fuel    → preferLower (efficient)
  //   landingRate, VSI@TD → preferZero  (smoother)
  //   glideslope%, stab%  → preferHigher (more is better)
  //   smoothness          → preferHigher
  //   pax, IAS, GS@TD     → neutral
  const flightTimeDelta = computeDelta(
    pirepA.flightTimeMin,
    pirepB.flightTimeMin,
    'preferLower',
  );
  const fuelDelta = computeDelta(
    pirepA.fuelUsedKg,
    pirepB.fuelUsedKg,
    'preferLower',
  );
  const landingRateDelta = computeDelta(
    pirepA.landingRateFpm,
    pirepB.landingRateFpm,
    'preferZero',
  );
  const paxDelta = computeDelta(
    pirepA.passengerCount,
    pirepB.passengerCount,
    'neutral',
  );
  const iasDelta = computeDelta(
    approachA?.iasAt1000ft ?? null,
    approachB?.iasAt1000ft ?? null,
    'neutral',
  );
  const glideslopeDelta = computeDelta(
    approachA?.glideslopeQualityPercent ?? null,
    approachB?.glideslopeQualityPercent ?? null,
    'preferHigher',
  );
  const stabilizationDelta = computeDelta(
    approachA?.stabilizationScorePercent ?? null,
    approachB?.stabilizationScorePercent ?? null,
    'preferHigher',
  );
  const vsiTouchdownDelta = computeDelta(
    landingA?.verticalFpmAtTouchdown ?? null,
    landingB?.verticalFpmAtTouchdown ?? null,
    'preferZero',
  );
  const gsTouchdownDelta = computeDelta(
    landingA?.groundSpeedKtsAtTouchdown ?? null,
    landingB?.groundSpeedKtsAtTouchdown ?? null,
    'neutral',
  );
  const smoothnessDelta = computeDelta(smoothnessA, smoothnessB, 'preferHigher');

  // Helper-renderers für value-cells. Müssen null-tolerant sein.
  const renderInt = (v: number | null | undefined): string =>
    v === null || v === undefined ? '—' : v.toString();
  const renderFlightTime = (v: number | null | undefined): string =>
    v === null || v === undefined ? '—' : formatFlightTime(v);
  const renderPercent = (v: number | null | undefined): string =>
    v === null || v === undefined ? '—' : `${v.toFixed(0)}%`;
  const renderUnit = (unit: string) => (v: number | null | undefined): string =>
    v === null || v === undefined ? '—' : `${v} ${unit}`;
  const renderAbsFpm = (v: number | null | undefined): string =>
    v === null || v === undefined ? '—' : `${Math.abs(v)} fpm`;

  return (
    <main className="min-h-screen bg-gray-50 dark:bg-gray-950 text-gray-900 dark:text-white p-4 sm:p-6 lg:p-8">
      <div className="max-w-6xl mx-auto">
        {/* Header */}
        <header className="mb-6 pb-6 border-b border-gray-200 dark:border-gray-800">
          <div className="flex flex-wrap items-center justify-between gap-3 mb-2">
            <h1 className="text-3xl font-bold">🔄 PIREP-Vergleich</h1>
            <Link
              href="/pireps"
              className="px-3 py-2 bg-gray-200 hover:bg-gray-300 dark:bg-gray-800 dark:hover:bg-gray-700 rounded text-sm transition"
            >
              ← Zurück zur Liste
            </Link>
          </div>
          <p className="text-gray-500 dark:text-gray-400 text-sm">
            Side-by-side comparison zweier Flüge. Δ-spalte zeigt
            differenz (A − B) mit color: grün = A besser, rot = A
            schlechter, grau = gleich oder neutral.
          </p>
        </header>

        {/* Identity-cards: zwei spalten mit basic-info pro PIREP */}
        <section className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-6">
          <div className="bg-white dark:bg-gray-900 border-2 border-indigo-300 dark:border-indigo-500/40 rounded-lg p-4">
            <div className="flex items-baseline justify-between gap-2 flex-wrap mb-2">
              <Link
                href={`/pireps/${pirepA.id}`}
                className="text-xl font-bold font-mono hover:text-indigo-600 dark:hover:text-indigo-400 transition"
              >
                A · {pirepA.route?.flightNumber ?? 'PIREP'}
              </Link>
              <span className="text-[10px] uppercase tracking-wider px-2 py-0.5 rounded bg-indigo-100 dark:bg-indigo-500/20 text-indigo-700 dark:text-indigo-300">
                {pirepA.status}
              </span>
            </div>
            <p className="font-mono text-sm text-gray-700 dark:text-gray-300">
              {pirepA.departure.icao} → {pirepA.arrival.icao}
            </p>
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
              {pirepA.user.name ?? 'Unbenannt'} ·{' '}
              {pirepA.aircraft?.registration ?? 'kein Aircraft'}
            </p>
            <p className="text-[11px] text-gray-500 dark:text-gray-500 mt-1">
              {formatDate(pirepA.submittedAt)}
            </p>
          </div>

          <div className="bg-white dark:bg-gray-900 border-2 border-purple-300 dark:border-purple-500/40 rounded-lg p-4">
            <div className="flex items-baseline justify-between gap-2 flex-wrap mb-2">
              <Link
                href={`/pireps/${pirepB.id}`}
                className="text-xl font-bold font-mono hover:text-purple-600 dark:hover:text-purple-400 transition"
              >
                B · {pirepB.route?.flightNumber ?? 'PIREP'}
              </Link>
              <span className="text-[10px] uppercase tracking-wider px-2 py-0.5 rounded bg-purple-100 dark:bg-purple-500/20 text-purple-700 dark:text-purple-300">
                {pirepB.status}
              </span>
            </div>
            <p className="font-mono text-sm text-gray-700 dark:text-gray-300">
              {pirepB.departure.icao} → {pirepB.arrival.icao}
            </p>
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
              {pirepB.user.name ?? 'Unbenannt'} ·{' '}
              {pirepB.aircraft?.registration ?? 'kein Aircraft'}
            </p>
            <p className="text-[11px] text-gray-500 dark:text-gray-500 mt-1">
              {formatDate(pirepB.submittedAt)}
            </p>
          </div>
        </section>

        {/* Same-route hint */}
        {pirepA.departure.icao !== pirepB.departure.icao ||
        pirepA.arrival.icao !== pirepB.arrival.icao ? (
          <div className="mb-6 px-4 py-3 bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/30 rounded-lg text-sm text-amber-800 dark:text-amber-200">
            ⚠️ Die zwei Flüge sind auf unterschiedlichen Routen. Vergleich
            ist trotzdem möglich, aber die delta-zahlen sind weniger
            aussagekräftig (verschiedene distanzen → verschiedene
            erwartungswerte).
          </div>
        ) : null}

        {/* Comparison-table */}
        <section className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-lg overflow-hidden mb-6">
          <table className="w-full text-sm">
            <thead className="bg-gray-100 dark:bg-gray-800/50">
              <tr className="text-left text-xs uppercase tracking-wider text-gray-500 dark:text-gray-400">
                <th className="px-4 py-3 w-[35%]">Metric</th>
                <th className="px-4 py-3 text-right w-[20%] text-indigo-700 dark:text-indigo-400">
                  A
                </th>
                <th className="px-4 py-3 text-right w-[20%] text-purple-700 dark:text-purple-400">
                  B
                </th>
                <th className="px-4 py-3 text-right w-[25%]">Δ (A − B)</th>
              </tr>
            </thead>
            <tbody>
              <SectionHeader label="Performance" />
              <MetricRow
                label="Block-Time"
                valueA={pirepA.flightTimeMin}
                valueB={pirepB.flightTimeMin}
                formatValue={renderFlightTime}
                delta={flightTimeDelta}
                unit="min"
              />
              <MetricRow
                label="Treibstoff"
                valueA={pirepA.fuelUsedKg}
                valueB={pirepB.fuelUsedKg}
                formatValue={renderUnit('kg')}
                delta={fuelDelta}
                unit="kg"
              />
              <MetricRow
                label="Landing-Rate (raw)"
                valueA={pirepA.landingRateFpm}
                valueB={pirepB.landingRateFpm}
                formatValue={renderAbsFpm}
                delta={landingRateDelta}
                unit="fpm"
              />
              <MetricRow
                label="Passagiere"
                valueA={pirepA.passengerCount}
                valueB={pirepB.passengerCount}
                formatValue={renderInt}
                delta={paxDelta}
              />

              <SectionHeader label="Approach-Analysis" />
              <MetricRow
                label="IAS @ 1000ft AGL"
                valueA={approachA?.iasAt1000ft ?? null}
                valueB={approachB?.iasAt1000ft ?? null}
                formatValue={renderUnit('kt')}
                delta={iasDelta}
                unit="kt"
              />
              <MetricRow
                label="Glideslope-Quality"
                valueA={approachA?.glideslopeQualityPercent ?? null}
                valueB={approachB?.glideslopeQualityPercent ?? null}
                formatValue={renderPercent}
                delta={glideslopeDelta}
                unit="%"
                precision={1}
              />
              <MetricRow
                label="Stabilized-Approach"
                valueA={approachA?.stabilizationScorePercent ?? null}
                valueB={approachB?.stabilizationScorePercent ?? null}
                formatValue={renderPercent}
                delta={stabilizationDelta}
                unit="%"
                precision={1}
              />

              <SectionHeader label="Landing-Analysis" />
              <MetricRow
                label="VSI @ Touchdown"
                valueA={landingA?.verticalFpmAtTouchdown ?? null}
                valueB={landingB?.verticalFpmAtTouchdown ?? null}
                formatValue={renderAbsFpm}
                delta={vsiTouchdownDelta}
                unit="fpm"
              />
              <MetricRow
                label="GS @ Touchdown"
                valueA={landingA?.groundSpeedKtsAtTouchdown ?? null}
                valueB={landingB?.groundSpeedKtsAtTouchdown ?? null}
                formatValue={renderUnit('kt')}
                delta={gsTouchdownDelta}
                unit="kt"
              />

              <SectionHeader label="Overall" />
              <MetricRow
                label="Smoothness-Score"
                valueA={smoothnessA}
                valueB={smoothnessB}
                formatValue={(v) =>
                  v === null || v === undefined ? '—' : `${v}/100`
                }
                delta={smoothnessDelta}
                unit=""
              />
            </tbody>
          </table>
        </section>

        {/* Footer-aside */}
        <aside className="bg-gray-100 dark:bg-gray-900/50 border border-gray-200 dark:border-gray-800 rounded-lg p-4 text-xs text-gray-600 dark:text-gray-400 space-y-2">
          <p>
            <strong className="text-gray-700 dark:text-gray-300">
              Δ-direction:
            </strong>{' '}
            Bei Block-Time und Treibstoff bedeutet{' '}
            <span className="text-emerald-700 dark:text-emerald-400">
              grün
            </span>{' '}
            dass A schneller/sparsamer war. Bei Landing-Rate und VSI@TD
            heisst grün dass A näher an Null lag (smoother). Bei
            Glideslope/Stabilization/Smoothness heisst grün dass A
            höhere werte hat (besser).
          </p>
          <p>
            <strong className="text-gray-700 dark:text-gray-300">
              Approach/Landing-Daten:
            </strong>{' '}
            ACARS-only. Manual oder VATSIM-only PIREPs zeigen "—" in
            diesen reihen.
          </p>
          <p>
            <strong className="text-gray-700 dark:text-gray-300">
              Smoothness-Score:
            </strong>{' '}
            Combined-metric aus Touchdown-VSI (50%), Stabilization (30%),
            Glideslope (20%). Null wenn keine component verfügbar.
          </p>
        </aside>
      </div>
    </main>
  );
}
