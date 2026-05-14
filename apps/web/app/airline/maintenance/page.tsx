/**
 * Welle L / L3 — Maintenance events admin overview.
 *
 * Route: /airline/maintenance
 *
 * Listet alle maintenance-events der airline mit status-filter chips.
 */

import { prisma } from '@vam/db';
import { requireAirlineManagerWithAirlinePage } from '@/lib/roles';
import Link from 'next/link';

export const dynamic = 'force-dynamic';

type SearchParams = Promise<{ status?: string }>;

const TYPE_LABELS: Record<string, string> = {
  PreFlightCheck: 'Pre-Flight',
  ACheck: 'A-Check',
  BCheck: 'B-Check',
  CCheck: 'C-Check',
  DCheck: 'D-Check',
  Repair: 'Reparatur',
  OilChange: 'Ölwechsel',
  TireReplacement: 'Reifen',
  EngineWork: 'Triebwerk',
  AvionicsUpdate: 'Avionik',
  Other: 'Sonstiges',
};

export default async function AirlineMaintenancePage(props: {
  searchParams: SearchParams;
}) {
  const user = await requireAirlineManagerWithAirlinePage();
  const sp = await props.searchParams;
  const filter = sp.status ?? 'all';

  const allowedStatuses = ['Scheduled', 'InProgress', 'Completed', 'Cancelled'] as const;
  type Status = (typeof allowedStatuses)[number];

  const where: { airlineId: string; status?: Status } = {
    airlineId: user.airlineId,
  };
  if (allowedStatuses.includes(filter as Status)) {
    where.status = filter as Status;
  }

  const [events, counts] = await Promise.all([
    prisma.maintenanceEvent.findMany({
      where,
      orderBy: [{ status: 'asc' }, { scheduledStart: 'asc' }],
      take: 100,
      select: {
        id: true,
        type: true,
        status: true,
        title: true,
        scheduledStart: true,
        scheduledEnd: true,
        actualEnd: true,
        costVam: true,
        aircraft: {
          select: { id: true, registration: true, type: true },
        },
      },
    }),
    prisma.maintenanceEvent.groupBy({
      by: ['status'],
      where: { airlineId: user.airlineId },
      _count: { _all: true },
    }),
  ]);

  const statusCounts: Record<string, number> = {};
  for (const c of counts) statusCounts[c.status] = c._count._all;

  const statusClasses: Record<string, string> = {
    Scheduled: 'border-yellow-500/30 bg-yellow-500/10 text-yellow-700 dark:text-yellow-300',
    InProgress: 'border-orange-500/30 bg-orange-500/10 text-orange-700 dark:text-orange-300',
    Completed: 'border-green-500/30 bg-green-500/10 text-green-700 dark:text-green-300',
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
              🔧 Aircraft-Maintenance
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Geplante + durchgeführte wartungsereignisse der fleet.
            </p>
          </div>
          <Link
            href="/airline/maintenance/new"
            className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700"
          >
            + Neues Event
          </Link>
        </header>

        {/* Filter chips */}
        <div className="mb-4 flex flex-wrap gap-2 text-sm">
          <Link
            href="/airline/maintenance"
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
              href={`/airline/maintenance?status=${s}`}
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

        {events.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border bg-card p-12 text-center">
            <div className="mb-3 text-5xl">🛠️</div>
            <h2 className="text-lg font-semibold">
              {filter === 'all'
                ? 'Noch keine maintenance-events'
                : `Keine events im Status "${filter}"`}
            </h2>
            <p className="mt-2 text-sm text-muted-foreground">
              Trackt wartung pro aircraft (A-Check, C-Check, Reparaturen).
            </p>
            <Link
              href="/airline/maintenance/new"
              className="mt-4 inline-block rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700"
            >
              Erstes event anlegen
            </Link>
          </div>
        ) : (
          <div className="overflow-hidden rounded-lg border border-border bg-card">
            <table className="w-full text-sm">
              <thead className="bg-muted/30 text-xs uppercase tracking-wider text-muted-foreground">
                <tr>
                  <th className="px-4 py-3 text-left">Aircraft</th>
                  <th className="px-4 py-3 text-left">Typ</th>
                  <th className="px-4 py-3 text-left">Titel</th>
                  <th className="px-4 py-3 text-left">Status</th>
                  <th className="px-4 py-3 text-left">Geplant</th>
                  <th className="px-4 py-3 text-right">Kosten</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {events.map((e) => (
                  <tr key={e.id} className="hover:bg-muted/20">
                    <td className="px-4 py-3">
                      <div className="font-mono font-semibold">
                        {e.aircraft.registration}
                      </div>
                      <div className="font-mono text-xs text-muted-foreground">
                        {e.aircraft.type}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-xs text-muted-foreground">
                      {TYPE_LABELS[e.type] ?? e.type}
                    </td>
                    <td className="px-4 py-3">
                      <Link
                        href={`/airline/maintenance/${e.id}`}
                        className="font-medium hover:text-indigo-600 dark:hover:text-indigo-400"
                      >
                        {e.title}
                      </Link>
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`rounded-md border px-1.5 py-0.5 text-xs font-medium ${statusClasses[e.status]}`}
                      >
                        {e.status}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-xs text-muted-foreground">
                      {e.scheduledStart.toLocaleDateString('de-DE', {
                        day: '2-digit',
                        month: '2-digit',
                        year: 'numeric',
                      })}
                      <div className="text-muted-foreground">
                        bis{' '}
                        {e.scheduledEnd.toLocaleDateString('de-DE', {
                          day: '2-digit',
                          month: '2-digit',
                        })}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-right text-xs tabular-nums text-muted-foreground">
                      {e.costVam !== null
                        ? `${parseFloat(e.costVam.toString()).toLocaleString('de-DE', { maximumFractionDigits: 0 })} VAM$`
                        : '—'}
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
