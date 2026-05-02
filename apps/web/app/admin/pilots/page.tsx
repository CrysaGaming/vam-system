import { auth } from '@/auth';
import { redirect } from 'next/navigation';
import { prisma } from '@vam/db';
import Link from 'next/link';

/**
 * Admin-only globale Piloten-übersicht. Zeigt ALLE user des VAM-Systems
 * — cross-airline, inklusive user ohne airline-zugehörigkeit.
 *
 * Abgrenzung zu /pilots: dort werden nur user der eigenen airline
 * gefiltert (where: { airlineId: currentUser.airlineId }) — das ist
 * die "Mitglieder meiner Airline"-ansicht für alle airline-members.
 * Diese page hier ist die "alle user von VAM-System"-ansicht und
 * gehört in den Admin-sektor des Sidebars.
 *
 * Auth-gate: strict admin-only. airline-admin / instructor sollen das
 * NICHT sehen — sie haben nur airline-scoped management-rechte über
 * /airline (members ihrer eigenen airline). Cross-airline-sicht ist
 * eine system-admin-funktion.
 *
 * Performance-anmerkung: prisma.user.findMany ohne pagination scannt
 * die ganze user-tabelle. Bei aktuell ~handvoll usern unkritisch; bei
 * wachsender userbase muss eine offset/cursor-pagination + suchfeld
 * dazu (analog /admin/requests pattern). Für jetzt absichtlich simpel
 * gehalten — skill-fragmentierung passiert wenn 100+ user da sind.
 */
