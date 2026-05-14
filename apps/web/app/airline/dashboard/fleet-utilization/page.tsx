import Link from 'next/link';
import { redirect } from 'next/navigation';
import { requireAirlineManagerWithAirlinePage } from '@/lib/roles';
import {
  getAirframeUtilization,
  getHubBalance,
  getRouteCoverage,
  rollupByType,
  summarize,
  formatHoursMinutes,
} from '@/lib/fleet/utilization';

/**
 * Welle F / F2 — Fleet-utilization Dashboard.
 *
 * Deep-dive expansion of the small <FleetUtilization /> widget on
 * /airline/dashboard. The widget gives a top-15 30-day glance; this page
 * adds period switching, the full airframe inventory, per-type rollup,
 * hub-balance matrix, and route-coverage matrix.
 *
 * # Period switch
 *
 * Query param ?period=30d|90d|1y|all (default 30d, matches widget). Period
 * applies to all four queries so the visible numbers are coherent. The
 * "all-time" mode uses new Date(0) — Prisma is happy with that on
 * indexed submittedAt and the planner just collapses the predicate.
 *
 * # Sections in render order
 *
 * 1. Header + period-switcher
 * 2. KPI summary cards (5 KPIs)
 * 3. Per-aircraft-type rollup (table)
 * 4. Per-airframe utilization (table, the meat of the page)
 * 5. Hub-balance matrix (cards-per-hub with per-type breakdowns)
 * 6. Route-coverage (top-20 routes with type-mix)
 *
 * Pages with no data show empty-state in each section instead of vanishing
 * the section entirely — airline-admins onboarding a new airline see what
 * sections exist so they know to populate the foundation.
 *
 * # Auth
 *
 * requireAirlineManagerWithAirlinePage gates the route (admin / airline-
 * admin / instructor) and redirects non-managers. Manager-without-airline
 * goes to /dashboard.
 */

type Period = '30d' | '90d' | '1y' | 'all';

const PERIOD_LABELS: Record<Period, string> = {
  '30d': '30 Tage',
  '90d': '90 Tage',
  '1y': '1 Jahr',
  all: 'Gesamt',
};

function parsePeriod(raw: string | undefined): Period {
  if (raw === '90d' || raw === '1y' || raw === 'all') return raw;
  return '30d';
}

function periodToSince(period: Period): Date {
  switch (period) {
    case '30d':
      return new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    case '90d':
      return new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
    case '1y':
      return new Date(Date.now() - 365 * 24 * 60 * 60 * 1000);
    case 'all':
      return new Date(0);
  }
}

function formatRelative(date: Date | null): string {
  if (!date) return 'nie';
  const diffSec = Math.floor((Date.now() - date.getTime()) / 1000);
  if (diffSec < 60) return `vor ${diffSec}s`;
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `vor ${diffMin}m`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 48) return `vor ${diffHr}h`;
  const diffDays = Math.floor(diffHr / 24);
  if (diffDays < 30) return `vor ${diffDays}d`;
  const diffMonths = Math.floor(diffDays / 30);
  if (diffMonths < 24) return `vor ${diffMonths}M`;
  return `vor ${Math.floor(diffDays / 365)}J`;
}

// Page-segment cache: 5 minutes. Fleet-utilization is read-heavy but
// not real-time critical — admins reviewing the page can tolerate
// 5-minute-stale data. Saves dozens of aggregation queries on busy days.
export const revalidate = 300;

interface SearchParams {
  period?: string;
}

