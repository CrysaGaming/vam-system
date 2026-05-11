import { auth } from '@/auth';
import { redirect, notFound } from 'next/navigation';
import Link from 'next/link';
import {
  getEventBySlug,
  getEventParticipants,
  getUserEventParticipation,
  prisma,
  type EventKind,
  type RuntimeStatus,
} from '@vam/db';
import { EventSignupButton } from './signup-button';
import { CommentsSection } from './comments-section';

/**
 * Track 1 #7 (Events / Flight-Tours, 9.2.8) — Public event-detail-page.
 *
 * Volle event-info inkl. description, datum, kind, bonus, route-legs
 * (für tours), participants-liste, und der signup-button.
 *
 * # Auth
 *
 * Member-only (login redirect). DRAFT-events werden für non-admins als
 * notFound() gerendert (admin-preview funktioniert via getEventBySlug
 * mit viewerIsAdmin=true).
 *
 * # Signup-button-logic
 *
 * Disabled-state berechnet sich aus runtime-status:
 *   - DRAFT → "Event ist noch nicht freigegeben"
 *   - CANCELLED → "Event wurde abgesagt"
 *   - COMPLETED/ENDED → "Event ist bereits vorbei"
 *   - IN_PROGRESS + endsAt < now (kann vorkommen wenn admin completed
 *     noch nicht gesetzt hat) → "Event ist bereits vorbei"
 *   - PUBLISHED + full → "Event ist voll"
 *   - sonst → enabled
 */

const KIND_LABELS: Record<EventKind, string> = {
  TOUR: 'Tour',
  SINGLE_FLIGHT: 'Single-Flight',
  THEMED: 'Themen-Event',
  GROUP_FLIGHT: 'Group-Flight',
  SEASONAL: 'Saison-Event',
};

const STATUS_LABELS: Record<RuntimeStatus, string> = {
  DRAFT: 'Entwurf',
  UPCOMING: 'Anstehend',
  IN_PROGRESS: 'Läuft gerade',
  ENDED: 'Beendet',
  COMPLETED: 'Abgeschlossen',
  CANCELLED: 'Abgesagt',
};

const STATUS_STYLES: Record<RuntimeStatus, string> = {
  DRAFT: 'bg-gray-200 text-gray-700 dark:bg-gray-800 dark:text-gray-300',
  UPCOMING:
    'bg-indigo-100 text-indigo-800 dark:bg-indigo-900/40 dark:text-indigo-200',
  IN_PROGRESS:
    'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200',
  ENDED: 'bg-gray-200 text-gray-700 dark:bg-gray-800 dark:text-gray-300',
  COMPLETED:
    'bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-200',
  CANCELLED:
    'bg-rose-100 text-rose-800 dark:bg-rose-900/40 dark:text-rose-200',
};

function formatDateTime(d: Date | null): string | null {
  if (!d) return null;
  return new Date(d).toLocaleString('de-DE', {
    dateStyle: 'full',
    timeStyle: 'short',
  });
}

type Leg = { icao: string; label?: string; note?: string };

function parseLegs(raw: unknown): Leg[] {
  if (!raw || !Array.isArray(raw)) return [];
  return raw
    .filter(
      (l): l is Leg =>
        typeof l === 'object' &&
        l !== null &&
        'icao' in l &&
        typeof (l as { icao: unknown }).icao === 'string',
    )
    .map((l) => ({
      icao: l.icao,
      label: l.label,
      note: l.note,
    }));
}

