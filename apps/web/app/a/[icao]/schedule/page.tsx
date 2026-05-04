import { notFound } from 'next/navigation';
import { prisma } from '@vam/db';
import { getPublicAirline, FALLBACK_PRIMARY } from '../_lib/airline';
import {
  ymdUtc,
  hhmmUtc,
  isoWeekdayUtc,
  WEEKDAY_SHORT_DE,
} from '../_lib/format';

/**
 * /a/[icao]/schedule — Public schedule view (Welle 8 commit 8B-2).
 *
 * Window: next 14 days from now-UTC. Shows Planned (= bookable) and
 * Booked (= already taken) instances. Cancelled/Completed are filtered
 * out — public viewers care about "what's flying soon", not historical
 * audit data.
 *
 * No booking-button here — visitor would need to log in first; that's
 * /bookings/new's job. Status indicator is informational only:
 *   - Planned → "Verfügbar" (subtle accent in brand color)
 *   - Booked  → "Gebucht" (muted gray)
 *
 * Read-only mirror of /airline/schedule/instances structurally — same
 * group-by-date pattern, but no admin actions (no cancel button, no
 * status filter, no day-window selector).
 */
export default async function PublicAirlineSchedulePage({
  params,
}: {
  params: Promise<{ icao: string }>;
}) {
  const { icao: icaoRaw } = await params;
  const airline = await getPublicAirline(icaoRaw);
  if (!airline) {
    notFound();
  }

  const now = new Date();
  const horizonEnd = new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000);

  const flights = await prisma.scheduledFlight.findMany({
    where: {
      airlineId: airline.id,
      status: { in: ['Planned', 'Booked'] },
      departureTime: { gte: now, lte: horizonEnd },
    },
    select: {
      id: true,
      departureTime: true,
      status: true,
      route: {
        select: {
          flightNumber: true,
          departure: { select: { icao: true } },
          arrival: { select: { icao: true } },
        },
      },
    },
    orderBy: { departureTime: 'asc' },
  });

  // Group by UTC date — flights are already sorted, so insertion-order
  // gives us chronological day-buckets.
  const grouped = new Map<string, typeof flights>();
  for (const f of flights) {
    const key = ymdUtc(f.departureTime);
    const existing = grouped.get(key);
    if (existing) existing.push(f);
    else grouped.set(key, [f]);
  }

  const primary = airline.primaryColor ?? FALLBACK_PRIMARY;

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-bold">Schedule</h1>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
          {flights.length === 0
            ? 'Keine geplanten flights in den nächsten 14 tagen.'
            : `${flights.length} ${flights.length === 1 ? 'flight' : 'flights'} in den nächsten 14 tagen · alle zeiten UTC`}
        </p>
      </header>

      {flights.length > 0 && (
        <div className="space-y-4">
          {Array.from(grouped.entries()).map(([dateKey, dayFlights]) => (
            <section
              key={dateKey}
              className="bg-white dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-800 overflow-hidden"
            >
              <header className="px-4 py-2.5 bg-gray-100 dark:bg-gray-800/50 border-b border-gray-200 dark:border-gray-800 flex items-baseline justify-between">
                <h2 className="text-sm font-semibold tabular-nums">
                  {dateKey}{' '}
                  <span className="text-xs font-normal text-gray-500 dark:text-gray-400 ml-1">
                    {WEEKDAY_SHORT_DE[isoWeekdayUtc(new Date(dateKey + 'T00:00:00Z'))]}
                  </span>
                </h2>
                <span className="text-xs text-gray-500 dark:text-gray-400 tabular-nums">
                  {dayFlights.length}{' '}
                  {dayFlights.length === 1 ? 'flight' : 'flights'}
                </span>
              </header>
              <ul className="divide-y divide-gray-200 dark:divide-gray-800">
                {dayFlights.map((f) => (
                  <li
                    key={f.id}
                    className="px-4 py-2.5 flex items-center justify-between gap-4"
                  >
                    <div className="flex items-center gap-4 min-w-0">
                      <div className="font-mono tabular-nums text-sm text-gray-700 dark:text-gray-300 w-14">
                        {hhmmUtc(f.departureTime)}
                      </div>
                      <div className="min-w-0">
                        <div className="font-mono font-semibold text-sm">
                          {f.route.flightNumber}
                        </div>
                        <div className="text-xs text-gray-500 font-mono">
                          {f.route.departure.icao} → {f.route.arrival.icao}
                        </div>
                      </div>
                    </div>
                    <StatusIndicator status={f.status} accent={primary} />
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}

function StatusIndicator({
  status,
  accent,
}: {
  status: 'Planned' | 'Booked' | 'Completed' | 'Cancelled';
  accent: string;
}) {
  // Public-facing labels are softer than internal admin labels.
  // Completed/Cancelled are filtered before reaching this component but
  // we still handle them defensively for type-completeness.
  if (status === 'Planned') {
    return (
      <span
        className="text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded text-white font-medium"
        style={{ backgroundColor: accent }}
      >
        Verfügbar
      </span>
    );
  }
  if (status === 'Booked') {
    return (
      <span className="text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded bg-gray-200 dark:bg-gray-700 text-gray-600 dark:text-gray-400 font-medium">
        Gebucht
      </span>
    );
  }
  return null;
}
