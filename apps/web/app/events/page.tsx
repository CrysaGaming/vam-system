import { auth } from '@/auth';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import {
  listPublishedEvents,
  prisma,
  type EventKind,
  type EventWithCounts,
  type RuntimeStatus,
} from '@vam/db';
import { EventCard } from './event-card';
import { EventCalendar } from './event-calendar';

/**
 * Track 1 #7 (Events / Flight-Tours, 9.2.8) — Public events-catalog.
 *
 * Zeigt alle PUBLISHED events der user-airline (+VA-wide events) mit
 * tab-switch zwischen "Aktuell" (UPCOMING + IN_PROGRESS, sortiert nach
 * startsAt asc) und "Vergangene Events" (ENDED + COMPLETED, sortiert
 * nach startsAt desc).
 *
 * # Filter-pattern
 *
 * Wie sceneries: filter-state in URL-searchparams. Tabs auch via URL-
 * param `bucket=upcoming|past`. Optional kind-filter (`kind=TOUR|...`).
 *
 * # Auth
 *
 * Member-only (login redirect). Catalog rendert die admin-link wenn
 * role=admin.
 *
 * # User-airline-scoping
 *
 * Wir scopen events auf die airline des aktuellen users (plus VA-wide
 * events mit airlineId=null). Das matched dem rest der app: ein pilot
 * sieht im event-catalog keine events von anderen airlines auf der
 * instanz. Multi-tenant-instanzen können später eine "alle airlines"
 * toggle bekommen.
 */

const KIND_LABELS: Record<EventKind, string> = {
  TOUR: 'Tour',
  SINGLE_FLIGHT: 'Single-Flight',
  THEMED: 'Themen-Event',
  GROUP_FLIGHT: 'Group-Flight',
  SEASONAL: 'Saison-Event',
};

const ALL_KINDS: EventKind[] = [
  'TOUR',
  'SINGLE_FLIGHT',
  'THEMED',
  'GROUP_FLIGHT',
  'SEASONAL',
];

