/**
 * Welle K / K5 — Pilot's own trips overview.
 *
 * Route: /me/trips
 *
 * Listet trips wo der user organizer ODER participant ist. Aufgeteilt
 * in 2 sections: "Organisiert von mir" + "Beigetreten".
 */

import { auth } from '@/auth';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import { prisma } from '@vam/db';

export const dynamic = 'force-dynamic';

export default async function MyTripsPage() {
  const session = await auth();
  if (!session?.user?.id) redirect('/');
  const userId = session.user.id;

  const [organized, joined] = await Promise.all([
    prisma.interAirlineTrip.findMany({
      where: { organizerUserId: userId },
      orderBy: { scheduledAt: 'desc' },
      take: 50,
      select: {
        id: true,
        title: true,
        departureIcao: true,
        arrivalIcao: true,
        scheduledAt: true,
        status: true,
        _count: { select: { participants: true } },
      },
    }),
    prisma.interAirlineTripParticipant.findMany({
      where: { userId, trip: { organizerUserId: { not: userId } } },
      orderBy: { trip: { scheduledAt: 'desc' } },
      take: 50,
      select: {
        trip: {
          select: {
            id: true,
            title: true,
            departureIcao: true,
            arrivalIcao: true,
            scheduledAt: true,
            status: true,
            organizerUser: { select: { name: true } },
            organizerAirline: { select: { icao: true } },
            _count: { select: { participants: true } },
          },
        },
      },
    }),
  ]);

  return (
    <main className="min-h-screen bg-background p-4 text-foreground sm:p-8">
      <div className="mx-auto max-w-3xl">
        <header className="mb-6 flex items-start justify-between border-b border-border pb-4">
          <div>
            <p className="text-xs uppercase tracking-wider text-muted-foreground">
              Community
            </p>
            <h1 className="mt-1 text-2xl font-bold sm:text-3xl">
              🤝 Meine Trips
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Inter-airline-trips die du organisiert hast oder beigetreten bist.
            </p>
          </div>
          <Link
            href="/trips/new"
            className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700"
          >
            + Neuer Trip
          </Link>
        </header>

        <div className="mb-4 text-sm">
          <Link
            href="/trips"
            className="text-indigo-600 hover:underline dark:text-indigo-400"
          >
            ← Trips browsen
          </Link>
        </div>

        {organized.length > 0 && (
          <section className="mb-6">
            <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Organisiert von mir ({organized.length})
            </h2>
            <ul className="space-y-2">
              {organized.map((t) => (
                <TripRow
                  key={t.id}
                  trip={t}
                  extraLabel="Organizer"
                />
              ))}
            </ul>
          </section>
        )}

        {joined.length > 0 && (
          <section>
            <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Beigetreten ({joined.length})
            </h2>
            <ul className="space-y-2">
              {joined.map((p) => (
                <TripRow
                  key={p.trip.id}
                  trip={p.trip}
                  extraLabel={`${p.trip.organizerAirline.icao} · ${p.trip.organizerUser.name}`}
                />
              ))}
            </ul>
          </section>
        )}

        {organized.length === 0 && joined.length === 0 && (
          <div className="rounded-lg border border-dashed border-border bg-card p-12 text-center text-sm text-muted-foreground">
            Du hast noch keine trips organisiert oder bist beigetreten.{' '}
            <Link
              href="/trips"
              className="text-indigo-600 hover:underline dark:text-indigo-400"
            >
              Trips browsen
            </Link>
          </div>
        )}
      </div>
    </main>
  );
}

function TripRow({
  trip,
  extraLabel,
}: {
  trip: {
    id: string;
    title: string;
    departureIcao: string;
    arrivalIcao: string;
    scheduledAt: Date;
    status: string;
    _count: { participants: number };
  };
  extraLabel: string;
}) {
  const statusClasses: Record<string, string> = {
    Proposed: 'border-yellow-500/30 bg-yellow-500/10 text-yellow-700 dark:text-yellow-300',
    Confirmed: 'border-green-500/30 bg-green-500/10 text-green-700 dark:text-green-300',
    Completed: 'border-blue-500/30 bg-blue-500/10 text-blue-700 dark:text-blue-300',
    Cancelled: 'border-red-500/30 bg-red-500/10 text-red-700 dark:text-red-300',
  };
  return (
    <li className="rounded-lg border border-border bg-card p-4">
      <div className="flex items-center gap-2">
        <span
          className={`rounded-md border px-1.5 py-0.5 text-xs font-medium ${statusClasses[trip.status]}`}
        >
          {trip.status}
        </span>
        <Link
          href={`/trips/${trip.id}`}
          className="truncate font-semibold hover:text-indigo-600 dark:hover:text-indigo-400"
        >
          {trip.title}
        </Link>
      </div>
      <div className="mt-2 flex flex-wrap gap-2 text-xs text-muted-foreground">
        <span className="font-mono">
          {trip.departureIcao} → {trip.arrivalIcao}
        </span>
        <span>
          🗓️{' '}
          {trip.scheduledAt.toLocaleString('de-DE', {
            dateStyle: 'short',
            timeStyle: 'short',
          })}
        </span>
        <span>👥 {trip._count.participants}</span>
        <span>· {extraLabel}</span>
      </div>
    </li>
  );
}
