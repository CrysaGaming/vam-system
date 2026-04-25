import { auth } from '@/auth';
import { redirect } from 'next/navigation';
import { prisma } from '@vam/db';
import Link from 'next/link';

const ALLOWED_ROLES = ['admin', 'instructor'];

export default async function PirepsPending() {
  const session = await auth();

  if (!session?.user) {
    redirect('/');
  }

  const currentUser = await prisma.user.findUnique({
    where: { id: session.user.id },
    include: { role: true, airline: true },
  });

  if (!currentUser) {
    redirect('/');
  }

  // Authorization: nur admin/instructor
  if (!currentUser.role || !ALLOWED_ROLES.includes(currentUser.role.name)) {
    redirect('/dashboard');
  }

  if (!currentUser.airlineId) {
    redirect('/dashboard');
  }

  // Alle pending PIREPs der Airline
  const pending = await prisma.pirep.findMany({
    where: {
      airlineId: currentUser.airlineId,
      status: 'Submitted',
    },
    include: {
      route: true,
      departure: true,
      arrival: true,
      aircraft: true,
      user: {
        include: { rank: true },
      },
    },
    orderBy: { submittedAt: 'asc' }, // älteste zuerst — fair Queue
  });

  return (
    <main className="min-h-screen bg-gray-950 text-white p-8">
      <div className="max-w-6xl mx-auto">
        <header className="flex justify-between items-center mb-8 pb-6 border-b border-gray-800">
          <div>
            <h1 className="text-3xl font-bold">PIREPs zur Prüfung</h1>
            <p className="text-gray-400 text-sm mt-1">
              {pending.length === 0
                ? 'Keine PIREPs warten aktuell auf Prüfung'
                : `${pending.length} ${pending.length === 1 ? 'PIREP wartet' : 'PIREPs warten'} auf Prüfung`}
            </p>
          </div>
          <div className="flex gap-3">
            <Link
              href="/dashboard"
              className="px-4 py-2 bg-gray-800 hover:bg-gray-700 rounded text-sm transition"
            >
              ← Dashboard
            </Link>
            <Link
              href="/pireps"
              className="px-4 py-2 bg-gray-800 hover:bg-gray-700 rounded text-sm transition"
            >
              Meine PIREPs
            </Link>
          </div>
        </header>

        {pending.length === 0 ? (
          <div className="bg-gray-900 border border-gray-800 rounded-lg p-12 text-center">
            <p className="text-5xl mb-4">✅</p>
            <p className="text-gray-300 font-semibold mb-2">
              Alle PIREPs sind geprüft.
            </p>
            <p className="text-gray-500 text-sm">
              Wenn neue Berichte eingereicht werden, erscheinen sie hier.
            </p>
          </div>
        ) : (
          <div className="bg-gray-900 rounded-lg border border-gray-800 overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-gray-800/50">
                <tr className="text-left text-xs uppercase tracking-wider text-gray-400">
                  <th className="px-4 py-3">Pilot</th>
                  <th className="px-4 py-3">Flug</th>
                  <th className="px-4 py-3">Strecke</th>
                  <th className="px-4 py-3">Aircraft</th>
                  <th className="px-4 py-3 text-right">Dauer</th>
                  <th className="px-4 py-3 text-right">Eingereicht</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-800">
                {pending.map((p) => (
                  <tr
                    key={p.id}
                    className="hover:bg-gray-800/30 transition group cursor-pointer"
                  >
                    <td className="px-4 py-3">
                      <Link href={`/pireps/${p.id}`} className="block">
                        <p className="font-semibold">{p.user.name ?? '—'}</p>
                        <p className="text-xs text-gray-500">
                          {p.user.rank?.name ?? '—'}
                        </p>
                      </Link>
                    </td>
                    <td className="px-4 py-3 font-mono font-semibold">
                      <Link
                        href={`/pireps/${p.id}`}
                        className="block text-indigo-400"
                      >
                        {p.route?.flightNumber ?? '—'}
                      </Link>
                    </td>
                    <td className="px-4 py-3 text-gray-300">
                      <Link href={`/pireps/${p.id}`} className="block">
                        {p.departure.icao} → {p.arrival.icao}
                      </Link>
                    </td>
                    <td className="px-4 py-3 text-gray-300">
                      <Link href={`/pireps/${p.id}`} className="block">
                        {p.aircraft?.registration ?? '—'}
                      </Link>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <Link href={`/pireps/${p.id}`} className="block">
                        {p.flightTimeMin
                          ? `${Math.floor(p.flightTimeMin / 60)}h ${p.flightTimeMin % 60}min`
                          : '—'}
                      </Link>
                    </td>
                    <td className="px-4 py-3 text-right text-gray-400 text-xs">
                      <Link href={`/pireps/${p.id}`} className="block">
                        {new Date(p.submittedAt).toLocaleString('de-DE', {
                          dateStyle: 'short',
                          timeStyle: 'short',
                        })}
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </main>
  );
}