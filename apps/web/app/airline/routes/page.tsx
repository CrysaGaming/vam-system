import { prisma } from '@vam/db';
import { requireAirlineManagerWithAirlinePage } from '@/lib/roles';
import Link from 'next/link';
import { DeleteRouteButton } from './delete-route-button';

/**
 * Track 4 #36 (Section G): Profitability-classification per route.
 *
 * Net pro route = sum(transaction.amount where pirep.routeId == route.id
 * AND pirep.status == Approved). REVENUE_* tx haben positive amounts,
 * EXPENSE_* haben negative — direkter sum gibt net. Wir nutzen explizite
 * type-whitelist statt "alle tx" damit SALARY/TRANSFER/ADJUSTMENT/
 * ECONOMY_RESET nicht reinrutschen — die haben nichts mit der route an
 * sich zu tun (interne airline-buchungen).
 *
 * Approved-only: pending/draft/rejected PIREPs verzerren die zahlen
 * (rejected hat oft schon partial-tx, draft hat noch keine endgültige
 * settlement-pass). Erst nach approval ist die net-zahl stabil.
 *
 * Klassifikation gegen den airline-weiten avg-net-per-flight:
 *   - "Cash-Cow"  → net/flight > 1.2× airline-avg UND net > 0
 *   - "Loss-Maker"→ net < 0
 *   - "Break-Even"→ alles dazwischen
 *   - "—" (keine badge) → wenn route weniger als 3 PIREPs hat (zu wenig
 *     daten für stabile aussage)
 *
 * Threshold 1.2× ist heuristik: nicht jeder route über avg ist eine
 * cash-cow, sonst wären 50% aller routes welche. 20% headroom filtert
 * auf die wirklich starken routes. Bei airline mit 1 route ist avg ===
 * route-net, also wird Cash-Cow nur ab 20% positivem outlier gezeigt —
 * was bei 1 route nie eintritt → keine badge bis genug routes da sind
 * für sinnvollen vergleich.
 *
 * Naming-konvention: amount kommt als Decimal (VAM$/EUR, kein cents),
 * wir konvertieren via Number() — bei tx-werten <10^15 ist der precision-
 * loss vernachlässigbar.
 */
const PROFIT_REVENUE_TYPES = [
  'REVENUE_PASSENGER',
  'REVENUE_CARGO',
  'REVENUE_TICKET_TWITCH',
  'REVENUE_STREAM_REWARD',
] as const;

const PROFIT_EXPENSE_TYPES = [
  'EXPENSE_FUEL',
  'EXPENSE_LANDING_FEE',
  'EXPENSE_GROUND_HANDLING',
  'EXPENSE_CATERING',
  'EXPENSE_MAINTENANCE',
] as const;

type ProfitClass = 'cash-cow' | 'loss-maker' | 'break-even' | 'insufficient-data';

function classifyProfit(
  netAmount: number,
  flightCount: number,
  airlineAvgPerFlight: number,
): ProfitClass {
  if (flightCount < 3) return 'insufficient-data';
  if (netAmount < 0) return 'loss-maker';
  const perFlight = netAmount / flightCount;
  if (perFlight > 1.2 * airlineAvgPerFlight && netAmount > 0) return 'cash-cow';
  return 'break-even';
}

/**
 * Track 4 #36: Visual-badge für die profit-class. Compact (passt in eine
 * tabellen-spalte), self-explanatory mit emoji + label, tooltip mit konkreten
 * zahlen für hover-detail.
 */
function ProfitBadge({
  profitClass,
  netAmount,
  flightCount,
}: {
  profitClass: ProfitClass;
  netAmount: number;
  flightCount: number;
}) {
  if (profitClass === 'insufficient-data') {
    return (
      <span
        className="text-xs text-gray-400 dark:text-gray-600"
        title={`Nur ${flightCount} approved PIREPs — mind. 3 für klassifikation`}
      >
        —
      </span>
    );
  }

  const tooltip = `Net ${netAmount.toFixed(0)} VAM$ über ${flightCount} flüge (${(netAmount / flightCount).toFixed(0)} VAM$/flug)`;

  if (profitClass === 'cash-cow') {
    return (
      <span
        className="inline-block px-2 py-0.5 text-xs rounded bg-emerald-100 dark:bg-emerald-500/20 text-emerald-700 dark:text-emerald-300"
        title={tooltip}
      >
        💰 Cash-Cow
      </span>
    );
  }
  if (profitClass === 'loss-maker') {
    return (
      <span
        className="inline-block px-2 py-0.5 text-xs rounded bg-red-100 dark:bg-red-500/20 text-red-700 dark:text-red-300"
        title={tooltip}
      >
        📉 Loss
      </span>
    );
  }
  return (
    <span
      className="inline-block px-2 py-0.5 text-xs rounded bg-gray-100 dark:bg-gray-700/50 text-gray-600 dark:text-gray-400"
      title={tooltip}
    >
      Break-Even
    </span>
  );
}

