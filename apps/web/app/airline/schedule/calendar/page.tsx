/**
 * Welle L / L1 — Schedule calendar view.
 *
 * Route: /airline/schedule/calendar
 *
 * 7-day calendar grid (default: current week) showing all ScheduledFlight
 * instanzen der airline. Conflicts (gleiche aircraft, überlappende zeit)
 * sind rot markiert mit warning-banner.
 *
 * Nav: ?weekOffset=N (default 0=this week, -1=last week, +1=next week)
 */

import { prisma } from '@vam/db';
import { requireAirlineManagerWithAirlinePage } from '@/lib/roles';
import Link from 'next/link';
import {
  detectScheduleConflicts,
  conflictedFlightIds,
  type ScheduleConflictInput,
} from '@/lib/schedule/conflicts';

export const dynamic = 'force-dynamic';

type SearchParams = Promise<{ weekOffset?: string }>;

/** Returnt den Monday 00:00 UTC der woche relativ zu now() + offset weeks. */
function getWeekStart(offset: number): Date {
  const now = new Date();
  const utcDay = now.getUTCDay();
  // ISO-week: Monday=1, Sunday=0/7. Wir wollen offset auf Monday-of-this-week.
  const daysFromMonday = (utcDay + 6) % 7;
  const monday = new Date(
    Date.UTC(
      now.getUTCFullYear(),
      now.getUTCMonth(),
      now.getUTCDate() - daysFromMonday + offset * 7,
      0,
      0,
      0,
      0,
    ),
  );
  return monday;
}

