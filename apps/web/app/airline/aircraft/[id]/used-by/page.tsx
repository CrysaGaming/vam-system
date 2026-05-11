import { notFound } from 'next/navigation';
import { prisma } from '@vam/db';
import { requireAirlineManagerWithAirlinePage } from '@/lib/roles';
import Link from 'next/link';
import type { AircraftStatus } from '@vam/db';

/**
 * /airline/aircraft/[id]/used-by — Pilots-who-flew-this-aircraft list
 * (Track 4 #89, Section Q — final item).
 *
 * Use-case: admin will sehen welche pilots erfahrung mit diesem aircraft
 * haben. Relevant für:
 *   - Type-rating tracking: wer ist current auf dem airframe?
 *   - Operational planning: wer ist der "experte" für die D-AIBC?
 *   - Career-mode-checks: welche pilots haben genug hours für captain-
 *     upgrade auf diesem type?
 *
 * Architektur-decision:
 * - Pure server-component, kein client-state
 * - groupBy(userId) auf approved PIREPs für dieses aircraft → sum minutes,
 *   count flights, max approvedAt. Mirror der per-aircraft-stats-aggregation
 *   aus der haupt-aircraft-listing.
 * - User-details werden in EINEM findMany IN list nachgeladen (statt N+1).
 * - Sort default: total-hours desc (wer am meisten geflogen ist, zuerst).
 * - All-time, kein date-filter — die ganze historie ist relevanter als
 *   "letzte 30 tage" (im gegensatz zum utilization-heatmap das ist zeit-
 *   sensitive). Wenn jemand vor 2 jahren 200h darauf geflogen ist, ist
 *   das immer noch relevant für type-rating.
 *
 * Out-of-scope:
 * - Currency-checks (z.B. "war in den letzten 90 tagen auf type") → eigene
 *   page in Section R Career
 * - Drill-down zu pilot-profil → wenn User-detail-page existiert kann das
 *   verlinkt werden, sonst skip
 * - Export → CSV-button wäre nice aber nicht critical für v1
 */

const STATUS_LABELS: Record<AircraftStatus, string> = {
  ACTIVE: 'Aktiv',
  MAINTENANCE: 'Wartung',
  STORED: 'Eingelagert',
  RETIRED: 'Außer Dienst',
};

const STATUS_BADGE_STYLES: Record<AircraftStatus, string> = {
  ACTIVE:
    'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/30',
  MAINTENANCE:
    'bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-500/30',
  STORED: 'bg-sky-500/15 text-sky-700 dark:text-sky-300 border-sky-500/30',
  RETIRED:
    'bg-gray-500/15 text-gray-600 dark:text-gray-400 border-gray-500/30',
};

interface Props {
  params: Promise<{ id: string }>;
}