export default async function AdminPilotsList() {
  const session = await auth();

  if (!session?.user) {
    redirect('/');
  }

  // Page-level admin-gate. Spiegelt requireAdmin() in admin/roles/actions.ts.
  // Im Sidebar (AppShell.tsx Admin-sektor) wird der link nur für isAdmin
  // gerendert, aber wir prüfen hier nochmal weil URL-direktzugriff diesen
  // client-seitigen gate umgeht. Backend-gates sind die echte safety-line.
  const currentUser = await prisma.user.findUnique({
    where: { id: session.user.id },
    include: { role: true },
  });

  if (!currentUser?.role || currentUser.role.name !== 'admin') {
    redirect('/dashboard');
  }

  // Alle user fetchen, mit rank/role/airline für die anzeige. Sortierung:
  // erstmal nach airline-name (alphabetisch, user ohne airline ans ende),
  // dann innerhalb der airline nach flugstunden — so sieht man pro airline
  // wer der aktivste pilot ist. user.airline ist optional FK; null-cases
  // landen via Prisma's nulls-last default am ende.
  const users = await prisma.user.findMany({
    include: {
      rank: true,
      role: true,
      airline: { select: { id: true, name: true, icao: true } },
    },
    orderBy: [
      { airline: { name: 'asc' } },
      { totalFlightHours: 'desc' },
      { totalFlights: 'desc' },
      { createdAt: 'asc' },
    ],
  });

  // Aggregate: anzahl distinct airlines + user ohne airline. Hilft dem
  // admin sofort zu sehen "hier sind 23 piloten verteilt auf 4 airlines,
  // 2 ohne airline" ohne die ganze tabelle zu scrollen.
  const distinctAirlineIds = new Set(
    users.map((u) => u.airlineId).filter((id): id is string => id !== null),
  );
  const airlineCount = distinctAirlineIds.size;
  const noAirlineCount = users.filter((u) => !u.airlineId).length;

  return (
    <main className="min-h-screen bg-gray-50 dark:bg-gray-950 text-gray-900 dark:text-white p-4 sm:p-6 lg:p-8">
      <div className="max-w-[100rem] mx-auto">
        <header className="flex justify-between items-center mb-8 pb-6 border-b border-gray-200 dark:border-gray-800">
          <div>
            <h1 className="text-3xl font-bold">Alle Piloten</h1>
            <p className="text-gray-500 dark:text-gray-400 text-sm mt-1">
              {users.length} {users.length === 1 ? 'User' : 'User'} im VAM-System
              {airlineCount > 0 && (
                <>
                  {' · '}
                  {airlineCount} {airlineCount === 1 ? 'Airline' : 'Airlines'}
                </>
              )}
              {noAirlineCount > 0 && (
                <>
                  {' · '}
                  {noAirlineCount} ohne Airline
                </>
              )}
            </p>
          </div>
          <Link
            href="/dashboard"
            className="px-4 py-2 bg-gray-200 hover:bg-gray-300 dark:bg-gray-800 dark:hover:bg-gray-700 rounded text-sm transition"
          >
            ← Dashboard
          </Link>
        </header>

        {users.length === 0 ? (
          <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-lg p-12 text-center">
            <p className="text-gray-500 dark:text-gray-400">Noch keine User registriert.</p>
          </div>
        ) : (
          <div className="bg-white dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-800 overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-gray-100 dark:bg-gray-800/50">
                <tr className="text-left text-xs uppercase tracking-wider text-gray-500 dark:text-gray-400">
                  <th className="px-4 py-3">Pilot</th>
                  <th className="px-4 py-3">Airline</th>
                  <th className="px-4 py-3">Rang</th>
                  <th className="px-4 py-3">Rolle</th>
                  <th className="px-4 py-3 text-right">Stunden</th>
                  <th className="px-4 py-3 text-right">Flüge</th>
                  <th className="px-4 py-3 text-right">Registriert</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200 dark:divide-gray-800">
                {users.map((user) => {
                  const isMe = user.id === currentUser.id;

                  return (
                    <tr
                      key={user.id}
                      className={`group transition cursor-pointer ${
                        isMe
                          ? 'bg-indigo-500/5 hover:bg-indigo-500/10'
                          : 'hover:bg-gray-50 dark:hover:bg-gray-800/30'
                      }`}
                    >
                      <td className="px-4 py-3">
                        {/* Detail-link zeigt aktuell auf /pilots/[id] — die
                            existing pilot-detail-page ist nicht airline-
                            gegated im sinne von "muss in derselben airline
                            sein", daher funktioniert der link auch wenn der
                            target-user in einer anderen airline ist. Falls
                            das je hard-gegated wird, müsste hier eine
                            admin-only /admin/pilots/[id] route entstehen. */}
                        <Link
                          href={`/pilots/${user.id}`}
                          className="flex items-center gap-3"
                        >
                          {user.image ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img
                              src={user.image}
                              alt={user.name ?? 'Avatar'}
                              className="w-8 h-8 rounded-full border border-gray-300 dark:border-gray-700"
                            />
                          ) : (
                            <div className="w-8 h-8 rounded-full bg-gray-200 dark:bg-gray-800 border border-gray-300 dark:border-gray-700" />
                          )}
                          <div>
                            <p className="font-semibold flex items-center gap-2">
                              {user.name ?? 'Unbenannt'}
                              {isMe && (
                                <span className="text-xs text-indigo-600 dark:text-indigo-400">(Du)</span>
                              )}
                            </p>
                            <p className="text-xs text-gray-500 dark:text-gray-500 truncate max-w-[14rem]">
                              {user.email}
                            </p>
                          </div>
                        </Link>
                      </td>
                      <td className="px-4 py-3">
                        {user.airline ? (
                          <div className="flex items-center gap-2">
                            <span className="font-mono text-xs text-gray-500 dark:text-gray-400">
                              {user.airline.icao}
                            </span>
                            <span className="text-gray-700 dark:text-gray-300 truncate max-w-[10rem]">
                              {user.airline.name}
                            </span>
                          </div>
                        ) : (
                          <span className="text-xs italic text-gray-400 dark:text-gray-600">
                            keine
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-gray-600 dark:text-gray-300">
                        {user.rank?.name ?? '—'}
                      </td>
                      <td className="px-4 py-3 text-gray-600 dark:text-gray-300">
                        {user.role?.name ?? '—'}
                      </td>
                      <td className="px-4 py-3 text-right">
                        {user.totalFlightHours.toFixed(1)} h
                      </td>
                      <td className="px-4 py-3 text-right">{user.totalFlights}</td>
                      <td className="px-4 py-3 text-right text-gray-500 dark:text-gray-400 text-xs">
                        {new Date(user.createdAt).toLocaleDateString('de-DE', {
                          year: 'numeric',
                          month: '2-digit',
                          day: '2-digit',
                        })}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </main>
  );
}
