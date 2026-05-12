/**
 * Track 5 #6 — Pilot Career Stats Dashboard.
 *
 * Route: /pilots/[id]/stats
 *
 * Eine deep-dive page mit allen lifetime-aggregations über die approved
 * PIREPs eines pilots. Komplementär zur /pilots/[id]-page die ein
 * "snapshot" zeigt (rank, recent flights, position) — diese stats-page
 * ist die "history+totals"-ansicht.
 *
 * # Sections (top to bottom)
 *
 * 1. Header mit pilot-name + zurück-link
 * 2. Totals KPI-grid (5-col): Flüge, Stunden, Distanz, Treibstoff, Pax
 * 3. Recent activity (2-col): 7-day + 30-day windows
 * 4. Landing-quality (3-col): avg fpm, best fpm, hard-landings
 * 5. 12-month trend-chart (bars=flights, line=hours, dual-axis)
 * 6. Aircraft-breakdown (top 5 types by hours)
 * 7. Top routes (top 5 pairs by count)
 * 8. Network split (VATSIM / IVAO / Offline)
 *
 * # Auth
 *
 * Wie /pilots/[id]: same-airline OR admin. Eigene stats sind immer
 * sichtbar.
 *
 * # Performance
 *
 * Eine `getPilotCareerStats(userId)` aggregation läuft 10+ parallele
 * queries → typisch <200ms total. Bei einem fresh-pilot ohne PIREPs
 * returnt das defaults (alle counts=0), die page rendert dann den
 * empty-state pro section ohne hard-error.
 */

import { auth } from '@/auth';
import { redirect, notFound } from 'next/navigation';
import { prisma, getPilotCareerStats } from '@vam/db';
import Link from 'next/link';
import { MonthlyTrendChart } from './monthly-trend-chart';

