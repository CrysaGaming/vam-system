import { notFound } from 'next/navigation';
import { prisma } from '@vam/db';
import { getPublicAirline, FALLBACK_PRIMARY } from '../_lib/airline';

/**
 * /a/[icao]/hubs — Public hub list (Welle 8 commit 8B-2).
 *
 * Shows ALL hubs (no pagination — realistic upper bound is ~10 per airline).
 * Primary hub is rendered first with a colored accent bar. Secondary hubs
 * follow alphabetically by ICAO.
 *
 * Data exposed: airport ICAO, IATA, name, city, country, hub-isPrimary
 * flag. Internal AirlineHub fields (createdAt, internal notes) are NOT
 * surfaced — public surface should be minimal.
 */
export default async function PublicAirlineHubsPage({
  params,
}: {
  params: Promise<{ icao: string }>;
}) {
  const { icao: icaoRaw } = await params;
  const airline = await getPublicAirline(icaoRaw);
  if (!airline) {
    notFound();
  }

  const hubs = await prisma.airlineHub.findMany({
    where: { airlineId: airline.id },
    include: {
      airport: {
        select: {
          icao: true,
          iata: true,
          name: true,
          city: true,
          country: true,
        },
      },
    },
    orderBy: [{ isPrimary: 'desc' }, { airportIcao: 'asc' }],
  });

  const primary = airline.primaryColor ?? FALLBACK_PRIMARY;

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-bold">Hubs</h1>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
          {hubs.length === 0
            ? 'Noch keine hubs definiert.'
            : `${hubs.length} ${hubs.length === 1 ? 'hub' : 'hubs'} insgesamt`}
        </p>
      </header>

      {hubs.length > 0 && (
        <ul className="space-y-3">
          {hubs.map((h) => (
            <li
              key={h.id}
              className="bg-white dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-800 overflow-hidden"
            >
              <div className="flex">
                {/* Accent bar — colored only for primary hub */}
                <div
                  className="w-1 flex-shrink-0"
                  style={{
                    backgroundColor: h.isPrimary ? primary : 'transparent',
                  }}
                  aria-hidden="true"
                />
                <div className="flex-1 p-4 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-mono font-bold text-lg">
                        {h.airport.icao}
                      </span>
                      {h.airport.iata && (
                        <span className="text-xs text-gray-500 dark:text-gray-400 font-mono">
                          {h.airport.iata}
                        </span>
                      )}
                      {h.isPrimary && (
                        <span
                          className="text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded text-white"
                          style={{ backgroundColor: primary }}
                        >
                          Primary
                        </span>
                      )}
                    </div>
                    <div className="text-sm text-gray-700 dark:text-gray-300 mt-1">
                      {h.airport.name}
                    </div>
                  </div>
                  <div className="text-xs text-gray-500 dark:text-gray-400 text-right">
                    {h.airport.city && <div>{h.airport.city}</div>}
                    {h.airport.country && (
                      <div className="font-mono">{h.airport.country}</div>
                    )}
                  </div>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
