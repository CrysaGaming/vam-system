import { auth } from '@/auth';
import { redirect } from 'next/navigation';
import { prisma } from '@vam/db';
import Link from 'next/link';
import { CancelScheduledFlightButton } from './cancel-flight-button';

/**
 * /airline/schedule/instances — Week-grid view aller materialisierten
 * ScheduledFlight-instanzen einer airline (Welle 7 commit 7B-3).
 *
 * Layout: bewusst KEIN ECHTES week-grid (calendar-style x-axis = wochentage,
 * y-axis = uhrzeit) — das skaliert schlecht bei realistischen flight-counts
 * (10+ flights/tag → kollidieren visuell). Stattdessen: vertikale liste,
 * gruppiert by date, sortiert innerhalb des tages by departureTime. Liest
 * sich auch auf mobile sauber, ist druckbar, und wird beim scroll zum
 * effektiven "wochen-überblick".
 *
 * Filter via search-params:
 *   - days: 7 | 14 | 30 (default 14) — fenster ab now-UTC
 *   - status: all | planned | booked | completed | cancelled (default all)
 *
 * Out-of-scope für 7B-3:
 *   - Reactivate (Cancelled → Planned) — siehe actions.ts docstring
 *   - Manuelle instance-creation (charter) — kommt evtl. mit 7C oder später
 *   - Instance-edit (departureTime ändern) — würde dedup-key brechen, müsste
 *     erst durchdacht werden
 *   - Pagination — bei realistic airline-size (10-50 flights/tag * 14 tage)
 *     sind wir bei <1000 rows. Wenn das je problem wird: server-side
 *     pagination via cursor.
 */

const ALLOWED_DAYS = [7, 14, 30] as const;
type AllowedDays = (typeof ALLOWED_DAYS)[number];

const STATUS_FILTERS = ['all', 'planned', 'booked', 'completed', 'cancelled'] as const;
type StatusFilter = (typeof STATUS_FILTERS)[number];

const STATUS_TO_PRISMA: Record<
  Exclude<StatusFilter, 'all'>,
  'Planned' | 'Booked' | 'Completed' | 'Cancelled'
> = {
  planned: 'Planned',
  booked: 'Booked',
  completed: 'Completed',
  cancelled: 'Cancelled',
};

