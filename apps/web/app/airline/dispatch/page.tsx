/**
 * Welle L / L4 — Dispatch Board.
 *
 * Route: /airline/dispatch
 *
 * Operational live-overview für admin/dispatcher: zeigt live-pilots,
 * heutige flights, recent PIREPs, out-of-service aircraft, und KPIs in
 * einer kompakten dashboard-ansicht. Auto-refresht alle 30s.
 *
 * Read-only V1 (keine quick-actions wie cancel-flight oder push-
 * broadcast — die kommen via die spezifischen routes). V2 könnte ein
 * "dispatcher-chat" und "fleet-wide announcement"-feature haben.
 */

import { requireAirlineManagerWithAirlinePage } from '@/lib/roles';
import { loadDispatchBoard } from '@/lib/dispatch/board';
import Link from 'next/link';
import AutoRefresh from './_auto-refresh';

export const dynamic = 'force-dynamic';

export default async function DispatchBoardPage() {
  const user = await requireAirlineManagerWithAirlinePage();
  const board = await loadDispatchBoard(user.airlineId);

  const stalenessSec = (lastUpdate: Date): number =>
    Math.floor((Date.now() - lastUpdate.getTime()) / 1000);

  return (
    <main className="min-h-screen bg-background p-4 text-foreground sm:p-8">
      <AutoRefresh />
      <div className="mx-auto max-w-7xl">
        <header className="mb-6 flex items-start justify-between border-b border-border pb-4">
          <div>
            <p className="text-xs uppercase tracking-wider text-muted-foreground">
              Airline · Operations
            </p>
            <h1 className="mt-1 text-2xl font-bold sm:text-3xl">
              🎯 Dispatch Board
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Live operational overview · auto-refresh alle 30s
            </p>
          </div>
          <div className="flex gap-2 text-sm">
            <Link
              href="/airline/schedule/calendar"
              className="rounded-md border border-border bg-card px-3 py-1.5 hover:border-indigo-400"
            >
              📅 Schedule
            </Link>
            <Link
              href="/airline/pairings"
              className="rounded-md border border-border bg-card px-3 py-1.5 hover:border-indigo-400"
            >
              ✈️ Pairings
            </Link>
            <Link
              href="/airline/maintenance"
              className="rounded-md border border-border bg-card px-3 py-1.5 hover:border-indigo-400"
            >
              🔧 Maintenance
            </Link>
          </div>
        </header>

        {/* KPI cards */}
        <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <KpiCard
            label="Live"
            value={board.liveSessions.length}
            color="green"
            icon="🟢"
          />
          <KpiCard
            label="Heute geplant"
            value={board.todaysFlights.length}
            color="blue"
            icon="📅"
          />
          <KpiCard
            label="Active Pairings"
            value={board.activePairings}
            color="indigo"
            icon="✈️"
          />
          <KpiCard
            label="Out of Service"
            value={board.fleetStats.inMaintenance}
            color={board.fleetStats.inMaintenance > 0 ? 'orange' : 'gray'}
            icon="🔧"
            sub={`${board.fleetStats.activeAircraft}/${board.fleetStats.totalAircraft} aktiv`}
          />
        </div>

        {/* 2-column main grid */}
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {/* Live sessions */}
          <section className="rounded-lg border border-border bg-card p-4">
            <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
              🟢 Live Pilots ({board.liveSessions.length})
            </h2>
            {board.liveSessions.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">
                Aktuell niemand online.
              </p>
            ) : (
              <ul className="space-y-2">
                {board.liveSessions.map((s) => (
                  <li
                    key={s.id}
                    className="rounded border border-border bg-background p-3"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="font-mono font-semibold">
                            {s.callsign}
                          </span>
                          <span className="rounded border border-blue-500/30 bg-blue-500/10 px-1 py-0.5 text-xs text-blue-700 dark:text-blue-300">
                            {s.network}
                          </span>
                          {s.onGround && (
                            <span className="text-xs text-muted-foreground">
                              🛬 ground
                            </span>
                          )}
                        </div>
                        <p className="mt-0.5 text-xs text-muted-foreground">
                          <Link
                            href={`/p/${s.user.id}`}
                            className="hover:text-indigo-600 dark:hover:text-indigo-400"
                          >
                            {s.user.name ?? 'Pilot'}
                          </Link>
                          {s.flightNumber && ` · ${s.flightNumber}`}
                          {s.departure && s.arrival && (
                            <span className="font-mono">
                              {' · '}
                              {s.departure}→{s.arrival}
                            </span>
                          )}
                        </p>
                      </div>
                      <div className="shrink-0 text-right text-xs tabular-nums">
                        <div className="font-mono">
                          {s.altitude.toLocaleString('de-DE')}ft
                        </div>
                        <div className="text-muted-foreground">
                          {s.groundSpeed}kt
                        </div>
                      </div>
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">
                      Update vor {stalenessSec(s.lastUpdatedAt)}s
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {/* Today's flights */}
          <section className="rounded-lg border border-border bg-card p-4">
            <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
              📅 Heutige Flights ({board.todaysFlights.length})
            </h2>
            {board.todaysFlights.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">
                Keine flights für heute geplant.
              </p>
            ) : (
              <ul className="space-y-1">
                {board.todaysFlights.slice(0, 15).map((f) => (
                  <li
                    key={f.id}
                    className="flex items-center justify-between gap-2 rounded border border-border bg-background p-2 text-xs"
                  >
                    <div className="flex items-center gap-2">
                      <span className="font-mono tabular-nums">
                        {f.departureTime.toLocaleTimeString('de-DE', {
                          hour: '2-digit',
                          minute: '2-digit',
                          timeZone: 'UTC',
                        })}
                        Z
                      </span>
                      <span className="font-mono font-semibold">
                        {f.route.flightNumber}
                      </span>
                      <span className="font-mono text-muted-foreground">
                        {f.route.departureIcao}→{f.route.arrivalIcao}
                      </span>
                      {f.aircraft?.registration && (
                        <span className="font-mono text-muted-foreground">
                          · {f.aircraft.registration}
                        </span>
                      )}
                    </div>
                    <span
                      className={`rounded px-1.5 py-0.5 ${
                        f.booked
                          ? 'border border-green-500/30 bg-green-500/10 text-green-700 dark:text-green-300'
                          : 'border border-yellow-500/30 bg-yellow-500/10 text-yellow-700 dark:text-yellow-300'
                      }`}
                    >
                      {f.booked ? 'Booked' : 'Planned'}
                    </span>
                  </li>
                ))}
                {board.todaysFlights.length > 15 && (
                  <li className="pt-2 text-center text-xs text-muted-foreground">
                    +{board.todaysFlights.length - 15} weitere flights · siehe{' '}
                    <Link
                      href="/airline/schedule/calendar"
                      className="text-indigo-600 hover:underline dark:text-indigo-400"
                    >
                      Kalender
                    </Link>
                  </li>
                )}
              </ul>
            )}
          </section>

          {/* Recent PIREPs */}
          <section className="rounded-lg border border-border bg-card p-4">
            <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
              📋 Recent PIREPs (24h)
            </h2>
            {board.recentPireps.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">
                Keine PIREPs in den letzten 24h.
              </p>
            ) : (
              <ul className="space-y-1">
                {board.recentPireps.slice(0, 10).map((p) => (
                  <li
                    key={p.id}
                    className="rounded border border-border bg-background p-2 text-xs"
                  >
                    <div className="flex items-center gap-2">
                      <span
                        className={`rounded px-1.5 py-0.5 text-xs ${
                          p.status === 'Approved'
                            ? 'border border-green-500/30 bg-green-500/10 text-green-700 dark:text-green-300'
                            : p.status === 'Rejected'
                              ? 'border border-red-500/30 bg-red-500/10 text-red-700 dark:text-red-300'
                              : 'border border-yellow-500/30 bg-yellow-500/10 text-yellow-700 dark:text-yellow-300'
                        }`}
                      >
                        {p.status}
                      </span>
                      <span className="font-mono font-semibold">
                        {p.flightNumber}
                      </span>
                      <span className="font-mono text-muted-foreground">
                        {p.departureIcao}→{p.arrivalIcao}
                      </span>
                    </div>
                    <p className="mt-1 text-muted-foreground">
                      {p.pilotName ?? 'Pilot'} ·{' '}
                      {p.submittedAt.toLocaleString('de-DE', {
                        dateStyle: 'short',
                        timeStyle: 'short',
                      })}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {/* Out of service */}
          <section className="rounded-lg border border-border bg-card p-4">
            <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
              🔧 Aircraft Out of Service
            </h2>
            {board.outOfServiceAircraft.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">
                Alle aircraft in operation.
              </p>
            ) : (
              <ul className="space-y-2">
                {board.outOfServiceAircraft.map((a) => (
                  <li
                    key={a.id}
                    className="rounded border border-orange-500/30 bg-orange-500/5 p-3"
                  >
                    <div className="flex items-center gap-2">
                      <span className="font-mono font-semibold">
                        {a.aircraftRegistration}
                      </span>
                      <span className="font-mono text-xs text-muted-foreground">
                        {a.aircraftType}
                      </span>
                    </div>
                    <Link
                      href={`/airline/maintenance/${a.id}`}
                      className="mt-1 block text-xs text-indigo-600 hover:underline dark:text-indigo-400"
                    >
                      {a.maintenanceTitle}
                    </Link>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      Erwartet wieder verfügbar:{' '}
                      {a.expectedEnd.toLocaleString('de-DE', {
                        dateStyle: 'short',
                        timeStyle: 'short',
                      })}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>

        <p className="mt-6 text-center text-xs text-muted-foreground">
          Snapshot generated {new Date().toLocaleTimeString('de-DE')} · auto-refresht
          alle 30s
        </p>
      </div>
    </main>
  );
}

function KpiCard({
  label,
  value,
  color,
  icon,
  sub,
}: {
  label: string;
  value: number;
  color: 'green' | 'blue' | 'indigo' | 'orange' | 'gray';
  icon: string;
  sub?: string;
}) {
  const colorClasses: Record<typeof color, string> = {
    green: 'border-green-500/30 bg-green-500/5',
    blue: 'border-blue-500/30 bg-blue-500/5',
    indigo: 'border-indigo-500/30 bg-indigo-500/5',
    orange: 'border-orange-500/30 bg-orange-500/5',
    gray: 'border-border bg-card',
  };
  return (
    <div className={`rounded-lg border p-4 ${colorClasses[color]}`}>
      <div className="flex items-center justify-between">
        <p className="text-xs uppercase tracking-wider text-muted-foreground">
          {label}
        </p>
        <span className="text-xl">{icon}</span>
      </div>
      <p className="mt-2 text-3xl font-bold tabular-nums">{value}</p>
      {sub && <p className="text-xs text-muted-foreground">{sub}</p>}
    </div>
  );
}
