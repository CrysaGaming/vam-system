import { auth } from '@/auth';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import {
  prisma,
  listEventsForAdmin,
  type EventStatus,
  type RuntimeStatus,
  type EventKind,
} from '@vam/db';
import { CreateEventForm } from './admin-forms';

/**
 * Track 1 #7 (Events / Flight-Tours, 9.2.8) — Admin events landing page.
 *
 * Admin-only. Listet alle events (auch DRAFTs + CANCELLEDs) sortiert
 * nach createdAt desc, plus collapsible create-form.
 *
 * # Filter
 *
 * Tab-bar nach DB-status: alle / DRAFT / PUBLISHED / COMPLETED / CANCELLED.
 * Die runtime-status (UPCOMING/IN_PROGRESS/ENDED) sind nicht filterbar
 * weil sie aus PUBLISHED+zeit berechnet werden — admin sieht den runtime-
 * status pro card als badge.
 *
 * # Airline-scoping
 *
 * Im MVP zeigen wir alle airlines (kein cross-airline-filter), das matched
 * der awards/sceneries-admin-view. Single-airline-instanz hat eh nur
 * eine airline.
 */

const KIND_LABELS: Record<EventKind, string> = {
  TOUR: 'Tour',
  SINGLE_FLIGHT: 'Single-Flight',
  THEMED: 'Themen-Event',
  GROUP_FLIGHT: 'Group-Flight',
  SEASONAL: 'Saison-Event',
};

const STATUS_LABELS: Record<EventStatus, string> = {
  DRAFT: 'Entwurf',
  PUBLISHED: 'Publiziert',
  COMPLETED: 'Abgeschlossen',
  CANCELLED: 'Abgesagt',
};

const STATUS_STYLES: Record<EventStatus, string> = {
  DRAFT: 'bg-gray-200 text-gray-700 dark:bg-gray-800 dark:text-gray-300',
  PUBLISHED:
    'bg-indigo-100 text-indigo-800 dark:bg-indigo-900/40 dark:text-indigo-200',
  COMPLETED:
    'bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-200',
  CANCELLED:
    'bg-rose-100 text-rose-800 dark:bg-rose-900/40 dark:text-rose-200',
};

const RUNTIME_STATUS_LABELS: Record<RuntimeStatus, string> = {
  DRAFT: 'Entwurf',
  UPCOMING: 'Anstehend',
  IN_PROGRESS: 'Läuft',
  ENDED: 'Beendet',
  COMPLETED: 'Abgeschlossen',
  CANCELLED: 'Abgesagt',
};

