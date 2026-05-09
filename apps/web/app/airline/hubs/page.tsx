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
          id: true,
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

  // Track 4 #39 (Section G): Pro hub die operative aktivität aggregieren —
  // hilft admin zu sehen welche hubs wirklich genutzt werden und welche
  // ggf. dead weight sind. 3 metriken:
  //   1. Routes mit departure ODER arrival auf diesem hub
  //   2. Aircraft mit homeIcao = hub
  //   3. Last-30-day PIREPs mit dep/arr auf diesem hub
  // Alle 3 in parallel, sequentiell wäre 3× round-trip.
  //
  // Note: PIREP nutzt FK-IDs (departureId/arrivalId auf Airport.id), Route
  // und Aircraft nutzen ICAO-strings. Wir bauen daher zwei lookup-richtungen:
  // hubIcaos für Route/Aircraft-queries, hubAirportIds + airportIdToIcao
  // für PIREP-queries.
  const hubIcaos = hubs.map((h) => h.airportIcao);
  const hubAirportIds = hubs.map((h) => h.airport.id);
  const airportIdToIcao = new Map(hubs.map((h) => [h.airport.id, h.airportIcao]));
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

  const [routesPerHub, aircraftPerHub, recentPirepsDeparture, recentPirepsArrival] =
    hubIcaos.length === 0
      ? [[], [], [], []]
      : await Promise.all([
          // Routes mit departure ODER arrival auf einem hub-airport. Route
          // nutzt — wie PIREP — FK-IDs, also filter via departureId/arrivalId
          // mit hubAirportIds. Selectiere beide IDs + active flag damit wir
          // pro hub aggregieren können (loop-routes counten in beiden).
          prisma.route.findMany({
            where: {
              airlineId: user.airlineId,
              OR: [
                { departureId: { in: hubAirportIds } },
                { arrivalId: { in: hubAirportIds } },
              ],
            },
            select: { departureId: true, arrivalId: true, active: true },
          }),
          // Aircraft.homeIcao ist String (kein FK), match per equality.
          prisma.aircraft.groupBy({
            by: ['homeIcao'],
            where: {
              airlineId: user.airlineId,
              homeIcao: { in: hubIcaos },
            },
            _count: { _all: true },
          }),
          // Recent-30d PIREPs: Approved + dep oder arr auf hub. Wir teilen
          // das in zwei queries (departure + arrival) damit ein PIREP der
          // von hub A nach hub B fliegt einmal für A und einmal für B
          // gezählt wird. Pirep nutzt FK-IDs, daher groupBy auf departureId/
          // arrivalId mit airport-id-filter.
          prisma.pirep.groupBy({
            by: ['departureId'],
            where: {
              airlineId: user.airlineId,
              status: 'Approved',
              approvedAt: { gte: thirtyDaysAgo },
              departureId: { in: hubAirportIds },
            },
            _count: { _all: true },
          }),
          prisma.pirep.groupBy({
            by: ['arrivalId'],
            where: {
              airlineId: user.airlineId,
              status: 'Approved',
              approvedAt: { gte: thirtyDaysAgo },
              arrivalId: { in: hubAirportIds },
            },
            _count: { _all: true },
          }),
        ]);

  // Aggregate route-counts pro hub: total + active-only. Map airport-ID
  // wieder zurück auf ICAO damit alle stats-maps konsistent gekeyed sind.
  const routesByHub = new Map<string, { total: number; active: number }>();
  for (const icao of hubIcaos) routesByHub.set(icao, { total: 0, active: 0 });
  for (const r of routesPerHub) {
    for (const id of [r.departureId, r.arrivalId]) {
      const icao = airportIdToIcao.get(id);
      if (!icao) continue;
      const entry = routesByHub.get(icao)!;
      entry.total += 1;
      if (r.active) entry.active += 1;
    }
  }

  const aircraftCountByIcao = Object.fromEntries(
    aircraftPerHub
      .filter((a) => a.homeIcao !== null)
      .map((a) => [a.homeIcao!, a._count._all]),
  );

  // PIREP-counts: dep + arr summieren pro hub. Wir mappen airport-id zurück
  // auf icao um die map mit dem rest der app zu unifyen.
  const recentPirepsByHub = new Map<string, number>();
  for (const icao of hubIcaos) recentPirepsByHub.set(icao, 0);
  for (const row of recentPirepsDeparture) {
    const icao = airportIdToIcao.get(row.departureId);
    if (icao) {
      recentPirepsByHub.set(icao, (recentPirepsByHub.get(icao) ?? 0) + row._count._all);
    }
  }
  for (const row of recentPirepsArrival) {
    const icao = airportIdToIcao.get(row.arrivalId);
    if (icao) {
      recentPirepsByHub.set(icao, (recentPirepsByHub.get(icao) ?? 0) + row._count._all);
    }
  }

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
                // Track 4 #39: per-hub stats für die activity-grid.
                const routeStats = routesByHub.get(hub.airportIcao) ?? { total: 0, active: 0 };
                const aircraftCount = aircraftCountByIcao[hub.airportIcao] ?? 0;
                const recentPireps = recentPirepsByHub.get(hub.airportIcao) ?? 0;
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
                        </p>
                      </div>

                      <HubActionsButtons
                        hubId={hub.id}
                        airportIcao={hub.airportIcao}
                        isPrimary={hub.isPrimary}
                        isOnlyHub={isOnlyHub}
                      />
                    </div>

                    {/* Track 4 #39 (Section G): Stats-grid pro hub. 4 metriken
                        in einer reihe — Routes, Aircraft, Pilots, Recent-PIREPs.
                        Bei null-werten zeigen wir trotzdem die "0" damit der
                        admin sieht "ja, hub existiert aber wird nicht genutzt".
                        Subtle separator-border oben, kompakte tabular-nums
                        damit zahlen aligned sind. */}
                    <div className="mt-4 pt-3 border-t border-gray-100 dark:border-gray-800/50 grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
                      <HubStat
                        icon="🛣️"
                        label="Routes"
                        value={
                          routeStats.total === 0
                            ? '0'
                            : routeStats.active === routeStats.total
                              ? String(routeStats.total)
                              : `${routeStats.active} / ${routeStats.total}`
                        }
                        sub={
                          routeStats.total > 0 && routeStats.active !== routeStats.total
                            ? 'aktiv / total'
                            : routeStats.total === 1
                              ? 'Route'
                              : 'Routes'
                        }
                      />
                      <HubStat
                        icon="✈️"
                        label="Aircraft"
                        value={String(aircraftCount)}
                        sub={
                          aircraftCount === 0
                            ? 'keine basiert hier'
                            : aircraftCount === 1
                              ? 'basiert hier'
                              : 'basieren hier'
                        }
                      />
                      <HubStat
                        icon="👥"
                        label="Piloten"
                        value={String(pilotCount)}
                        sub={
                          pilotCount === 0
                            ? 'kein Base'
                            : pilotCount === 1
                              ? 'Base hier'
                              : 'Bases hier'
                        }
                      />
                      <HubStat
                        icon="📈"
                        label="Aktivität"
                        value={String(recentPireps)}
                        sub={
                          recentPireps === 0
                            ? 'kein Verkehr (30d)'
                            : recentPireps === 1
                              ? 'PIREP (30d)'
                              : 'PIREPs (30d)'
                        }
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

/**
 * Track 4 #39 (Section G): Compact stat-card für die hub-activity-grid.
 * 4 davon nebeneinander pro hub. Icon + label oben, value prominent
 * mittig, sub als context-hint unten.
 */
function HubStat({
  icon,
  label,
  value,
  sub,
}: {
  icon: string;
  label: string;
  value: string;
  sub: string;
}) {
  return (
    <div>
      <p className="text-[10px] uppercase tracking-wide text-gray-500 dark:text-gray-500 flex items-center gap-1">
        <span aria-hidden="true">{icon}</span>
        {label}
      </p>
      <p className="text-base font-semibold tabular-nums mt-0.5">{value}</p>
      <p className="text-[11px] text-gray-500 dark:text-gray-500">{sub}</p>
    </div>
  );
}
