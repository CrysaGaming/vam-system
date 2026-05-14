/**
 * Welle K / K5 — Trip detail page.
 *
 * Route: /trips/[id]
 *
 * Server-component. Lädt trip-details + participants-list + handelt
 * action-state-derivation (isOrganizer, isParticipant, canJoin).
 */

import { auth } from '@/auth';
import { redirect, notFound } from 'next/navigation';
import Link from 'next/link';
import { prisma } from '@vam/db';
import TripActions from './_actions';

export const dynamic = 'force-dynamic';

type Params = Promise<{ id: string }>;

export default async function TripDetailPage(props: { params: Params }) {
  const session = await auth();
  if (!session?.user?.id) redirect('/');
  const userId = session.user.id;

  const { id } = await props.params;

  const trip = await prisma.interAirlineTrip.findUnique({
    where: { id },
    select: {
      id: true,
      title: true,
      description: true,
      departureIcao: true,
      arrivalIcao: true,
      scheduledAt: true,
      status: true,
      maxParticipants: true,
      createdAt: true,
      completedAt: true,
      cancelledAt: true,
      organizerUserId: true,
      organizerAirline: {
        select: { icao: true, name: true },
      },
      organizerUser: {
        select: { id: true, name: true },
      },
      participants: {
        orderBy: { joinedAt: 'asc' },
        select: {
          id: true,
          joinedAt: true,
          notes: true,
          user: {
            select: {
              id: true,
              name: true,
              airline: { select: { icao: true } },
            },
          },
        },
      },
    },
  });

  if (!trip) notFound();

  const isOrganizer = trip.organizerUserId === userId;
  const isParticipant = trip.participants.some((p) => p.user.id === userId);
  const canJoin =
    (trip.status === 'Proposed' || trip.status === 'Confirmed') &&
    (trip.maxParticipants === 0 ||
      trip.participants.length < trip.maxParticipants);

  const statusClasses: Record<string, string> = {
    Proposed:
      'border-yellow-500/30 bg-yellow-500/10 text-yellow-700 dark:text-yellow-300',
    Confirmed:
      'border-green-500/30 bg-green-500/10 text-green-700 dark:text-green-300',
    Completed:
      'border-blue-500/30 bg-blue-500/10 text-blue-700 dark:text-blue-300',
    Cancelled:
      'border-red-500/30 bg-red-500/10 text-red-700 dark:text-red-300',
  };

  return (
    <main className="min-h-screen bg-background p-4 text-foreground sm:p-8">
      <div className="mx-auto max-w-3xl">
        <nav className="mb-4 text-xs">
          <Link
            href="/trips"
            className="text-muted-foreground hover:text-indigo-600 dark:hover:text-indigo-400"
          >
            ← Zurück zur trip-liste
          </Link>
        </nav>

        <header className="mb-6 rounded-lg border border-border bg-card p-5">
          <div className="mb-2 flex items-center gap-2">
            <span
              className={`rounded-md border px-1.5 py-0.5 text-xs font-medium ${statusClasses[trip.status]}`}
            >
              {trip.status}
            </span>
            <span className="font-mono text-sm text-muted-foreground">
              {trip.departureIcao} → {trip.arrivalIcao}
            </span>
          </div>
          <h1 className="text-2xl font-bold">{trip.title}</h1>

          <div className="mt-3 flex flex-wrap gap-3 text-sm text-muted-foreground">
            <span>
              🗓️{' '}
              {trip.scheduledAt.toLocaleString('de-DE', {
                dateStyle: 'full',
                timeStyle: 'short',
              })}
            </span>
            <span>
              👥 {trip.participants.length}
              {trip.maxParticipants > 0 ? ` / ${trip.maxParticipants}` : ' teilnehmer'}
            </span>
            <span>
              🛩️ Organisiert von{' '}
              <Link
                href={`/p/${trip.organizerUser.id}`}
                className="font-medium text-foreground hover:text-indigo-600 dark:hover:text-indigo-400"
              >
                {trip.organizerUser.name}
              </Link>{' '}
              ({trip.organizerAirline.icao})
            </span>
          </div>

          <p className="mt-4 whitespace-pre-wrap text-base leading-relaxed">
            {trip.description}
          </p>
        </header>

        <section className="mb-6">
          <TripActions
            tripId={trip.id}
            status={trip.status as 'Proposed' | 'Confirmed' | 'Completed' | 'Cancelled'}
            isOrganizer={isOrganizer}
            isParticipant={isParticipant}
            canJoin={canJoin}
          />
        </section>

        <section>
          <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Teilnehmer ({trip.participants.length})
          </h2>
          <ul className="space-y-2">
            {trip.participants.map((p) => (
              <li
                key={p.id}
                className="flex items-start justify-between gap-3 rounded-lg border border-border bg-card p-3"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <Link
                      href={`/p/${p.user.id}`}
                      className="font-semibold hover:text-indigo-600 dark:hover:text-indigo-400"
                    >
                      {p.user.name ?? 'Pilot'}
                    </Link>
                    {p.user.airline?.icao && (
                      <span className="font-mono text-xs text-muted-foreground">
                        {p.user.airline.icao}
                      </span>
                    )}
                    {p.user.id === trip.organizerUserId && (
                      <span className="rounded-md border border-indigo-500/30 bg-indigo-500/10 px-1.5 py-0.5 text-xs font-medium text-indigo-700 dark:text-indigo-300">
                        Organizer
                      </span>
                    )}
                  </div>
                  {p.notes && (
                    <p className="mt-1 text-xs text-muted-foreground">{p.notes}</p>
                  )}
                </div>
                <span className="shrink-0 text-xs text-muted-foreground">
                  {p.joinedAt.toLocaleDateString('de-DE')}
                </span>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </main>
  );
}
