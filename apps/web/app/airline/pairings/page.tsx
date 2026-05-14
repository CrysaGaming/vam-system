/**
 * Welle L / L2 — Crew-pairings admin overview.
 *
 * Route: /airline/pairings
 *
 * Listet alle pairings der airline mit status-filter + create-button.
 */

import { prisma } from '@vam/db';
import { requireAirlineManagerWithAirlinePage } from '@/lib/roles';
import Link from 'next/link';

export const dynamic = 'force-dynamic';

type SearchParams = Promise<{ status?: string }>;

export default async function AirlinePairingsPage(props: {
  searchParams: SearchParams;
}) {
  const user = await requireAirlineManagerWithAirlinePage();
  const sp = await props.searchParams;
  const filter = sp.status ?? 'all';

  const allowedStatuses = [
    'Draft',
    'Published',
    'Assigned',
    'InProgress',
    'Completed',
    'Cancelled',
  ] as const;
  type PairingStatus = (typeof allowedStatuses)[number];

  const where: {
    airlineId: string;
    status?: PairingStatus;
  } = { airlineId: user.airlineId };
  if (allowedStatuses.includes(filter as PairingStatus)) {
    where.status = filter as PairingStatus;
  }

  const [pairings, counts] = await Promise.all([
    prisma.crewPairing.findMany({
      where,
      orderBy: [{ status: 'asc' }, { startsAt: 'asc' }, { createdAt: 'desc' }],
      take: 100,
      select: {
        id: true,
        name: true,
        status: true,
        legCount: true,
        totalDurationMin: true,
        startsAt: true,
        endsAt: true,
        createdAt: true,
        assignedPilot: { select: { id: true, name: true } },
      },
    }),
    prisma.crewPairing.groupBy({
      by: ['status'],
      where: { airlineId: user.airlineId },
      _count: { _all: true },
    }),
  ]);

  const statusCounts: Record<string, number> = {};
  for (const c of counts) statusCounts[c.status] = c._count._all;

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
      <div className="mx-auto max-w-6xl">
        <header className="mb-6 flex items-start justify-between border-b border-border pb-4">
          <div>
            <p className="text-xs uppercase tracking-wider text-muted-foreground">
              Airline · Operations
            </p>
            <h1 className="mt-1 text-2xl font-bold sm:text-3xl">
              ✈️ Crew-Pairings
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Multi-leg duty-perioden für pilots der airline.
            </p>
          </div>
          <Link
            href="/airline/pairings/new"
            className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700"
          >
            + Neue Pairing
          </Link>
        </header>

        {/* Filter chips */}
        <div className="mb-4 flex flex-wrap gap-2 text-sm">
          <Link
            href="/airline/pairings"
            className={`rounded-md border px-3 py-1.5 ${
              filter === 'all'
                ? 'border-indigo-500 bg-indigo-500/10 text-indigo-700 dark:text-indigo-300'
                : 'border-border text-muted-foreground hover:text-foreground'
            }`}
          >
            Alle ({Object.values(statusCounts).reduce((a, b) => a + b, 0)})
          </Link>
          {allowedStatuses.map((s) => (
            <Link
              key={s}
              href={`/airline/pairings?status=${s}`}
              className={`rounded-md border px-3 py-1.5 ${
                filter === s
                  ? 'border-indigo-500 bg-indigo-500/10 text-indigo-700 dark:text-indigo-300'
                  : 'border-border text-muted-foreground hover:text-foreground'
              }`}
            >
              {s} ({statusCounts[s] ?? 0})
            </Link>
          ))}
        </div>

        {pairings.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border bg-card p-12 text-center">
            <div className="mb-3 text-5xl">🧑‍✈️</div>
            <h2 className="text-lg font-semibold">
              {filter === 'all'
                ? 'Noch keine Pairings'
                : `Keine Pairings im Status "${filter}"`}
            </h2>
            <p className="mt-2 text-sm text-muted-foreground">
              Bündele mehrere scheduled-flights als duty-period für deine pilots.
            </p>
            <Link
              href="/airline/pairings/new"
              className="mt-4 inline-block rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700"
            >
              Erste Pairing anlegen
            </Link>
          </div>
        ) : (
          <div className="overflow-hidden rounded-lg border border-border bg-card">
            <table className="w-full text-sm">
              <thead className="bg-muted/30 text-xs uppercase tracking-wider text-muted-foreground">
                <tr>
                  <th className="px-4 py-3 text-left">Name</th>
                  <th className="px-4 py-3 text-left">Status</th>
                  <th className="px-4 py-3 text-right">Legs</th>
                  <th className="px-4 py-3 text-right">Dauer</th>
                  <th className="px-4 py-3 text-left">Start</th>
                  <th className="px-4 py-3 text-left">Pilot</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {pairings.map((p) => (
                  <tr key={p.id} className="hover:bg-muted/20">
                    <td className="px-4 py-3">
                      <Link
                        href={`/airline/pairings/${p.id}`}
                        className="font-semibold hover:text-indigo-600 dark:hover:text-indigo-400"
                      >
                        {p.name}
                      </Link>
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`rounded-md border px-1.5 py-0.5 text-xs font-medium ${statusClasses[p.status]}`}
                      >
                        {p.status}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums">
                      {p.legCount}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums">
                      {Math.floor(p.totalDurationMin / 60)}h{' '}
                      {p.totalDurationMin % 60}m
                    </td>
                    <td className="px-4 py-3 text-xs text-muted-foreground">
                      {p.startsAt ? (
                        p.startsAt.toLocaleString('de-DE', {
                          dateStyle: 'short',
                          timeStyle: 'short',
                          timeZone: 'UTC',
                        })
                      ) : (
                        <span className="italic">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-xs">
                      {p.assignedPilot ? (
                        <Link
                          href={`/p/${p.assignedPilot.id}`}
                          className="hover:text-indigo-600 dark:hover:text-indigo-400"
                        >
                          {p.assignedPilot.name ?? 'Pilot'}
                        </Link>
                      ) : (
                        <span className="italic text-muted-foreground">
                          Nicht zugewiesen
                        </span>
                      )}
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
