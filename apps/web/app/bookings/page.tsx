import { auth } from '@/auth';
import { redirect } from 'next/navigation';
import { Prisma, prisma, BookingState } from '@vam/db';
import Link from 'next/link';
import { EmptyState } from '@/components/empty-state';

// Mirror of the helper in [id]/page.tsx — kept duplicated here intentionally
// to avoid premature extraction. If a third caller appears, hoist into a
// shared module; until then duplication beats premature abstraction.
function stateStyle(state: BookingState): { className: string; label: string } {
  switch (state) {
    case 'Created':
      return {
        className: 'bg-blue-500/10 border-blue-500/30 text-blue-700 dark:text-blue-400',
        label: 'Erstellt',
      };
    case 'SimBriefDispatched':
      return {
        className: 'bg-green-500/10 border-green-500/30 text-green-700 dark:text-green-400',
        label: 'OFP geplant',
      };
    case 'InProgress':
      // Multi-leg tour-state (option #12). A tour-booking sits here
      // between legs. Cyan distinguishes it from planning-blue (Created)
      // and planning-green (SimBriefDispatched) — at-a-glance "this one
      // is mid-tour". Single-leg bookings never enter this state.
      return {
        className: 'bg-cyan-500/10 border-cyan-500/30 text-cyan-700 dark:text-cyan-400',
        label: 'Tour läuft',
      };
    case 'Cancelled':
      return {
        className: 'bg-red-500/10 border-red-500/30 text-red-700 dark:text-red-400',
        label: 'Storniert',
      };
    case 'Completed':
      return {
        className: 'bg-gray-500/10 border-gray-500/30 text-gray-700 dark:text-gray-400',
        label: 'Abgeschlossen',
      };
    case 'Expired':
      return {
        className: 'bg-yellow-500/10 border-yellow-500/30 text-yellow-700 dark:text-yellow-400',
        label: 'Abgelaufen',
      };
  }
}

// Single source of truth for the include shape — used both in the query
// below and as the basis for the row component's prop type via
// Prisma.BookingGetPayload<…>. Any column added here flows through to the
// component's row type automatically.
const bookingInclude = {
  route: {
    include: {
      departure: { select: { icao: true } },
      arrival: { select: { icao: true } },
      aircraft: { select: { registration: true, type: true } },
    },
  },
  flightPlanCache: { select: { id: true } },
} satisfies Prisma.BookingInclude;

type BookingRow = Prisma.BookingGetPayload<{ include: typeof bookingInclude }>;

// All BookingState values, in the order the filter chips display.
// Used both to validate the URL searchparam and to render the chip row.
const ALL_BOOKING_STATES: BookingState[] = [
  'Created',
  'SimBriefDispatched',
  'InProgress',
  'Cancelled',
  'Completed',
  'Expired',
];

/**
 * Track 4 #15 (Section C polish) — Bookings filter UI.
 *
 * URL-driven filter pattern (matches sceneries / events): all filter
 * state lives in searchparams. `q` is a free-text query that matches
 * against flightNumber / departure ICAO / arrival ICAO / aircraft
 * registration; `status` is a single BookingState value. Both flow
 * server-side into the Prisma where clause so the database does the
 * narrowing — no in-memory filter on top of an unfiltered fetch.
 *
 * Why URL params over client-side useState:
 *   - Filter state is shareable (link copy preserves the view).
 *   - Browser-back navigates between filter states naturally.
 *   - SSR-friendly, no hydration-mismatch risk.
 *   - Reload returns the same view.
 *
 * The "Aktiv" / "Abgeschlossen" split is preserved when filtering — when
 * the status filter is set to a single state, exactly one of the two
 * sections will render (or neither, if the user has no bookings in that
 * state). The empty-state message branches between "no bookings yet"
 * (no filter) and "no matches for this filter" (filter active).
 */
