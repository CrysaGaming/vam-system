/**
 * Welle I / I5 — Comparison-page: pilot vs airline vs platform.
 *
 * Route: /me/comparison
 *
 * Vier metrik-vergleiche als grouped bar-chart + textuelle deltas.
 * Each metrik zeigt 3 bars (user / airline / platform); UI hebt
 * hervor wo der user über/unter dem peer-durchschnitt liegt.
 *
 * # Metrik-interpretation
 *
 * - Avg flight minutes: höher = längere flüge (typischer airliner-stil
 *   vs. GA-style touch-and-goes). Kein "besser/schlechter" — neutral.
 * - Flights per month: höher = aktiverer pilot. Mehr ist besser
 *   wenn der user "more active" sein will.
 * - Landing-rate (fpm): NEGATIVER = besser (weicher landing). Bei
 *   der vergleichsdarstellung müssen wir bei dieser metrik die
 *   semantik invertieren (smaller = better).
 * - Approval-rate (%): höher = besser (cleaner reports).
 *
 * # Two charts
 *
 * Wir splitten die metriken auf 2 charts weil die scales sehr
 * unterschiedlich sind (minutes 0-300, per-month 0-30, fpm -1000-0,
 * pct 0-100). Ein einziges chart mit dual-axis wäre verwirrend.
 *
 *   Chart 1: minutes + per-month (positive activity-metriken)
 *   Chart 2: landing-rate + approval-pct (quality-metriken)
 *
 * Aktuell V1 implementation: alle 4 in einer einzigen scaled chart
 * via separater normalization — KISS, keep it simple. V2 könnte
 * split-chart sein.
 */

import { auth } from '@/auth';
import { redirect } from 'next/navigation';
import Link from 'next/link';

import { getComparisonStats, type ComparisonMetric } from '@/lib/stats/comparison';
import ComparisonChart from './_comparison-chart';

export const revalidate = 300;

