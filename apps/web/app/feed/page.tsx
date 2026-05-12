/**
 * Track 5 #12 (Section C) — Airline Activity Feed.
 *
 * Route: /feed
 *
 * Eine timeline der letzten 14 tage aus der eigenen airline. Pure-aggregator
 * über approved PIREPs + UserAward grants + PirepKudos. Kein neues schema —
 * read-only view auf existing tables.
 *
 * # Auth
 *
 * Logged-in only + muss airlineId haben. Sonst → redirect/empty-state.
 * Cross-airline-leak ist unmöglich weil getAirlineActivityFeed() den
 * airlineId-filter strict via Prisma relation-where forciert.
 *
 * # UX
 *
 * Single column timeline. Kein infinite-scroll im V1 — wenn 50 events der
 * letzten 14 tage nicht reichen, kann der user den window-range expandieren
 * (V2 als query-param). Items linken zu /pireps/[id], /p/[id], etc.
 */

import { auth } from '@/auth';
import { redirect } from 'next/navigation';
import { prisma, getAirlineActivityFeed, type ActivityEvent } from '@vam/db';
import Link from 'next/link';

export default async function FeedPage() {
  const session = await auth();
  if (!session?.user?.id) redirect('/');

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: {
      airlineId: true,
      airline: { select: { icao: true, name: true } },
    },
  });

  if (!user?.airlineId || !user.airline) {
    return (
      <main className="min-h-screen bg-gray-50 dark:bg-gray-950 text-gray-900 dark:text-white p-8">
        <div className="max-w-2xl mx-auto">
          <h1 className="text-3xl font-bold mb-4">Activity Feed 📰</h1>
          <div className="bg-amber-50 dark:bg-amber-950/30 border border-amber-300 dark:border-amber-700/40 rounded-lg p-6">
            <p className="text-sm text-amber-700 dark:text-amber-300">
              Du bist keiner Airline zugeordnet. Der Activity Feed zeigt
              flugaktivität deiner Airline-Kollegen — sobald du einer Airline
              beitrittst, siehst du hier deine timeline.
            </p>
          </div>
        </div>
      </main>
    );
  }

  const events = await getAirlineActivityFeed(user.airlineId, {
    windowDays: 14,
    limit: 50,
  });

  return (
    <main className="min-h-screen bg-gray-50 dark:bg-gray-950 text-gray-900 dark:text-white p-4 sm:p-6 lg:p-8">
      <div className="max-w-2xl mx-auto">
        <header className="mb-6 pb-6 border-b border-gray-200 dark:border-gray-800">
          <h1 className="text-3xl font-bold flex items-baseline gap-3">
            Activity Feed 📰
          </h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-2">
            Was in den letzten 14 tagen bei{' '}
            <span className="font-mono font-semibold">
              {user.airline.icao}
            </span>{' '}
            {user.airline.name} passiert ist.
          </p>
        </header>

        {events.length === 0 ? (
          <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-lg p-8 text-center">
            <p className="text-sm text-gray-500">
              Noch keine activity in den letzten 14 tagen. Flieg einen flug,
              gib jemandem kudos, oder warte bis ein kollege fliegt.
            </p>
          </div>
        ) : (
          <ul className="space-y-3">
            {events.map((e) => (
              <li key={e.id}>
                <EventCard event={e} />
              </li>
            ))}
          </ul>
        )}

        <footer className="mt-8 text-center text-[11px] text-gray-400 dark:text-gray-500">
          {events.length} {events.length === 1 ? 'event' : 'events'} · letzte 14 tage
        </footer>
      </div>
    </main>
  );
}