export default async function BookingsList({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await auth();
  if (!session?.user) redirect('/');

  const params = await searchParams;
  const textQuery =
    typeof params.q === 'string' ? params.q.trim() : '';
  const statusParam =
    typeof params.status === 'string' ? params.status : '';
  const statusFilter: BookingState | null =
    ALL_BOOKING_STATES.includes(statusParam as BookingState)
      ? (statusParam as BookingState)
      : null;

  const currentUser = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { id: true, airlineId: true },
  });
  if (!currentUser?.airlineId) redirect('/dashboard');

  // Build the where clause dynamically. Top-level keys AND together; the
  // OR array combines text-search columns. Skipping OR when no query
  // lets Prisma avoid the join-fanout, keeping the unfiltered case as
  // fast as before this option landed. Mode 'insensitive' is the
  // PostgreSQL ILIKE path — case folding without forcing the user to
  // type ICAO codes in upper-case.
  const baseWhere = {
    userId: currentUser.id,
    airlineId: currentUser.airlineId,
  } satisfies Prisma.BookingWhereInput;

  const filteredWhere: Prisma.BookingWhereInput = {
    ...baseWhere,
    ...(statusFilter && { state: statusFilter }),
    ...(textQuery && {
      OR: [
        { route: { flightNumber: { contains: textQuery, mode: 'insensitive' } } },
        { route: { departure: { icao: { contains: textQuery, mode: 'insensitive' } } } },
        { route: { arrival: { icao: { contains: textQuery, mode: 'insensitive' } } } },
        { route: { aircraft: { registration: { contains: textQuery, mode: 'insensitive' } } } },
      ],
    }),
  };

  // When any filter is active, also fetch the unfiltered total so the
  // user can see "12 of 87 sichtbar" — useful context for "did the
  // filter find what I expected, or is my dataset just small?". Skip
  // the extra round-trip when no filter is set (the visible count is
  // the total).
  const filterActive = textQuery !== '' || statusFilter !== null;
  const [bookings, totalUnfiltered] = await Promise.all([
    prisma.booking.findMany({
      where: filteredWhere,
      include: bookingInclude,
      orderBy: { createdAt: 'desc' },
    }),
    filterActive
      ? prisma.booking.count({ where: baseWhere })
      : Promise.resolve(-1), // sentinel; we use bookings.length below
  ]);

  // Active = anything the user can still act on. Surfaced separately at the
  // top so a freshly created or in-flight booking is one click away even
  // when older closed bookings have piled up. 'InProgress' (option #12
  // multi-leg tours) belongs here too — a tour mid-leg is the most active
  // booking-state there is.
  const activeBookings = bookings.filter(
    (b) =>
      b.state === 'Created' ||
      b.state === 'SimBriefDispatched' ||
      b.state === 'InProgress',
  );
  const closedBookings = bookings.filter(
    (b) =>
      b.state !== 'Created' &&
      b.state !== 'SimBriefDispatched' &&
      b.state !== 'InProgress',
  );

  const totalForHeader = filterActive ? totalUnfiltered : bookings.length;

  return (
    <main className="min-h-screen bg-gray-50 dark:bg-gray-950 text-gray-900 dark:text-white p-4 sm:p-6 lg:p-8">
      <div className="max-w-[100rem] mx-auto">
        <header className="flex justify-between items-center mb-8 pb-6 border-b border-gray-200 dark:border-gray-800">
          <div>
            <h1 className="text-3xl font-bold">Meine Bookings</h1>
            <p className="text-gray-500 dark:text-gray-400 text-sm mt-1">
              {totalForHeader}{' '}
              {totalForHeader === 1 ? 'Booking gesamt' : 'Bookings gesamt'}
              {!filterActive && activeBookings.length > 0 &&
                ` · ${activeBookings.length} aktiv`}
            </p>
          </div>
          <div className="flex gap-3">
            <Link
              href="/dashboard"
              className="px-4 py-2 bg-gray-200 hover:bg-gray-300 dark:bg-gray-800 dark:hover:bg-gray-700 rounded text-sm transition"
            >
              ← Dashboard
            </Link>
            <Link
              href="/bookings/new"
              className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 rounded text-sm transition"
            >
              + Neues Booking
            </Link>
          </div>
        </header>

        <FilterBar
          textQuery={textQuery}
          statusFilter={statusFilter}
          filterActive={filterActive}
          visibleCount={bookings.length}
          totalUnfiltered={totalUnfiltered}
        />

        {bookings.length === 0 ? (
          // Track 4 #52: migrated zur reusable <EmptyState /> component.
          // Branch zwischen "filter aktiv aber keine matches" und "noch nie
          // ein booking erstellt" bleibt erhalten — andere intent, andere
          // CTA.
          filterActive ? (
            <EmptyState
              variant="info"
              icon="🔍"
              title="Keine Bookings entsprechen dem Filter"
              description="Setze den Filter zurück oder ändere die Suchbegriffe."
              primaryAction={{ label: 'Filter zurücksetzen', href: '/bookings' }}
            />
          ) : (
            <EmptyState
              icon="📋"
              title="Du hast noch keine Bookings angelegt"
              description="Erstelle deine erste Buchung um einen Flug zu reservieren."
              primaryAction={{
                label: 'Erstes Booking anlegen →',
                href: '/bookings/new',
              }}
            />
          )
        ) : (
          <div className="space-y-8">
            {activeBookings.length > 0 && (
              <BookingSection title="Aktiv" bookings={activeBookings} />
            )}
            {closedBookings.length > 0 && (
              <BookingSection
                title="Abgeschlossen"
                bookings={closedBookings}
                muted
              />
            )}
          </div>
        )}
      </div>
    </main>
  );
}