export default async function ScheduleCalendarPage(props: {
  searchParams: SearchParams;
}) {
  const user = await requireAirlineManagerWithAirlinePage();
  const sp = await props.searchParams;
  const weekOffset = parseInt(sp.weekOffset ?? '0', 10) || 0;

  const weekStart = getWeekStart(weekOffset);
  const weekEnd = new Date(weekStart.getTime() + 7 * 24 * 60 * 60 * 1000);

  const flights = await prisma.scheduledFlight.findMany({
    where: {
      airlineId: user.airlineId,
      departureTime: { gte: weekStart, lt: weekEnd },
    },
    orderBy: { departureTime: 'asc' },
    select: {
      id: true,
      departureTime: true,
      status: true,
      preferredAircraftId: true,
      preferredAircraft: { select: { registration: true } },
      route: {
        select: {
          flightNumber: true,
          estimatedMinutes: true,
          departure: { select: { icao: true } },
          arrival: { select: { icao: true } },
        },
      },
    },
  });

  // Conflict-detection auf der ganzen woche
  const conflictInputs: ScheduleConflictInput[] = flights.map((f) => ({
    id: f.id,
    preferredAircraftId: f.preferredAircraftId,
    departureTime: f.departureTime,
    estimatedDurationMin: f.route.estimatedMinutes ?? 120,
    status: f.status,
  }));
  const conflicts = detectScheduleConflicts(conflictInputs);
  const conflictIds = conflictedFlightIds(conflicts);

  // Group flights by day (0=Mon ... 6=Sun)
  const days: Array<typeof flights> = [[], [], [], [], [], [], []];
  for (const f of flights) {
    const daysFromStart = Math.floor(
      (f.departureTime.getTime() - weekStart.getTime()) / (24 * 60 * 60 * 1000),
    );
    if (daysFromStart >= 0 && daysFromStart < 7) {
      days[daysFromStart].push(f);
    }
  }

  const dayNames = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'];

  return (
    <main className="min-h-screen bg-background p-4 text-foreground sm:p-8">
      <div className="mx-auto max-w-7xl">
        <header className="mb-6 flex items-start justify-between border-b border-border pb-4">
          <div>
            <p className="text-xs uppercase tracking-wider text-muted-foreground">
              Airline · Schedule
            </p>
            <h1 className="mt-1 text-2xl font-bold sm:text-3xl">
              📅 Schedule Calendar
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">
              7-Tage-übersicht aller scheduled flights mit conflict-detection.
            </p>
          </div>
          <Link
            href="/airline/schedule"
            className="text-sm text-indigo-600 hover:underline dark:text-indigo-400"
          >
            ← Templates
          </Link>
        </header>

        {/* Week navigation */}
        <nav className="mb-4 flex items-center justify-between">
          <Link
            href={`/airline/schedule/calendar?weekOffset=${weekOffset - 1}`}
            className="rounded-md border border-border bg-card px-3 py-1.5 text-sm hover:border-indigo-400"
          >
            ← Vorherige Woche
          </Link>
          <div className="text-center">
            <p className="text-sm font-semibold">
              {weekStart.toLocaleDateString('de-DE', {
                day: '2-digit',
                month: '2-digit',
                year: 'numeric',
              })}{' '}
              –{' '}
              {new Date(weekEnd.getTime() - 1).toLocaleDateString('de-DE', {
                day: '2-digit',
                month: '2-digit',
                year: 'numeric',
              })}
            </p>
            {weekOffset !== 0 && (
              <Link
                href="/airline/schedule/calendar"
                className="text-xs text-indigo-600 hover:underline dark:text-indigo-400"
              >
                → diese Woche
              </Link>
            )}
          </div>
          <Link
            href={`/airline/schedule/calendar?weekOffset=${weekOffset + 1}`}
            className="rounded-md border border-border bg-card px-3 py-1.5 text-sm hover:border-indigo-400"
          >
            Nächste Woche →
          </Link>
        </nav>

        {/* Conflicts banner */}
        {conflicts.length > 0 && (
          <div className="mb-4 rounded-lg border border-red-500/30 bg-red-500/10 p-4">
            <div className="flex items-start gap-2">
              <span className="text-xl">⚠️</span>
              <div className="flex-1">
                <p className="font-semibold text-red-700 dark:text-red-300">
                  {conflicts.length} Aircraft-Konflikt
                  {conflicts.length === 1 ? '' : 'e'} in dieser Woche
                </p>
                <p className="mt-1 text-sm text-red-700/80 dark:text-red-300/80">
                  Mindestens 2 flights nutzen das gleiche aircraft mit
                  überlappender zeit. Markiert mit roten badges.
                </p>
                <details className="mt-2 text-sm">
                  <summary className="cursor-pointer text-red-700 dark:text-red-300">
                    Details anzeigen
                  </summary>
                  <ul className="mt-2 space-y-1 pl-4 text-xs">
                    {conflicts.map((c, i) => (
                      <li key={i}>
                        <span className="font-mono">
                          {c.aId.slice(-6)} ↔ {c.bId.slice(-6)}
                        </span>{' '}
                        — Aircraft {c.aircraftId.slice(-6)} · {c.overlapMin}min
                        überlappung
                      </li>
                    ))}
                  </ul>
                </details>
              </div>
            </div>
          </div>
        )}

        {/* Calendar grid */}
        <div className="grid grid-cols-1 gap-3 md:grid-cols-7">
          {days.map((dayFlights, dayIdx) => {
            const dayDate = new Date(
              weekStart.getTime() + dayIdx * 24 * 60 * 60 * 1000,
            );
            return (
              <div
                key={dayIdx}
                className="rounded-lg border border-border bg-card p-2"
              >
                <div className="mb-2 border-b border-border pb-1 text-center">
                  <p className="text-xs uppercase tracking-wider text-muted-foreground">
                    {dayNames[dayIdx]}
                  </p>
                  <p className="text-sm font-semibold">
                    {dayDate.toLocaleDateString('de-DE', {
                      day: '2-digit',
                      month: '2-digit',
                    })}
                  </p>
                </div>
                {dayFlights.length === 0 ? (
                  <p className="py-4 text-center text-xs text-muted-foreground">
                    —
                  </p>
                ) : (
                  <ul className="space-y-1">
                    {dayFlights.map((f) => {
                      const hasConflict = conflictIds.has(f.id);
                      const timeStr = f.departureTime.toLocaleTimeString('de-DE', {
                        hour: '2-digit',
                        minute: '2-digit',
                        timeZone: 'UTC',
                      });
                      const statusColor =
                        f.status === 'Cancelled'
                          ? 'border-red-500/30 bg-red-500/5 text-muted-foreground line-through'
                          : f.status === 'Completed'
                            ? 'border-blue-500/30 bg-blue-500/5'
                            : f.status === 'Booked'
                              ? 'border-green-500/30 bg-green-500/5'
                              : 'border-border bg-background';
                      return (
                        <li
                          key={f.id}
                          className={`rounded border p-1.5 text-xs ${statusColor} ${
                            hasConflict
                              ? 'ring-2 ring-red-500/50 ring-offset-1 ring-offset-card'
                              : ''
                          }`}
                          title={
                            hasConflict
                              ? 'Aircraft-konflikt mit anderem flug in dieser zeit'
                              : undefined
                          }
                        >
                          <div className="flex items-center gap-1">
                            {hasConflict && <span title="Konflikt">⚠️</span>}
                            <span className="font-mono font-semibold">
                              {timeStr}Z
                            </span>
                          </div>
                          <div className="mt-0.5 font-mono">
                            {f.route.departure.icao}→{f.route.arrival.icao}
                          </div>
                          <div className="text-muted-foreground">
                            {f.route.flightNumber}
                          </div>
                          {f.preferredAircraft && (
                            <div className="text-muted-foreground">
                              {f.preferredAircraft.registration}
                            </div>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
            );
          })}
        </div>

        <div className="mt-6 text-xs text-muted-foreground">
          {flights.length} flights insgesamt in dieser woche · {conflicts.length}{' '}
          konflikte detected · alle zeiten in UTC
        </div>
      </div>
    </main>
  );
}
