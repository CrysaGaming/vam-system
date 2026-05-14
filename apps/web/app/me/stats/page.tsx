import { auth } from '@/auth';
import { redirect } from 'next/navigation';
import Link from 'next/link';

import { getPersonalStatsBundle } from '@/lib/stats/personal';
import { MonthlyChart } from './_monthly-chart';

/**
 * Welle I / I1 — Personal stats-page.
 *
 * Route: /me/stats
 *
 * All-time pilot analytics dashboard für den eingeloggten user.
 * Server-rendered mit revalidate=300 (5min cache) — stats ändern
 * sich nur bei neuen PIREP-approvals, frequency ist gering, fresh-
 * read on every visit wäre overkill.
 *
 * # Sections
 *
 *   1. Lifetime KPIs (4 cards): total flights, total hours, avg
 *      duration, longest flight
 *   2. Monthly flights chart (last 12 months, recharts bar-chart)
 *   3. Top 5 routes (table)
 *   4. Top 5 aircraft types (table)
 *   5. Top 5 airports (table)
 *   6. Personal records (cards): longest, smoothest landing, first
 *
 * # Empty states
 *
 * Pilots ohne approved-PIREPs sehen einen freundlichen "noch keine
 * flights"-state mit link zu /bookings/new statt leerer tabellen.
 *
 * # Privacy
 *
 * Diese page ist /me/* — nur eingeloggter user sieht seine eigenen
 * stats. Public-view von anderen pilots' stats wäre ein /p/[id]/stats
 * follow-up (skipped V1, nur mit isProfilePublic-gate).
 */

export const revalidate = 300; // 5 minutes