export default async function ComparisonPage() {
  const session = await auth();
  if (!session?.user?.id) redirect('/');

  const stats = await getComparisonStats(session.user.id);
  const hasAirline = stats.airlineLabel !== null;
  const isEmpty = stats.totalFlights.user === 0;

  if (isEmpty) {
    return (
      <main className="min-h-screen bg-background p-4 text-foreground sm:p-8">
        <div className="mx-auto max-w-5xl">
          <PageHeader airlineLabel={stats.airlineLabel} />
          <div className="rounded-lg border border-dashed border-border bg-card p-12 text-center">
            <div className="mb-3 text-5xl">📊</div>
            <h2 className="text-lg font-semibold">Noch keine Vergleichsdaten</h2>
            <p className="mt-2 text-sm text-muted-foreground">
              Sobald du approved PIREPs hast, kannst du dich hier mit dem
              durchschnitt vergleichen.
            </p>
            <Link
              href="/me/stats"
              className="mt-4 inline-block rounded bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700"
            >
              ← Zurück zu Stats
            </Link>
          </div>
        </div>
      </main>
    );
  }

  // Activity-metriken (durations + frequency)
  const activityData = [
    {
      metric: 'Ø Flugzeit (min)',
      user: stats.avgFlightMinutes.user,
      airline: stats.avgFlightMinutes.airline,
      platform: stats.avgFlightMinutes.platform,
    },
    {
      metric: 'Flüge / Monat',
      user: stats.flightsPerMonth.user,
      airline: stats.flightsPerMonth.airline,
      platform: stats.flightsPerMonth.platform,
    },
  ];

  // Quality-metriken (lower-is-better für landing → wir invertieren
  // das negative-fpm zu absoluten werten für die chart-anzeige damit
  // der bar-vergleich visuell intuitiv ist. Negative-zeichen bleibt
  // in den text-deltas.)
  const qualityData = [
    {
      metric: 'Landing |fpm|',
      user: Math.abs(stats.avgLandingRateFpm.user),
      airline: Math.abs(stats.avgLandingRateFpm.airline),
      platform: Math.abs(stats.avgLandingRateFpm.platform),
    },
    {
      metric: 'Approval-Rate %',
      user: stats.approvalRatePct.user,
      airline: stats.approvalRatePct.airline,
      platform: stats.approvalRatePct.platform,
    },
  ];

  return (
    <main className="min-h-screen bg-background p-4 text-foreground sm:p-8">
      <div className="mx-auto max-w-5xl">
        <PageHeader airlineLabel={stats.airlineLabel} />

        {/* Context-card: totals */}
        <section className="mb-6 rounded-lg border border-border bg-card p-4">
          <h2 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Kontext
          </h2>
          <div className="grid grid-cols-3 gap-4 text-sm">
            <ContextCol
              label="Du"
              value={`${stats.totalFlights.user} PIREPs`}
              color="text-indigo-600 dark:text-indigo-400"
            />
            <ContextCol
              label={stats.airlineLabel ?? 'Airline'}
              value={
                hasAirline
                  ? `${stats.totalFlights.airline} PIREPs gesamt`
                  : '— keine airline'
              }
              color="text-cyan-600 dark:text-cyan-400"
            />
            <ContextCol
              label="Platform"
              value={`${stats.totalFlights.platform.toLocaleString('de-DE')} PIREPs gesamt`}
              color="text-slate-600 dark:text-slate-400"
            />
          </div>
        </section>

        {/* Activity chart */}
        <section className="mb-8 rounded-lg border border-border bg-card p-4">
          <h2 className="mb-1 text-lg font-semibold">Aktivität</h2>
          <p className="mb-4 text-xs text-muted-foreground">
            Wie oft + wie lange du fliegst, verglichen mit{' '}
            {hasAirline ? 'airline-' : ''}durchschnitt.
          </p>
          <ComparisonChart
            data={activityData}
            airlineLabel={stats.airlineLabel}
            hasAirline={hasAirline}
          />
        </section>

        {/* Quality chart */}
        <section className="mb-8 rounded-lg border border-border bg-card p-4">
          <h2 className="mb-1 text-lg font-semibold">Qualität</h2>
          <p className="mb-4 text-xs text-muted-foreground">
            Landing-rate (|fpm|, niedriger = besser) und PIREP-approval-rate.
          </p>
          <ComparisonChart
            data={qualityData}
            airlineLabel={stats.airlineLabel}
            hasAirline={hasAirline}
          />
        </section>

        {/* Deltas-list */}
        <section className="mb-8 rounded-lg border border-border bg-card p-4">
          <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Wie schlägst du dich?
          </h2>
          <ul className="space-y-2 text-sm">
            <DeltaRow
              label="Ø Flugzeit"
              metric={stats.avgFlightMinutes}
              hasAirline={hasAirline}
              suffix=" min"
              higherIsBetter={null}
            />
            <DeltaRow
              label="Flüge / Monat"
              metric={stats.flightsPerMonth}
              hasAirline={hasAirline}
              higherIsBetter={true}
            />
            <DeltaRow
              label="Landing-rate"
              metric={stats.avgLandingRateFpm}
              hasAirline={hasAirline}
              suffix=" fpm"
              higherIsBetter={true /* less-negative = closer to 0 = smoother */}
            />
            <DeltaRow
              label="Approval-rate"
              metric={stats.approvalRatePct}
              hasAirline={hasAirline}
              suffix=" %"
              higherIsBetter={true}
            />
          </ul>
        </section>

        <footer className="border-t border-border pt-4 text-xs text-muted-foreground">
          <Link
            href="/me/stats"
            className="text-indigo-600 hover:underline dark:text-indigo-400"
          >
            ← Zurück zu Personal Stats
          </Link>
        </footer>
      </div>
    </main>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Components
// ─────────────────────────────────────────────────────────────────────

function PageHeader({ airlineLabel }: { airlineLabel: string | null }) {
  return (
    <header className="mb-6 border-b border-border pb-4">
      <p className="text-xs uppercase tracking-wider text-muted-foreground">
        Vergleich · {airlineLabel ?? 'Platform-wide'}
      </p>
      <h1 className="mt-1 text-2xl font-bold sm:text-3xl">
        Wie schlägst du dich?
      </h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Deine Stats vs.{' '}
        {airlineLabel
          ? `dein airline-durchschnitt vs. platform-durchschnitt`
          : 'platform-durchschnitt'}
        . Last-12-month window.
      </p>
    </header>
  );
}

function ContextCol({
  label,
  value,
  color,
}: {
  label: string;
  value: string;
  color: string;
}) {
  return (
    <div>
      <div className={`text-xs uppercase tracking-wider ${color}`}>{label}</div>
      <div className="mt-1 text-sm">{value}</div>
    </div>
  );
}

/**
 * Eine row im deltas-section. Zeigt den user-wert + die zwei deltas
 * gegen airline + platform. Farb-codiert nach higherIsBetter:
 *   - true: höher-ist-besser → user > peer = grün
 *   - false: niedriger-ist-besser → user < peer = grün
 *   - null: neutral, keine farbe (z.B. Ø Flugzeit — pure descriptor)
 */
function DeltaRow({
  label,
  metric,
  hasAirline,
  suffix = '',
  higherIsBetter,
}: {
  label: string;
  metric: ComparisonMetric;
  hasAirline: boolean;
  suffix?: string;
  higherIsBetter: boolean | null;
}) {
  return (
    <li className="grid grid-cols-1 gap-2 border-b border-border/50 py-2 last:border-0 sm:grid-cols-4">
      <div className="font-medium">{label}</div>
      <div className="font-mono text-indigo-600 dark:text-indigo-400">
        Du: {metric.user}
        {suffix}
      </div>
      <div className="font-mono text-cyan-600 dark:text-cyan-400">
        Airline:{' '}
        {hasAirline ? (
          <>
            {metric.airline}
            {suffix}{' '}
            <DeltaBadge
              userVal={metric.user}
              peerVal={metric.airline}
              higherIsBetter={higherIsBetter}
            />
          </>
        ) : (
          '—'
        )}
      </div>
      <div className="font-mono text-slate-600 dark:text-slate-400">
        Platform: {metric.platform}
        {suffix}{' '}
        <DeltaBadge
          userVal={metric.user}
          peerVal={metric.platform}
          higherIsBetter={higherIsBetter}
        />
      </div>
    </li>
  );
}

/**
 * Kleine "+12.3"-pille rechts neben dem peer-wert. Zeigt den signed-
 * delta und färbt sich grün/rot je nach higherIsBetter-mode.
 */
function DeltaBadge({
  userVal,
  peerVal,
  higherIsBetter,
}: {
  userVal: number;
  peerVal: number;
  higherIsBetter: boolean | null;
}) {
  if (peerVal === 0 && userVal === 0) return null;
  const diff = userVal - peerVal;
  const sign = diff > 0 ? '+' : '';
  const rounded = Math.round(diff * 10) / 10;

  let colorCls = 'text-muted-foreground';
  if (higherIsBetter !== null) {
    const isBetter = higherIsBetter ? diff > 0 : diff < 0;
    if (Math.abs(diff) > 0.05) {
      colorCls = isBetter
        ? 'text-green-600 dark:text-green-400'
        : 'text-orange-600 dark:text-orange-400';
    }
  }

  return (
    <span className={`ml-1 text-xs font-semibold ${colorCls}`}>
      ({sign}
      {rounded})
    </span>
  );
}
