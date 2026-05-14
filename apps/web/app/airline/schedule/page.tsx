import { prisma } from '@vam/db';
import { requireAirlineManagerWithAirlinePage } from '@/lib/roles';
import Link from 'next/link';
import { DeleteScheduleTemplateButton } from './delete-template-button';
import { GenerateInstancesButton } from './generate-instances-button';
import { formatDaysOfWeekDe, formatMinuteUtc } from '@/lib/schedule';

/**
 * /airline/schedule — Schedule-template-verwaltung für airline-admins
 * (Welle 7 commit 7B-1 + 7B-2).
 *
 * Listet alle templates der eigenen airline (active + inactive) mit
 * edit/delete-actions und einem Generate-button (7B-2) der aus aktiven
 * templates konkrete ScheduledFlight-instanzen materialisiert. Spiegelt
 * /airline/routes pattern: server-component für initial-render, table
 * layout, action-buttons rechts.
 *
 * Spalten: Route, Label, Wochentage, Zeit (UTC), Gültigkeit, Aircraft,
 * Status, Aktionen.
 *
 * Out-of-scope:
 * - Instance-grid-view mit week-overlay (kommt 7B-3)
 * - Instance-level cancel/reschedule
 * - Inline-quick-edit
 */
export default async function AirlineSchedulePage() {
  const user = await requireAirlineManagerWithAirlinePage();
  const templates = await prisma.scheduleTemplate.findMany({
    where: { airlineId: user.airlineId },
    include: {
      route: {
        select: {
          flightNumber: true,
          departure: { select: { icao: true } },
          arrival: { select: { icao: true } },
        },
      },
      preferredAircraft: { select: { registration: true, type: true } },
      _count: { select: { scheduledFlights: true } },
    },
    orderBy: [
      { active: 'desc' },
      { departureMinuteUtc: 'asc' },
      { createdAt: 'desc' },
    ],
  });

  const activeCount = templates.filter((t) => t.active).length;
  const inactiveCount = templates.length - activeCount;
  const totalInstances = templates.reduce(
    (sum, t) => sum + t._count.scheduledFlights,
    0,
  );

  return (
    <main className="min-h-screen bg-gray-50 dark:bg-gray-950 text-gray-900 dark:text-white p-4 sm:p-6 lg:p-8">
      <div className="max-w-[100rem] mx-auto">
        {/* Header */}
        <header className="flex flex-wrap justify-between items-start gap-4 mb-8 pb-6 border-b border-gray-200 dark:border-gray-800">
          <div>
            <h1 className="text-3xl font-bold">Schedule-Verwaltung</h1>
            <p className="text-gray-500 dark:text-gray-400 text-sm mt-1">
              {activeCount} aktiv
              {inactiveCount > 0 && `, ${inactiveCount} inaktiv`}
              {totalInstances > 0 && ` · ${totalInstances} generierte instances`}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Link
              href="/airline/schedule/calendar"
              className="px-4 py-2 border border-gray-300 dark:border-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 rounded text-sm font-medium transition"
            >
              📅 Kalender
            </Link>
            <Link
              href="/airline/schedule/instances"
              className="px-4 py-2 border border-gray-300 dark:border-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 rounded text-sm font-medium transition"
            >
              Instances anzeigen
            </Link>
            <Link
              href="/airline/schedule/new"
              className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded text-sm font-medium transition flex items-center gap-2"
            >
              <span aria-hidden="true">+</span>
              Neues Template
            </Link>
          </div>
        </header>

        {/* Generator-section: button + help-text. Bewusst oberhalb der
            template-tabelle weil das die häufigste workflow-action ist
            (admin lockt vorbei → "wieviele instances habe ich für nächste
            woche generiert?" → ggf. neu triggern). */}
        {templates.length > 0 && (
          <section className="mb-6 p-4 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-lg">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div className="flex-1 min-w-0">
                <h2 className="text-sm font-semibold text-gray-900 dark:text-white">
                  Scheduled Flights generieren
                </h2>
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-1 max-w-2xl">
                  Erstellt aus den aktiven templates konkrete instances für die
                  nächsten N tage. Idempotent — re-runs erzeugen keine
                  duplikate. Aktuell: <strong>{totalInstances}</strong>{' '}
                  generierte instances aus <strong>{activeCount}</strong>{' '}
                  aktiven templates.
                </p>
              </div>
              <GenerateInstancesButton activeTemplateCount={activeCount} />
            </div>
          </section>
        )}

        {/* Empty-state oder table */}
        {templates.length === 0 ? (
          <EmptyState />
        ) : (
          <div className="bg-white dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-800 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-100 dark:bg-gray-800/50">
                  <tr className="text-left text-xs uppercase tracking-wider text-gray-500 dark:text-gray-400">
                    <th className="px-4 py-3">Route</th>
                    <th className="px-4 py-3">Label</th>
                    <th className="px-4 py-3">Tage</th>
                    <th className="px-4 py-3">Zeit (UTC)</th>
                    <th className="px-4 py-3">Gültigkeit</th>
                    <th className="px-4 py-3">Aircraft</th>
                    <th className="px-4 py-3 text-right">Instances</th>
                    <th className="px-4 py-3 text-center">Status</th>
                    <th className="px-4 py-3 text-right">Aktionen</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200 dark:divide-gray-800">
                  {templates.map((t) => (
                    <tr
                      key={t.id}
                      className={`hover:bg-gray-50 dark:hover:bg-gray-800/30 transition ${
                        !t.active ? 'opacity-60' : ''
                      }`}
                    >
                      <td className="px-4 py-3">
                        <div className="font-mono font-semibold">
                          {t.route.flightNumber}
                        </div>
                        <div className="text-xs text-gray-500 font-mono">
                          {t.route.departure.icao} → {t.route.arrival.icao}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-gray-700 dark:text-gray-300">
                        {t.label ?? (
                          <span className="text-gray-400 dark:text-gray-600 italic">
                            —
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-gray-700 dark:text-gray-300">
                        {formatDaysOfWeekDe(t.daysOfWeek)}
                      </td>
                      <td className="px-4 py-3 font-mono text-gray-700 dark:text-gray-300 tabular-nums">
                        {formatMinuteUtc(t.departureMinuteUtc)}
                      </td>
                      <td className="px-4 py-3 text-xs text-gray-600 dark:text-gray-400">
                        <div>{formatYmd(t.validFrom)}</div>
                        <div className="text-gray-400 dark:text-gray-600">
                          {t.validUntil
                            ? `bis ${formatYmd(t.validUntil)}`
                            : 'unbegrenzt'}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-xs text-gray-600 dark:text-gray-400">
                        {t.preferredAircraft ? (
                          <>
                            <div className="font-mono">
                              {t.preferredAircraft.registration}
                            </div>
                            <div className="text-gray-400 dark:text-gray-600 font-mono">
                              {t.preferredAircraft.type}
                            </div>
                          </>
                        ) : (
                          <span className="text-gray-400 dark:text-gray-600 italic">
                            —
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right text-gray-600 dark:text-gray-300 tabular-nums">
                        {t._count.scheduledFlights}
                      </td>
                      <td className="px-4 py-3 text-center">
                        {t.active ? (
                          <span className="inline-block px-2 py-0.5 text-xs rounded bg-green-100 dark:bg-green-500/20 text-green-700 dark:text-green-300">
                            Aktiv
                          </span>
                        ) : (
                          <span className="inline-block px-2 py-0.5 text-xs rounded bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300">
                            Inaktiv
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center justify-end gap-3">
                          <Link
                            href={`/airline/schedule/${t.id}/edit`}
                            className="text-xs text-indigo-600 dark:text-indigo-400 hover:text-indigo-700 dark:hover:text-indigo-300 transition"
                          >
                            Bearbeiten
                          </Link>
                          <DeleteScheduleTemplateButton
                            templateId={t.id}
                            templateLabel={t.label ?? t.route.flightNumber}
                            scheduledFlightCount={t._count.scheduledFlights}
                          />
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </main>
  );
}

function EmptyState() {
  return (
    <div className="bg-white dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-800 p-12 text-center">
      <div className="text-5xl mb-4" aria-hidden="true">
        🕒
      </div>
      <h2 className="text-xl font-semibold mb-2">
        Noch keine schedule-templates angelegt
      </h2>
      <p className="text-sm text-gray-500 dark:text-gray-400 mb-6 max-w-md mx-auto">
        Templates definieren wiederkehrende flugmuster (z.B. &ldquo;Mo+Mi+Fr
        14:30 UTC auf LH918&rdquo;). Aus templates werden später konkrete
        scheduled flights generiert.
      </p>
      <Link
        href="/airline/schedule/new"
        className="inline-block px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded text-sm font-medium transition"
      >
        Erstes template anlegen
      </Link>
    </div>
  );
}

function formatYmd(date: Date): string {
  const y = date.getUTCFullYear();
  const m = (date.getUTCMonth() + 1).toString().padStart(2, '0');
  const d = date.getUTCDate().toString().padStart(2, '0');
  return `${y}-${m}-${d}`;
}
