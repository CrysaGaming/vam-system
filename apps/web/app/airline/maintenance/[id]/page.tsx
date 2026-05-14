/**
 * Welle L / L3 — Maintenance event detail page.
 *
 * Route: /airline/maintenance/[id]
 */

import { prisma } from '@vam/db';
import { requireAirlineManagerWithAirlinePage } from '@/lib/roles';
import { notFound } from 'next/navigation';
import Link from 'next/link';
import MaintenanceActions from './_actions';

export const dynamic = 'force-dynamic';

type Params = Promise<{ id: string }>;

const TYPE_LABELS: Record<string, string> = {
  PreFlightCheck: 'Pre-Flight Check',
  ACheck: 'A-Check',
  BCheck: 'B-Check',
  CCheck: 'C-Check',
  DCheck: 'D-Check',
  Repair: 'Reparatur',
  OilChange: 'Ölwechsel',
  TireReplacement: 'Reifenwechsel',
  EngineWork: 'Triebwerksarbeit',
  AvionicsUpdate: 'Avionik-Update',
  Other: 'Sonstiges',
};

export default async function MaintenanceDetailPage(props: { params: Params }) {
  const user = await requireAirlineManagerWithAirlinePage();
  const { id } = await props.params;

  const event = await prisma.maintenanceEvent.findUnique({
    where: { id },
    select: {
      id: true,
      type: true,
      status: true,
      title: true,
      description: true,
      scheduledStart: true,
      scheduledEnd: true,
      actualStart: true,
      actualEnd: true,
      costVam: true,
      nextDueAt: true,
      createdAt: true,
      cancelledAt: true,
      airlineId: true,
      aircraft: {
        select: {
          id: true,
          registration: true,
          type: true,
          homeIcao: true,
        },
      },
      createdBy: { select: { name: true } },
    },
  });

  if (!event || event.airlineId !== user.airlineId) notFound();

  const statusClasses: Record<string, string> = {
    Scheduled: 'border-yellow-500/30 bg-yellow-500/10 text-yellow-700 dark:text-yellow-300',
    InProgress: 'border-orange-500/30 bg-orange-500/10 text-orange-700 dark:text-orange-300',
    Completed: 'border-green-500/30 bg-green-500/10 text-green-700 dark:text-green-300',
    Cancelled: 'border-red-500/30 bg-red-500/10 text-red-700 dark:text-red-300',
  };

  return (
    <main className="min-h-screen bg-background p-4 text-foreground sm:p-8">
      <div className="mx-auto max-w-3xl">
        <nav className="mb-4 text-xs">
          <Link
            href="/airline/maintenance"
            className="text-muted-foreground hover:text-indigo-600 dark:hover:text-indigo-400"
          >
            ← Zurück zur Maintenance-Liste
          </Link>
        </nav>

        <header className="mb-6 rounded-lg border border-border bg-card p-5">
          <div className="mb-2 flex items-center gap-2">
            <span
              className={`rounded-md border px-1.5 py-0.5 text-xs font-medium ${statusClasses[event.status]}`}
            >
              {event.status}
            </span>
            <span className="rounded-md border border-indigo-500/30 bg-indigo-500/10 px-1.5 py-0.5 text-xs font-medium text-indigo-700 dark:text-indigo-300">
              {TYPE_LABELS[event.type] ?? event.type}
            </span>
          </div>
          <h1 className="text-2xl font-bold">{event.title}</h1>

          <div className="mt-3 grid grid-cols-1 gap-3 text-sm sm:grid-cols-2">
            <div>
              <p className="text-xs uppercase tracking-wider text-muted-foreground">
                Aircraft
              </p>
              <p className="mt-1 font-mono">
                <Link
                  href={`/airline/aircraft`}
                  className="font-semibold hover:text-indigo-600 dark:hover:text-indigo-400"
                >
                  {event.aircraft.registration}
                </Link>{' '}
                <span className="text-muted-foreground">
                  · {event.aircraft.type}
                  {event.aircraft.homeIcao && ` · ${event.aircraft.homeIcao}`}
                </span>
              </p>
            </div>
            <div>
              <p className="text-xs uppercase tracking-wider text-muted-foreground">
                Kosten
              </p>
              <p className="mt-1 tabular-nums">
                {event.costVam !== null
                  ? `${parseFloat(event.costVam.toString()).toLocaleString('de-DE', { maximumFractionDigits: 2 })} VAM$`
                  : '—'}
              </p>
            </div>
            <div>
              <p className="text-xs uppercase tracking-wider text-muted-foreground">
                Geplant
              </p>
              <p className="mt-1 text-xs">
                {event.scheduledStart.toLocaleString('de-DE', {
                  dateStyle: 'short',
                  timeStyle: 'short',
                  timeZone: 'UTC',
                })}
                Z →{' '}
                {event.scheduledEnd.toLocaleString('de-DE', {
                  dateStyle: 'short',
                  timeStyle: 'short',
                  timeZone: 'UTC',
                })}
                Z
              </p>
            </div>
            <div>
              <p className="text-xs uppercase tracking-wider text-muted-foreground">
                Tatsächlich
              </p>
              <p className="mt-1 text-xs">
                {event.actualStart
                  ? `${event.actualStart.toLocaleString('de-DE', {
                      dateStyle: 'short',
                      timeStyle: 'short',
                      timeZone: 'UTC',
                    })}Z`
                  : '—'}
                {' → '}
                {event.actualEnd
                  ? `${event.actualEnd.toLocaleString('de-DE', {
                      dateStyle: 'short',
                      timeStyle: 'short',
                      timeZone: 'UTC',
                    })}Z`
                  : '—'}
              </p>
            </div>
            {event.nextDueAt && (
              <div>
                <p className="text-xs uppercase tracking-wider text-muted-foreground">
                  Nächste Fälligkeit
                </p>
                <p className="mt-1 text-xs">
                  {event.nextDueAt.toLocaleDateString('de-DE', {
                    dateStyle: 'full',
                  })}
                </p>
              </div>
            )}
            <div>
              <p className="text-xs uppercase tracking-wider text-muted-foreground">
                Erstellt
              </p>
              <p className="mt-1 text-xs">
                Von {event.createdBy.name ?? 'Admin'} am{' '}
                {event.createdAt.toLocaleDateString('de-DE')}
              </p>
            </div>
          </div>

          {event.description && (
            <div className="mt-4 border-t border-border pt-4">
              <p className="mb-2 text-xs uppercase tracking-wider text-muted-foreground">
                Beschreibung
              </p>
              <p className="whitespace-pre-wrap text-base leading-relaxed">
                {event.description}
              </p>
            </div>
          )}
        </header>

        <section>
          <MaintenanceActions
            eventId={event.id}
            status={event.status as 'Scheduled' | 'InProgress' | 'Completed' | 'Cancelled'}
          />
        </section>
      </div>
    </main>
  );
}
