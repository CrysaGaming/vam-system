/**
 * Welle K / K5 — Inter-airline-trip browse feed.
 *
 * Route: /trips
 *
 * Server-component, force-dynamic (always-fresh participant counts).
 * Listet alle Proposed/Confirmed trips, sortiert by scheduledAt asc
 * (nächste-trips-zuerst).
 */

import { auth } from '@/auth';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import { prisma } from '@vam/db';

export const dynamic = 'force-dynamic';

export default async function TripsBrowsePage() {
  const session = await auth();
  if (!session?.user?.id) redirect('/');

  const trips = await prisma.interAirlineTrip.findMany({
    where: {
      status: { in: ['Proposed', 'Confirmed'] },
      scheduledAt: { gte: new Date(Date.now() - 1000 * 60 * 60 * 24) },
    },
    orderBy: { scheduledAt: 'asc' },
    take: 50,
    select: {
      id: true,
      title: true,
      departureIcao: true,
      arrivalIcao: true,
      scheduledAt: true,
      status: true,
      maxParticipants: true,
      organizerAirline: { select: { icao: true, name: true } },
      organizerUser: { select: { name: true } },
      _count: { select: { participants: true } },
    },
  });

  return (
    <main className="min-h-screen bg-background p-4 text-foreground sm:p-8">
      <div className="mx-auto max-w-3xl">
        <header className="mb-6 flex items-start justify-between border-b border-border pb-4">
          <div>
            <p className="text-xs uppercase tracking-wider text-muted-foreground">
              Community
            </p>
            <h1 className="mt-1 text-2xl font-bold sm:text-3xl">
              🤝 Inter-Airline-Trips
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Joint-flights airline-übergreifend. Erstelle einen trip oder
              schließe dich anderen an.
            </p>
          </div>
          <Link
            href="/trips/new"
            className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700"
          >
            + Neuer Trip
          </Link>
        </header>

        <div className="mb-4 flex items-center justify-between text-sm">
          <span className="text-muted-foreground">
            {trips.length} aktive trip{trips.length === 1 ? '' : 's'}
          </span>
          <Link
            href="/me/trips"
            className="text-indigo-600 hover:underline dark:text-indigo-400"
          >
            Meine Trips →
          </Link>
        </div>

        {trips.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border bg-card p-12 text-center">
            <div className="mb-3 text-5xl">🛫</div>
            <h2 className="text-lg font-semibold">Aktuell keine geplanten Trips</h2>
            <p className="mt-2 text-sm text-muted-foreground">
              Sei der erste — erstelle einen joint-flight für die community.
            </p>
            <Link
              href="/trips/new"
              className="mt-4 inline-block rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700"
            >
              Trip erstellen
            </Link>
          </div>
        ) : (
          <ul className="space-y-3">
            {trips.map((t) => (
              <li key={t.id} className="rounded-lg border border-border bg-card p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span
                        className={`rounded-md border px-1.5 py-0.5 text-xs font-medium ${
                          t.status === 'Confirmed'
                            ? 'border-green-500/30 bg-green-500/10 text-green-700 dark:text-green-300'
                            : 'border-yellow-500/30 bg-yellow-500/10 text-yellow-700 dark:text-yellow-300'
                        }`}
                      >
                        {t.status}
                      </span>
                      <Link
                        href={`/trips/${t.id}`}
                        className="truncate text-base font-semibold hover:text-indigo-600 dark:hover:text-indigo-400"
                      >
                        {t.title}
                      </Link>
                    </div>
                    <p className="mt-1 font-mono text-sm">
                      {t.departureIcao} → {t.arrivalIcao}
                    </p>
                    <div className="mt-2 flex flex-wrap gap-2 text-xs text-muted-foreground">
                      <span>
                        🗓️{' '}
                        {t.scheduledAt.toLocaleString('de-DE', {
                          dateStyle: 'short',
                          timeStyle: 'short',
                        })}
                      </span>
                      <span>
                        👥 {t._count.participants}
                        {t.maxParticipants > 0 ? ` / ${t.maxParticipants}` : ''}
                      </span>
                      <span>
                        🛩️ {t.organizerAirline.icao} · {t.organizerUser.name}
                      </span>
                    </div>
                  </div>
                  <Link
                    href={`/trips/${t.id}`}
                    className="shrink-0 rounded-md border border-border bg-background px-3 py-1.5 text-xs font-semibold hover:border-indigo-400"
                  >
                    Details
                  </Link>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </main>
  );
}
