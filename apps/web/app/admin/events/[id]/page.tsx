import { notFound  } from 'next/navigation';
import Link from 'next/link';
import { prisma, getEventForAdmin, type EventStatus, type RuntimeStatus, type EventKind } from '@vam/db';
import { requireAdminPage } from '@/lib/roles';
import { EditEventForm, EventStateButtons, MarkParticipantButton } from '../admin-forms';

/**
 * Track 1 #7 (Events / Flight-Tours, 9.2.8) — Admin event-detail-page.
 *
 * Admin-only. Volle event-info plus:
 *   - Status-buttons (publish/cancel/complete/delete je nach status)
 *   - Edit-form (collapsible)
 *   - Participants-tabelle mit per-row mark/unmark-buttons
 *   - Public-link in neuem tab (PUBLISHED only)
 *
 * # Auth
 *
 * role.name === 'admin' required. Defense-in-depth: actions checken
 * eh selbst, aber wir wollen kein confusing-empty-render für non-admins.
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

function formatDateTime(d: Date | null): string | null {
  if (!d) return null;
  return new Date(d).toLocaleString('de-DE', {
    dateStyle: 'full',
    timeStyle: 'short',
  });
}

export default async function AdminEventDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await requireAdminPage();
  const { id } = await params;

  // Parallel: event-with-participants + airlines (für edit-form dropdown)
  const [event, airlines] = await Promise.all([
    getEventForAdmin(id),
    prisma.airline.findMany({
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
    }),
  ]);

  if (!event) notFound();

  const bonus = Number(event.bonusReward);

  // Stats für summary-banner
  const completedCount = event.participants.filter((p) => p.completed).length;
  const pendingCount = event.participants.length - completedCount;

  return (
    <main className="min-h-screen bg-gray-50 dark:bg-gray-950 text-gray-900 dark:text-white p-8">
      <div className="max-w-5xl mx-auto">
        <header className="mb-6 flex justify-between items-start gap-4 flex-wrap">
          <Link
            href="/admin/events"
            className="px-4 py-2 bg-gray-200 hover:bg-gray-300 dark:bg-gray-800 dark:hover:bg-gray-700 rounded text-sm transition"
          >
            ← Alle Events
          </Link>
          {event.status === 'PUBLISHED' && (
            <Link
              href={`/events/${event.slug}`}
              target="_blank"
              rel="noopener noreferrer"
              className="px-4 py-2 bg-indigo-100 hover:bg-indigo-200 dark:bg-indigo-900/30 dark:hover:bg-indigo-900/50 text-indigo-900 dark:text-indigo-100 rounded text-sm transition"
            >
              Public ansehen ↗
            </Link>
          )}
        </header>

        {/* Title + status-row */}
        <section className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-lg p-6 mb-6">
          <div className="flex items-center gap-2 mb-3 flex-wrap">
            <span
              className={`text-xs px-2 py-0.5 rounded ${STATUS_STYLES[event.status]}`}
            >
              {STATUS_LABELS[event.status]}
            </span>
            {event.status === 'PUBLISHED' &&
              event.runtimeStatus !== 'UPCOMING' && (
                <span className="text-xs px-2 py-0.5 rounded bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200">
                  {RUNTIME_STATUS_LABELS[event.runtimeStatus]}
                </span>
              )}
            <span className="text-xs px-2 py-0.5 rounded bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300">
              {KIND_LABELS[event.kind]}
            </span>
            {event.airline ? (
              <span className="text-xs px-2 py-0.5 rounded bg-amber-100 dark:bg-amber-900/30 text-amber-800 dark:text-amber-200">
                {event.airline.name}
              </span>
            ) : (
              <span className="text-xs px-2 py-0.5 rounded bg-purple-100 dark:bg-purple-900/30 text-purple-800 dark:text-purple-200">
                VA-weit
              </span>
            )}
          </div>
          <h1 className="text-2xl font-bold mb-1">{event.title}</h1>
          <p className="text-xs text-gray-500 dark:text-gray-400 font-mono mb-4">
            slug: <code>{event.slug}</code>
          </p>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm pt-4 border-t border-gray-200 dark:border-gray-800">
            <div>
              <p className="text-xs text-gray-500 dark:text-gray-400">Beginn</p>
              <p className="font-medium text-xs">
                {formatDateTime(event.startsAt)}
              </p>
            </div>
            {event.endsAt && (
              <div>
                <p className="text-xs text-gray-500 dark:text-gray-400">Ende</p>
                <p className="font-medium text-xs">
                  {formatDateTime(event.endsAt)}
                </p>
              </div>
            )}
            <div>
              <p className="text-xs text-gray-500 dark:text-gray-400">
                Teilnehmer
              </p>
              <p className="font-medium">
                {event.participantCount}
                {event.maxParticipants !== null && ` / ${event.maxParticipants}`}
              </p>
            </div>
            {bonus > 0 && (
              <div>
                <p className="text-xs text-gray-500 dark:text-gray-400">
                  Completion-Bonus
                </p>
                <p className="font-medium text-amber-700 dark:text-amber-400">
                  {bonus} VAM$
                </p>
              </div>
            )}
          </div>
        </section>

        {/* State-actions */}
        <section className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-lg p-6 mb-6">
          <h2 className="text-sm uppercase tracking-wider text-gray-500 mb-3">
            Status-Aktionen
          </h2>
          <EventStateButtons
            eventId={event.id}
            status={event.status}
            title={event.title}
          />
        </section>

        {/* Edit-form (collapsible) */}
        <details className="mb-6 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-lg">
          <summary className="cursor-pointer p-4 font-medium hover:bg-gray-50 dark:hover:bg-gray-800/50 rounded-lg">
            Event bearbeiten
          </summary>
          <div className="p-4 pt-0 border-t border-gray-200 dark:border-gray-800">
            <EditEventForm event={event} airlines={airlines} />
          </div>
        </details>

        {/* Participants */}
        <section className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-lg overflow-hidden">
          <header className="px-6 py-4 border-b border-gray-200 dark:border-gray-800 flex items-center justify-between flex-wrap gap-2">
            <h2 className="text-sm uppercase tracking-wider text-gray-500">
              Teilnehmer ({event.participants.length})
            </h2>
            {event.participants.length > 0 && (
              <span className="text-xs text-gray-500 dark:text-gray-400">
                {completedCount} abgeschlossen · {pendingCount} ausstehend
              </span>
            )}
          </header>

          {event.participants.length === 0 ? (
            <div className="p-12 text-center">
              <p className="text-gray-500 dark:text-gray-400">
                {event.status === 'DRAFT'
                  ? 'Noch keine Anmeldungen — event ist im DRAFT-status (nicht öffentlich).'
                  : 'Noch keine Anmeldungen.'}
              </p>
            </div>
          ) : (
            <ul className="divide-y divide-gray-200 dark:divide-gray-800">
              {event.participants.map((p) => (
                <li
                  key={p.id}
                  className="px-6 py-4 flex items-center justify-between gap-4 flex-wrap"
                >
                  <div className="flex items-center gap-3 flex-1 min-w-0">
                    {p.user.image ? (
                      <picture>
                        <img
                          src={p.user.image}
                          alt=""
                          className="w-9 h-9 rounded-full"
                        />
                      </picture>
                    ) : (
                      <div className="w-9 h-9 rounded-full bg-gray-300 dark:bg-gray-700" />
                    )}
                    <div className="flex-1 min-w-0">
                      <Link
                        href={`/pilots/${p.user.id}`}
                        className="text-sm font-medium hover:text-indigo-600 dark:hover:text-indigo-400 transition"
                      >
                        {p.user.name ?? 'Unbenannt'}
                      </Link>
                      <p className="text-xs text-gray-500 dark:text-gray-400">
                        Angemeldet:{' '}
                        {new Date(p.joinedAt).toLocaleDateString('de-DE', {
                          dateStyle: 'medium',
                        })}
                        {p.completed && p.completedAt && (
                          <>
                            {' · '}
                            <span className="text-emerald-700 dark:text-emerald-400">
                              ✓ Abgeschlossen am{' '}
                              {new Date(p.completedAt).toLocaleDateString('de-DE')}
                              {p.completedBy && ` von ${p.completedBy.name ?? '—'}`}
                            </span>
                          </>
                        )}
                      </p>
                    </div>
                  </div>
                  <MarkParticipantButton
                    participantId={p.id}
                    completed={p.completed}
                    pilotName={p.user.name ?? 'Pilot'}
                    bonusReward={bonus}
                  />
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </main>
  );
}