export default async function PersonalStatsPage() {
  const session = await auth();
  if (!session?.user?.id) redirect('/');

  const userId = session.user.id;

  const [bundle, user] = await Promise.all([
    getPersonalStatsBundle(userId),
    // For the page header we want the user's display name + airline
    // context. Single tiny query parallel to the stats bundle.
    (async () => {
      const { prisma } = await import('@vam/db');
      return prisma.user.findUnique({
        where: { id: userId },
        select: {
          name: true,
          airline: { select: { name: true, icao: true } },
          rank: { select: { name: true } },
        },
      });
    })(),
  ]);

  const isEmpty = bundle.totals.totalFlights === 0;

  return (
    <main className="min-h-screen bg-background p-4 text-foreground sm:p-8">
      <div className="mx-auto max-w-5xl">
        {/* Header */}
        <header className="mb-6 border-b border-border pb-4">
          <p className="text-xs uppercase tracking-wider text-muted-foreground">
            {user?.airline
              ? `${user.airline.icao} · ${user.airline.name}`
              : 'Persönliche Statistik'}
          </p>
          <h1 className="mt-1 text-2xl font-bold sm:text-3xl">
            {user?.name ? `${user.name}'s Statistik` : 'Deine Statistik'}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            All-time stats über deine approved PIREPs.
            {user?.rank ? ` Aktueller Rank: ${user.rank.name}.` : ''}
          </p>
        </header>

        {isEmpty ? (
          <EmptyState />
        ) : (
          <>
            {/* 1. Lifetime KPIs */}
            <section className="mb-8">
              <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                Lifetime
              </h2>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <KpiCard
                  label="Flüge gesamt"
                  value={bundle.totals.totalFlights.toLocaleString('de-DE')}
                />
                <KpiCard
                  label="Flugstunden"
                  value={bundle.totals.totalHours.toLocaleString('de-DE', {
                    minimumFractionDigits: 1,
                    maximumFractionDigits: 1,
                  })}
                  suffix="h"
                />
                <KpiCard
                  label="Ø Flugzeit"
                  value={formatMinutes(bundle.totals.avgFlightMinutes)}
                />
                <KpiCard
                  label="Längster Flug"
                  value={formatMinutes(bundle.totals.longestFlightMin)}
                />
              </div>
            </section>

            {/* 2. Monthly chart */}
            <section className="mb-8">
              <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                Letzte 12 Monate
              </h2>
              <div className="rounded-lg border border-border bg-card p-4">
                <MonthlyChart data={bundle.monthly} />
              </div>
            </section>

            {/* 3-5. Top tables grid */}
            <section className="mb-8 grid gap-6 lg:grid-cols-3">
              <TopRoutesTable rows={bundle.topRoutes} />
              <TopAircraftTable rows={bundle.topAircraft} />
              <TopAirportsTable rows={bundle.topAirports} />
            </section>

            {/* 6. Personal records */}
            <section className="mb-8">
              <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                Personal Records
              </h2>
              <div className="grid gap-3 sm:grid-cols-3">
                <RecordCard
                  icon="⏱️"
                  title="Längster Flug"
                  empty={!bundle.records.longestFlight}
                >
                  {bundle.records.longestFlight && (
                    <>
                      <p className="font-mono text-base font-bold">
                        {formatMinutes(bundle.records.longestFlight.flightTimeMin)}
                      </p>
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        {bundle.records.longestFlight.departureIcao} →{' '}
                        {bundle.records.longestFlight.arrivalIcao}
                      </p>
                      <Link
                        href={`/pireps/${bundle.records.longestFlight.pirepId}`}
                        className="mt-1 inline-block text-xs text-indigo-600 hover:underline dark:text-indigo-400"
                      >
                        PIREP ansehen →
                      </Link>
                    </>
                  )}
                </RecordCard>

                <RecordCard
                  icon="🛬"
                  title="Smoothest Landing"
                  empty={!bundle.records.smoothestLanding}
                >
                  {bundle.records.smoothestLanding && (
                    <>
                      <p className="font-mono text-base font-bold">
                        {bundle.records.smoothestLanding.landingRateFpm} fpm
                      </p>
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        bei {bundle.records.smoothestLanding.arrivalIcao}
                      </p>
                      <Link
                        href={`/pireps/${bundle.records.smoothestLanding.pirepId}`}
                        className="mt-1 inline-block text-xs text-indigo-600 hover:underline dark:text-indigo-400"
                      >
                        PIREP ansehen →
                      </Link>
                    </>
                  )}
                </RecordCard>

                <RecordCard
                  icon="🚀"
                  title="Erster Flug"
                  empty={!bundle.records.firstFlight}
                >
                  {bundle.records.firstFlight && (
                    <>
                      <p className="text-sm font-semibold">
                        {bundle.records.firstFlight.submittedAt.toLocaleDateString(
                          'de-DE',
                          { day: '2-digit', month: '2-digit', year: 'numeric' },
                        )}
                      </p>
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        {bundle.records.firstFlight.departureIcao} →{' '}
                        {bundle.records.firstFlight.arrivalIcao}
                      </p>
                      <Link
                        href={`/pireps/${bundle.records.firstFlight.pirepId}`}
                        className="mt-1 inline-block text-xs text-indigo-600 hover:underline dark:text-indigo-400"
                      >
                        PIREP ansehen →
                      </Link>
                    </>
                  )}
                </RecordCard>

                {/* Welle I / I3 — expanded records: meiste-hours-tag,
                    meiste-flüge-tag, längste-route */}
                <RecordCard
                  icon="📅"
                  title="Stundenrekord (Tag)"
                  empty={!bundle.records.mostHoursInOneDay}
                >
                  {bundle.records.mostHoursInOneDay && (
                    <>
                      <p className="font-mono text-base font-bold">
                        {formatMinutes(
                          bundle.records.mostHoursInOneDay.totalMinutes,
                        )}
                      </p>
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        am{' '}
                        {bundle.records.mostHoursInOneDay.day.toLocaleDateString(
                          'de-DE',
                          { day: '2-digit', month: '2-digit', year: 'numeric' },
                        )}{' '}
                        ({bundle.records.mostHoursInOneDay.flights} Flüge)
                      </p>
                    </>
                  )}
                </RecordCard>

                <RecordCard
                  icon="🗓️"
                  title="Flugrekord (Tag)"
                  empty={!bundle.records.mostFlightsInOneDay}
                >
                  {bundle.records.mostFlightsInOneDay && (
                    <>
                      <p className="font-mono text-base font-bold">
                        {bundle.records.mostFlightsInOneDay.flights} Flüge
                      </p>
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        am{' '}
                        {bundle.records.mostFlightsInOneDay.day.toLocaleDateString(
                          'de-DE',
                          { day: '2-digit', month: '2-digit', year: 'numeric' },
                        )}{' '}
                        ({formatMinutes(
                          bundle.records.mostFlightsInOneDay.totalMinutes,
                        )})
                      </p>
                    </>
                  )}
                </RecordCard>

                <RecordCard
                  icon="🌍"
                  title="Längste Strecke"
                  empty={!bundle.records.longestRoute}
                >
                  {bundle.records.longestRoute && (
                    <>
                      <p className="font-mono text-base font-bold">
                        {bundle.records.longestRoute.distanceKm.toLocaleString(
                          'de-DE',
                        )}{' '}
                        km
                      </p>
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        {bundle.records.longestRoute.departureIcao} →{' '}
                        {bundle.records.longestRoute.arrivalIcao}
                      </p>
                      <Link
                        href={`/pireps/${bundle.records.longestRoute.pirepId}`}
                        className="mt-1 inline-block text-xs text-indigo-600 hover:underline dark:text-indigo-400"
                      >
                        PIREP ansehen →
                      </Link>
                    </>
                  )}
                </RecordCard>
              </div>
            </section>

            {/* Footer links */}
            <footer className="border-t border-border pt-4 text-xs text-muted-foreground">
              <p>
                Stats werden 5 Minuten gecacht.{' '}
                <Link
                  href="/me/year-in-review"
                  className="text-indigo-600 hover:underline dark:text-indigo-400"
                >
                  Year-in-Review →
                </Link>
              </p>
            </footer>
          </>
        )}
      </div>
    </main>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Components
// ─────────────────────────────────────────────────────────────────────

function EmptyState() {
  return (
    <div className="rounded-lg border border-dashed border-border bg-card p-12 text-center">
      <div className="mb-3 text-5xl">✈️</div>
      <h2 className="text-lg font-semibold">Noch keine Flüge</h2>
      <p className="mt-2 text-sm text-muted-foreground">
        Sobald dein erster PIREP genehmigt wurde, erscheinen hier deine Stats.
      </p>
      <Link
        href="/bookings/new"
        className="mt-4 inline-block rounded bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700"
      >
        Ersten Flug buchen
      </Link>
    </div>
  );
}

function KpiCard({
  label,
  value,
  suffix,
}: {
  label: string;
  value: string;
  suffix?: string;
}) {
  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <p className="text-xs uppercase tracking-wider text-muted-foreground">
        {label}
      </p>
      <p className="mt-1 font-mono text-2xl font-bold">
        {value}
        {suffix && (
          <span className="ml-1 text-base text-muted-foreground">{suffix}</span>
        )}
      </p>
    </div>
  );
}

function TopRoutesTable({
  rows,
}: {
  rows: Array<{
    departureIcao: string;
    arrivalIcao: string;
    flights: number;
    totalMinutes: number;
  }>;
}) {
  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
        Top Routen
      </h2>
      {rows.length === 0 ? (
        <p className="text-xs italic text-muted-foreground">Keine Daten</p>
      ) : (
        <table className="w-full text-sm">
          <tbody>
            {rows.map((r, i) => (
              <tr key={`${r.departureIcao}-${r.arrivalIcao}-${i}`} className="border-b border-border/50 last:border-0">
                <td className="py-1.5 font-mono">
                  {r.departureIcao} → {r.arrivalIcao}
                </td>
                <td className="py-1.5 text-right">{r.flights}×</td>
                <td className="py-1.5 pl-2 text-right text-xs text-muted-foreground">
                  {formatMinutes(r.totalMinutes)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

function TopAircraftTable({
  rows,
}: {
  rows: Array<{ type: string; flights: number; totalMinutes: number }>;
}) {
  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
        Top Aircraft
      </h2>
      {rows.length === 0 ? (
        <p className="text-xs italic text-muted-foreground">Keine Daten</p>
      ) : (
        <table className="w-full text-sm">
          <tbody>
            {rows.map((r) => (
              <tr key={r.type} className="border-b border-border/50 last:border-0">
                <td className="py-1.5 font-mono">{r.type}</td>
                <td className="py-1.5 text-right">{r.flights}×</td>
                <td className="py-1.5 pl-2 text-right text-xs text-muted-foreground">
                  {formatMinutes(r.totalMinutes)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

function TopAirportsTable({
  rows,
}: {
  rows: Array<{
    icao: string;
    departures: number;
    arrivals: number;
    total: number;
  }>;
}) {
  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
        Top Airports
      </h2>
      {rows.length === 0 ? (
        <p className="text-xs italic text-muted-foreground">Keine Daten</p>
      ) : (
        <table className="w-full text-sm">
          <tbody>
            {rows.map((r) => (
              <tr key={r.icao} className="border-b border-border/50 last:border-0">
                <td className="py-1.5 font-mono">{r.icao}</td>
                <td className="py-1.5 text-right text-xs text-muted-foreground">
                  ↑{r.departures} · ↓{r.arrivals}
                </td>
                <td className="py-1.5 pl-2 text-right font-semibold">
                  {r.total}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

function RecordCard({
  icon,
  title,
  empty,
  children,
}: {
  icon: string;
  title: string;
  empty: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <div className="flex items-center gap-2">
        <span className="text-xl">{icon}</span>
        <h3 className="text-xs uppercase tracking-wider text-muted-foreground">
          {title}
        </h3>
      </div>
      <div className="mt-2">
        {empty ? (
          <p className="text-xs italic text-muted-foreground">
            Noch keine Daten
          </p>
        ) : (
          children
        )}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────

function formatMinutes(min: number): string {
  if (min <= 0) return '–';
  const hours = Math.floor(min / 60);
  const minutes = min % 60;
  if (hours === 0) return `${minutes}m`;
  return `${hours}h ${String(minutes).padStart(2, '0')}m`;
}