export default async function ScheduleInstancesPage({
  searchParams,
}: {
  searchParams: Promise<{ days?: string; status?: string }>;
}) {
  const session = await auth();
  if (!session?.user) redirect('/');

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    include: { role: true },
  });

  const allowedRoles = ['admin', 'airline-admin', 'instructor'];
  if (
    !user?.role ||
    !allowedRoles.includes(user.role.name) ||
    !user.airlineId
  ) {
    redirect('/dashboard');
  }

  const params = await searchParams;
  const daysRaw = parseInt(params.days ?? '14', 10);
  const days: AllowedDays = (ALLOWED_DAYS as readonly number[]).includes(daysRaw)
    ? (daysRaw as AllowedDays)
    : 14;

  const statusRaw = (params.status ?? 'all').toLowerCase();
  const statusFilter: StatusFilter = (STATUS_FILTERS as readonly string[]).includes(
    statusRaw,
  )
    ? (statusRaw as StatusFilter)
    : 'all';

  const fromDate = new Date();
  const toDate = new Date(fromDate.getTime() + days * 24 * 60 * 60 * 1000);

  const flights = await prisma.scheduledFlight.findMany({
    where: {
      airlineId: user.airlineId,
      departureTime: { gte: fromDate, lte: toDate },
      ...(statusFilter !== 'all'
        ? { status: STATUS_TO_PRISMA[statusFilter] }
        : {}),
    },
    include: {
      route: {
        select: {
          flightNumber: true,
          departure: { select: { icao: true } },
          arrival: { select: { icao: true } },
        },
      },
      template: { select: { id: true, label: true } },
      preferredAircraft: { select: { registration: true, type: true } },
      booking: {
        select: {
          id: true,
          user: { select: { id: true, name: true, email: true } },
        },
      },
    },
    orderBy: { departureTime: 'asc' },
  });

  // Aggregate counts pro status für die filter-pills (zeigen tatsächliche
  // verteilung im aktuellen window — unabhängig vom aktuellen status-filter,
  // damit der user sieht "ah, 3 cancelled liegen rum"). Für simplicity: zwei
  // separate queries — bei realistic counts vernachlässigbar.
  const statusCounts = await prisma.scheduledFlight.groupBy({
    by: ['status'],
    where: {
      airlineId: user.airlineId,
      departureTime: { gte: fromDate, lte: toDate },
    },
    _count: { _all: true },
  });
  const countByStatus: Record<string, number> = { all: 0 };
  for (const row of statusCounts) {
    countByStatus[row.status.toLowerCase()] = row._count._all;
    countByStatus.all = (countByStatus.all ?? 0) + row._count._all;
  }

  // Group by UTC-date (YYYY-MM-DD). Map mit insertion-order (flights sind
  // schon by departureTime sortiert → groups kommen chronologisch).
  const grouped = new Map<string, typeof flights>();
  for (const f of flights) {
    const key = ymdUtc(f.departureTime);
    const existing = grouped.get(key);
    if (existing) existing.push(f);
    else grouped.set(key, [f]);
  }

  return (
    <main className="min-h-screen bg-gray-50 dark:bg-gray-950 text-gray-900 dark:text-white p-4 sm:p-6 lg:p-8">
      <div className="max-w-[100rem] mx-auto">
        {/* Header */}
        <header className="flex flex-wrap justify-between items-start gap-4 mb-8 pb-6 border-b border-gray-200 dark:border-gray-800">
          <div>
            <div className="flex items-center gap-3 mb-1">
              <Link
                href="/airline/schedule"
                className="text-sm text-indigo-600 dark:text-indigo-400 hover:text-indigo-700 dark:hover:text-indigo-300 transition"
              >
                ← Schedule
              </Link>
            </div>
            <h1 className="text-3xl font-bold">Generierte Flüge</h1>
            <p className="text-gray-500 dark:text-gray-400 text-sm mt-1">
              {flights.length}{' '}
              {flights.length === 1 ? 'flight' : 'flights'} im fenster (
              {ymdUtc(fromDate)} → {ymdUtc(toDate)})
              {statusFilter !== 'all' && ` · gefiltert auf ${statusFilter}`}
            </p>
          </div>
        </header>

        {/* Filter-section */}
        <section className="mb-6 flex flex-wrap items-center gap-4">
          {/* Days-filter */}
          <div className="flex items-center gap-2">
            <span className="text-xs text-gray-500 dark:text-gray-400 uppercase tracking-wider">
              Zeitraum:
            </span>
            <div className="inline-flex rounded-md overflow-hidden border border-gray-200 dark:border-gray-700">
              {ALLOWED_DAYS.map((d) => {
                const active = d === days;
                const href = buildHref({ days: d, status: statusFilter });
                return (
                  <Link
                    key={d}
                    href={href}
                    className={`px-3 py-1.5 text-xs font-medium transition ${
                      active
                        ? 'bg-indigo-600 text-white'
                        : 'bg-white dark:bg-gray-900 text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800'
                    }`}
                  >
                    {d} Tage
                  </Link>
                );
              })}
            </div>
          </div>

          {/* Status-filter */}
          <div className="flex items-center gap-2">
            <span className="text-xs text-gray-500 dark:text-gray-400 uppercase tracking-wider">
              Status:
            </span>
            <div className="inline-flex flex-wrap gap-1">
              {STATUS_FILTERS.map((s) => {
                const active = s === statusFilter;
                const href = buildHref({ days, status: s });
                const count = countByStatus[s] ?? 0;
                return (
                  <Link
                    key={s}
                    href={href}
                    className={`px-2.5 py-1 rounded text-xs font-medium transition flex items-center gap-1.5 ${
                      active
                        ? 'bg-indigo-600 text-white'
                        : 'bg-white dark:bg-gray-900 text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 border border-gray-200 dark:border-gray-700'
                    }`}
                  >
                    <span className="capitalize">{s}</span>
                    <span
                      className={`tabular-nums ${
                        active ? 'opacity-80' : 'text-gray-400 dark:text-gray-600'
                      }`}
                    >
                      {count}
                    </span>
                  </Link>
                );
              })}
            </div>
          </div>
        </section>

        {/* Empty-state oder grouped list */}
        {flights.length === 0 ? (
          <EmptyState statusFilter={statusFilter} />
        ) : (
          <div className="space-y-6">
            {Array.from(grouped.entries()).map(([dateKey, dayFlights]) => (
              <section
                key={dateKey}
                className="bg-white dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-800 overflow-hidden"
              >
                <header className="px-4 py-2.5 bg-gray-100 dark:bg-gray-800/50 border-b border-gray-200 dark:border-gray-800 flex items-baseline justify-between">
                  <h2 className="text-sm font-semibold tabular-nums">
                    {dateKey}{' '}
                    <span className="text-xs font-normal text-gray-500 dark:text-gray-400 ml-1">
                      {WEEKDAY_DE[isoWeekdayUtc(new Date(dateKey + 'T00:00:00Z'))]}
                    </span>
                  </h2>
                  <span className="text-xs text-gray-500 dark:text-gray-400 tabular-nums">
                    {dayFlights.length}{' '}
                    {dayFlights.length === 1 ? 'flight' : 'flights'}
                  </span>
                </header>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <tbody className="divide-y divide-gray-200 dark:divide-gray-800">
                      {dayFlights.map((f) => (
                        <tr
                          key={f.id}
                          className={`hover:bg-gray-50 dark:hover:bg-gray-800/30 transition ${
                            f.status === 'Cancelled' ? 'opacity-50' : ''
                          }`}
                        >
                          <td className="px-4 py-2.5 font-mono tabular-nums text-gray-700 dark:text-gray-300 w-20">
                            {hhmmUtc(f.departureTime)}
                          </td>
                          <td className="px-4 py-2.5">
                            <div className="font-mono font-semibold">
                              {f.route.flightNumber}
                            </div>
                            <div className="text-xs text-gray-500 font-mono">
                              {f.route.departure.icao} → {f.route.arrival.icao}
                            </div>
                          </td>
                          <td className="px-4 py-2.5 text-xs text-gray-600 dark:text-gray-400">
                            {f.preferredAircraft ? (
                              <>
                                <div className="font-mono">
                                  {f.preferredAircraft.registration}
                                </div>
                                <div className="text-gray-400 dark:text-gray-600 font-mono">
                                  {f.preferredAircraft.type}
                                </div>
                              </>
                            ) : (
                              <span className="text-gray-400 dark:text-gray-600 italic">
                                —
                              </span>
                            )}
                          </td>
                          <td className="px-4 py-2.5 text-xs">
                            {f.booking ? (
                              <Link
                                href={`/bookings/${f.booking.id}`}
                                className="text-indigo-600 dark:text-indigo-400 hover:text-indigo-700 dark:hover:text-indigo-300 transition"
                              >
                                {f.booking.user.name ?? f.booking.user.email}
                              </Link>
                            ) : (
                              <span className="text-gray-400 dark:text-gray-600 italic">
                                offen
                              </span>
                            )}
                          </td>
                          <td className="px-4 py-2.5 w-28">
                            <StatusBadge status={f.status} />
                          </td>
                          <td className="px-4 py-2.5 text-right">
                            {f.status === 'Planned' && (
                              <CancelScheduledFlightButton
                                flightId={f.id}
                                flightLabel={`${f.route.flightNumber} @ ${hhmmUtc(f.departureTime)}`}
                                hasBooking={!!f.booking}
                              />
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            ))}
          </div>
        )}
      </div>
    </main>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// Sub-components
// ─────────────────────────────────────────────────────────────────────────

function StatusBadge({
  status,
}: {
  status: 'Planned' | 'Booked' | 'Completed' | 'Cancelled';
}) {
  const cls: Record<typeof status, string> = {
    Planned:
      'bg-blue-100 dark:bg-blue-500/20 text-blue-700 dark:text-blue-300',
    Booked:
      'bg-amber-100 dark:bg-amber-500/20 text-amber-700 dark:text-amber-300',
    Completed:
      'bg-green-100 dark:bg-green-500/20 text-green-700 dark:text-green-300',
    Cancelled:
      'bg-rose-100 dark:bg-rose-500/20 text-rose-700 dark:text-rose-300',
  };
  return (
    <span
      className={`inline-block px-2 py-0.5 text-xs rounded ${cls[status]}`}
    >
      {status}
    </span>
  );
}

function EmptyState({ statusFilter }: { statusFilter: StatusFilter }) {
  const isFiltered = statusFilter !== 'all';
  return (
    <div className="bg-white dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-800 p-12 text-center">
      <div className="text-5xl mb-4" aria-hidden="true">
        ✈️
      </div>
      <h2 className="text-xl font-semibold mb-2">
        {isFiltered
          ? `Keine ${statusFilter}-flights im fenster`
          : 'Noch keine flights im fenster'}
      </h2>
      <p className="text-sm text-gray-500 dark:text-gray-400 mb-6 max-w-md mx-auto">
        {isFiltered ? (
          <>
            Wechsle den status-filter oder erweitere den zeitraum oben.
          </>
        ) : (
          <>
            Lege ein schedule-template an und nutze den{' '}
            <em>&ldquo;Generate next N days&rdquo;</em>-button auf der
            schedule-übersicht, um instances zu materialisieren.
          </>
        )}
      </p>
      <Link
        href="/airline/schedule"
        className="inline-block px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded text-sm font-medium transition"
      >
        Zur Schedule-Übersicht
      </Link>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────

function ymdUtc(date: Date): string {
  const y = date.getUTCFullYear();
  const m = (date.getUTCMonth() + 1).toString().padStart(2, '0');
  const d = date.getUTCDate().toString().padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function hhmmUtc(date: Date): string {
  const h = date.getUTCHours().toString().padStart(2, '0');
  const m = date.getUTCMinutes().toString().padStart(2, '0');
  return `${h}:${m}`;
}

function isoWeekdayUtc(date: Date): number {
  const d = date.getUTCDay();
  return d === 0 ? 7 : d;
}

const WEEKDAY_DE: Record<number, string> = {
  1: 'Montag',
  2: 'Dienstag',
  3: 'Mittwoch',
  4: 'Donnerstag',
  5: 'Freitag',
  6: 'Samstag',
  7: 'Sonntag',
};

function buildHref({
  days,
  status,
}: {
  days: AllowedDays;
  status: StatusFilter;
}): string {
  const params = new URLSearchParams();
  if (days !== 14) params.set('days', String(days));
  if (status !== 'all') params.set('status', status);
  const qs = params.toString();
  return qs ? `/airline/schedule/instances?${qs}` : '/airline/schedule/instances';
}
