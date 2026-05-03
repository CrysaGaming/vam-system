import { auth } from '@/auth';
import { redirect, notFound } from 'next/navigation';
import { prisma } from '@vam/db';
import Link from 'next/link';

export default async function PilotProfile({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await auth();

  if (!session?.user) {
    redirect('/');
  }

  const { id } = await params;

  const currentUser = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { id: true, airlineId: true, role: { select: { name: true } } },
  });

  if (!currentUser?.airlineId) {
    redirect('/dashboard');
  }

  const pilot = await prisma.user.findUnique({
    where: { id },
    include: {
      rank: true,
      role: true,
      airline: true,
    },
  });

  if (!pilot) {
    notFound();
  }

  // Authorization: piloten der eigenen Airline sind für jeden member
  // sichtbar. System-admins dürfen ZUSÄTZLICH user anderer airlines
  // (oder ohne airline) sehen — sonst wäre der link aus /admin/pilots
  // (cross-airline übersicht) für admins kaputt. Andere rollen kriegen
  // weiter den redirect zur airline-scoped pilots-liste.
  const isAdmin = currentUser.role?.name === 'admin';
  const sameAirline = pilot.airlineId === currentUser.airlineId;

  if (!isAdmin && !sameAirline) {
    redirect('/pilots');
  }

  const isMe = pilot.id === currentUser.id;

  // Letzte 5 PIREPs
  const recentPireps = await prisma.pirep.findMany({
    where: { userId: pilot.id, status: 'Approved' },
    include: {
      route: true,
      departure: true,
      arrival: true,
      aircraft: true,
    },
    orderBy: { submittedAt: 'desc' },
    take: 5,
  });

  // Top-3 meistgeflogene Routen
  const routeCounts = await prisma.pirep.groupBy({
    by: ['routeId'],
    where: {
      userId: pilot.id,
      status: 'Approved',
      routeId: { not: null },
    },
    _count: { routeId: true },
    orderBy: { _count: { routeId: 'desc' } },
    take: 3,
  });

  const topRoutes = await Promise.all(
    routeCounts.map(async (rc) => {
      if (!rc.routeId) return null;
      const route = await prisma.route.findUnique({
        where: { id: rc.routeId },
        include: { departure: true, arrival: true },
      });
      if (!route) return null;
      return { route, count: rc._count.routeId };
    })
  );

  const topRoutesValid = topRoutes.filter((r): r is NonNullable<typeof r> => r !== null);

  // Beitrittsdauer
  const joinedDays = Math.floor(
    (Date.now() - new Date(pilot.createdAt).getTime()) / (1000 * 60 * 60 * 24)
  );

  return (
    <main className="min-h-screen bg-gray-50 dark:bg-gray-950 text-gray-900 dark:text-white p-8">
      <div className="max-w-4xl mx-auto">
        <header className="flex justify-between items-center mb-8 pb-6 border-b border-gray-200 dark:border-gray-800">
          <Link
            href="/pilots"
            className="px-4 py-2 bg-gray-200 hover:bg-gray-300 dark:bg-gray-800 dark:hover:bg-gray-700 rounded text-sm transition"
          >
            ← Alle Piloten
          </Link>
          {isMe && (
            <Link
              href="/dashboard"
              className="px-4 py-2 bg-gray-200 hover:bg-gray-300 dark:bg-gray-800 dark:hover:bg-gray-700 rounded text-sm transition"
            >
              Mein Dashboard →
            </Link>
          )}
        </header>

        {/* Profile-Header */}
        <section className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-lg p-8 mb-8">
          <div className="flex items-center gap-6">
            {pilot.image ? (
              <img
                src={pilot.image}
                alt={pilot.name ?? 'Avatar'}
                className="w-24 h-24 rounded-full border-2 border-gray-300 dark:border-gray-700"
              />
            ) : (
              <div className="w-24 h-24 rounded-full bg-gray-200 dark:bg-gray-800 border-2 border-gray-300 dark:border-gray-700" />
            )}
            <div>
              <h1 className="text-3xl font-bold flex items-center gap-3">
                {pilot.name ?? 'Unbenannt'}
                {isMe && (
                  <span
                    style={{ backgroundColor: '#6366f1' }}
                    className="px-2 py-0.5 rounded text-xs font-semibold text-white"
                  >
                    Du
                  </span>
                )}
              </h1>
              <p className="text-gray-500 dark:text-gray-400 mt-1">
                {pilot.rank?.name ?? 'Kein Rang'} · {pilot.role?.name ?? 'pilot'}
              </p>
              <p className="text-xs text-gray-500 mt-2">
                {pilot.airline?.name} · Mitglied seit{' '}
                {new Date(pilot.createdAt).toLocaleDateString('de-DE', {
                  year: 'numeric',
                  month: 'long',
                  day: 'numeric',
                })}{' '}
                ({joinedDays} {joinedDays === 1 ? 'Tag' : 'Tage'})
              </p>
            </div>
          </div>
        </section>

        {/* Stats */}
        <div className="grid md:grid-cols-3 gap-6 mb-8">
          <section className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-lg p-6 text-center">
            <p className="text-xs uppercase tracking-wider text-gray-500 mb-2">
              Flugstunden
            </p>
            <p className="text-4xl font-bold">{pilot.totalFlightHours.toFixed(1)}</p>
            <p className="text-xs text-gray-500 mt-1">Stunden geflogen</p>
          </section>

          <section className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-lg p-6 text-center">
            <p className="text-xs uppercase tracking-wider text-gray-500 mb-2">
              Flüge
            </p>
            <p className="text-4xl font-bold">{pilot.totalFlights}</p>
            <p className="text-xs text-gray-500 mt-1">PIREPs eingereicht</p>
          </section>

          <section className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-lg p-6 text-center">
            <p className="text-xs uppercase tracking-wider text-gray-500 mb-2">
              Aktueller Rang
            </p>
            <p className="text-2xl font-bold mt-1">{pilot.rank?.name ?? '—'}</p>
            {pilot.rank && (
              <p className="text-xs text-gray-500 mt-2">
                ab {pilot.rank.minFlightHours} h
              </p>
            )}
          </section>
        </div>

        {/* Top-Routen */}
        {topRoutesValid.length > 0 && (
          <section className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-lg p-6 mb-8">
            <h2 className="text-sm uppercase tracking-wider text-gray-500 mb-4">
              Meist geflogen
            </h2>
            <div className="space-y-2">
              {topRoutesValid.map((entry, idx) => (
                <div
                  key={entry.route.id}
                  className="flex justify-between items-center px-4 py-3 bg-gray-100 dark:bg-gray-800/50 rounded border border-gray-200 dark:border-gray-800"
                >
                  <div className="flex items-center gap-4">
                    <span className="text-gray-500 font-mono text-xs">
                      #{idx + 1}
                    </span>
                    <span className="font-mono text-sm text-indigo-600 dark:text-indigo-400">
                      {entry.route.flightNumber}
                    </span>
                    <span className="text-sm">
                      <span className="font-mono">{entry.route.departure.icao}</span>
                      <span className="text-gray-500 mx-2">→</span>
                      <span className="font-mono">{entry.route.arrival.icao}</span>
                    </span>
                  </div>
                  <span className="text-sm text-gray-500 dark:text-gray-400">
                    {entry.count}× geflogen
                  </span>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* Letzte Flüge */}
        <section className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-lg p-6">
          <div className="flex justify-between items-center mb-4">
            <h2 className="text-sm uppercase tracking-wider text-gray-500">
              Letzte Flüge
            </h2>
            {recentPireps.length > 0 && (
              <span className="text-xs text-gray-500">
                Nur genehmigte PIREPs
              </span>
            )}
          </div>
          {recentPireps.length === 0 ? (
            <p className="text-gray-500 dark:text-gray-400 text-sm">
              Noch keine genehmigten Flüge.
            </p>
          ) : (
            <div className="space-y-2">
              {recentPireps.map((pirep) => {
                const hours = Math.floor((pirep.flightTimeMin ?? 0) / 60);
                const mins = (pirep.flightTimeMin ?? 0) % 60;
                const flightTime = hours > 0 ? `${hours}h ${mins}min` : `${mins}min`;

                // Eigene PIREPs sind klickbar zur Detail-Page; fremde nicht
                const isClickable = isMe;
                const Wrapper = isClickable ? Link : 'div';
                const wrapperProps = isClickable
                  ? { href: `/pireps/${pirep.id}` as const }
                  : {};

                return (
                  <Wrapper
                    key={pirep.id}
                    {...(wrapperProps as any)}
                    className={`flex justify-between items-center px-4 py-3 bg-gray-100 dark:bg-gray-800/50 rounded border border-gray-200 dark:border-gray-800 transition ${
                      isClickable ? 'hover:bg-gray-200 dark:hover:bg-gray-800 hover:border-indigo-600/50' : ''
                    }`}
                  >
                    <div className="flex items-center gap-4">
                      <span className="font-mono text-sm text-indigo-600 dark:text-indigo-400">
                        {pirep.route?.flightNumber ?? '—'}
                      </span>
                      <span className="text-sm">
                        <span className="font-mono">{pirep.departure.icao}</span>
                        <span className="text-gray-500 mx-2">→</span>
                        <span className="font-mono">{pirep.arrival.icao}</span>
                      </span>
                    </div>
                    <div className="flex items-center gap-4 text-sm">
                      <span className="text-gray-500 dark:text-gray-400">{flightTime}</span>
                      {pirep.aircraft && (
                        <span className="text-gray-500 font-mono text-xs">
                          {pirep.aircraft.registration}
                        </span>
                      )}
                    </div>
                  </Wrapper>
                );
              })}
            </div>
          )}
        </section>
      </div>
    </main>
  );
}