function EventCard({ event }: { event: ActivityEvent }) {
  const ts = formatRelativeTime(event.timestamp);

  if (event.kind === 'pirep') {
    return (
      <article className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-lg p-4 flex items-start gap-3">
        <ActorAvatar actor={event.actor} />
        <div className="flex-1 min-w-0">
          <div className="flex items-baseline gap-2 flex-wrap">
            <ActorName actor={event.actor} />
            <span className="text-sm text-gray-500">flog</span>
            <Link
              href={`/pireps/${event.pirep.id}`}
              className="text-sm font-mono font-semibold text-indigo-600 dark:text-indigo-400 hover:underline"
            >
              {event.pirep.flightNumber ?? 'PIREP'}
            </Link>
          </div>
          <p className="text-sm text-gray-700 dark:text-gray-300 mt-1 font-mono">
            {event.pirep.departureIcao} → {event.pirep.arrivalIcao}
            {event.pirep.aircraftType && (
              <span className="text-xs text-gray-500 ml-2">
                · {event.pirep.aircraftType}
              </span>
            )}
            {event.pirep.flightTimeMin !== null && (
              <span className="text-xs text-gray-500 ml-2 tabular-nums">
                · {Math.floor(event.pirep.flightTimeMin / 60)}h{' '}
                {event.pirep.flightTimeMin % 60}m
              </span>
            )}
          </p>
          <p className="text-[10px] text-gray-400 mt-1">✈️ {ts}</p>
        </div>
      </article>
    );
  }

  if (event.kind === 'award') {
    return (
      <article className="bg-white dark:bg-gray-900 border border-amber-200 dark:border-amber-700/30 rounded-lg p-4 flex items-start gap-3">
        <ActorAvatar actor={event.actor} />
        <div className="flex-1 min-w-0">
          <div className="flex items-baseline gap-2 flex-wrap">
            <ActorName actor={event.actor} />
            <span className="text-sm text-gray-500">
              hat einen Award erhalten
            </span>
          </div>
          <div className="mt-2 flex items-center gap-2 px-3 py-2 bg-amber-50 dark:bg-amber-950/30 rounded">
            {event.award.iconUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <picture>
                <img
                  src={event.award.iconUrl}
                  alt=""
                  className="w-8 h-8 object-contain"
                />
              </picture>
            ) : (
              <span className="text-2xl" aria-hidden="true">
                🏆
              </span>
            )}
            <div className="min-w-0">
              <p className="text-sm font-semibold">{event.award.name}</p>
              {event.award.description && (
                <p className="text-[11px] text-gray-600 dark:text-gray-400 line-clamp-1">
                  {event.award.description}
                </p>
              )}
            </div>
          </div>
          <p className="text-[10px] text-gray-400 mt-2">🏆 {ts}</p>
        </div>
      </article>
    );
  }

  // kudos
  return (
    <article className="bg-white dark:bg-gray-900 border border-pink-200 dark:border-pink-700/30 rounded-lg p-4 flex items-start gap-3">
      <ActorAvatar actor={event.actor} />
      <div className="flex-1 min-w-0">
        <div className="flex items-baseline gap-2 flex-wrap">
          <ActorName actor={event.actor} />
          <span className="text-sm text-gray-500">gab Kudos für</span>
          <ActorName actor={event.target.pilot} />
          <span className="text-sm text-gray-500">flug</span>
          <Link
            href={`/pireps/${event.target.pirepId}`}
            className="text-sm font-mono font-semibold text-indigo-600 dark:text-indigo-400 hover:underline"
          >
            {event.target.flightNumber ?? 'PIREP'}
          </Link>
        </div>
        <p className="text-sm text-gray-700 dark:text-gray-300 mt-1 font-mono">
          {event.target.departureIcao} → {event.target.arrivalIcao}
        </p>
        <p className="text-[10px] text-gray-400 mt-1">👍 {ts}</p>
      </div>
    </article>
  );
}

function ActorAvatar({ actor }: { actor: ActivityEvent['actor'] }) {
  if (actor.image) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <picture>
        <img
          src={actor.image}
          alt=""
          className="w-10 h-10 rounded-full border border-gray-200 dark:border-gray-700 shrink-0"
        />
      </picture>
    );
  }
  return (
    <div className="w-10 h-10 rounded-full bg-gray-200 dark:bg-gray-800 border border-gray-300 dark:border-gray-700 shrink-0" />
  );
}

function ActorName({ actor }: { actor: ActivityEvent['actor'] }) {
  return (
    <Link
      href={`/p/${actor.id}`}
      className="text-sm font-semibold hover:underline"
    >
      {actor.name ?? 'Unbenannt'}
    </Link>
  );
}

/**
 * Relative-time formatter. "vor 5min", "vor 2h", "vor 3d", "vor 2 wochen".
 * Schreibt explicit auf deutsch — UI ist deutsch, also kein Intl.RelativeTimeFormat
 * weil das locale-fragil ist (en/de/etc je nach browser/server).
 */
function formatRelativeTime(date: Date): string {
  const now = Date.now();
  const diffMs = now - date.getTime();
  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 1) return 'gerade eben';
  if (diffMin < 60) return `vor ${diffMin}min`;
  const diffH = Math.floor(diffMin / 60);
  if (diffH < 24) return `vor ${diffH}h`;
  const diffD = Math.floor(diffH / 24);
  if (diffD < 7) return `vor ${diffD}d`;
  const diffW = Math.floor(diffD / 7);
  return `vor ${diffW} ${diffW === 1 ? 'woche' : 'wochen'}`;
}