export default async function PilotStatsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await auth();
  if (!session?.user) redirect('/');

  const { id } = await params;

  const currentUser = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { id: true, airlineId: true, role: { select: { name: true } } },
  });
  if (!currentUser?.airlineId) redirect('/dashboard');

  const pilot = await prisma.user.findUnique({
    where: { id },
    include: {
      rank: true,
      airline: { select: { name: true, icao: true } },
    },
  });
  if (!pilot) notFound();

  // Auth: same-airline OR admin
  const isAdmin = currentUser.role?.name === 'admin';
  const sameAirline = pilot.airlineId === currentUser.airlineId;
  if (!isAdmin && !sameAirline) redirect('/pilots');

  const stats = await getPilotCareerStats(pilot.id);

  const totalNetworkPireps =
    stats.networkSplit.VATSIM +
    stats.networkSplit.IVAO +
    stats.networkSplit.Offline;

  return (
    <main className="min-h-screen bg-gray-50 dark:bg-gray-950 text-gray-900 dark:text-white p-8">
      <div className="max-w-5xl mx-auto">
        {/* ── Header ── */}
        <header className="flex justify-between items-center mb-8 pb-6 border-b border-gray-200 dark:border-gray-800 flex-wrap gap-4">
          <div>
            <div className="flex items-baseline gap-3 flex-wrap">
              <h1 className="text-3xl font-bold">
                {pilot.name ?? 'Unbenannt'}
              </h1>
              <span className="text-sm text-gray-500">— Career Stats 📊</span>
            </div>
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
              {pilot.rank?.name ?? 'Kein Rang'}
              {pilot.airline && (
                <>
                  {' · '}
                  <span className="font-mono">{pilot.airline.icao}</span>{' '}
                  {pilot.airline.name}
                </>
              )}
            </p>
          </div>
          <Link
            href={`/pilots/${pilot.id}`}
            className="px-4 py-2 bg-gray-200 hover:bg-gray-300 dark:bg-gray-800 dark:hover:bg-gray-700 rounded text-sm transition"
          >
            ← Zum Profil
          </Link>
        </header>

        {/* ── Totals KPI-grid ── */}
        <section className="mb-8 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
          <KpiCard
            label="Flüge"
            value={stats.totalFlights.toLocaleString('de-DE')}
            accent="indigo"
          />
          <KpiCard
            label="Stunden"
            value={stats.totalHours.toLocaleString('de-DE')}
            unit="h"
          />
          <KpiCard
            label="Distanz"
            value={stats.totalDistanceNm.toLocaleString('de-DE')}
            unit="nm"
          />
          <KpiCard
            label="Treibstoff"
            value={stats.totalFuelKg.toLocaleString('de-DE')}
            unit="kg"
          />
          <KpiCard
            label="Passagiere"
            value={stats.totalPassengers.toLocaleString('de-DE')}
          />
        </section>

        {/* ── Recent activity ── */}
        <section className="mb-8 grid grid-cols-1 sm:grid-cols-2 gap-4">
          <RecentCard
            title="Letzte 7 Tage"
            flights={stats.last7dFlights}
            hours={stats.last7dHours}
          />
          <RecentCard
            title="Letzte 30 Tage"
            flights={stats.last30dFlights}
            hours={stats.last30dHours}
          />
        </section>

        {/* ── Landing quality ── */}
        <section className="mb-8 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-lg p-6">
          <h2 className="text-sm uppercase tracking-wider text-gray-500 font-semibold mb-4">
            Landings 🛬
          </h2>
          {stats.avgLandingFpm !== null ? (
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <LandingCell
                label="Ø Touchdown-Rate"
                value={stats.avgLandingFpm}
                unit="fpm"
                tone="neutral"
              />
              <LandingCell
                label="Beste Landung"
                value={stats.bestLandingFpm ?? 0}
                unit="fpm"
                tone="good"
                hint="smoothest ever"
              />
              <LandingCell
                label="Hard Landings"
                value={stats.hardLandingCount}
                tone={stats.hardLandingCount === 0 ? 'good' : 'warning'}
                hint="> 600 fpm"
              />
            </div>
          ) : (
            <p className="text-sm text-gray-500">
              Keine PIREPs mit Landing-Rate erfasst.
            </p>
          )}
        </section>

        {/* ── 12-month trend ── */}
        <section className="mb-8 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-lg p-6">
          <h2 className="text-sm uppercase tracking-wider text-gray-500 font-semibold mb-4">
            Aktivität (12 Monate)
          </h2>
          {stats.totalFlights > 0 ? (
            <MonthlyTrendChart buckets={stats.monthlyTrend} />
          ) : (
            <p className="text-sm text-gray-500">
              Noch keine approved Flüge.
            </p>
          )}
        </section>

        {/* ── Aircraft + Routes (2-col) ── */}
        <section className="mb-8 grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* Aircraft breakdown */}
          <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-lg p-6">
            <h2 className="text-sm uppercase tracking-wider text-gray-500 font-semibold mb-4">
              Aircraft-Types (Top 5)
            </h2>
            {stats.aircraftBreakdown.length > 0 ? (
              <ul className="divide-y divide-gray-200 dark:divide-gray-800">
                {stats.aircraftBreakdown.map((a) => (
                  <li
                    key={a.type}
                    className="py-2 flex items-baseline justify-between gap-3 text-sm"
                  >
                    <span className="font-mono font-semibold">{a.type}</span>
                    <span className="text-gray-500 dark:text-gray-400 tabular-nums">
                      {a.hours} h · {a.flights} Flüge
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-gray-500">Noch keine Aircraft-Daten.</p>
            )}
          </div>

          {/* Top routes */}
          <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-lg p-6">
            <h2 className="text-sm uppercase tracking-wider text-gray-500 font-semibold mb-4">
              Top Routen (Top 5)
            </h2>
            {stats.topRoutes.length > 0 ? (
              <ul className="divide-y divide-gray-200 dark:divide-gray-800">
                {stats.topRoutes.map((r, i) => (
                  <li
                    key={i}
                    className="py-2 flex items-baseline justify-between gap-3 text-sm"
                  >
                    <span className="font-mono font-semibold">
                      {r.departureIcao} → {r.arrivalIcao}
                    </span>
                    <span className="text-gray-500 dark:text-gray-400 tabular-nums">
                      {r.count}×
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-gray-500">Noch keine Routen-Daten.</p>
            )}
          </div>
        </section>

        {/* ── Network split ── */}
        {totalNetworkPireps > 0 && (
          <section className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-lg p-6">
            <h2 className="text-sm uppercase tracking-wider text-gray-500 font-semibold mb-4">
              Netzwerk-Verteilung
            </h2>
            <div className="grid grid-cols-3 gap-4">
              <NetworkCell
                label="VATSIM"
                count={stats.networkSplit.VATSIM}
                total={totalNetworkPireps}
                color="bg-blue-500"
              />
              <NetworkCell
                label="IVAO"
                count={stats.networkSplit.IVAO}
                total={totalNetworkPireps}
                color="bg-emerald-500"
              />
              <NetworkCell
                label="Offline"
                count={stats.networkSplit.Offline}
                total={totalNetworkPireps}
                color="bg-gray-500"
              />
            </div>
          </section>
        )}
      </div>
    </main>
  );
}

// ──────────────────────────────────────────────────────────────────────
// Sub-components — inline (page-only, kein re-use anderswo)
// ──────────────────────────────────────────────────────────────────────

function KpiCard({
  label,
  value,
  unit,
  accent,
}: {
  label: string;
  value: string;
  unit?: string;
  accent?: 'indigo';
}) {
  const borderClass =
    accent === 'indigo'
      ? 'border-indigo-300 dark:border-indigo-700/40'
      : 'border-gray-200 dark:border-gray-800';
  const labelClass =
    accent === 'indigo'
      ? 'text-indigo-600 dark:text-indigo-400'
      : 'text-gray-500';
  return (
    <div
      className={`bg-white dark:bg-gray-900 border ${borderClass} rounded-lg p-4`}
    >
      <p
        className={`text-[10px] uppercase tracking-wider font-semibold ${labelClass}`}
      >
        {label}
      </p>
      <p className="text-2xl font-bold mt-2 leading-tight tabular-nums">
        {value}
        {unit && (
          <span className="text-sm font-normal text-gray-500 ml-1">{unit}</span>
        )}
      </p>
    </div>
  );
}

function RecentCard({
  title,
  flights,
  hours,
}: {
  title: string;
  flights: number;
  hours: number;
}) {
  return (
    <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-lg p-5">
      <p className="text-xs uppercase tracking-wider text-gray-500 font-semibold mb-2">
        {title}
      </p>
      <div className="flex items-baseline gap-6">
        <div>
          <p className="text-2xl font-bold tabular-nums">{flights}</p>
          <p className="text-xs text-gray-500">Flüge</p>
        </div>
        <div>
          <p className="text-2xl font-bold tabular-nums">{hours}</p>
          <p className="text-xs text-gray-500">Stunden</p>
        </div>
      </div>
    </div>
  );
}

function LandingCell({
  label,
  value,
  unit,
  tone,
  hint,
}: {
  label: string;
  value: number;
  unit?: string;
  tone: 'neutral' | 'good' | 'warning';
  hint?: string;
}) {
  const colorClass =
    tone === 'good'
      ? 'bg-green-500/5 border-green-500/30'
      : tone === 'warning'
        ? 'bg-amber-500/5 border-amber-500/30'
        : 'bg-gray-50 dark:bg-gray-800/40 border-transparent';
  return (
    <div className={`rounded-lg p-4 border ${colorClass}`}>
      <p className="text-[10px] uppercase tracking-wider text-gray-500 font-semibold">
        {label}
      </p>
      <p className="text-2xl font-bold mt-2 leading-tight tabular-nums">
        {value.toLocaleString('de-DE')}
        {unit && (
          <span className="text-sm font-normal text-gray-500 ml-1">{unit}</span>
        )}
      </p>
      {hint && <p className="text-[10px] text-gray-500 mt-1">{hint}</p>}
    </div>
  );
}

function NetworkCell({
  label,
  count,
  total,
  color,
}: {
  label: string;
  count: number;
  total: number;
  color: string;
}) {
  const pct = total > 0 ? (count / total) * 100 : 0;
  return (
    <div>
      <div className="flex items-baseline justify-between mb-2">
        <span className="text-xs uppercase tracking-wider text-gray-500 font-semibold">
          {label}
        </span>
        <span className="text-xs text-gray-500 tabular-nums">
          {count} · {pct.toFixed(0)}%
        </span>
      </div>
      <div className="h-2 bg-gray-100 dark:bg-gray-800 rounded-full overflow-hidden">
        <div
          className={`h-full ${color} transition-all`}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}
