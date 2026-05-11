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

  // Track 4 #62 (Section L): Recent-Activity-aggregation.
  //
  // Für jeden pilot in der airline holen wir den max(submittedAt) ihrer
  // approved PIREPs. groupBy ist hier effizient — eine query liefert
  // last-activity für alle piloten gleichzeitig. Bei airlines mit dutzenden
  // bis ~100 mitgliedern ist das billig, sogar wenn jeder pilot tausende
  // PIREPs hat (groupBy nutzt den (userId, submittedAt)-index am Pirep).
  //
  // _max statt _avg/_count weil wir nur den letzten zeitstempel brauchen.
  // Piloten ohne approved-PIREPs haben keinen eintrag im result-array —
  // wir bauen eine map mit lookup-fallback null = "noch nie geflogen".
  //
  // Status='Approved' weil draft/submitted/rejected nicht als "aktiv"
  // zählt — pilot muss eine bestätigte landung haben.
  const lastActivityByUser = await prisma.pirep.groupBy({
    by: ['userId'],
    where: {
      airlineId: currentUser.airlineId,
      status: 'Approved',
    },
    _max: { submittedAt: true },
  });
  const lastActiveMap = new Map(
    lastActivityByUser.map((row) => [row.userId, row._max.submittedAt]),
  );

  // Helper für die "vor X tagen"-anzeige. Gibt {label, colorClass} zurück.
  // Color-coding folgt aktivitäts-rhythmus für eine flight-sim hobby:
  //   <7d   → emerald (very-active, fliegt regelmässig)
  //   <30d  → indigo  (active, normal cadence)
  //   <90d  → amber   (occasional, kommt rein und raus)
  //   ≥90d  → rose    (dormant, lange nicht geflogen)
  //   never → gray italic (noch nie geflogen)
  function formatLastActive(date: Date | null): {
    label: string;
    color: string;
  } {
    if (!date) {
      return {
        label: 'noch nie',
        color: 'text-gray-400 dark:text-gray-600 italic',
      };
    }
    const diffMs = Date.now() - new Date(date).getTime();
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
    let label: string;
    if (diffDays === 0) label = 'heute';
    else if (diffDays === 1) label = 'gestern';
    else if (diffDays < 7) label = `vor ${diffDays} Tagen`;
    else if (diffDays < 30) {
      const w = Math.floor(diffDays / 7);
      label = `vor ${w} ${w === 1 ? 'Woche' : 'Wochen'}`;
    } else if (diffDays < 365) {
      const m = Math.floor(diffDays / 30);
      label = `vor ${m} ${m === 1 ? 'Monat' : 'Monaten'}`;
    } else {
      const y = Math.floor(diffDays / 365);
      label = `vor ${y} ${y === 1 ? 'Jahr' : 'Jahren'}`;
    }
    let color: string;
    if (diffDays < 7) color = 'text-emerald-600 dark:text-emerald-400';
    else if (diffDays < 30) color = 'text-indigo-600 dark:text-indigo-400';
    else if (diffDays < 90) color = 'text-amber-600 dark:text-amber-400';
    else color = 'text-rose-600 dark:text-rose-400';
    return { label, color };
  }

  return (
    <main className="min-h-screen bg-gray-50 dark:bg-gray-950 text-gray-900 dark:text-white p-4 sm:p-6 lg:p-8">
      <div className="max-w-[100rem] mx-auto">
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
                  <th className="px-4 py-3 text-right">Letzter Flug</th>
                  <th className="px-4 py-3 text-right">Beigetreten</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200 dark:divide-gray-800">
                {pilots.map((pilot, idx) => {
                  const isMe = pilot.id === currentUser.id;
                  const medal = idx === 0 ? '🥇' : idx === 1 ? '🥈' : idx === 2 ? '🥉' : null;
                  const lastActive = formatLastActive(
                    lastActiveMap.get(pilot.id) ?? null,
                  );

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
                      <td className="px-4 py-3 text-right text-xs">
                        <Link
                          href={`/pilots/${pilot.id}`}
                          className={`block font-medium ${lastActive.color}`}
                          title={
                            lastActiveMap.get(pilot.id)
                              ? new Date(
                                  lastActiveMap.get(pilot.id)!,
                                ).toLocaleString('de-DE')
                              : undefined
                          }
                        >
                          {lastActive.label}
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