function formatDateTime(d: Date): string {
  return new Date(d).toLocaleString('de-DE', {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
}

const ALL_STATUS_FILTERS: Array<EventStatus | 'all'> = [
  'all',
  'DRAFT',
  'PUBLISHED',
  'COMPLETED',
  'CANCELLED',
];

export default async function AdminEventsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await auth();
  if (!session?.user) redirect('/');

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    include: { role: true },
  });

  if (!user?.role || user.role.name !== 'admin') {
    redirect('/dashboard');
  }

  const params = await searchParams;
  const statusParam = typeof params.status === 'string' ? params.status : 'all';
  const statusFilter: EventStatus | 'all' =
    ALL_STATUS_FILTERS.includes(statusParam as EventStatus | 'all')
      ? (statusParam as EventStatus | 'all')
      : 'all';

  // Parallel fetch: events + airlines (für create-form dropdown).
  const [allEvents, airlines] = await Promise.all([
    listEventsForAdmin({}),
    prisma.airline.findMany({
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
    }),
  ]);

  const events =
    statusFilter === 'all'
      ? allEvents
      : allEvents.filter((e) => e.status === statusFilter);

  // Counts per status für tab-badges
  const counts: Record<EventStatus | 'all', number> = {
    all: allEvents.length,
    DRAFT: allEvents.filter((e) => e.status === 'DRAFT').length,
    PUBLISHED: allEvents.filter((e) => e.status === 'PUBLISHED').length,
    COMPLETED: allEvents.filter((e) => e.status === 'COMPLETED').length,
    CANCELLED: allEvents.filter((e) => e.status === 'CANCELLED').length,
  };

  return (
    <main className="min-h-screen bg-gray-50 dark:bg-gray-950 text-gray-900 dark:text-white p-8">
      <div className="max-w-5xl mx-auto">
        <header className="flex justify-between items-center mb-8 pb-6 border-b border-gray-200 dark:border-gray-800 flex-wrap gap-3">
          <div>
            <h1 className="text-3xl font-bold">Events-Verwaltung</h1>
            <p className="text-gray-500 dark:text-gray-400 text-sm mt-1">
              Tours, Themen-Events und Flight-Tours anlegen, publizieren + verwalten.
            </p>
          </div>
          <div className="flex gap-2">
            <Link
              href="/events"
              className="px-4 py-2 bg-indigo-100 hover:bg-indigo-200 dark:bg-indigo-900/30 dark:hover:bg-indigo-900/50 text-indigo-900 dark:text-indigo-100 rounded text-sm transition"
            >
              Catalog ansehen
            </Link>
            <Link
              href="/dashboard"
              className="px-4 py-2 bg-gray-200 hover:bg-gray-300 dark:bg-gray-800 dark:hover:bg-gray-700 rounded text-sm transition"
            >
              ← Dashboard
            </Link>
          </div>
        </header>

        {/* Create-form als collapsible — admin verwaltet häufiger als anlegt. */}
        <details className="mb-6 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-lg">
          <summary className="cursor-pointer p-4 font-medium hover:bg-gray-50 dark:hover:bg-gray-800/50 rounded-lg">
            + Neues Event anlegen
          </summary>
          <div className="p-4 pt-0 border-t border-gray-200 dark:border-gray-800">
            <CreateEventForm airlines={airlines} />
          </div>
        </details>

        {/* Status-filter-tabs */}
        <div className="flex flex-wrap gap-2 mb-4 border-b border-gray-200 dark:border-gray-800">
          {ALL_STATUS_FILTERS.map((f) => (
            <Link
              key={f}
              href={f === 'all' ? '/admin/events' : `/admin/events?status=${f}`}
              className={
                statusFilter === f
                  ? 'px-3 py-2 border-b-2 border-indigo-600 text-indigo-700 dark:text-indigo-400 font-medium text-sm'
                  : 'px-3 py-2 border-b-2 border-transparent text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white text-sm'
              }
            >
              {f === 'all' ? 'Alle' : STATUS_LABELS[f]}{' '}
              <span className="text-xs opacity-60">({counts[f]})</span>
            </Link>
          ))}
        </div>

        {/* Event-liste */}
        {events.length === 0 ? (
          <section className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-lg p-12 text-center">
            <p className="text-gray-500 dark:text-gray-400 mb-2">
              {counts.all === 0
                ? 'Noch keine Events.'
                : `Keine Events im status "${statusFilter === 'all' ? 'alle' : STATUS_LABELS[statusFilter]}".`}
            </p>
            {counts.all === 0 && (
              <p className="text-sm text-gray-500">
                Klick auf "Neues Event anlegen" um den ersten Entwurf zu erstellen.
              </p>
            )}
          </section>
        ) : (
          <ul className="space-y-3">
            {events.map((event) => (
              <li
                key={event.id}
                className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-lg p-5"
              >
                <div className="flex items-start justify-between gap-4 flex-wrap">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-2 flex-wrap">
                      <span
                        className={`text-xs px-2 py-0.5 rounded ${STATUS_STYLES[event.status]}`}
                      >
                        {STATUS_LABELS[event.status]}
                      </span>
                      {event.status === 'PUBLISHED' &&
                        event.runtimeStatus !== 'UPCOMING' &&
                        event.runtimeStatus !== 'COMPLETED' && (
                          <span className="text-xs px-2 py-0.5 rounded bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200">
                            {RUNTIME_STATUS_LABELS[event.runtimeStatus]}
                          </span>
                        )}
                      <span className="text-xs px-2 py-0.5 rounded bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300">
                        {KIND_LABELS[event.kind]}
                      </span>
                    </div>
                    <h3 className="font-semibold text-base mb-1">
                      <Link
                        href={`/admin/events/${event.id}`}
                        className="hover:text-indigo-600 dark:hover:text-indigo-400 transition"
                      >
                        {event.title}
                      </Link>
                    </h3>
                    <p className="text-xs text-gray-500 dark:text-gray-400">
                      Beginn: {formatDateTime(event.startsAt)}
                      {event.endsAt && ` · Ende: ${formatDateTime(event.endsAt)}`}
                    </p>
                    <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                      {event.participantCount}
                      {event.maxParticipants !== null && ` / ${event.maxParticipants}`}{' '}
                      Anmeldungen
                      {event.completedCount > 0 &&
                        ` · ${event.completedCount} abgeschlossen`}
                      {Number(event.bonusReward) > 0 &&
                        ` · ${Number(event.bonusReward)} VAM$ Bonus`}
                    </p>
                  </div>
                  <div className="flex flex-col items-end gap-2 shrink-0">
                    <Link
                      href={`/admin/events/${event.id}`}
                      className="px-3 py-1.5 text-xs bg-indigo-100 hover:bg-indigo-200 dark:bg-indigo-900/30 dark:hover:bg-indigo-900/50 text-indigo-900 dark:text-indigo-100 rounded font-medium transition"
                    >
                      Verwalten →
                    </Link>
                    {event.status === 'PUBLISHED' && (
                      <Link
                        href={`/events/${event.slug}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="px-3 py-1.5 text-xs bg-gray-100 hover:bg-gray-200 dark:bg-gray-800 dark:hover:bg-gray-700 rounded font-medium transition"
                      >
                        Public ansehen ↗
                      </Link>
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
