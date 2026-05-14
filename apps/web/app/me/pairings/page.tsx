/**
 * Welle L / L2 — Pilot's assigned pairings overview.
 *
 * Route: /me/pairings
 */

import { auth } from '@/auth';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import { prisma } from '@vam/db';

export const dynamic = 'force-dynamic';

export default async function MyPairingsPage() {
  const session = await auth();
  if (!session?.user?.id) redirect('/');
  const userId = session.user.id;

  const pairings = await prisma.crewPairing.findMany({
    where: {
      assignedPilotId: userId,
      status: { in: ['Assigned', 'InProgress', 'Completed'] },
    },
    orderBy: [{ status: 'asc' }, { startsAt: 'asc' }],
    take: 50,
    select: {
      id: true,
      name: true,
      status: true,
      legCount: true,
      totalDurationMin: true,
      startsAt: true,
      endsAt: true,
      airline: { select: { icao: true, name: true } },
      legs: {
        orderBy: { sequence: 'asc' },
        take: 5,
        select: {
          sequence: true,
          scheduledFlight: {
            select: {
              route: {
                select: {
                  flightNumber: true,
                  departure: { select: { icao: true } },
                  arrival: { select: { icao: true } },
                },
              },
              departureTime: true,
            },
          },
        },
      },
    },
  });

  const statusClasses: Record<string, string> = {
    Assigned: 'border-indigo-500/30 bg-indigo-500/10 text-indigo-700 dark:text-indigo-300',
    InProgress: 'border-green-500/30 bg-green-500/10 text-green-700 dark:text-green-300',
    Completed: 'border-gray-500/30 bg-gray-500/10 text-gray-700 dark:text-gray-300',
  };

  return (
    <main className="min-h-screen bg-background p-4 text-foreground sm:p-8">
      <div className="mx-auto max-w-3xl">
        <header className="mb-6 border-b border-border pb-4">
          <p className="text-xs uppercase tracking-wider text-muted-foreground">
            Meine Inhalte
          </p>
          <h1 className="mt-1 text-2xl font-bold sm:text-3xl">
            ✈️ Meine Crew-Pairings
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Multi-leg duty-perioden die dir zugewiesen wurden.
          </p>
        </header>

        {pairings.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border bg-card p-12 text-center">
            <div className="mb-3 text-5xl">🧑‍✈️</div>
            <h2 className="text-lg font-semibold">Keine pairings zugewiesen</h2>
            <p className="mt-2 text-sm text-muted-foreground">
              Sobald ein admin dir eine pairing zuweist, erscheint sie hier.
            </p>
          </div>
        ) : (
          <ul className="space-y-3">
            {pairings.map((p) => (
              <li
                key={p.id}
                className="rounded-lg border border-border bg-card p-4"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span
                        className={`rounded-md border px-1.5 py-0.5 text-xs font-medium ${statusClasses[p.status]}`}
                      >
                        {p.status}
                      </span>
                      <Link
                        href={`/airline/pairings/${p.id}`}
                        className="truncate font-semibold hover:text-indigo-600 dark:hover:text-indigo-400"
                      >
                        {p.name}
                      </Link>
                    </div>
                    <div className="mt-1 flex flex-wrap gap-2 text-xs text-muted-foreground">
                      <span className="font-mono">{p.airline.icao}</span>
                      <span>·</span>
                      <span>
                        {p.legCount} Leg{p.legCount === 1 ? '' : 's'}
                      </span>
                      <span>·</span>
                      <span>
                        {Math.floor(p.totalDurationMin / 60)}h{' '}
                        {p.totalDurationMin % 60}m
                      </span>
                      {p.startsAt && (
                        <>
                          <span>·</span>
                          <span>
                            🛫{' '}
                            {p.startsAt.toLocaleString('de-DE', {
                              dateStyle: 'short',
                              timeStyle: 'short',
                              timeZone: 'UTC',
                            })}
                            Z
                          </span>
                        </>
                      )}
                    </div>
                    {p.legs.length > 0 && (
                      <div className="mt-2 flex flex-wrap gap-1 text-xs font-mono text-muted-foreground">
                        {p.legs.map((leg, idx) => (
                          <span key={idx}>
                            {leg.scheduledFlight.route.departure.icao}→
                            {leg.scheduledFlight.route.arrival.icao}
                            {idx < p.legs.length - 1 && ' ·'}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </main>
  );
}