/**
 * /airline/routes — Routen-Verwaltung für airline-admins. Listet alle
 * routes der eigenen airline (active + inactive) mit edit/delete-actions.
 *
 * Auth-gate: spiegelt AIRLINE_MANAGER_ROLES in airline/routes/actions.ts.
 * Wenn die liste hier divergiert, sieht user den sidebar-link aber landet
 * auf /dashboard zurück — gleiches pattern wie /airline.
 *
 * Layout-decisions:
 * - Server-component für initial-render (kein client-fetch-flicker)
 * - Table statt cards weil typische airline 50-200 routes hat (high
 *   information density bevorzugt)
 * - Inactive-routes mit grauem badge + opacity statt versteckt — admin
 *   soll seine deaktivierten routes sehen können um sie zu reactivaten
 * - Action-buttons rechts statt context-menu: 2 actions ist zu wenig
 *   für ein dropdown-overhead
 *
 * Out-of-scope für commit 1:
 * - Server-side pagination (kommt wenn jemand 500+ routes hat)
 * - Multi-column-sort (alphabetisch nach flightNumber reicht)
 * - Bulk-actions (delete-all, deactivate-all) — gefährlich, später
 */
export default async function AirlineRoutesPage() {
  const user = await requireAirlineManagerWithAirlinePage();
  const routes = await prisma.route.findMany({
    where: { airlineId: user.airlineId },
    include: {
      departure: { select: { icao: true, iata: true, city: true } },
      arrival: { select: { icao: true, iata: true, city: true } },
      _count: { select: { pireps: true, bookings: true } },
    },
    orderBy: [{ active: 'desc' }, { flightNumber: 'asc' }],
  });

  // Track 4 #36 (Section G): Profit-data fetch parallel zur routes-query
  // wäre ideal, aber Prisma-include-counts und transaction-filter unterscheiden
  // sich genug dass wir das bewusst sequentiell halten — die zweite query
  // läuft erst nach airlineId resolution. Fetch alle approved-tx der airline
  // mit routeId !== null und whitelist-type. Aggregation in-memory: typisch
  // ~50 routes × N tx ist sub-1k rows, kein bottleneck.
  const profitTxs = await prisma.transaction.findMany({
    where: {
      pirep: {
        airlineId: user.airlineId,
        status: 'Approved',
        routeId: { not: null },
      },
      type: { in: [...PROFIT_REVENUE_TYPES, ...PROFIT_EXPENSE_TYPES] },
    },
    select: {
      amount: true,
      pirep: { select: { id: true, routeId: true } },
    },
  });

  // Aggregate: routeId → { net, distinct pirep-count }. distinct-count via
  // Set damit mehrere tx pro PIREP (z.B. fuel + landing) den flightCount
  // nicht doppelt zählen.
  const profitPerRoute = new Map<string, { net: number; pirepIds: Set<string> }>();
  for (const tx of profitTxs) {
    if (!tx.pirep || !tx.pirep.routeId) continue;
    const rid = tx.pirep.routeId;
    const entry = profitPerRoute.get(rid) ?? { net: 0, pirepIds: new Set<string>() };
    entry.net += Number(tx.amount);
    entry.pirepIds.add(tx.pirep.id);
    profitPerRoute.set(rid, entry);
  }

  // Airline-weiter avg-net-per-flight als baseline für Cash-Cow-vergleich.
  // Nur über routes mit ≥3 PIREPs damit ausreißer (eine route mit 1 super-
  // profit-flug) den avg nicht künstlich hochziehen. Alternative wäre
  // median, aber arithmetic mean ist intuitiver und für die Cash-Cow-
  // schwelle (1.2× avg) reicht's.
  let totalNet = 0;
  let totalFlights = 0;
  for (const r of profitPerRoute.values()) {
    if (r.pirepIds.size < 3) continue;
    totalNet += r.net;
    totalFlights += r.pirepIds.size;
  }
  const airlineAvgPerFlight = totalFlights > 0 ? totalNet / totalFlights : 0;

  const activeCount = routes.filter((r) => r.active).length;
  const inactiveCount = routes.length - activeCount;

  return (
    <main className="min-h-screen bg-gray-50 dark:bg-gray-950 text-gray-900 dark:text-white p-4 sm:p-6 lg:p-8">
      <div className="max-w-[100rem] mx-auto">
        {/* Header */}
        <header className="flex flex-wrap justify-between items-start gap-4 mb-8 pb-6 border-b border-gray-200 dark:border-gray-800">
          <div>
            <h1 className="text-3xl font-bold">Routen-Verwaltung</h1>
            <p className="text-gray-500 dark:text-gray-400 text-sm mt-1">
              {activeCount} aktiv
              {inactiveCount > 0 && `, ${inactiveCount} inaktiv`}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Link
              href="/airline/routes/import"
              className="px-3 py-2 bg-gray-200 hover:bg-gray-300 dark:bg-gray-800 dark:hover:bg-gray-700 rounded text-sm transition flex items-center gap-2"
            >
              <span aria-hidden="true">📥</span>
              CSV importieren
            </Link>
            <Link
              href="/airline/routes/new"
              className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded text-sm font-medium transition flex items-center gap-2"
            >
              <span aria-hidden="true">+</span>
              Neue Route
            </Link>
          </div>
        </header>

        {/* Empty-state oder table */}
        {routes.length === 0 ? (
          <EmptyState />
        ) : (
          <div className="bg-white dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-800 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-100 dark:bg-gray-800/50">
                  <tr className="text-left text-xs uppercase tracking-wider text-gray-500 dark:text-gray-400">
                    <th className="px-4 py-3">Flug</th>
                    <th className="px-4 py-3">Von</th>
                    <th className="px-4 py-3">Nach</th>
                    <th className="px-4 py-3">Type</th>
                    <th className="px-4 py-3 text-right">Distanz</th>
                    <th className="px-4 py-3 text-right">Dauer</th>
                    <th className="px-4 py-3 text-center">Profit</th>
                    <th className="px-4 py-3 text-center">Status</th>
                    <th className="px-4 py-3 text-right">Aktionen</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200 dark:divide-gray-800">
                  {routes.map((route) => {
                    const refsTotal = route._count.pireps + route._count.bookings;
                    // Track 4 #36: profit-lookup pro route. Wenn keine
                    // approved-tx existieren, default zu 0/0 → ProfitBadge
                    // rendert "—" (insufficient-data).
                    const profitEntry = profitPerRoute.get(route.id);
                    const profitNet = profitEntry?.net ?? 0;
                    const profitFlightCount = profitEntry?.pirepIds.size ?? 0;
                    const profitClass = classifyProfit(
                      profitNet,
                      profitFlightCount,
                      airlineAvgPerFlight,
                    );
                    return (
                      <tr
                        key={route.id}
                        className={`hover:bg-gray-50 dark:hover:bg-gray-800/30 transition ${
                          !route.active ? 'opacity-60' : ''
                        }`}
                      >
                        <td className="px-4 py-3 font-mono font-semibold">
                          {route.flightNumber}
                        </td>
                        <td className="px-4 py-3">
                          <div className="font-mono">{route.departure.icao}</div>
                          {route.departure.city && (
                            <div className="text-xs text-gray-500">
                              {route.departure.city}
                            </div>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          <div className="font-mono">{route.arrival.icao}</div>
                          {route.arrival.city && (
                            <div className="text-xs text-gray-500">{route.arrival.city}</div>
                          )}
                        </td>
                        <td className="px-4 py-3 font-mono text-xs text-gray-600 dark:text-gray-300">
                          {route.aircraftTypeIcao ?? '—'}
                        </td>
                        <td className="px-4 py-3 text-right text-gray-600 dark:text-gray-300">
                          {route.distanceNm} nm
                        </td>
                        <td className="px-4 py-3 text-right text-gray-600 dark:text-gray-300">
                          {Math.floor(route.estimatedMinutes / 60)}h{' '}
                          {route.estimatedMinutes % 60}min
                        </td>
                        <td className="px-4 py-3 text-center">
                          <ProfitBadge
                            profitClass={profitClass}
                            netAmount={profitNet}
                            flightCount={profitFlightCount}
                          />
                        </td>
                        <td className="px-4 py-3 text-center">
                          {route.active ? (
                            <span className="inline-block px-2 py-0.5 text-xs rounded bg-green-100 dark:bg-green-500/20 text-green-700 dark:text-green-300">
                              Aktiv
                            </span>
                          ) : (
                            <span className="inline-block px-2 py-0.5 text-xs rounded bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300">
                              Inaktiv
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center justify-end gap-3">
                            <Link
                              href={`/airline/routes/${route.id}/edit`}
                              className="text-xs text-indigo-600 dark:text-indigo-400 hover:text-indigo-700 dark:hover:text-indigo-300 transition"
                            >
                              Bearbeiten
                            </Link>
                            <DeleteRouteButton
                              routeId={route.id}
                              flightNumber={route.flightNumber}
                            />
                          </div>
                          {refsTotal > 0 && (
                            <div className="text-[10px] text-gray-400 mt-0.5 text-right">
                              {refsTotal} verknüpft
                            </div>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </main>
  );
}

function EmptyState() {
  return (
    <div className="bg-white dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-800 p-12 text-center">
      <div className="text-5xl mb-4" aria-hidden="true">
        🛣️
      </div>
      <h2 className="text-xl font-semibold mb-2">Noch keine routes angelegt</h2>
      <p className="text-sm text-gray-500 dark:text-gray-400 mb-6 max-w-md mx-auto">
        Lege deine erste route manuell an oder importiere mehrere routes auf einmal aus einer
        CSV-datei (Excel-kompatibel).
      </p>
      <div className="flex justify-center gap-3">
        <Link
          href="/airline/routes/new"
          className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded text-sm font-medium transition"
        >
          Erste route anlegen
        </Link>
        <Link
          href="/airline/routes/import"
          className="px-4 py-2 bg-gray-200 hover:bg-gray-300 dark:bg-gray-800 dark:hover:bg-gray-700 rounded text-sm transition"
        >
          CSV importieren
        </Link>
      </div>
    </div>
  );
}
