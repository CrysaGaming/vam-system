import { prisma } from '@vam/db';
import { requireAirlineManagerWithAirlinePage } from '@/lib/roles';
import Link from 'next/link';
import { AddHubForm } from './add-hub-form';
import { HubActionsButtons } from './hub-actions-buttons';

/**
 * /airline/hubs — Hub-Verwaltung für airline-admins. Listet alle hubs der
 * eigenen airline mit primary-badge, add-form, set-primary + remove-actions.
 *
 * Auth-gate: spiegelt AIRLINE_MANAGER_ROLES in airline/hubs/actions.ts.
 *
 * Layout-decisions:
 * - Server-component für initial-render (kein client-fetch-flicker)
 * - Add-form oben damit das primary-feature ("hub anlegen") sofort sichtbar ist
 * - Cards statt table weil typische airline 1-5 hubs hat (low density,
 *   informationen pro entry sind wichtig: airport-name, city, primary-status)
 * - Empty-state mit hint auf airline.primaryHub-implications
 *
 * Welle 4 scope:
 * - CRUD für hubs (add, set-primary, remove)
 * - Catalog-validation (hub muss verifizierter airport sein)
 * - Multi-tenant gates (airline kann nur eigene hubs ändern)
 *
 * Out-of-scope (kommt später):
 * - Pilot-rebalance-flow bei hub-removal
 * - Hub-details (gates, ATC-coverage, scheduling-rules) → Welle 7+
 * - Map-view aller hubs → Welle 6+ (zusammen mit route-map)
 */
