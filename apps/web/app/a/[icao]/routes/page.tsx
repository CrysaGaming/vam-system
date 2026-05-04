import { notFound } from 'next/navigation';
import { prisma } from '@vam/db';
import { getPublicAirline } from '../_lib/airline';

/**
 * /a/[icao]/routes — Public route list (Welle 8 commit 8B-2).
 *
 * Shows only `active=true` routes — disabled / archived routes are
 * internal-state and shouldn't appear publicly. Sorted by flight number
 * (alphanumeric, so "LH401" comes before "LH4010" thanks to lexical sort,
 * which is the convention airlines use).
 *
 * Per row: flight number, dep→arr (ICAO + airport name), aircraft type
 * (preferring the type-designator string over assigned-aircraft.type;
 * see Route.aircraftTypeIcao docstring in schema for why both exist),
 * distance, duration. No pagination — even large airlines rarely have
 * more than a few hundred routes.
 */
export default async function PublicAirlineRoutesPage({
  params,
}: {
  params: Promise<{ icao: string }>;
}) {
  const { icao: icaoRaw } = await params;
  const airline = await getPublicAirline(icaoRaw);
  if (!airline) {
    notFound();
  }

  const routes = await prisma.route.findMany({
    where: { airlineId: airline.id, active: true },
    select: {
      id: true,
      flightNumber: true,
      aircraftTypeIcao: true,
      estimatedMinutes: true,
      distanceNm: true,
      departure: { select: { icao: true, name: true, city: true } },
      arrival: { select: { icao: true, name: true, city: true } },
      aircraft: { select: { type: true } },
    },
    orderBy: { flightNumber: 'asc' },
  });

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-bold">Routes</h1>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
          {routes.length === 0
            ? 'Noch keine aktiven routes definiert.'
            : `${routes.length} aktive ${routes.length === 1 ? 'route' : 'routes'}`}
        </p>
      </header>

      {routes.length > 0 && (
        <div className="bg-white dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-800 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-100 dark:bg-gray-800/50">
                <tr className="text-left text-xs uppercase tracking-wider text-gray-500 dark:text-gray-400">
                  <th className="px-4 py-3">Flug</th>
                  <th className="px-4 py-3">Von</th>
                  <th className="px-4 py-3">Nach</th>
                  <th className="px-4 py-3">Typ</th>
                  <th className="px-4 py-3 text-right">Distanz</th>
                  <th className="px-4 py-3 text-right">Block</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200 dark:divide-gray-800">
                {routes.map((r) => {
                  // Prefer the explicit type-designator (added in Welle 5
                  // for type-based scheduling); fall back to assigned-
                  // aircraft.type for legacy routes that pre-date the field.
                  const typeLabel = r.aircraftTypeIcao ?? r.aircraft?.type ?? '—';
                  return (
                    <tr
                      key={r.id}
                      className="hover:bg-gray-50 dark:hover:bg-gray-800/30 transition"
                    >
                      <td className="px-4 py-2.5 font-mono font-semibold">
                        {r.flightNumber}
                      </td>
                      <td className="px-4 py-2.5">
                        <div className="font-mono">{r.departure.icao}</div>
                        <div className="text-[11px] text-gray-500 dark:text-gray-400 truncate max-w-[12rem]">
                          {r.departure.city ?? r.departure.name}
                        </div>
                      </td>
                      <td className="px-4 py-2.5">
                        <div className="font-mono">{r.arrival.icao}</div>
                        <div className="text-[11px] text-gray-500 dark:text-gray-400 truncate max-w-[12rem]">
                          {r.arrival.city ?? r.arrival.name}
                        </div>
                      </td>
                      <td className="px-4 py-2.5 font-mono text-xs text-gray-700 dark:text-gray-300">
                        {typeLabel}
                      </td>
                      <td className="px-4 py-2.5 text-right text-xs text-gray-700 dark:text-gray-300 tabular-nums">
                        {r.distanceNm.toLocaleString('de-DE')} nm
                      </td>
                      <td className="px-4 py-2.5 text-right text-xs text-gray-700 dark:text-gray-300 tabular-nums">
                        {formatBlockTime(r.estimatedMinutes)}
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
  );
}

/**
 * Block time formatter — minutes → "Hh MMm" (e.g. 95 → "1h 35m").
 * Sub-1h shows "55m"; multi-hour shows "2h 15m".
 */
function formatBlockTime(minutes: number): string {
  if (minutes < 60) return `${minutes}m`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m === 0 ? `${h}h` : `${h}h ${m.toString().padStart(2, '0')}m`;
}
