import { notFound } from 'next/navigation';
import Link from 'next/link';
import { prisma } from '@vam/db';
import { requireAirlineManagerWithAirlinePage } from '@/lib/roles';

/**
 * Track 4 #94 (Section R) — Training-Hours-Log.
 *
 * /airline/pilots/[id]/training-log — pilot-detail-sub-page mit detailed
 * flight-hours breakdown. Vergleich zum skill-tree (#90):
 *
 *   - Skill-Tree: aggregierte total-hours für progress-milestones
 *   - Training-Log: DETAILLIERTER breakdown nach flight-type +
 *     aircraft-type + recent-training-PIREPs
 *
 * Use-case: admin sieht für einen pilot
 *   (1) wie viel "richtige" training-time vs scheduled-revenue-flying
 *   (2) breakdown pro aircraft-type (relevant für TR-currency: 3 takeoffs
 *       in 90d, recurrent-checks)
 *   (3) recent training-PIREPs als detail-list (welche flights waren als
 *       TRAINING markiert?)
 *
 * Pure server-component, kein neues schema — alle daten aus existing
 * Pirep + Aircraft tables.
 *
 * Architektur:
 * - Server-component, kein client-state
 * - DERIVED view: PIREP.flightType + aircraft.aircraftType-relation
 * - 90-day-recency window für currency-tracking (regulatory norm
 *   "3 takeoffs/landings in 90 days for PAX-ops")
 *
 * Out-of-scope für v1:
 * - Pilot-self-view (admin-only erstmal, /licenses zeigt schon basic info)
 * - Export to CSV (admin könnte später wollen für regulatory-reporting)
 * - New TrainingSession-model mit instructor+notes (lean: derive from
 *   existing PIREPs — wenn richer log gewollt → eigene welle)
 * - Pro-aircraft-type-currency-pass/fail-indicators (kommt mit
 *   enforceTypeRatingCurrency-feature)
 */

interface Props {
  params: Promise<{ id: string }>;
}

/** Labels + colors für FlightType-display */
const FLIGHT_TYPE_META: Record<
  'SCHEDULED' | 'CHARTER' | 'POSITIONING' | 'TRAINING' | 'FREE',
  { label: string; icon: string; color: string }
> = {
  TRAINING: {
    label: 'Training',
    icon: '🎓',
    color:
      'bg-indigo-50 dark:bg-indigo-500/15 text-indigo-900 dark:text-indigo-200 border-indigo-300 dark:border-indigo-500/40',
  },
  SCHEDULED: {
    label: 'Scheduled',
    icon: '🛫',
    color:
      'bg-emerald-50 dark:bg-emerald-500/15 text-emerald-900 dark:text-emerald-200 border-emerald-300 dark:border-emerald-500/40',
  },
  CHARTER: {
    label: 'Charter',
    icon: '💼',
    color:
      'bg-amber-50 dark:bg-amber-500/15 text-amber-900 dark:text-amber-200 border-amber-300 dark:border-amber-500/40',
  },
  POSITIONING: {
    label: 'Positioning',
    icon: '↔️',
    color:
      'bg-sky-50 dark:bg-sky-500/15 text-sky-900 dark:text-sky-200 border-sky-300 dark:border-sky-500/40',
  },
  FREE: {
    label: 'Free-Flight',
    icon: '🌐',
    color:
      'bg-purple-50 dark:bg-purple-500/15 text-purple-900 dark:text-purple-200 border-purple-300 dark:border-purple-500/40',
  },
};

const FLIGHT_TYPE_ORDER: Array<keyof typeof FLIGHT_TYPE_META> = [
  'TRAINING',
  'SCHEDULED',
  'CHARTER',
  'POSITIONING',
  'FREE',
];

