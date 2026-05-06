import { prisma } from '@vam/db';
import { requireAirlineManagerWithAirlinePage } from '@/lib/roles';
import Link from 'next/link';
import { DeleteRouteButton } from './delete-route-button';

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
                    <th className="px-4 py-3 text-center">Status</th>
                    <th className="px-4 py-3 text-right">Aktionen</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200 dark:divide-gray-800">
                  {routes.map((route) => {
                    const refsTotal = route._count.pireps + route._count.bookings;
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