export default async function AirlineHubsPage() {
  const user = await requireAirlineManagerWithAirlinePage();
  const hubs = await prisma.airlineHub.findMany({
    where: { airlineId: user.airlineId },
    include: {
      airport: {
        select: {
          icao: true,
          iata: true,
          name: true,
          city: true,
          country: true,
          type: true,
        },
      },
    },
    // Primary first, dann alphabetisch nach ICAO. Pilot soll den primary-hub
    // sofort oben sehen.
    orderBy: [{ isPrimary: 'desc' }, { airportIcao: 'asc' }],
  });

  const primaryHub = hubs.find((h) => h.isPrimary);
  const isOnlyHub = hubs.length === 1;

  // Pilot-counts pro hub: zeigt admin wie viele piloten ihren baseIcao
  // auf welchem hub haben. Hilft bei rebalance-decisions ("kann ich
  // FRA als primary entfernen wenn 80% der pilots dort basieren?").
  // Ist zwar keine FK-relation (baseIcao ist String), aber app-level-
  // count via groupBy.
  const pilotCounts = await prisma.user.groupBy({
    by: ['baseIcao'],
    where: {
      airlineId: user.airlineId,
      baseIcao: { not: null },
    },
    _count: { _all: true },
  });
  const pilotCountByIcao = Object.fromEntries(
    pilotCounts.map((p) => [p.baseIcao!, p._count._all]),
  );

  return (
    <main className="min-h-screen bg-gray-50 dark:bg-gray-950 text-gray-900 dark:text-white p-4 sm:p-6 lg:p-8">
      <div className="max-w-5xl mx-auto">
        {/* Header */}
        <header className="flex flex-wrap justify-between items-start gap-4 mb-8 pb-6 border-b border-gray-200 dark:border-gray-800">
          <div>
            <h1 className="text-3xl font-bold">Hub-Verwaltung</h1>
            <p className="text-gray-500 dark:text-gray-400 text-sm mt-1">
              {user.airline.name} —{' '}
              {hubs.length === 0
                ? 'Noch keine Hubs angelegt'
                : `${hubs.length} Hub${hubs.length === 1 ? '' : 's'}${primaryHub ? `, Primary: ${primaryHub.airportIcao}` : ''}`}
            </p>
          </div>

          <Link
            href="/dashboard"
            className="px-3 py-2 bg-gray-200 hover:bg-gray-300 dark:bg-gray-800 dark:hover:bg-gray-700 rounded text-sm transition"
          >
            ← Dashboard
          </Link>
        </header>

        {/* Add-form section */}
        <section className="mb-8 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-lg p-6">
          <h2 className="text-lg font-semibold mb-1">Neuen Hub hinzufügen</h2>
          <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
            ICAO eingeben (z.B. EDDF). Der Airport muss bereits im System-
            Catalog existieren — sonst erst über{' '}
            <Link
              href="/airports/request"
              className="text-indigo-600 dark:text-indigo-400 hover:underline"
            >
              Airport-Antrag
            </Link>{' '}
            anlegen lassen.
          </p>
          <AddHubForm />
        </section>

        {/* Hubs list */}
        <section>
          <h2 className="text-lg font-semibold mb-4">Aktive Hubs</h2>

          {hubs.length === 0 ? (
            <div className="bg-white dark:bg-gray-900 border border-dashed border-gray-300 dark:border-gray-700 rounded-lg p-8 text-center">
              <p className="text-gray-500 dark:text-gray-400">
                Noch keine Hubs angelegt.
              </p>
              <p className="text-sm text-gray-400 dark:text-gray-500 mt-2">
                Lege deinen ersten Hub an — er wird automatisch zum Primary-Hub
                deiner Airline.
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {hubs.map((hub) => {
                const pilotCount = pilotCountByIcao[hub.airportIcao] ?? 0;
                return (
                  <div
                    key={hub.id}
                    className={`bg-white dark:bg-gray-900 border rounded-lg p-4 sm:p-5 transition ${
                      hub.isPrimary
                        ? 'border-indigo-500/50 dark:border-indigo-500/40 shadow-sm shadow-indigo-500/10'
                        : 'border-gray-200 dark:border-gray-800'
                    }`}
                  >
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="flex-1 min-w-[200px]">
                        <div className="flex items-center gap-2 flex-wrap">
                          <h3 className="text-lg font-semibold">
                            {hub.airportIcao}
                            {hub.airport.iata && (
                              <span className="text-sm text-gray-500 dark:text-gray-400 font-normal ml-2">
                                / {hub.airport.iata}
                              </span>
                            )}
                          </h3>
                          {hub.isPrimary && (
                            <span className="inline-flex items-center px-2 py-0.5 text-xs font-medium rounded bg-indigo-500/15 text-indigo-700 dark:text-indigo-300 border border-indigo-500/30">
                              ★ Primary
                            </span>
                          )}
                          {hub.airport.type === 'large_airport' && (
                            <span className="inline-flex items-center px-2 py-0.5 text-xs rounded bg-gray-200 dark:bg-gray-800 text-gray-600 dark:text-gray-400">
                              Large
                            </span>
                          )}
                        </div>
                        <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">
                          {hub.airport.name}
                        </p>
                        <p className="text-xs text-gray-500 dark:text-gray-500 mt-0.5">
                          {hub.airport.city
                            ? `${hub.airport.city}, ${hub.airport.country}`
                            : hub.airport.country}
                          {' · '}
                          Angelegt {hub.createdAt.toLocaleDateString('de-DE')}
                          {pilotCount > 0 &&
                            ` · ${pilotCount} Pilot${pilotCount === 1 ? '' : 'en'} basiert hier`}
                        </p>
                      </div>

                      <HubActionsButtons
                        hubId={hub.id}
                        airportIcao={hub.airportIcao}
                        isPrimary={hub.isPrimary}
                        isOnlyHub={isOnlyHub}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>

        {/* Info-footer: erklärt was hubs in Welle 4 bedeuten */}
        <aside className="mt-10 bg-gray-100 dark:bg-gray-900/50 border border-gray-200 dark:border-gray-800 rounded-lg p-5 text-sm text-gray-600 dark:text-gray-400 space-y-2">
          <p>
            <strong className="text-gray-700 dark:text-gray-300">Was ist ein Hub?</strong>{' '}
            Ein Hub ist ein Airport, an dem deine Airline scheduling beginnt
            und Piloten ihre Base haben können. Der Primary-Hub ist der
            Default-Anchor für neue Piloten und für scheduling-views.
          </p>
          <p>
            <strong className="text-gray-700 dark:text-gray-300">Multi-Hub:</strong>{' '}
            Du kannst beliebig viele Hubs anlegen (z.B. EDDF + EDDM für eine
            Lufthansa-style Airline). Genau einer ist immer Primary.
          </p>
        </aside>
      </div>
    </main>
  );
}