export default async function EventsCatalogPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await auth();
  if (!session?.user) redirect('/');

  const params = await searchParams;
  const bucketParam = typeof params.bucket === 'string' ? params.bucket : 'upcoming';
  const bucket: 'upcoming' | 'past' =
    bucketParam === 'past' ? 'past' : 'upcoming';
  const kindParam = typeof params.kind === 'string' ? params.kind : '';
  const kind: EventKind | null =
    ALL_KINDS.includes(kindParam as EventKind) ? (kindParam as EventKind) : null;

  // Track 4 #95: view-toggle. ?view=calendar zeigt month-grid statt list.
  // Default = list (legacy-pfad bleibt der primary).
  const viewParam = typeof params.view === 'string' ? params.view : 'list';
  const view: 'list' | 'calendar' = viewParam === 'calendar' ? 'calendar' : 'list';
  const monthParam = typeof params.month === 'string' ? params.month : undefined;

  // User-airline für scoping + admin-check
  const currentUser = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: {
      airlineId: true,
      role: { select: { name: true } },
    },
  });
  const isAdmin = currentUser?.role?.name === 'admin';

  // Track 4 #95: Calendar-mode fetcht alle events (upcoming + past) und
  // gruppiert sie über alle monate. Die ?month=YYYY-MM-navigation in der
  // calendar-component filtert client-seitig durch die anzeige — wir
  // fetchen aber bewusst kein month-window damit dem user beim
  // wechsel zwischen monaten kein flicker entsteht und event-counts
  // konsistent bleiben.
  //
  // List-mode nutzt weiter den bucket-filter wie bisher.
  let events: EventWithCounts[];
  if (view === 'calendar') {
    const [upcoming, past] = await Promise.all([
      listPublishedEvents({
        airlineId: currentUser?.airlineId ?? null,
        bucket: 'upcoming',
        kind,
      }),
      listPublishedEvents({
        airlineId: currentUser?.airlineId ?? null,
        bucket: 'past',
        kind,
      }),
    ]);
    // Merge + dedupe (PUBLISHED-events mit endsAt-window-edge können
    // theoretisch in beiden buckets sein, defensive uniq via id-set).
    const seen = new Set<string>();
    events = [];
    for (const ev of [...upcoming, ...past]) {
      if (seen.has(ev.id)) continue;
      seen.add(ev.id);
      events.push(ev);
    }
  } else {
    events = await listPublishedEvents({
      airlineId: currentUser?.airlineId ?? null,
      bucket,
      kind,
    });
  }

  // Counts für tab-badges. Beide buckets parallel ohne kind-filter
  // damit der user beim wechseln zwischen tabs konsistente zahlen sieht.
  const [upcomingCount, pastCount] = await Promise.all([
    listPublishedEvents({
      airlineId: currentUser?.airlineId ?? null,
      bucket: 'upcoming',
    }).then((list) => list.length),
    listPublishedEvents({
      airlineId: currentUser?.airlineId ?? null,
      bucket: 'past',
    }).then((list) => list.length),
  ]);

  return (
    <main className="min-h-screen bg-gray-50 dark:bg-gray-950 text-gray-900 dark:text-white p-8">
      <div className="max-w-6xl mx-auto">
        <header className="mb-6">
          <div className="flex items-center justify-between flex-wrap gap-4 mb-2">
            <h1 className="text-3xl font-bold">Events</h1>
            <div className="flex items-center gap-2">
              {/* Track 4 #95 (Section S): view-toggle. Sitzt prominent
                  rechts oben damit's der erste sicht-anker ist. List ist
                  der default + matched dem legacy-pfad, calendar ist
                  der opt-in für planungs-überblick. */}
              <div className="inline-flex rounded-md bg-gray-200 dark:bg-gray-800 p-0.5">
                <Link
                  href={`/events?view=list${kind ? `&kind=${kind}` : ''}${
                    bucket !== 'upcoming' ? `&bucket=${bucket}` : ''
                  }`}
                  className={`px-3 py-1.5 text-xs font-medium rounded transition ${
                    view === 'list'
                      ? 'bg-white dark:bg-gray-900 text-gray-900 dark:text-white shadow-sm'
                      : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white'
                  }`}
                >
                  📋 Liste
                </Link>
                <Link
                  href={`/events?view=calendar${kind ? `&kind=${kind}` : ''}`}
                  className={`px-3 py-1.5 text-xs font-medium rounded transition ${
                    view === 'calendar'
                      ? 'bg-white dark:bg-gray-900 text-gray-900 dark:text-white shadow-sm'
                      : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white'
                  }`}
                >
                  📅 Kalender
                </Link>
              </div>
              {isAdmin && (
                <Link
                  href="/admin/events"
                  className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded text-sm font-medium transition"
                >
                  Verwalten
                </Link>
              )}
            </div>
          </div>
          <p className="text-gray-500 dark:text-gray-400">
            Tours, Themen-Flights und gemeinsame Events der Airline.
          </p>
        </header>

        {/* Tab-bar — nur in list-view sichtbar. Calendar hat eigene
            time-navigation via month-arrows + ist time-agnostisch
            (zeigt alle events). */}
        {view === 'list' && (
          <div className="flex gap-2 mb-4 border-b border-gray-200 dark:border-gray-800">
            <Link
              href={`/events?bucket=upcoming${kind ? `&kind=${kind}` : ''}`}
              className={
                bucket === 'upcoming'
                  ? 'px-4 py-2 border-b-2 border-indigo-600 text-indigo-700 dark:text-indigo-400 font-medium text-sm'
                  : 'px-4 py-2 border-b-2 border-transparent text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white text-sm'
              }
            >
              Aktuell{' '}
              <span className="text-xs opacity-60">({upcomingCount})</span>
            </Link>
            <Link
              href={`/events?bucket=past${kind ? `&kind=${kind}` : ''}`}
              className={
                bucket === 'past'
                  ? 'px-4 py-2 border-b-2 border-indigo-600 text-indigo-700 dark:text-indigo-400 font-medium text-sm'
                  : 'px-4 py-2 border-b-2 border-transparent text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white text-sm'
              }
            >
              Vergangene{' '}
              <span className="text-xs opacity-60">({pastCount})</span>
            </Link>
          </div>
        )}

        {/* Kind-filter pills — in beiden views. Calendar preserved den
            kind im ?view=calendar-link, so dass beim toggle filter
            behalten wird. */}
        <div className="flex flex-wrap gap-2 mb-6">
          <Link
            href={
              view === 'calendar'
                ? `/events?view=calendar${monthParam ? `&month=${monthParam}` : ''}`
                : `/events?bucket=${bucket}`
            }
            className={
              !kind
                ? 'px-3 py-1 text-xs rounded-full bg-indigo-600 text-white'
                : 'px-3 py-1 text-xs rounded-full bg-gray-200 dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:bg-gray-300 dark:hover:bg-gray-700'
            }
          >
            Alle
          </Link>
          {ALL_KINDS.map((k) => (
            <Link
              key={k}
              href={
                view === 'calendar'
                  ? `/events?view=calendar&kind=${k}${monthParam ? `&month=${monthParam}` : ''}`
                  : `/events?bucket=${bucket}&kind=${k}`
              }
              className={
                kind === k
                  ? 'px-3 py-1 text-xs rounded-full bg-indigo-600 text-white'
                  : 'px-3 py-1 text-xs rounded-full bg-gray-200 dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:bg-gray-300 dark:hover:bg-gray-700'
              }
            >
              {KIND_LABELS[k]}
            </Link>
          ))}
        </div>

        {view === 'calendar' ? (
          <EventCalendar
            events={events.map((e) => ({
              id: e.id,
              slug: e.slug,
              title: e.title,
              kind: e.kind,
              startsAt: e.startsAt,
              endsAt: e.endsAt,
            }))}
            monthParam={monthParam}
            kindParam={kind ?? undefined}
          />
        ) : events.length === 0 ? (
          <section className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-lg p-12 text-center">
            <p className="text-gray-500 dark:text-gray-400 mb-2">
              {bucket === 'upcoming'
                ? 'Aktuell keine Events geplant.'
                : 'Keine vergangenen Events.'}
            </p>
            {bucket === 'upcoming' && isAdmin && (
              <p className="text-sm text-gray-500">
                Als Admin kannst du{' '}
                <Link
                  href="/admin/events"
                  className="text-indigo-600 dark:text-indigo-400 hover:underline"
                >
                  hier ein neues Event anlegen
                </Link>
                .
              </p>
            )}
          </section>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {events.map((event) => (
              <EventCard key={event.id} event={event} />
            ))}
          </div>
        )}
      </div>
    </main>
  );
}

// Re-export für card-component damit es nicht 2x deklariert werden muss
export { KIND_LABELS };
export type { EventWithCounts, RuntimeStatus };