/**
 * URL builder for filter-chip links. Preserves the orthogonal axis when
 * one filter is being changed — e.g. clicking a status chip while a
 * text query is active keeps the query in place. Passing `null` for
 * `newStatus` drops the status filter (used by the "Alle" chip and by
 * the global "zurücksetzen" link).
 */
function buildBookingsUrl(
  textQuery: string,
  newStatus: BookingState | null,
): string {
  const usp = new URLSearchParams();
  if (textQuery) usp.set('q', textQuery);
  if (newStatus) usp.set('status', newStatus);
  const qs = usp.toString();
  return qs ? `/bookings?${qs}` : '/bookings';
}

interface FilterBarProps {
  textQuery: string;
  statusFilter: BookingState | null;
  filterActive: boolean;
  visibleCount: number;
  totalUnfiltered: number;
}

function FilterBar({
  textQuery,
  statusFilter,
  filterActive,
  visibleCount,
  totalUnfiltered,
}: FilterBarProps) {
  return (
    <div className="mb-6 space-y-3">
      {/*
        Search form — plain HTML form with method=GET so submission
        navigates to the same page with new ?q=... param. SSR re-renders
        with the new where-clause. No client component needed; this
        works without JS.

        We carry the current statusFilter through as a hidden input so
        a search submission preserves the active status chip — losing
        it on submit would feel like the chip "broke" when the user
        typed in the search box.
      */}
      <form method="GET" className="flex gap-2">
        <input
          type="text"
          name="q"
          defaultValue={textQuery}
          placeholder="Suche: Flugnummer, ICAO, Aircraft-Registration…"
          className="flex-1 px-3 py-2 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded text-sm focus:outline-none focus:border-indigo-500 dark:focus:border-indigo-400"
        />
        {statusFilter && (
          <input type="hidden" name="status" value={statusFilter} />
        )}
        <button
          type="submit"
          className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded text-sm transition"
        >
          Suchen
        </button>
      </form>

      {/*
        Status-filter chip row. "Alle" reset chip on the left, then one
        chip per BookingState. Each chip's accent uses the same color
        palette as the booking-row state-pill so the filter UI feels
        consistent with the result rows.
      */}
      <div className="flex gap-2 flex-wrap items-center">
        <FilterChip
          label="Alle"
          href={buildBookingsUrl(textQuery, null)}
          active={!statusFilter}
        />
        {ALL_BOOKING_STATES.map((s) => {
          const style = stateStyle(s);
          return (
            <FilterChip
              key={s}
              label={style.label}
              href={buildBookingsUrl(textQuery, s)}
              active={statusFilter === s}
              accentClass={style.className}
            />
          );
        })}
      </div>

      {/*
        Filter-status row. Only rendered when something is active —
        otherwise it's noise. Shows "X / Y sichtbar" + a single-click
        reset link so the user can always escape the filter.
      */}
      {filterActive && (
        <p className="text-xs text-gray-500 dark:text-gray-400">
          {visibleCount} / {totalUnfiltered}{' '}
          {totalUnfiltered === 1 ? 'Booking sichtbar' : 'Bookings sichtbar'}{' '}
          ·{' '}
          <Link
            href="/bookings"
            className="text-indigo-600 dark:text-indigo-400 hover:underline"
          >
            × Filter zurücksetzen
          </Link>
        </p>
      )}
    </div>
  );
}