/** Training-milestones für progress-tracker. Threshold + label. */
const TRAINING_MILESTONES = [
  { hours: 10, label: 'Erste 10 h' },
  { hours: 25, label: 'Solo-Bereit' },
  { hours: 50, label: 'Apprentice' },
  { hours: 100, label: 'Veteran-Trainee' },
  { hours: 250, label: 'Instructor-Track' },
];

export default async function TrainingLogPage({ params }: Props) {
  const { id: targetUserId } = await params;
  const actor = await requireAirlineManagerWithAirlinePage();

  // Multi-tenant gate (analog skill-tree)
  const target = await prisma.user.findUnique({
    where: { id: targetUserId },
    select: {
      id: true,
      name: true,
      email: true,
      image: true,
      airlineId: true,
      careerEnabled: true,
      rank: { select: { name: true } },
      role: { select: { name: true } },
    },
  });

  if (!target || target.airlineId !== actor.airlineId) {
    notFound();
  }

  // Cutoff für 90-day-recency-window. Aviation-norm: 3 takeoffs+landings
  // in 90 days für PAX-currency. Wir zeigen das als "letzte 90 Tage" für
  // alle stats, plus all-time-totals separat.
  const ninetyDaysAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);

  // Parallele queries: pro flight-type breakdown (all-time), per-aircraft
  // breakdown (all-time), 90-day-window stats. Recent-training-PIREPs läuft
  // SEPARAT (out of Promise.all) — Prisma 7's type-narrowing kollabiert bei
  // 4+ verschiedenen findMany/groupBy-shapes im selben tuple-array.
  const [byFlightType, recentPireps, all90dPireps] = await Promise.all([
    // Per FlightType: count + sum(flightTimeMin) für approved PIREPs
    prisma.pirep.groupBy({
      by: ['flightType'],
      where: { userId: target.id, status: 'Approved' },
      _count: { _all: true },
      _sum: { flightTimeMin: true },
    }),
    // Per-aircraft breakdown (approved only, all-time)
    prisma.pirep.findMany({
      where: { userId: target.id, status: 'Approved' },
      select: {
        id: true,
        flightTimeMin: true,
        flightType: true,
        aircraft: {
          select: {
            registration: true,
            aircraftType: { select: { icaoType: true, name: true } },
          },
        },
      },
    }),
    // 90-day-window: count + sum für recency-tracking
    prisma.pirep.findMany({
      where: {
        userId: target.id,
        status: 'Approved',
        // Approved PIREPs in last 90d — submittedAt ist der file-time des
        // PIREPs (default now() bei creation). PIREP-model hat submittedAt
        // statt createdAt — siehe schema.prisma. Approved-records haben
        // approvedAt-zeitstempel, aber für die recency-window-rechnung ist
        // submittedAt der operative timestamp (3 takeoffs in 90d = flights
        // gefiled in den letzten 90 Tagen).
        submittedAt: { gte: ninetyDaysAgo },
      },
      select: { flightTimeMin: true, flightType: true },
    }),
  ]);

  // Recent training-PIREPs als detail-list (last 20, FlightType=TRAINING).
  // Separat statt im Promise.all-tuple, weil Prisma 7's type-narrowing bei
  // 4 unterschiedlichen query-shapes im selben Promise.all kollabiert und
  // alle properties als full-Pirep-typ ohne relations annimmt. Eigener
  // await behält die select-narrowing korrekt.
  const trainingPireps = await prisma.pirep.findMany({
    where: {
      userId: target.id,
      status: 'Approved',
      flightType: 'TRAINING',
    },
    select: {
      id: true,
      flightTimeMin: true,
      submittedAt: true,
      // PIREP hat KEIN flightNumber-feld — das lebt auf Route/Booking.
      // Für eine simple list zeigen wir id-prefix als pseudo-flight-id.
      remarks: true,
      departure: { select: { icao: true } },
      arrival: { select: { icao: true } },
      aircraft: {
        select: {
          registration: true,
          aircraftType: { select: { icaoType: true } },
        },
      },
    },
    orderBy: { submittedAt: 'desc' },
    take: 20,
  });

  // Build by-flight-type-summary
  const byTypeMap = new Map<string, { hours: number; count: number }>();
  for (const t of FLIGHT_TYPE_ORDER) {
    byTypeMap.set(t, { hours: 0, count: 0 });
  }
  for (const row of byFlightType) {
    byTypeMap.set(row.flightType, {
      hours: (row._sum.flightTimeMin ?? 0) / 60,
      count: row._count._all,
    });
  }

  // Build per-aircraft-type aggregation (group by ICAO type-code)
  const byAircraftMap = new Map<
    string,
    { name: string | null; hours: number; count: number; flightTypes: Set<string> }
  >();
  for (const pirep of recentPireps) {
    const typeIcao = pirep.aircraft?.aircraftType?.icaoType;
    if (!typeIcao) continue; // skip PIREPs without aircraft-type info
    const existing = byAircraftMap.get(typeIcao) ?? {
      name: pirep.aircraft?.aircraftType?.name ?? null,
      hours: 0,
      count: 0,
      flightTypes: new Set<string>(),
    };
    existing.hours += (pirep.flightTimeMin ?? 0) / 60;
    existing.count += 1;
    existing.flightTypes.add(pirep.flightType);
    byAircraftMap.set(typeIcao, existing);
  }
  const aircraftBreakdown = Array.from(byAircraftMap.entries())
    .map(([icao, data]) => ({ icao, ...data }))
    .sort((a, b) => b.hours - a.hours);

  // 90-day stats
  const total90dHours =
    all90dPireps.reduce((s, p) => s + (p.flightTimeMin ?? 0), 0) / 60;
  const total90dCount = all90dPireps.length;
  const training90dHours =
    all90dPireps
      .filter((p) => p.flightType === 'TRAINING')
      .reduce((s, p) => s + (p.flightTimeMin ?? 0), 0) / 60;

  // All-time training-hours für milestone-progress
  const trainingAllTimeHours = byTypeMap.get('TRAINING')?.hours ?? 0;

  // Total all-time-hours (sum aller flight-types)
  const totalAllTimeHours = Array.from(byTypeMap.values()).reduce(
    (s, v) => s + v.hours,
    0,
  );
  const totalAllTimeCount = Array.from(byTypeMap.values()).reduce(
    (s, v) => s + v.count,
    0,
  );

  return (
    <main className="min-h-screen bg-gray-50 dark:bg-gray-950 text-gray-900 dark:text-white p-4 sm:p-6 lg:p-8">
      <div className="max-w-6xl mx-auto">
        {/* Header */}
        <header className="mb-8 pb-6 border-b border-gray-200 dark:border-gray-800">
          <Link
            href={`/airline/pilots/${target.id}`}
            className="text-sm text-indigo-600 dark:text-indigo-400 hover:underline"
          >
            ← Zurück zum Pilot
          </Link>
          <div className="mt-3 flex flex-wrap items-start gap-4">
            {target.image ? (
              <picture className="shrink-0">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={target.image}
                  alt=""
                  className="w-20 h-20 rounded-full object-cover border border-gray-200 dark:border-gray-800"
                />
              </picture>
            ) : (
              <div
                className="w-20 h-20 rounded-full bg-gray-200 dark:bg-gray-800 flex items-center justify-center text-2xl font-semibold text-gray-500 dark:text-gray-400 shrink-0"
                aria-hidden="true"
              >
                {(target.name ?? target.email ?? '?').charAt(0).toUpperCase()}
              </div>
            )}
            <div className="flex-1 min-w-0">
              <h1 className="text-3xl font-bold tracking-tight">
                {target.name ?? target.email}
              </h1>
              <p className="text-gray-500 dark:text-gray-400 text-sm mt-1">
                📚 Training-Hours-Log — Flight-time breakdown
              </p>
              <p className="text-xs text-gray-500 dark:text-gray-500 mt-0.5">
                {target.rank?.name ?? 'Kein Rank'}
                {target.role?.name && ` · ${target.role.name}`}
              </p>
            </div>
          </div>
        </header>

        {/* Summary cards: all-time totals + 90-day-window */}
        <section className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-8">
          <SummaryCard
            label="Gesamt-Stunden"
            value={totalAllTimeHours.toFixed(1)}
            sublabel={`${totalAllTimeCount} approved PIREPs`}
          />
          <SummaryCard
            label="Training-Stunden"
            value={trainingAllTimeHours.toFixed(1)}
            sublabel={`${byTypeMap.get('TRAINING')?.count ?? 0} Training-PIREPs`}
            accent
          />
          <SummaryCard
            label="Letzte 90 Tage"
            value={total90dHours.toFixed(1)}
            sublabel={`${total90dCount} PIREPs (alle types)`}
          />
          <SummaryCard
            label="Training 90 Tage"
            value={training90dHours.toFixed(1)}
            sublabel="recency-window"
          />
        </section>

        {/* Two-column grid: breakdown links, milestones rechts */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-8">
          {/* By FlightType breakdown */}
          <section className="lg:col-span-2 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-lg p-5">
            <h2 className="text-lg font-semibold mb-1">Breakdown nach Flight-Type</h2>
            <p className="text-xs text-gray-500 dark:text-gray-500 mb-4">
              All-time, approved PIREPs only. Training-flights sind die
              ICAO-relevanten stunden für license-progression; scheduled-
              flights sind revenue-ops.
            </p>
            <div className="space-y-2">
              {FLIGHT_TYPE_ORDER.map((type) => {
                const data = byTypeMap.get(type)!;
                const meta = FLIGHT_TYPE_META[type];
                const pctOfTotal =
                  totalAllTimeHours > 0 ? (data.hours / totalAllTimeHours) * 100 : 0;
                return (
                  <div
                    key={type}
                    className={`flex items-center gap-3 px-3 py-2 rounded border ${meta.color} ${data.count === 0 ? 'opacity-50' : ''}`}
                  >
                    <span className="text-xl" aria-hidden="true">
                      {meta.icon}
                    </span>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-baseline justify-between gap-2">
                        <span className="font-semibold">{meta.label}</span>
                        <span className="text-xs opacity-75">
                          {pctOfTotal.toFixed(1)}%
                        </span>
                      </div>
                      {/* Progress-bar visualisierung der proportion */}
                      <div className="h-1 rounded-full bg-black/10 dark:bg-white/10 overflow-hidden mt-1">
                        <div
                          className="h-full bg-current opacity-60"
                          style={{ width: `${pctOfTotal}%` }}
                        />
                      </div>
                    </div>
                    <div className="text-right shrink-0 text-sm">
                      <div className="font-mono font-bold">
                        {data.hours.toFixed(1)} h
                      </div>
                      <div className="text-[11px] opacity-75">
                        {data.count} PIREP{data.count === 1 ? '' : 's'}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </section>

          {/* Training-Milestones */}
          <section className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-lg p-5">
            <h2 className="text-lg font-semibold mb-1">Training-Meilensteine</h2>
            <p className="text-xs text-gray-500 dark:text-gray-500 mb-3">
              Career-progression nach training-stunden. Aktuell:{' '}
              <span className="font-mono font-semibold">
                {trainingAllTimeHours.toFixed(1)} h
              </span>
            </p>
            <ol className="space-y-1.5">
              {TRAINING_MILESTONES.map((ms) => {
                const reached = trainingAllTimeHours >= ms.hours;
                const nextNotReached =
                  !reached &&
                  TRAINING_MILESTONES.findIndex(
                    (m) => trainingAllTimeHours < m.hours,
                  ) === TRAINING_MILESTONES.indexOf(ms);
                return (
                  <li
                    key={ms.hours}
                    className={`flex items-center gap-2 px-2 py-1.5 rounded text-sm ${
                      reached
                        ? 'bg-indigo-50 dark:bg-indigo-500/10 text-indigo-900 dark:text-indigo-100'
                        : nextNotReached
                          ? 'bg-gray-50 dark:bg-gray-900/50 text-gray-700 dark:text-gray-300 border border-indigo-300 dark:border-indigo-500/40 border-dashed'
                          : 'text-gray-400 dark:text-gray-600'
                    }`}
                  >
                    <span aria-hidden="true" className="text-base">
                      {reached ? '✓' : '·'}
                    </span>
                    <span className="font-mono font-semibold text-xs">
                      {ms.hours} h
                    </span>
                    <span className="flex-1 text-xs">{ms.label}</span>
                    {nextNotReached && (
                      <span className="text-[10px] text-indigo-600 dark:text-indigo-400 font-mono">
                        +{(ms.hours - trainingAllTimeHours).toFixed(1)} h
                      </span>
                    )}
                  </li>
                );
              })}
              {trainingAllTimeHours >=
                TRAINING_MILESTONES[TRAINING_MILESTONES.length - 1].hours && (
                <li className="px-2 py-1.5 text-xs text-indigo-600 dark:text-indigo-400 italic">
                  Alle Meilensteine erreicht 🎉
                </li>
              )}
            </ol>
          </section>
        </div>

        {/* Per-aircraft-type breakdown */}
        <section className="mb-8 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-lg p-5">
          <h2 className="text-lg font-semibold mb-1">Breakdown nach Aircraft-Type</h2>
          <p className="text-xs text-gray-500 dark:text-gray-500 mb-4">
            Stunden pro aircraft-type (ICAO). Relevant für Type-Rating-
            currency: pilot braucht 3 takeoffs/landings in 90 Tagen für
            PAX-ops. PIREPs ohne aircraft-type-bindung sind hier
            nicht gelistet.
          </p>
          {aircraftBreakdown.length === 0 ? (
            <p className="text-sm text-gray-500 dark:text-gray-400 italic">
              Noch keine PIREPs mit aircraft-type-bindung.
            </p>
          ) : (
            <div className="space-y-1.5">
              {aircraftBreakdown.map((row) => (
                <div
                  key={row.icao}
                  className="flex items-center justify-between gap-3 px-3 py-2 rounded bg-gray-50 dark:bg-gray-900/50 border border-gray-200 dark:border-gray-800"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline gap-2">
                      <span className="font-mono font-bold">{row.icao}</span>
                      {row.name && (
                        <span className="text-xs text-gray-500 dark:text-gray-400 truncate">
                          {row.name}
                        </span>
                      )}
                    </div>
                    <div className="flex flex-wrap gap-1 mt-1">
                      {Array.from(row.flightTypes).map((t) => {
                        const meta =
                          FLIGHT_TYPE_META[t as keyof typeof FLIGHT_TYPE_META];
                        return (
                          <span
                            key={t}
                            className={`inline-flex items-center gap-1 px-1.5 py-0.5 text-[10px] rounded border ${meta.color}`}
                          >
                            <span aria-hidden="true">{meta.icon}</span>
                            <span>{meta.label}</span>
                          </span>
                        );
                      })}
                    </div>
                  </div>
                  <div className="text-right shrink-0 text-sm">
                    <div className="font-mono font-bold">
                      {row.hours.toFixed(1)} h
                    </div>
                    <div className="text-[11px] text-gray-500 dark:text-gray-500">
                      {row.count} PIREP{row.count === 1 ? '' : 's'}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* Recent Training-PIREPs */}
        <section className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-lg p-5">
          <h2 className="text-lg font-semibold mb-1">
            Letzte Training-PIREPs
          </h2>
          <p className="text-xs text-gray-500 dark:text-gray-500 mb-4">
            Die 20 jüngsten approved Training-flights (FlightType=TRAINING).
            Klick auf flight-nr öffnet das PIREP-detail.
          </p>
          {trainingPireps.length === 0 ? (
            <p className="text-sm text-gray-500 dark:text-gray-400 italic">
              Noch keine Training-PIREPs. Pilot kann PIREPs als TRAINING
              markieren beim file-time.
            </p>
          ) : (
            <ol className="space-y-1.5">
              {trainingPireps.map((p) => (
                <li
                  key={p.id}
                  className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 rounded bg-indigo-50 dark:bg-indigo-500/10 border border-indigo-300 dark:border-indigo-500/40"
                >
                  <Link
                    href={`/pireps/${p.id}`}
                    className="font-mono text-xs font-bold text-indigo-700 dark:text-indigo-300 hover:underline"
                  >
                    {p.id.slice(0, 8)}
                  </Link>
                  <span className="text-xs font-mono">
                    {p.departure.icao} → {p.arrival.icao}
                  </span>
                  {p.aircraft?.aircraftType?.icaoType && (
                    <span className="inline-flex items-center px-1.5 py-0.5 text-[10px] rounded bg-gray-200 dark:bg-gray-800 font-mono">
                      {p.aircraft.aircraftType.icaoType}
                    </span>
                  )}
                  {p.aircraft?.registration && (
                    <span className="text-[10px] text-gray-500 dark:text-gray-500 font-mono">
                      {p.aircraft.registration}
                    </span>
                  )}
                  <span className="text-xs font-mono ml-auto">
                    {((p.flightTimeMin ?? 0) / 60).toFixed(1)} h
                  </span>
                  <span className="text-[10px] text-gray-500 dark:text-gray-500">
                    {p.submittedAt.toLocaleDateString('de-DE')}
                  </span>
                </li>
              ))}
            </ol>
          )}
        </section>

        {/* Info-footer */}
        <aside className="mt-8 bg-gray-100 dark:bg-gray-900/50 border border-gray-200 dark:border-gray-800 rounded-lg p-4 text-sm text-gray-600 dark:text-gray-400 space-y-2">
          <p>
            <strong className="text-gray-700 dark:text-gray-300">
              Datenquelle:
            </strong>{' '}
            Approved-PIREPs mit FlightType-flag. Pilot markiert beim file-
            time einen flight als TRAINING — diese stunden zählen für die
            milestones und sind ICAO-relevant für CPL/ATPL-progression
            (250h für CPL, 1500h für ATPL).
          </p>
          <p>
            <strong className="text-gray-700 dark:text-gray-300">
              90-Tage-Recency:
            </strong>{' '}
            Aviation-norm: pilot braucht 3 takeoffs+landings in den letzten
            90 Tagen für PAX-currency. Im 90-Tage-Fenster siehst du wie
            aktiv der pilot ist; bei {'<'}3 PIREPs in 90d wäre er nach
            real-world-rules nicht PAX-current.
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
  accent?: boolean;
}

function SummaryCard({ label, value, sublabel, accent }: SummaryCardProps) {
  return (
    <div
      className={`border rounded-lg p-4 ${
        accent
          ? 'border-indigo-500/40 bg-indigo-50 dark:bg-indigo-500/10'
          : 'border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900'
      }`}
    >
      <p
        className={`text-xs uppercase tracking-wide font-medium ${
          accent
            ? 'text-indigo-700 dark:text-indigo-400'
            : 'text-gray-500 dark:text-gray-400'
        }`}
      >
        {label}
      </p>
      <p
        className={`text-2xl font-bold font-mono mt-1 ${
          accent ? 'text-indigo-900 dark:text-indigo-200' : ''
        }`}
      >
        {value}
      </p>
      <p className="text-[11px] text-gray-500 dark:text-gray-500 mt-0.5">
        {sublabel}
      </p>
    </div>
  );
}