export default async function FleetUtilizationPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const user = await requireAirlineManagerWithAirlinePage();
  if (!user.airline) redirect('/dashboard');

  const params = await searchParams;
  const period = parsePeriod(params.period);
  const since = periodToSince(period);
  const airlineId = user.airline.id;

  // All four aggregations run in parallel — independent queries, no shared
  // state. Total round-trip ≈ slowest single query.
  const [airframes, hubBalance, routeCoverage] = await Promise.all([
    getAirframeUtilization(airlineId, since),
    getHubBalance(airlineId, since),
    getRouteCoverage(airlineId, since),
  ]);

  const summary = summarize(airframes);
  const typeRollup = rollupByType(airframes);

  // For per-type-cell color-scaling in matrices: max-count establishes
  // the 100% point. Reused by hub-balance + route-coverage.
  const maxHubTouches = Math.max(
    1,
    ...hubBalance.map((h) => h.departures + h.arrivals),
  );

  return (
    <main className="min-h-screen bg-gray-50 dark:bg-gray-950 text-gray-900 dark:text-white p-4 sm:p-6 lg:p-8">
      <div className="max-w-[100rem] mx-auto">
        {/* Header */}
        <header className="mb-6 pb-6 border-b border-gray-200 dark:border-gray-800">
          <div className="flex flex-wrap items-center justify-between gap-3 mb-2">
            <h1 className="text-3xl font-bold">📊 Fleet-Utilization</h1>
            <Link
              href="/airline/dashboard"
              className="px-3 py-2 bg-gray-200 hover:bg-gray-300 dark:bg-gray-800 dark:hover:bg-gray-700 rounded text-sm transition"
            >
              ← Dashboard
            </Link>
          </div>
          <p className="text-sm text-gray-600 dark:text-gray-400">
            Per-airframe + per-typ + per-hub + per-route utilization für{' '}
            <span className="font-semibold">{user.airline.name}</span>.
          </p>
        </header>

        {/* Period switcher */}
        <nav className="mb-6 flex items-center gap-2 text-sm" aria-label="Zeitraum">
          <span className="text-gray-500 dark:text-gray-400 mr-1">Zeitraum:</span>
          {(['30d', '90d', '1y', 'all'] as const).map((p) => {
            const isActive = p === period;
            return (
              <Link
                key={p}
                href={`/airline/dashboard/fleet-utilization?period=${p}`}
                className={`px-3 py-1.5 rounded transition ${
                  isActive
                    ? 'bg-blue-600 text-white'
                    : 'bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 hover:bg-gray-100 dark:hover:bg-gray-800'
                }`}
                aria-pressed={isActive}
              >
                {PERIOD_LABELS[p]}
              </Link>
            );
          })}
        </nav>

        {/* KPI summary */}
        <section className="mb-8">
          <div className="grid gap-3 grid-cols-2 sm:grid-cols-3 lg:grid-cols-5">
            <KpiCard label="Airframes gesamt" value={summary.totalAirframes} />
            <KpiCard
              label="Aktive Airframes"
              value={summary.activeAirframes}
              subline={`${summary.totalAirframes - summary.activeAirframes} inaktiv`}
            />
            <KpiCard
              label="Block-Stunden"
              value={formatHoursMinutes(summary.totalBlockMinutes)}
            />
            <KpiCard label="Flüge" value={summary.totalFlights} />
            <KpiCard
              label="Idle (0 Flüge)"
              value={summary.airframesWithZeroFlights}
              highlight={summary.airframesWithZeroFlights > 0}
              subline={
                summary.airframesWithZeroFlights > 0
                  ? 'aktive Airframes ohne Nutzung'
                  : undefined
              }
            />
          </div>
        </section>

        {/* Per-type rollup */}
        <section className="mb-10">
          <h2 className="text-lg font-semibold mb-3">Per Typ</h2>
          {typeRollup.length === 0 ? (
            <EmptyCard message="Keine Aircraft-Types — fleet ist noch leer." />
          ) : (
            <div className="rounded-xl bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 dark:bg-gray-950/50 border-b border-gray-200 dark:border-gray-800">
                  <tr>
                    <th className="px-4 py-3 text-left font-medium text-gray-500 dark:text-gray-400">Typ</th>
                    <th className="px-4 py-3 text-right font-medium text-gray-500 dark:text-gray-400">Airframes</th>
                    <th className="px-4 py-3 text-right font-medium text-gray-500 dark:text-gray-400">Aktiv</th>
                    <th className="px-4 py-3 text-right font-medium text-gray-500 dark:text-gray-400">Flüge</th>
                    <th className="px-4 py-3 text-right font-medium text-gray-500 dark:text-gray-400">Block-Stunden</th>
                    <th className="px-4 py-3 text-right font-medium text-gray-500 dark:text-gray-400">Ø pro Airframe</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200 dark:divide-gray-800">
                  {typeRollup.map((t) => {
                    const avgHours = t.activeAirframes > 0
                      ? formatHoursMinutes(Math.round(t.blockMinutes / t.activeAirframes))
                      : '—';
                    return (
                      <tr key={t.typeName} className="hover:bg-gray-50 dark:hover:bg-gray-950/30">
                        <td className="px-4 py-3 font-mono font-semibold">{t.typeName}</td>
                        <td className="px-4 py-3 text-right">{t.airframeCount}</td>
                        <td className="px-4 py-3 text-right">{t.activeAirframes}</td>
                        <td className="px-4 py-3 text-right tabular-nums">{t.flightCount}</td>
                        <td className="px-4 py-3 text-right font-semibold tabular-nums">{formatHoursMinutes(t.blockMinutes)}</td>
                        <td className="px-4 py-3 text-right text-gray-500 dark:text-gray-400 tabular-nums">{avgHours}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>

        {/* Per-airframe table */}
        <section className="mb-10">
          <h2 className="text-lg font-semibold mb-3">Per Airframe</h2>
          {airframes.length === 0 ? (
            <EmptyCard message="Keine Airframes registriert — füge welche unter /airline/aircraft hinzu." />
          ) : (
            <div className="rounded-xl bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 dark:bg-gray-950/50 border-b border-gray-200 dark:border-gray-800">
                  <tr>
                    <th className="px-4 py-3 text-left font-medium text-gray-500 dark:text-gray-400">Registrierung</th>
                    <th className="px-4 py-3 text-left font-medium text-gray-500 dark:text-gray-400">Typ</th>
                    <th className="px-4 py-3 text-left font-medium text-gray-500 dark:text-gray-400">Status</th>
                    <th className="px-4 py-3 text-left font-medium text-gray-500 dark:text-gray-400">Position</th>
                    <th className="px-4 py-3 text-right font-medium text-gray-500 dark:text-gray-400">Flüge</th>
                    <th className="px-4 py-3 text-right font-medium text-gray-500 dark:text-gray-400">Block</th>
                    <th className="px-4 py-3 text-right font-medium text-gray-500 dark:text-gray-400">Letzter Flug</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200 dark:divide-gray-800">
                  {airframes.map((a) => {
                    const isIdle = a.flightCount === 0 && a.status === 'ACTIVE';
                    const awayFromHome =
                      a.homeIcao && a.currentLocationIcao && a.homeIcao !== a.currentLocationIcao;
                    return (
                      <tr
                        key={a.aircraftId}
                        className={`hover:bg-gray-50 dark:hover:bg-gray-950/30 ${
                          isIdle ? 'bg-orange-50 dark:bg-orange-500/5' : ''
                        }`}
                      >
                        <td className="px-4 py-3 font-mono font-semibold">{a.registration}</td>
                        <td className="px-4 py-3">
                          <span className="font-mono">{a.type}</span>
                          {a.aircraftTypeName && (
                            <span className="ml-2 text-xs text-gray-500 dark:text-gray-400">
                              {a.aircraftTypeName}
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          <StatusBadge status={a.status} />
                        </td>
                        <td className="px-4 py-3 text-xs">
                          {a.currentLocationIcao ? (
                            <span className="font-mono">{a.currentLocationIcao}</span>
                          ) : (
                            <span className="text-gray-400">—</span>
                          )}
                          {awayFromHome && (
                            <span className="ml-1 text-amber-600 dark:text-amber-400" title={`Home: ${a.homeIcao}`}>
                              ⚠
                            </span>
                          )}
                          {a.homeIcao && !awayFromHome && a.currentLocationIcao && (
                            <span className="ml-1 text-emerald-600 dark:text-emerald-400" title="At home base">
                              ✓
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-right tabular-nums">{a.flightCount}</td>
                        <td className="px-4 py-3 text-right font-semibold tabular-nums">
                          {formatHoursMinutes(a.blockMinutes)}
                        </td>
                        <td
                          className="px-4 py-3 text-right text-gray-500 dark:text-gray-400 whitespace-nowrap text-xs"
                          title={a.lastFlightAt?.toISOString() ?? 'never'}
                        >
                          {formatRelative(a.lastFlightAt)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>

        {/* Hub-balance */}
        <section className="mb-10">
          <h2 className="text-lg font-semibold mb-3">Hub-Balance</h2>
          {hubBalance.length === 0 ? (
            <EmptyCard message="Keine Hubs konfiguriert — definiere welche unter /airline/hubs." />
          ) : (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {hubBalance.map((h) => {
                const total = h.departures + h.arrivals;
                const balancePct =
                  total > 0
                    ? Math.round(((h.departures - h.arrivals) / total) * 100)
                    : 0;
                const intensity = Math.round((total / maxHubTouches) * 100);
                return (
                  <div
                    key={h.hubIcao}
                    className="rounded-xl bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 p-4"
                  >
                    <div className="flex items-baseline justify-between mb-2">
                      <div>
                        <span className="font-mono font-bold text-lg">{h.hubIcao}</span>
                        {h.isPrimary && (
                          <span className="ml-2 px-1.5 py-0.5 text-xs rounded bg-blue-100 dark:bg-blue-500/15 text-blue-800 dark:text-blue-300">
                            Primary
                          </span>
                        )}
                      </div>
                      <span className="text-xs text-gray-500 dark:text-gray-400">{intensity}%</span>
                    </div>
                    {h.hubName && (
                      <p className="text-xs text-gray-500 dark:text-gray-400 mb-3 truncate">{h.hubName}</p>
                    )}
                    <div className="flex items-center justify-between text-sm mb-3">
                      <span className="text-gray-600 dark:text-gray-400">
                        🛫 {h.departures} · 🛬 {h.arrivals}
                      </span>
                      <BalanceBadge balancePct={balancePct} />
                    </div>
                    {h.byType.length > 0 && (
                      <ul className="text-xs space-y-1 border-t border-gray-200 dark:border-gray-800 pt-2">
                        {h.byType.slice(0, 5).map((t) => (
                          <li key={t.type} className="flex justify-between">
                            <span className="font-mono">{t.type}</span>
                            <span className="text-gray-500 dark:text-gray-400">
                              {t.departures}↑ / {t.arrivals}↓
                            </span>
                          </li>
                        ))}
                        {h.byType.length > 5 && (
                          <li className="text-gray-400 italic text-xs">
                            +{h.byType.length - 5} weitere Typen
                          </li>
                        )}
                      </ul>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </section>

        {/* Route-coverage */}
        <section className="mb-10">
          <h2 className="text-lg font-semibold mb-3">Routen-Coverage (Top 20)</h2>
          {routeCoverage.length === 0 ? (
            <EmptyCard message="Keine PIREPs mit Route-Bezug im gewählten Zeitraum." />
          ) : (
            <div className="rounded-xl bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 dark:bg-gray-950/50 border-b border-gray-200 dark:border-gray-800">
                  <tr>
                    <th className="px-4 py-3 text-left font-medium text-gray-500 dark:text-gray-400">Flight</th>
                    <th className="px-4 py-3 text-left font-medium text-gray-500 dark:text-gray-400">Strecke</th>
                    <th className="px-4 py-3 text-right font-medium text-gray-500 dark:text-gray-400">Flüge</th>
                    <th className="px-4 py-3 text-left font-medium text-gray-500 dark:text-gray-400">Typ-Mix</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200 dark:divide-gray-800">
                  {routeCoverage.map((r) => (
                    <tr key={r.routeId} className="hover:bg-gray-50 dark:hover:bg-gray-950/30">
                      <td className="px-4 py-3 font-mono font-semibold">{r.flightNumber}</td>
                      <td className="px-4 py-3 font-mono text-xs">
                        {r.depIcao} → {r.arrIcao}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums font-semibold">
                        {r.totalFlights}
                      </td>
                      <td className="px-4 py-3">
                        <TypeMixBar byType={r.byType} total={r.totalFlights} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </main>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// Subcomponents
// ─────────────────────────────────────────────────────────────────────────

function KpiCard({
  label,
  value,
  subline,
  highlight,
}: {
  label: string;
  value: string | number;
  subline?: string;
  highlight?: boolean;
}) {
  return (
    <div
      className={`rounded-xl p-4 border ${
        highlight
          ? 'bg-orange-50 dark:bg-orange-500/10 border-orange-200 dark:border-orange-500/30'
          : 'bg-white dark:bg-gray-900 border-gray-200 dark:border-gray-800'
      }`}
    >
      <p className="text-xs text-gray-500 dark:text-gray-400 mb-1">{label}</p>
      <p className="text-2xl font-bold tabular-nums">{value}</p>
      {subline && (
        <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">{subline}</p>
      )}
    </div>
  );
}

function EmptyCard({ message }: { message: string }) {
  return (
    <div className="rounded-xl bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 p-8 text-center">
      <p className="text-sm text-gray-500 dark:text-gray-400">{message}</p>
    </div>
  );
}

function StatusBadge({ status }: { status: 'ACTIVE' | 'MAINTENANCE' | 'STORED' | 'RETIRED' }) {
  const styles: Record<typeof status, string> = {
    ACTIVE:
      'bg-emerald-100 dark:bg-emerald-500/15 text-emerald-800 dark:text-emerald-300',
    MAINTENANCE: 'bg-amber-100 dark:bg-amber-500/15 text-amber-800 dark:text-amber-300',
    STORED: 'bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300',
    RETIRED: 'bg-rose-100 dark:bg-rose-500/15 text-rose-800 dark:text-rose-300',
  };
  const labels: Record<typeof status, string> = {
    ACTIVE: 'Aktiv',
    MAINTENANCE: 'Wartung',
    STORED: 'Eingelagert',
    RETIRED: 'Stillgelegt',
  };
  return (
    <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${styles[status]}`}>
      {labels[status]}
    </span>
  );
}

function BalanceBadge({ balancePct }: { balancePct: number }) {
  // balancePct: positive = more departures than arrivals (net-outflow,
  // pilots leaving and not returning). negative = net-inflow (arrivals
  // accumulating, possibly stuck aircraft).
  const absPct = Math.abs(balancePct);
  if (absPct <= 10) {
    return (
      <span className="px-1.5 py-0.5 text-xs rounded bg-emerald-100 dark:bg-emerald-500/15 text-emerald-800 dark:text-emerald-300">
        ⚖ ausgewogen
      </span>
    );
  }
  if (balancePct > 0) {
    return (
      <span
        className="px-1.5 py-0.5 text-xs rounded bg-amber-100 dark:bg-amber-500/15 text-amber-800 dark:text-amber-300"
        title="Mehr Abflüge als Ankünfte"
      >
        ↗ {balancePct}%
      </span>
    );
  }
  return (
    <span
      className="px-1.5 py-0.5 text-xs rounded bg-blue-100 dark:bg-blue-500/15 text-blue-800 dark:text-blue-300"
      title="Mehr Ankünfte als Abflüge"
    >
      ↙ {balancePct}%
    </span>
  );
}

/**
 * Stacked bar showing the type-mix for a route. Each segment width =
 * count / total. Hover-tooltip shows exact counts; visual scan shows
 * dominance at-a-glance. Limits to top-5 types so the bar doesn't
 * become an unreadable rainbow.
 */
function TypeMixBar({ byType, total }: { byType: Array<{ type: string; count: number }>; total: number }) {
  if (total === 0) return <span className="text-gray-400 text-xs">—</span>;

  // Color rotation; deterministic by type-name so the same type always
  // gets the same color across rows. djb2-style hash → palette index.
  const palette = [
    'bg-blue-500',
    'bg-emerald-500',
    'bg-amber-500',
    'bg-rose-500',
    'bg-violet-500',
    'bg-cyan-500',
    'bg-orange-500',
  ];
  const colorFor = (type: string): string => {
    let hash = 5381;
    for (let i = 0; i < type.length; i++) {
      hash = (hash * 33 + type.charCodeAt(i)) >>> 0;
    }
    return palette[hash % palette.length] ?? palette[0]!;
  };

  const visible = byType.slice(0, 5);
  const visibleSum = visible.reduce((s, t) => s + t.count, 0);
  const otherCount = total - visibleSum;

  return (
    <div>
      <div className="flex h-4 rounded overflow-hidden">
        {visible.map((t) => (
          <div
            key={t.type}
            className={`${colorFor(t.type)} relative group`}
            style={{ width: `${(t.count / total) * 100}%` }}
            title={`${t.type}: ${t.count} (${Math.round((t.count / total) * 100)}%)`}
          />
        ))}
        {otherCount > 0 && (
          <div
            className="bg-gray-400 dark:bg-gray-600"
            style={{ width: `${(otherCount / total) * 100}%` }}
            title={`Other: ${otherCount}`}
          />
        )}
      </div>
      <div className="flex gap-2 mt-1 text-xs flex-wrap">
        {visible.map((t) => (
          <span key={t.type} className="text-gray-600 dark:text-gray-400">
            <span className={`inline-block w-2 h-2 rounded-sm mr-1 align-middle ${colorFor(t.type)}`} />
            <span className="font-mono">{t.type}</span>
            <span className="text-gray-500 ml-1">{t.count}</span>
          </span>
        ))}
        {otherCount > 0 && (
          <span className="text-gray-500 dark:text-gray-500 text-xs italic">+{otherCount} weitere</span>
        )}
      </div>
    </div>
  );
}
