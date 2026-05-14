/**
 * Welle L / L2 — Pairing detail page.
 *
 * Route: /airline/pairings/[id]
 *
 * Zeigt header (name + status + dauer) + legs-list + actions.
 */

import { prisma } from '@vam/db';
import { requireAirlineManagerWithAirlinePage } from '@/lib/roles';
import { notFound } from 'next/navigation';
import Link from 'next/link';
import PairingActions, { RemoveLegButton, AddLegForm } from './_actions';

export const dynamic = 'force-dynamic';

type Params = Promise<{ id: string }>;

export default async function PairingDetailPage(props: { params: Params }) {
  const user = await requireAirlineManagerWithAirlinePage();
  const { id } = await props.params;

  const pairing = await prisma.crewPairing.findUnique({
    where: { id },
    select: {
      id: true,
      name: true,
      description: true,
      status: true,
      legCount: true,
      totalDurationMin: true,
      startsAt: true,
      endsAt: true,
      airlineId: true,
      assignedPilotId: true,
      assignedPilot: {
        select: { id: true, name: true },
      },
      createdBy: { select: { name: true } },
      createdAt: true,
      publishedAt: true,
      completedAt: true,
      cancelledAt: true,
      legs: {
        orderBy: { sequence: 'asc' },
        select: {
          id: true,
          sequence: true,
          layoverHoursAfter: true,
          scheduledFlight: {
            select: {
              id: true,
              departureTime: true,
              status: true,
              route: {
                select: {
                  flightNumber: true,
                  estimatedMinutes: true,
                  departure: { select: { icao: true } },
                  arrival: { select: { icao: true } },
                },
              },
              preferredAircraft: { select: { registration: true } },
            },
          },
        },
      },
    },
  });

  if (!pairing || pairing.airlineId !== user.airlineId) notFound();

  // Available pilots: alle in der gleichen airline
  const availablePilots = await prisma.user.findMany({
    where: { airlineId: user.airlineId },
    orderBy: { name: 'asc' },
    select: { id: true, name: true },
    take: 100,
  });

  // Available flights for add-leg: only when in Draft. Wir holen alle planned/
  // booked flights die noch nicht teil dieser pairing sind und in der zukunft
  // liegen.
  const usedFlightIds = new Set(pairing.legs.map((l) => l.scheduledFlight.id));
  const availableFlights =
    pairing.status === 'Draft'
      ? await prisma.scheduledFlight.findMany({
          where: {
            airlineId: user.airlineId,
            status: { in: ['Planned', 'Booked'] },
            id: { notIn: Array.from(usedFlightIds) },
            departureTime: { gte: new Date() },
          },
          orderBy: { departureTime: 'asc' },
          take: 50,
          select: {
            id: true,
            departureTime: true,
            route: {
              select: {
                flightNumber: true,
                departure: { select: { icao: true } },
                arrival: { select: { icao: true } },
              },
            },
          },
        })
      : [];

  const availableFlightsForForm = availableFlights.map((f) => ({
    id: f.id,
    flightNumber: f.route.flightNumber,
    departureIcao: f.route.departure.icao,
    arrivalIcao: f.route.arrival.icao,
    departureTime: f.departureTime,
  }));

  const statusClasses: Record<string, string> = {
    Draft: 'border-yellow-500/30 bg-yellow-500/10 text-yellow-700 dark:text-yellow-300',
    Published: 'border-blue-500/30 bg-blue-500/10 text-blue-700 dark:text-blue-300',
    Assigned: 'border-indigo-500/30 bg-indigo-500/10 text-indigo-700 dark:text-indigo-300',
    InProgress: 'border-green-500/30 bg-green-500/10 text-green-700 dark:text-green-300',
    Completed: 'border-gray-500/30 bg-gray-500/10 text-gray-700 dark:text-gray-300',
    Cancelled: 'border-red-500/30 bg-red-500/10 text-red-700 dark:text-red-300',
  };

  return (
    <main className="min-h-screen bg-background p-4 text-foreground sm:p-8">
      <div className="mx-auto max-w-4xl">
        <nav className="mb-4 text-xs">
          <Link
            href="/airline/pairings"
            className="text-muted-foreground hover:text-indigo-600 dark:hover:text-indigo-400"
          >
            ← Zurück zur Pairings-Liste
          </Link>
        </nav>

        <header className="mb-6 rounded-lg border border-border bg-card p-5">
          <div className="mb-2 flex items-center gap-2">
            <span
              className={`rounded-md border px-1.5 py-0.5 text-xs font-medium ${statusClasses[pairing.status]}`}
            >
              {pairing.status}
            </span>
          </div>
          <h1 className="text-2xl font-bold">{pairing.name}</h1>

          <div className="mt-3 flex flex-wrap gap-3 text-sm text-muted-foreground">
            <span>
              ✈️ {pairing.legCount} Leg{pairing.legCount === 1 ? '' : 's'}
            </span>
            <span>
              ⏱ {Math.floor(pairing.totalDurationMin / 60)}h{' '}
              {pairing.totalDurationMin % 60}m
            </span>
            {pairing.startsAt && (
              <span>
                🛫 Start:{' '}
                {pairing.startsAt.toLocaleString('de-DE', {
                  dateStyle: 'short',
                  timeStyle: 'short',
                  timeZone: 'UTC',
                })}
                Z
              </span>
            )}
            {pairing.endsAt && (
              <span>
                🛬 Ende:{' '}
                {pairing.endsAt.toLocaleString('de-DE', {
                  dateStyle: 'short',
                  timeStyle: 'short',
                  timeZone: 'UTC',
                })}
                Z
              </span>
            )}
            <span>👤 Erstellt von {pairing.createdBy.name ?? 'Admin'}</span>
            {pairing.assignedPilot && (
              <span>
                🧑‍✈️ Zugewiesen an{' '}
                <Link
                  href={`/p/${pairing.assignedPilot.id}`}
                  className="font-medium text-foreground hover:text-indigo-600 dark:hover:text-indigo-400"
                >
                  {pairing.assignedPilot.name ?? 'Pilot'}
                </Link>
              </span>
            )}
          </div>

          {pairing.description && (
            <p className="mt-4 whitespace-pre-wrap text-base leading-relaxed">
              {pairing.description}
            </p>
          )}
        </header>

        <section className="mb-6">
          <PairingActions
            pairingId={pairing.id}
            status={pairing.status}
            assignedPilotId={pairing.assignedPilotId}
            availablePilots={availablePilots}
          />
        </section>

        {pairing.status === 'Draft' && (
          <section className="mb-6">
            <AddLegForm
              pairingId={pairing.id}
              availableFlights={availableFlightsForForm}
            />
          </section>
        )}

        <section>
          <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Legs ({pairing.legs.length})
          </h2>
          {pairing.legs.length === 0 ? (
            <div className="rounded-lg border border-dashed border-border bg-card p-6 text-center text-sm text-muted-foreground">
              Noch keine Legs. Füge oben einen ersten flight hinzu.
            </div>
          ) : (
            <ol className="space-y-2">
              {pairing.legs.map((leg) => (
                <li
                  key={leg.id}
                  className="rounded-lg border border-border bg-card p-4"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="rounded-md border border-indigo-500/30 bg-indigo-500/10 px-1.5 py-0.5 text-xs font-medium text-indigo-700 dark:text-indigo-300">
                          Leg {leg.sequence}
                        </span>
                        <Link
                          href={`/airline/schedule/instances`}
                          className="font-mono font-semibold hover:text-indigo-600 dark:hover:text-indigo-400"
                        >
                          {leg.scheduledFlight.route.flightNumber}
                        </Link>
                        <span className="font-mono text-sm text-muted-foreground">
                          {leg.scheduledFlight.route.departure.icao} →{' '}
                          {leg.scheduledFlight.route.arrival.icao}
                        </span>
                      </div>
                      <div className="mt-2 flex flex-wrap gap-3 text-xs text-muted-foreground">
                        <span>
                          🗓️{' '}
                          {leg.scheduledFlight.departureTime.toLocaleString('de-DE', {
                            dateStyle: 'short',
                            timeStyle: 'short',
                            timeZone: 'UTC',
                          })}
                          Z
                        </span>
                        <span>
                          ⏱ {leg.scheduledFlight.route.estimatedMinutes}min
                        </span>
                        {leg.scheduledFlight.preferredAircraft && (
                          <span className="font-mono">
                            🛩️ {leg.scheduledFlight.preferredAircraft.registration}
                          </span>
                        )}
                        <span>
                          Status: {leg.scheduledFlight.status}
                        </span>
                      </div>
                      {leg.layoverHoursAfter !== null && leg.layoverHoursAfter !== undefined && (
                        <p className="mt-1 text-xs text-muted-foreground">
                          ⏸ Layover danach: {leg.layoverHoursAfter.toString()}h
                        </p>
                      )}
                    </div>
                    <RemoveLegButton
                      legId={leg.id}
                      canRemove={pairing.status === 'Draft'}
                    />
                  </div>
                </li>
              ))}
            </ol>
          )}
        </section>
      </div>
    </main>
  );
}