export default async function AircraftUsedByPage({ params }: Props) {
  const { id } = await params;
  const user = await requireAirlineManagerWithAirlinePage();

  const aircraft = await prisma.aircraft.findUnique({
    where: { id },
    select: {
      id: true,
      airlineId: true,
      registration: true,
      type: true,
      status: true,
      photoUrl: true,
      aircraftType: {
        select: { icaoType: true, name: true, manufacturer: true },
      },
    },
  });

  // Ownership-gate analog zu edit-page: notFound() statt redirect für
  // foreign-aircraft URLs, damit existence nicht leakt.
  if (!aircraft || aircraft.airlineId !== user.airlineId) {
    notFound();
  }

  // GroupBy(userId) auf approved PIREPs. Nur approved zählt — submitted/
  // rejected sind nicht "geflogen worden". Die airline-id-bedingung ist
  // technisch redundant (Pirep.aircraftId ist FK zu Aircraft das schon
  // airlineId-gechecked ist), aber schadet nicht und macht den query
  // selbst-dokumentierend.
  const pirepStats = await prisma.pirep.groupBy({
    by: ['userId'],
    where: {
      aircraftId: aircraft.id,
      status: 'Approved',
    },
    _count: { _all: true },
    _sum: { flightTimeMin: true },
    _max: { approvedAt: true },
  });

  // Sort by total hours desc — der pilot mit den meisten stunden steht
  // oben. Bei tie wird userId als secondary-sort genommen (deterministisch
  // aber willkürlich — egal, ties sind selten und die UI zeigt die zahlen
  // sowieso).
  pirepStats.sort((a, b) => {
    const aMin = a._sum.flightTimeMin ?? 0;
    const bMin = b._sum.flightTimeMin ?? 0;
    if (aMin !== bMin) return bMin - aMin;
    return a.userId.localeCompare(b.userId);
  });

  // User-details für die gefundenen userIds nachladen (in einem query,
  // nicht N+1). User.rank ist eine direkte relation (kein separater
  // membership-table — User ist 1:1 mit einer airline), daher select
  // direkt rank.name.
  const userIds = pirepStats.map((s) => s.userId);
  const users =
    userIds.length > 0
      ? await prisma.user.findMany({
          where: { id: { in: userIds } },
          select: {
            id: true,
            name: true,
            email: true,
            image: true,
            rank: { select: { name: true } },
          },
        })
      : [];

  const userById = new Map(users.map((u) => [u.id, u]));

  // Total-aggregation für summary-banner oben.
  const totalMinutes = pirepStats.reduce(
    (sum, s) => sum + (s._sum.flightTimeMin ?? 0),
    0,
  );
  const totalFlights = pirepStats.reduce(
    (sum, s) => sum + s._count._all,
    0,
  );
  const totalPilots = pirepStats.length;

  return (
    <main className="min-h-screen bg-gray-50 dark:bg-gray-950 text-gray-900 dark:text-white p-4 sm:p-6 lg:p-8">
      <div className="max-w-4xl mx-auto">
        {/* Header with aircraft context */}
        <header className="mb-8 pb-6 border-b border-gray-200 dark:border-gray-800">
          <Link
            href="/airline/aircraft"
            className="text-sm text-indigo-600 dark:text-indigo-400 hover:underline"
          >
            ← Zurück zur Aircraft-Verwaltung
          </Link>
          <div className="mt-3 flex flex-wrap items-start gap-4">
            {aircraft.photoUrl && (
              <picture className="shrink-0">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={aircraft.photoUrl}
                  alt={`${aircraft.registration} foto`}
                  className="w-20 h-20 rounded object-cover border border-gray-200 dark:border-gray-800"
                />
              </picture>
            )}
            <div className="flex-1 min-w-0">
              <h1 className="text-3xl font-bold tracking-tight flex flex-wrap items-center gap-2">
                <span className="font-mono">{aircraft.registration}</span>
                <span
                  className={`inline-flex px-2 py-0.5 text-xs font-medium rounded border ${STATUS_BADGE_STYLES[aircraft.status]}`}
                >
                  {STATUS_LABELS[aircraft.status]}
                </span>
              </h1>
              <p className="text-gray-500 dark:text-gray-400 text-sm mt-1">
                👥 Wer hat dieses Aircraft geflogen?
              </p>
              <p className="text-xs text-gray-500 dark:text-gray-500 mt-0.5">
                {aircraft.aircraftType
                  ? `${aircraft.aircraftType.manufacturer} ${aircraft.aircraftType.name} (${aircraft.aircraftType.icaoType})`
                  : aircraft.type}
              </p>
            </div>
            <Link
              href={`/airline/aircraft/${aircraft.id}/edit`}
              className="px-3 py-2 bg-gray-200 hover:bg-gray-300 dark:bg-gray-800 dark:hover:bg-gray-700 rounded text-sm transition"
            >
              ✏️ Bearbeiten
            </Link>
          </div>
        </header>

        {/* Summary banner */}
        <section className="grid grid-cols-3 gap-3 mb-6">
          <SummaryCard
            label="Pilots"
            value={totalPilots.toString()}
            sublabel="haben geflogen"
          />
          <SummaryCard
            label="Flüge"
            value={totalFlights.toString()}
            sublabel="approved PIREPs"
          />
          <SummaryCard
            label="Stunden"
            value={(totalMinutes / 60).toFixed(1)}
            sublabel="kumulativ"
          />
        </section>

        {/* Pilots list */}
        {pirepStats.length === 0 ? (
          <div className="bg-white dark:bg-gray-900 border border-dashed border-gray-300 dark:border-gray-700 rounded-lg p-12 text-center">
            <p className="text-lg text-gray-700 dark:text-gray-300 mb-2">
              Noch keine geflogenen PIREPs
            </p>
            <p className="text-sm text-gray-500 dark:text-gray-400">
              Sobald pilots dieses Aircraft fliegen und der PIREP approved
              wird, erscheinen sie hier nach gesamtstunden sortiert.
            </p>
          </div>
        ) : (
          <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-lg overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 dark:bg-gray-900/50 border-b border-gray-200 dark:border-gray-800">
                  <th className="text-left text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400 font-medium px-4 py-3 w-12">
                    #
                  </th>
                  <th className="text-left text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400 font-medium px-4 py-3">
                    Pilot
                  </th>
                  <th className="text-right text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400 font-medium px-4 py-3">
                    Stunden
                  </th>
                  <th className="text-right text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400 font-medium px-4 py-3">
                    Flüge
                  </th>
                  <th className="text-right text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400 font-medium px-4 py-3 hidden sm:table-cell">
                    Letzter Flug
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200 dark:divide-gray-800">
                {pirepStats.map((s, idx) => {
                  const u = userById.get(s.userId);
                  const hours = (s._sum.flightTimeMin ?? 0) / 60;
                  const rankName = u?.rank?.name ?? null;
                  // Rank #1 mit gold-medal-trophy, #2 silber, #3 bronze
                  // — kleines bisschen leaderboard-flair für admins, kostet
                  // nichts an code aber macht die liste leichter scanbar.
                  const medal =
                    idx === 0 ? '🥇' : idx === 1 ? '🥈' : idx === 2 ? '🥉' : null;
                  return (
                    <tr
                      key={s.userId}
                      className="hover:bg-gray-50 dark:hover:bg-gray-900/30 transition"
                    >
                      <td className="px-4 py-3 align-middle">
                        <div className="flex items-center gap-1">
                          <span className="font-mono text-gray-500 dark:text-gray-500 text-sm">
                            {idx + 1}
                          </span>
                          {medal && (
                            <span aria-hidden="true" className="text-sm">
                              {medal}
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-3 align-middle">
                        <div className="flex items-center gap-3">
                          {u?.image ? (
                            <picture className="shrink-0">
                              {/* eslint-disable-next-line @next/next/no-img-element */}
                              <img
                                src={u.image}
                                alt=""
                                className="w-10 h-10 rounded-full object-cover border border-gray-200 dark:border-gray-800"
                              />
                            </picture>
                          ) : (
                            <div
                              className="w-10 h-10 rounded-full bg-gray-200 dark:bg-gray-800 flex items-center justify-center text-sm font-semibold text-gray-500 dark:text-gray-400 shrink-0"
                              aria-hidden="true"
                            >
                              {(u?.name ?? u?.email ?? '?')
                                .charAt(0)
                                .toUpperCase()}
                            </div>
                          )}
                          <div className="min-w-0">
                            <div className="font-medium text-gray-900 dark:text-white truncate">
                              {u?.name ?? u?.email ?? 'Unbekannt'}
                            </div>
                            {rankName && (
                              <div className="text-xs text-gray-500 dark:text-gray-500 mt-0.5">
                                {rankName}
                              </div>
                            )}
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3 align-middle text-right font-mono font-semibold">
                        {hours.toFixed(1)}{' '}
                        <span className="text-xs text-gray-500 dark:text-gray-500 font-normal">
                          h
                        </span>
                      </td>
                      <td className="px-4 py-3 align-middle text-right font-mono text-sm">
                        {s._count._all}
                      </td>
                      <td className="px-4 py-3 align-middle text-right text-xs text-gray-600 dark:text-gray-400 hidden sm:table-cell">
                        {s._max.approvedAt
                          ? s._max.approvedAt.toLocaleDateString('de-DE')
                          : '—'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        <aside className="mt-6 bg-gray-100 dark:bg-gray-900/50 border border-gray-200 dark:border-gray-800 rounded-lg p-4 text-sm text-gray-600 dark:text-gray-400">
          <p>
            <strong className="text-gray-700 dark:text-gray-300">
              Basis:
            </strong>{' '}
            Approved PIREPs für dieses Aircraft. Sortiert nach gesamtstunden
            absteigend. Submitted/Rejected PIREPs zählen nicht.
          </p>
          <p className="mt-2">
            Diese liste ist <strong>all-time</strong> — wenn ein pilot vor
            2 jahren 200h auf diesem aircraft geflogen ist, taucht er hier
            immer noch auf. Für "current"-checks (z.B. letzte 90 tage für
            type-rating-currency) wird es in Section R eine eigene seite
            geben.
          </p>
        </aside>
      </div>
    </main>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// Sub-components
// ─────────────────────────────────────────────────────────────────────────

interface SummaryCardProps {
  label: string;
  value: string;
  sublabel: string;
}

function SummaryCard({ label, value, sublabel }: SummaryCardProps) {
  return (
    <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-lg p-4">
      <p className="text-xs uppercase tracking-wide font-medium text-gray-500 dark:text-gray-400">
        {label}
      </p>
      <p className="text-2xl font-bold font-mono mt-1">{value}</p>
      <p className="text-[11px] text-gray-500 dark:text-gray-500 mt-0.5">
        {sublabel}
      </p>
    </div>
  );
}