interface FilterChipProps {
  label: string;
  href: string;
  active: boolean;
  /**
   * Optional accent classes for the active state — mirrors the
   * booking-row state-pill colors. Falls back to a neutral indigo
   * for the "Alle" chip which has no associated state color.
   */
  accentClass?: string;
}

function FilterChip({ label, href, active, accentClass }: FilterChipProps) {
  // Inactive: subdued neutral that fades into the page. Active: either
  // the state's own accent (so the chip mirrors the row pill) or
  // indigo for "Alle" (the catch-all has no state color of its own).
  const base =
    'px-3 py-1 rounded-full text-xs font-medium border transition whitespace-nowrap';
  const inactive =
    'bg-white dark:bg-gray-900 border-gray-200 dark:border-gray-800 text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800';
  const activeAccent =
    accentClass ?? 'bg-indigo-600 text-white border-indigo-600';
  return (
    <Link href={href} className={`${base} ${active ? activeAccent : inactive}`}>
      {label}
    </Link>
  );
}

interface BookingSectionProps {
  title: string;
  bookings: BookingRow[];
  muted?: boolean;
}

function BookingSection({ title, bookings, muted }: BookingSectionProps) {
  return (
    <section>
      <h2 className="text-sm uppercase tracking-wider text-gray-500 mb-3">
        {title}
      </h2>
      <div className={`space-y-2 ${muted ? 'opacity-75' : ''}`}>
        {bookings.map((booking) => {
          const style = stateStyle(booking.state);
          const hasOfp = !!booking.flightPlanCache;
          return (
            <Link
              key={booking.id}
              href={`/bookings/${booking.id}`}
              className="flex justify-between items-center px-4 py-3 bg-white hover:bg-gray-50 dark:bg-gray-900 dark:hover:bg-gray-800 rounded border border-gray-200 dark:border-gray-800 hover:border-indigo-600/50 transition group"
            >
              <div className="flex items-center gap-4 min-w-0">
                <span className="font-mono text-sm text-indigo-600 dark:text-indigo-400 group-hover:text-indigo-700 dark:group-hover:text-indigo-300 transition w-16 flex-shrink-0">
                  {booking.route.flightNumber}
                </span>
                <span className="text-sm">
                  <span className="font-mono">
                    {booking.route.departure.icao}
                  </span>
                  <span className="text-gray-500 mx-2">→</span>
                  <span className="font-mono">
                    {booking.route.arrival.icao}
                  </span>
                </span>
                {booking.route.aircraft && (
                  <span className="text-xs font-mono text-gray-500 hidden md:inline">
                    {booking.route.aircraft.registration}
                  </span>
                )}
              </div>
              <div className="flex items-center gap-3 flex-shrink-0">
                {hasOfp && (
                  <span
                    className="text-xs text-indigo-600 dark:text-indigo-400"
                    title="OFP gecacht"
                  >
                    ✈ OFP
                  </span>
                )}
                {booking.intendedNetwork && (
                  <span className="text-xs text-gray-500 font-mono hidden sm:inline">
                    {booking.intendedNetwork}
                  </span>
                )}
                <span
                  className={`px-2 py-0.5 rounded text-xs font-semibold border ${style.className}`}
                >
                  {style.label}
                </span>
                <span className="text-gray-500 group-hover:translate-x-1 transition-transform">
                  →
                </span>
              </div>
            </Link>
          );
        })}
      </div>
    </section>
  );
}