export default async function EventDetailPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const session = await auth();
  if (!session?.user) redirect('/');

  const { slug } = await params;

  // Admin-check für DRAFT-preview-zugriff
  const currentUser = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { role: { select: { name: true } } },
  });
  const isAdmin = currentUser?.role?.name === 'admin';

  const event = await getEventBySlug(slug, { viewerIsAdmin: isAdmin });
  if (!event) notFound();

  // Parallel: participants + own-participation-check
  const [participants, ownParticipation] = await Promise.all([
    getEventParticipants(event.id),
    getUserEventParticipation(event.id, session.user.id),
  ]);

  const bonus = Number(event.bonusReward);
  const legs = parseLegs(event.legs);

  // Disabled-logic für signup-button
  let signupDisabled = false;
  let signupDisabledReason: string | null = null;
  if (event.runtimeStatus === 'DRAFT') {
    signupDisabled = true;
    signupDisabledReason = 'Event ist noch nicht freigegeben.';
  } else if (event.runtimeStatus === 'CANCELLED') {
    signupDisabled = true;
    signupDisabledReason = 'Event wurde abgesagt.';
  } else if (
    event.runtimeStatus === 'COMPLETED' ||
    event.runtimeStatus === 'ENDED'
  ) {
    signupDisabled = true;
    signupDisabledReason = 'Event ist bereits vorbei.';
  } else if (
    event.maxParticipants !== null &&
    event.participantCount >= event.maxParticipants &&
    !ownParticipation
  ) {
    signupDisabled = true;
    signupDisabledReason = 'Event ist voll belegt.';
  }

  return (
    <main className="min-h-screen bg-gray-50 dark:bg-gray-950 text-gray-900 dark:text-white p-8">
      <div className="max-w-4xl mx-auto">
        <Link
          href="/events"
          className="inline-block mb-4 text-sm text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white"
        >
          ← Zurück zum Katalog
        </Link>

        {/* Cover-image (full-width, 16:9) */}
        {event.coverImageUrl && event.coverImageUrl.startsWith('http') && (
          <picture>
            <img
              src={event.coverImageUrl}
              alt=""
              className="w-full aspect-video object-cover rounded-lg mb-6"
            />
          </picture>
        )}

        <header className="mb-6">
          <div className="flex items-center gap-3 mb-3 flex-wrap">
            <span
              className={`text-xs px-2.5 py-1 rounded ${STATUS_STYLES[event.runtimeStatus]}`}
            >
              {STATUS_LABELS[event.runtimeStatus]}
            </span>
            <span className="text-xs px-2.5 py-1 bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 rounded">
              {KIND_LABELS[event.kind]}
            </span>
            {event.airline && (
              <span className="text-xs px-2.5 py-1 bg-amber-100 dark:bg-amber-900/30 text-amber-800 dark:text-amber-200 rounded">
                {event.airline.name}
              </span>
            )}
            {!event.airline && (
              <span className="text-xs px-2.5 py-1 bg-purple-100 dark:bg-purple-900/30 text-purple-800 dark:text-purple-200 rounded">
                VA-weit
              </span>
            )}
          </div>
          <h1 className="text-3xl font-bold">{event.title}</h1>
        </header>

        {/* Action-zone: signup-button rechts, datum/zeit links */}
        <section className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-lg p-6 mb-6">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <p className="text-sm text-gray-500 dark:text-gray-400 mb-1">
                Beginn
              </p>
              <p className="font-medium">{formatDateTime(event.startsAt)}</p>
              {event.endsAt && (
                <>
                  <p className="text-sm text-gray-500 dark:text-gray-400 mt-3 mb-1">
                    Ende
                  </p>
                  <p className="font-medium">{formatDateTime(event.endsAt)}</p>
                </>
              )}
              {/* Track 4 #21: ICS-Calendar-Export. Nur für nicht-cancelled
                  events anzeigen — die ICS-route returns 410 für CANCELLED
                  events und wir wollen den dead-link gar nicht erst rendern. */}
              {event.runtimeStatus !== 'CANCELLED' && (
                <a
                  href={`/api/events/${event.slug}/ics`}
                  className="inline-flex items-center gap-1.5 mt-4 text-sm text-indigo-600 dark:text-indigo-400 hover:text-indigo-800 dark:hover:text-indigo-300 hover:underline"
                  download={`event-${event.slug}.ics`}
                  title="Lädt eine .ics-Datei herunter, die du in Google/Apple/Outlook Calendar importieren kannst."
                >
                  📅 Zum Kalender hinzufügen
                </a>
              )}
              {/* Track 4 #96 (Section S): Recap-link nur für completed/
                  ended events. Recap-page zeigt teilnehmer-stats,
                  completion-rate, flugs-stunden im event-fenster und
                  top-completers-leaderboard. */}
              {(event.runtimeStatus === 'COMPLETED' ||
                event.runtimeStatus === 'ENDED') && (
                <Link
                  href={`/events/${event.slug}/recap`}
                  className="inline-flex items-center gap-1.5 mt-2 text-sm text-emerald-600 dark:text-emerald-400 hover:text-emerald-800 dark:hover:text-emerald-300 hover:underline"
                >
                  📊 Event-Recap ansehen
                </Link>
              )}
            </div>

            <EventSignupButton
              eventId={event.id}
              slug={event.slug}
              initialJoined={ownParticipation !== null}
              disabled={signupDisabled}
              disabledReason={signupDisabledReason}
            />
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-6 pt-6 border-t border-gray-200 dark:border-gray-800 text-sm">
            <div>
              <p className="text-xs text-gray-500 dark:text-gray-400">
                Teilnehmer
              </p>
              <p className="font-medium">
                {event.participantCount}
                {event.maxParticipants !== null && (
                  <span className="text-gray-500"> / {event.maxParticipants}</span>
                )}
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
            <div>
              <p className="text-xs text-gray-500 dark:text-gray-400">
                Erstellt von
              </p>
              <p className="font-medium">{event.createdBy.name ?? '—'}</p>
            </div>
            {legs.length > 0 && (
              <div>
                <p className="text-xs text-gray-500 dark:text-gray-400">
                  Strecken
                </p>
                <p className="font-medium">{legs.length}</p>
              </div>
            )}
          </div>
        </section>

        {/* Description */}
        <section className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-lg p-6 mb-6">
          <h2 className="font-semibold text-lg mb-3">Beschreibung</h2>
          <div className="prose prose-sm dark:prose-invert max-w-none whitespace-pre-wrap text-gray-700 dark:text-gray-300">
            {event.description}
          </div>
        </section>

        {/* Tour-legs */}
        {legs.length > 0 && (
          <section className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-lg p-6 mb-6">
            <h2 className="font-semibold text-lg mb-3">Strecken</h2>
            <ol className="space-y-2">
              {legs.map((leg, i) => (
                <li
                  key={`${leg.icao}-${i}`}
                  className="flex items-start gap-3 text-sm"
                >
                  <span className="flex-shrink-0 w-6 h-6 rounded-full bg-indigo-100 dark:bg-indigo-900/40 text-indigo-700 dark:text-indigo-300 flex items-center justify-center text-xs font-semibold">
                    {i + 1}
                  </span>
                  <div className="flex-1">
                    <span className="font-mono uppercase font-semibold">
                      {leg.icao}
                    </span>
                    {leg.label && (
                      <span className="ml-2 text-gray-600 dark:text-gray-400">
                        {leg.label}
                      </span>
                    )}
                    {leg.note && (
                      <p className="text-xs text-gray-500 dark:text-gray-500 mt-0.5">
                        {leg.note}
                      </p>
                    )}
                  </div>
                </li>
              ))}
            </ol>
          </section>
        )}

        {/* Participants */}
        {participants.length > 0 && (
          <section className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-lg p-6 mb-6">
            <h2 className="font-semibold text-lg mb-3">
              Teilnehmer ({participants.length})
            </h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {participants.map((p) => (
                <Link
                  key={p.id}
                  href={`/pilots/${p.user.id}`}
                  className="flex items-center gap-3 p-2 rounded hover:bg-gray-50 dark:hover:bg-gray-800 transition"
                >
                  {p.user.image ? (
                    <picture>
                      <img
                        src={p.user.image}
                        alt=""
                        className="w-8 h-8 rounded-full"
                      />
                    </picture>
                  ) : (
                    <div className="w-8 h-8 rounded-full bg-gray-300 dark:bg-gray-700" />
                  )}
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">
                      {p.user.name ?? '—'}
                    </p>
                    {p.completed && (
                      <p className="text-xs text-emerald-700 dark:text-emerald-400">
                        ✓ Abgeschlossen
                      </p>
                    )}
                  </div>
                </Link>
              ))}
            </div>
          </section>
        )}

        {/* Track 4 #99 (Section S): Comments-section. Server-component
            fetcht comments + rendert post-form. Always shown (auch wenn
            keine participants existieren) — pilots können fragen stellen
            vor dem signup. */}
        <CommentsSection
          eventId={event.id}
          slug={event.slug}
          currentUserId={session.user.id}
          currentUserIsAdmin={isAdmin}
        />
      </div>
    </main>
  );
}
