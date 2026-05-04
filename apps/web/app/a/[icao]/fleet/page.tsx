import { notFound } from 'next/navigation';
import { prisma } from '@vam/db';
import { getPublicAirline, FALLBACK_PRIMARY } from '../_lib/airline';

/**
 * /a/[icao]/fleet — Public fleet list (Welle 8 commit 8B-2).
 *
 * Aircraft grouped by ICAO type-designator (B738, A20N, A359 …) — the
 * grouping mirrors the most common way airlines and spotters think about
 * fleets ("how many 737s do they operate?"). Within each group, sorted
 * by registration.
 *
 * Status (Active/Maintenance/Stored from Welle 5) is intentionally NOT
 * surfaced here — public viewers don't need to know operational state,
 * and exposing "Maintenance" feels gossipy. If demand for this comes up,
 * additive feature later.
 */
export default async function PublicAirlineFleetPage({
  params,
}: {
  params: Promise<{ icao: string }>;
}) {
  const { icao: icaoRaw } = await params;
  const airline = await getPublicAirline(icaoRaw);
  if (!airline) {
    notFound();
  }

  const aircraft = await prisma.aircraft.findMany({
    where: { airlineId: airline.id },
    select: { id: true, registration: true, type: true },
    orderBy: [{ type: 'asc' }, { registration: 'asc' }],
  });

  // Group by type. Sorted query already sorts by type-then-registration,
  // so an in-order pass produces correctly sorted groups + members.
  const grouped = new Map<string, typeof aircraft>();
  for (const a of aircraft) {
    const existing = grouped.get(a.type);
    if (existing) existing.push(a);
    else grouped.set(a.type, [a]);
  }

  const primary = airline.primaryColor ?? FALLBACK_PRIMARY;

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-bold">Fleet</h1>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
          {aircraft.length === 0
            ? 'Noch keine aircraft registriert.'
            : `${aircraft.length} ${aircraft.length === 1 ? 'aircraft' : 'aircraft'} in ${grouped.size} ${grouped.size === 1 ? 'typ' : 'typen'}`}
        </p>
      </header>

      {aircraft.length > 0 && (
        <div className="space-y-6">
          {Array.from(grouped.entries()).map(([type, members]) => (
            <section
              key={type}
              className="bg-white dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-800 overflow-hidden"
            >
              <header className="px-4 py-2.5 bg-gray-100 dark:bg-gray-800/50 border-b border-gray-200 dark:border-gray-800 flex items-baseline justify-between">
                <h2 className="text-sm font-bold font-mono">{type}</h2>
                <span
                  className="text-xs tabular-nums font-semibold"
                  style={{ color: primary }}
                >
                  {members.length}
                </span>
              </header>
              <ul className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-px bg-gray-200 dark:bg-gray-800">
                {members.map((a) => (
                  <li
                    key={a.id}
                    className="bg-white dark:bg-gray-900 p-3 text-center"
                  >
                    <div className="font-mono font-semibold text-sm">
                      {a.registration}
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
