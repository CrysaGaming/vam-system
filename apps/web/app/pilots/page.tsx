import { auth } from '@/auth';
import { redirect } from 'next/navigation';
import { prisma } from '@vam/db';
import Link from 'next/link';

export default async function PilotsList() {
  const session = await auth();

  if (!session?.user) {
    redirect('/');
  }

  const currentUser = await prisma.user.findUnique({
    where: { id: session.user.id },
    include: { airline: true },
  });

  if (!currentUser?.airlineId) {
    redirect('/dashboard');
  }

  const pilots = await prisma.user.findMany({
    where: { airlineId: currentUser.airlineId },
    include: { rank: true, role: true },
    orderBy: [
      { totalFlightHours: 'desc' },
      { totalFlights: 'desc' },
      { createdAt: 'asc' },
    ],
  });

  return (
    <main className="min-h-screen bg-gray-50 dark:bg-gray-950 text-gray-900 dark:text-white p-8">
      <div className="max-w-6xl mx-auto">
        <header className="flex justify-between items-center mb-8 pb-6 border-b border-gray-200 dark:border-gray-800">
          <div>
            <h1 className="text-3xl font-bold">Piloten</h1>
            <p className="text-gray-500 dark:text-gray-400 text-sm mt-1">
              {pilots.length} {pilots.length === 1 ? 'Mitglied' : 'Mitglieder'} bei{' '}
              {currentUser.airline?.name}
            </p>
          </div>
          <Link
            href="/dashboard"
            className="px-4 py-2 bg-gray-200 hover:bg-gray-300 dark:bg-gray-800 dark:hover:bg-gray-700 rounded text-sm transition"
          >
            ← Dashboard
          </Link>
        </header>

        {pilots.length === 0 ? (
          <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-lg p-12 text-center">
            <p className="text-gray-500 dark:text-gray-400">Noch keine Piloten in dieser Airline.</p>
          </div>
        ) : (
          <div className="bg-white dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-800 overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-gray-100 dark:bg-gray-800/50">
                <tr className="text-left text-xs uppercase tracking-wider text-gray-500 dark:text-gray-400">
                  <th className="px-4 py-3">Pilot</th>
                  <th className="px-4 py-3">Rang</th>
                  <th className="px-4 py-3">Rolle</th>
                  <th className="px-4 py-3 text-right">Stunden</th>
                  <th className="px-4 py-3 text-right">Flüge</th>
                  <th className="px-4 py-3 text-right">Beigetreten</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200 dark:divide-gray-800">
                {pilots.map((pilot, idx) => {
                  const isMe = pilot.id === currentUser.id;
                  const medal = idx === 0 ? '🥇' : idx === 1 ? '🥈' : idx === 2 ? '🥉' : null;

                  return (
                    <tr
                      key={pilot.id}
                      className={`group transition cursor-pointer ${
                        isMe ? 'bg-indigo-500/5 hover:bg-indigo-500/10' : 'hover:bg-gray-50 dark:hover:bg-gray-800/30'
                      }`}
                    >
                      <td className="px-4 py-3">
                        <Link
                          href={`/pilots/${pilot.id}`}
                          className="flex items-center gap-3"
                        >
                          {pilot.image ? (
                            <img
                              src={pilot.image}
                              alt={pilot.name ?? 'Avatar'}
                              className="w-8 h-8 rounded-full border border-gray-300 dark:border-gray-700"
                            />
                          ) : (
                            <div className="w-8 h-8 rounded-full bg-gray-200 dark:bg-gray-800 border border-gray-300 dark:border-gray-700" />
                          )}
                          <div>
                            <p className="font-semibold flex items-center gap-2">
                              {medal && <span>{medal}</span>}
                              {pilot.name ?? 'Unbenannt'}
                              {isMe && (
                                <span className="text-xs text-indigo-600 dark:text-indigo-400">(Du)</span>
                              )}
                            </p>
                          </div>
                        </Link>
                      </td>
                      <td className="px-4 py-3 text-gray-600 dark:text-gray-300">
                        <Link href={`/pilots/${pilot.id}`} className="block">
                          {pilot.rank?.name ?? '—'}
                        </Link>
                      </td>
                      <td className="px-4 py-3 text-gray-600 dark:text-gray-300">
                        <Link href={`/pilots/${pilot.id}`} className="block">
                          {pilot.role?.name ?? 'pilot'}
                        </Link>
                      </td>
                      <td className="px-4 py-3 text-right">
                        <Link href={`/pilots/${pilot.id}`} className="block">
                          {pilot.totalFlightHours.toFixed(1)} h
                        </Link>
                      </td>
                      <td className="px-4 py-3 text-right">
                        <Link href={`/pilots/${pilot.id}`} className="block">
                          {pilot.totalFlights}
                        </Link>
                      </td>
                      <td className="px-4 py-3 text-right text-gray-500 dark:text-gray-400 text-xs">
                        <Link href={`/pilots/${pilot.id}`} className="block">
                          {new Date(pilot.createdAt).toLocaleDateString('de-DE', {
                            year: 'numeric',
                            month: '2-digit',
                            day: '2-digit',
                          })}
                        </Link>
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
