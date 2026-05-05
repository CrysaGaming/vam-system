import { auth } from '@/auth';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import { prisma } from '@vam/db';
import { FlightSchoolForm } from './school-form';
import { ActiveToggleButton } from './active-toggle';

/**
 * System-admin liste aller FlightSchools (Welle 13E-11).
 *
 * Auth-gate: strikt admin-only — FlightSchools sind cross-airline NPC-
 * organisationen, also gehört das CRUD ins system-admin-paneel, nicht
 * zur airline-admin-area. URL-direktzugriff wird hier server-side
 * abgewiesen (sidebar rendert den link auch nur für isAdmin).
 *
 * Layout: stats-block oben, inline create-form als collapsible card,
 * danach die list mit edit-link + active-toggle pro row. Kein search/
 * filter im MVP — bei aktuellem dataset (vermutlich <50 schools) nicht
 * nötig. Wenn es mal mehr werden, kommt eine client-table-component
 * (analog admin-pilots-table) dazu.
 *
 * Sortierung: active-first (DESC), dann airport-icao (ASC), dann name
 * (ASC). Damit liegt die "interessante" liste oben und gleiche airports
 * sind gruppiert.
 */
export default async function AdminFlightSchoolsPage() {
  const session = await auth();
  if (!session?.user) redirect('/');

  const currentUser = await prisma.user.findUnique({
    where: { id: session.user.id },
    include: { role: true },
  });

  if (!currentUser?.role || currentUser.role.name !== 'admin') {
    redirect('/dashboard');
  }

  const schools = await prisma.flightSchool.findMany({
    include: {
      airport: { select: { name: true, city: true, country: true } },
      _count: { select: { enrollments: true } },
    },
    orderBy: [{ active: 'desc' }, { airportIcao: 'asc' }, { name: 'asc' }],
  });

  const activeCount = schools.filter((s) => s.active).length;
  const inactiveCount = schools.length - activeCount;
  const distinctAirports = new Set(schools.map((s) => s.airportIcao)).size;

  return (
    <main className="px-6 py-8 sm:px-10 lg:px-12 max-w-7xl">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">
          Flugschulen
        </h1>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
          System-weite NPC-Flugschulen. Piloten können sich für Lizenz-Trainings
          einschreiben (Welle 13E-12).
        </p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
        <StatCard label="Insgesamt" value={schools.length} />
        <StatCard label="Aktiv" value={activeCount} accent="green" />
        <StatCard label="Inaktiv" value={inactiveCount} accent="gray" />
        <StatCard label="Airports" value={distinctAirports} />
      </div>

      {/* Inline create-form */}
      <details className="mb-8 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-lg overflow-hidden">
        <summary className="px-5 py-3 cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-800/50 transition flex items-center justify-between">
          <span className="font-semibold text-sm">+ Neue Flugschule anlegen</span>
          <span className="text-xs text-gray-500">Klicken zum Aufklappen</span>
        </summary>
        <div className="px-5 pb-5 pt-2 border-t border-gray-200 dark:border-gray-800">
          <FlightSchoolForm mode="create" />
        </div>
      </details>

      {/* List */}
      {schools.length === 0 ? (
        <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-lg p-12 text-center">
          <p className="text-gray-500 dark:text-gray-400 italic">
            Noch keine Flugschulen angelegt. Klick oben auf „+ Neue Flugschule anlegen".
          </p>
        </div>
      ) : (
        <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 dark:bg-gray-950 border-b border-gray-200 dark:border-gray-800">
              <tr className="text-left text-xs uppercase tracking-wider text-gray-500">
                <th className="px-4 py-3">Schule</th>
                <th className="px-4 py-3">Airport</th>
                <th className="px-4 py-3">Lizenzen</th>
                <th className="px-4 py-3 text-right">Tarife (VAM$/h)</th>
                <th className="px-4 py-3 text-right">Pilots</th>
                <th className="px-4 py-3 text-center">Status</th>
                <th className="px-4 py-3 text-right"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200 dark:divide-gray-800">
              {schools.map((s) => (
                <tr key={s.id} className={s.active ? '' : 'opacity-60'}>
                  <td className="px-4 py-3">
                    <Link
                      href={`/admin/flight-schools/${s.id}`}
                      className="font-medium text-gray-900 dark:text-white hover:text-indigo-600 dark:hover:text-indigo-400 transition"
                    >
                      {s.name}
                    </Link>
                    <p className="text-xs text-gray-500 mt-0.5">
                      ★ {s.rating.toFixed(1)}
                    </p>
                  </td>
                  <td className="px-4 py-3 text-xs">
                    <p className="font-mono font-semibold">{s.airportIcao}</p>
                    <p className="text-gray-500 truncate max-w-[10rem]">
                      {s.airport.name}
                    </p>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap gap-1">
                      {s.offeredLicenses.slice(0, 4).map((lic) => (
                        <span
                          key={lic}
                          className="px-1.5 py-0.5 rounded text-[10px] font-mono bg-indigo-50 dark:bg-indigo-500/10 text-indigo-700 dark:text-indigo-300"
                        >
                          {lic}
                        </span>
                      ))}
                      {s.offeredLicenses.length > 4 && (
                        <span className="px-1.5 py-0.5 rounded text-[10px] font-mono bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400">
                          +{s.offeredLicenses.length - 4}
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-right text-xs">
                    <p>
                      <span className="text-gray-500">Theorie:</span>{' '}
                      <span className="font-mono font-semibold">
                        {Number(s.hourlyRateGround).toFixed(0)}
                      </span>
                    </p>
                    <p>
                      <span className="text-gray-500">Flug:</span>{' '}
                      <span className="font-mono font-semibold">
                        {Number(s.hourlyRateAir).toFixed(0)}
                      </span>
                    </p>
                    {s.hourlyRateSim && (
                      <p>
                        <span className="text-gray-500">Sim:</span>{' '}
                        <span className="font-mono font-semibold">
                          {Number(s.hourlyRateSim).toFixed(0)}
                        </span>
                      </p>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right text-sm font-mono">
                    {s._count.enrollments}
                  </td>
                  <td className="px-4 py-3 text-center">
                    <ActiveToggleButton schoolId={s.id} active={s.active} />
                  </td>
                  <td className="px-4 py-3 text-right">
                    <Link
                      href={`/admin/flight-schools/${s.id}`}
                      className="text-xs text-indigo-600 dark:text-indigo-400 hover:underline"
                    >
                      Bearbeiten →
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </main>
  );
}

function StatCard({
  label,
  value,
  accent,
}: {
  label: string;
  value: number;
  accent?: 'green' | 'gray';
}) {
  const accentClass =
    accent === 'green'
      ? 'text-green-700 dark:text-green-400'
      : accent === 'gray'
        ? 'text-gray-500 dark:text-gray-400'
        : 'text-gray-900 dark:text-white';
  return (
    <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-lg p-4">
      <p className="text-xs uppercase tracking-wider text-gray-500 dark:text-gray-400">
        {label}
      </p>
      <p className={`text-2xl font-bold mt-1 ${accentClass}`}>{value}</p>
    </div>
  );
}
