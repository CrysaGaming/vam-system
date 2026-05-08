import { auth } from '@/auth';
import { redirect } from 'next/navigation';
import { Prisma, prisma, BookingState } from '@vam/db';
import Link from 'next/link';

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

export default async function BookingsList() {
  const session = await auth();
  if (!session?.user) redirect('/');

  const currentUser = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { id: true, airlineId: true },
  });
  if (!currentUser?.airlineId) redirect('/dashboard');

  // Scope: only this user's bookings within their airline. The airlineId
  // filter is defense-in-depth — userId already implies airlineId via the
  // booking schema, but doubling the predicate makes the multi-tenant
  // boundary explicit at the query level.
  const bookings = await prisma.booking.findMany({
    where: {
      userId: currentUser.id,
      airlineId: currentUser.airlineId,
    },
    include: bookingInclude,
    orderBy: { createdAt: 'desc' },
  });

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

  return (
    <main className="min-h-screen bg-gray-50 dark:bg-gray-950 text-gray-900 dark:text-white p-4 sm:p-6 lg:p-8">
      <div className="max-w-[100rem] mx-auto">
        <header className="flex justify-between items-center mb-8 pb-6 border-b border-gray-200 dark:border-gray-800">
          <div>
            <h1 className="text-3xl font-bold">Meine Bookings</h1>
            <p className="text-gray-500 dark:text-gray-400 text-sm mt-1">
              {bookings.length}{' '}
              {bookings.length === 1 ? 'Booking gesamt' : 'Bookings gesamt'}
              {activeBookings.length > 0 &&
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

        {bookings.length === 0 ? (
          <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-lg p-12 text-center">
            <p className="text-gray-500 dark:text-gray-400 mb-4">
              Du hast noch keine Bookings angelegt.
            </p>
            <Link
              href="/bookings/new"
              className="inline-block px-6 py-3 bg-indigo-600 hover:bg-indigo-700 rounded font-medium transition"
            >
              Erstes Booking anlegen →
            </Link>
          </div>
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
