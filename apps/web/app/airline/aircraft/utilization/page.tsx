import { prisma } from '@vam/db';
import { requireAirlineManagerWithAirlinePage } from '@/lib/roles';
import Link from 'next/link';
import type { AircraftStatus } from '@vam/db';

/**
 * /airline/aircraft/utilization — Fleet-Utilization Heatmap (Track 4 #87,
 * Section Q).
 *
 * Calendar-grid: rows = aircraft, columns = letzte N tage. Jede zelle wird
 * eingefärbt basierend auf der flugzeit (sum von flightTimeMin) dieses
 * aircraft an dem tag (approved PIREPs only). Gibt admins einen instant-
 * read welche aircraft unterausgelastet sind und welche überbeansprucht.
 *
 * Architektur-decision:
 * - Server-component, pure render. Keine client-side interaktivität in v1
 *   weil das heatmap genug aussagt. Drill-down (klick auf zelle → PIREP-
 *   liste) wäre nice aber out-of-scope.
 * - DEFAULT_DAYS=30 als sweet-spot zwischen detail und übersicht. 14d zu
 *   wenig, 60d zu viel cells für mobile.
 * - Buckets sind absolute minuten (nicht percentil-basiert) damit cross-
 *   aircraft-comparison sinnvoll bleibt — ein A320 mit 8h/tag ist visuell
 *   gleich gefärbt wie eine C172 mit 8h/tag, statt relativ zur eigenen
 *   distribution.
 * - GroupBy aircraftId + date-trunc('day', approvedAt) wäre die natürliche
 *   query, aber Prisma's groupBy macht keine date-truncation. Stattdessen:
 *   findMany aller approved PIREPs der letzten 30 tage + aggregation in-
 *   memory. Bei 3-50 aircraft × 30 tage × <100 PIREPs/tag bleibt das
 *   günstig (<1 sec).
 *
 * Out-of-scope:
 * - Idle-detection mit konkreten alerts → könnte in Section P (Notifications)
 * - Drill-down auf einzelne PIREPs pro zelle → click-through-flow
 * - Export als CSV → wenn jemand das braucht, schnell nachzurüsten
 * - Heatmap pro stunde des tages statt pro tag → "wartung übernacht"
 *   ist ein anderes use-case und nicht das was hier gefragt war
 */

const DEFAULT_DAYS = 30;
const MAX_DAYS = 90;
const MIN_DAYS = 7;

// Flight-time buckets in minuten. Jede cell wird einer von 5 stufen
// zugeordnet (0=empty, 1=light, 2=medium, 3=high, 4=very-high). Die
// schwellwerte sind so gewählt, dass typische airliner-tagesleistungen
// vernünftig verteilt sind:
//   - <60 min: kurzes hop / training-flight → level 1
//   - 60-240 min: normaler 1-2-leg-tag → level 2
//   - 240-480 min: voller flugtag (4-8h) → level 3
//   - 480+ min: heavy utilization → level 4
const BUCKET_THRESHOLDS = [0, 60, 240, 480] as const;

const BUCKET_COLORS: Record<number, string> = {
  0: 'bg-gray-100 dark:bg-gray-900',
  1: 'bg-emerald-200 dark:bg-emerald-900/50',
  2: 'bg-emerald-400 dark:bg-emerald-700/70',
  3: 'bg-emerald-600 dark:bg-emerald-600',
  4: 'bg-emerald-800 dark:bg-emerald-500',
};

const BUCKET_LABELS: Record<number, string> = {
  0: 'Kein Flug',
  1: '< 1 h',
  2: '1–4 h',
  3: '4–8 h',
  4: '> 8 h',
};

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

function bucketFor(minutes: number): number {
  if (minutes <= BUCKET_THRESHOLDS[0]) return 0;
  if (minutes < BUCKET_THRESHOLDS[1]) return 1;
  if (minutes < BUCKET_THRESHOLDS[2]) return 2;
  if (minutes < BUCKET_THRESHOLDS[3]) return 3;
  return 4;
}

/**
 * Generates an array of date-strings (YYYY-MM-DD) for the last `days`
 * tage, in der reihenfolge ältester → jüngster. Heute ist die letzte
 * zelle in der grid.
 *
 * Bewusst lokal-zeit basiert: wenn ein admin in Berlin um 23:00 lokal
 * einen flug fliegt, soll die zelle "heute" sein, nicht "morgen" (was
 * passieren würde wenn wir UTC-grid + UTC-PIREP-timestamps nutzen und
 * der PIREP nach midnight UTC approved wurde). Die date-strings die wir
 * vergleichen sind also "lokale tage" basierend auf server-time.
 */
function generateDateColumns(days: number): string[] {
  const result: string[] = [];
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    result.push(toLocalDateString(d));
  }
  return result;
}

function toLocalDateString(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

interface SearchParams {
  days?: string;
}

export default async function FleetUtilizationPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const user = await requireAirlineManagerWithAirlinePage();
  const params = await searchParams;

  // Days-filter via query-param. Clamped auf [MIN_DAYS, MAX_DAYS] um
  // missbrauch (?days=99999 → DB-melt) zu verhindern.
  const requestedDays = Number(params.days ?? DEFAULT_DAYS);
  const days =
    Number.isFinite(requestedDays) && requestedDays > 0
      ? Math.min(Math.max(Math.round(requestedDays), MIN_DAYS), MAX_DAYS)
      : DEFAULT_DAYS;

  const dateColumns = generateDateColumns(days);
  const earliestDate = new Date(dateColumns[0] + 'T00:00:00');

  // Aircraft + approved PIREPs der letzten N tage parallel laden.
  // PIREPs werden über approvedAt gefiltert (nicht createdAt) — das
  // matched dem "wann wurde der flug offiziell als geflogen anerkannt"
  // konzept und stimmt mit der existing aircraft-stats-aggregation
  // überein.
  const [aircraft, pireps] = await Promise.all([
    prisma.aircraft.findMany({
      where: { airlineId: user.airlineId },
      select: {
        id: true,
        registration: true,
        type: true,
        status: true,
        photoUrl: true,
        aircraftType: {
          select: { icaoType: true, name: true, manufacturer: true },
        },
      },
      // Status-order spiegelt die haupt-listing (ACTIVE first).
      orderBy: [{ status: 'asc' }, { registration: 'asc' }],
    }),
    prisma.pirep.findMany({
      where: {
        aircraft: { airlineId: user.airlineId },
        status: 'Approved',
        approvedAt: { gte: earliestDate },
      },
      select: {
        aircraftId: true,
        approvedAt: true,
        flightTimeMin: true,
      },
    }),
  ]);

  // Aggregation in-memory: für jedes aircraft eine map<date → minutes,count>.
  // Map statt object weil aircraftId | null als key sicher ist.
  type DayStats = { minutes: number; flights: number };
  const statsByAircraft = new Map<string, Map<string, DayStats>>();

  for (const p of pireps) {
    if (!p.aircraftId || !p.approvedAt) continue;
    const dateKey = toLocalDateString(p.approvedAt);
    let perAcft = statsByAircraft.get(p.aircraftId);
    if (!perAcft) {
      perAcft = new Map();
      statsByAircraft.set(p.aircraftId, perAcft);
    }
    const existing = perAcft.get(dateKey) ?? { minutes: 0, flights: 0 };
    existing.minutes += p.flightTimeMin ?? 0;
    existing.flights += 1;
    perAcft.set(dateKey, existing);
  }

  // Pro-aircraft summary für die rechte spalte: total minutes, flights,
  // last-flight-date. Wird auch für sortierung der idle-warning genutzt.
  type AircraftSummary = {
    totalMinutes: number;
    totalFlights: number;
    activeDays: number;
    lastFlightDate: string | null;
  };
  const summaryByAircraft = new Map<string, AircraftSummary>();
  for (const ac of aircraft) {
    const dayStats = statsByAircraft.get(ac.id);
    let totalMinutes = 0;
    let totalFlights = 0;
    let activeDays = 0;
    let lastFlightDate: string | null = null;
    if (dayStats) {
      for (const [date, s] of dayStats) {
        totalMinutes += s.minutes;
        totalFlights += s.flights;
        if (s.flights > 0) {
          activeDays += 1;
          if (!lastFlightDate || date > lastFlightDate) {
            lastFlightDate = date;
          }
        }
      }
    }
    summaryByAircraft.set(ac.id, {
      totalMinutes,
      totalFlights,
      activeDays,
      lastFlightDate,
    });
  }

  // Fleet-level totals für den summary-banner oben.
  let fleetTotalMinutes = 0;
  let fleetTotalFlights = 0;
  let idleAircraftCount = 0; // 0 active-days in window
  for (const ac of aircraft) {
    const s = summaryByAircraft.get(ac.id);
    if (!s) continue;
    fleetTotalMinutes += s.totalMinutes;
    fleetTotalFlights += s.totalFlights;
    if (s.activeDays === 0 && ac.status === 'ACTIVE') idleAircraftCount += 1;
  }
  const fleetTotalHours = fleetTotalMinutes / 60;
  const activeAircraftCount = aircraft.filter((a) => a.status === 'ACTIVE').length;
  const avgHoursPerAircraft =
    activeAircraftCount > 0 ? fleetTotalHours / activeAircraftCount : 0;

  // Date-column labels: für jeden 7. tag das volle datum, sonst nur tag-
  // nummer. Verhindert overflow bei 30+ spalten ohne ganz auf orientierung
  // zu verzichten.
  const todayKey = toLocalDateString(new Date());

  return (
    <main className="min-h-screen bg-gray-50 dark:bg-gray-950 text-gray-900 dark:text-white p-4 sm:p-6 lg:p-8">
      <div className="max-w-7xl mx-auto">
        <header className="flex flex-wrap items-start justify-between gap-4 mb-8 pb-6 border-b border-gray-200 dark:border-gray-800">
          <div>
            <Link
              href="/airline/aircraft"
              className="text-sm text-indigo-600 dark:text-indigo-400 hover:underline"
            >
              ← Zurück zur Aircraft-Verwaltung
            </Link>
            <h1 className="text-3xl font-bold tracking-tight mt-2">
              Fleet-Utilization
            </h1>
            <p className="text-gray-500 dark:text-gray-400 text-sm mt-1">
              {user.airline.name} — Aktivitäts-Heatmap der letzten {days} Tage
            </p>
          </div>

          {/* Days-range selector — GET-form analog zu existing filter-pattern */}
          <form
            method="get"
            className="flex items-center gap-2"
            aria-label="Zeitraum-Auswahl"
          >
            <label
              htmlFor="days-input"
              className="text-sm text-gray-600 dark:text-gray-400"
            >
              Zeitraum:
            </label>
            <select
              id="days-input"
              name="days"
              defaultValue={String(days)}
              className="px-2 py-1 bg-white dark:bg-gray-900 border border-gray-300 dark:border-gray-700 rounded text-sm"
            >
              <option value="7">7 Tage</option>
              <option value="14">14 Tage</option>
              <option value="30">30 Tage</option>
              <option value="60">60 Tage</option>
              <option value="90">90 Tage</option>
            </select>
            <button
              type="submit"
              className="px-2 py-1 bg-gray-200 hover:bg-gray-300 dark:bg-gray-800 dark:hover:bg-gray-700 rounded text-xs transition"
            >
              Anwenden
            </button>
          </form>
        </header>

        {/* Summary-banner */}
        <section className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
          <SummaryCard
            label="Flotten-Stunden"
            value={fleetTotalHours.toFixed(1)}
            sublabel={`im ${days}-tage-fenster`}
          />
          <SummaryCard
            label="Flüge"
            value={fleetTotalFlights.toString()}
            sublabel="approved PIREPs"
          />
          <SummaryCard
            label="∅ pro Aircraft"
            value={avgHoursPerAircraft.toFixed(1) + ' h'}
            sublabel={`über ${activeAircraftCount} aktive`}
          />
          <SummaryCard
            label="Idle (0 Flüge)"
            value={idleAircraftCount.toString()}
            sublabel="von aktiven Aircraft"
            warn={idleAircraftCount > 0}
          />
        </section>

        {aircraft.length === 0 ? (
          <div className="bg-white dark:bg-gray-900 border border-dashed border-gray-300 dark:border-gray-700 rounded-lg p-12 text-center">
            <p className="text-gray-500 dark:text-gray-400">
              Noch keine Aircraft registriert. Lege erst Aircraft an um
              utilization zu sehen.
            </p>
          </div>
        ) : (
          // Heatmap: horizontal scrollable bei vielen tagen (mobil).
          // Sticky-left first column für aircraft-labels.
          <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-lg overflow-x-auto">
            <table className="border-separate border-spacing-0 text-xs">
              <thead>
                <tr>
                  <th className="sticky left-0 z-10 bg-white dark:bg-gray-900 px-3 py-2 text-left text-gray-500 dark:text-gray-400 font-medium border-r border-gray-200 dark:border-gray-800 min-w-[160px]">
                    Aircraft
                  </th>
                  {dateColumns.map((dateKey, idx) => {
                    const d = new Date(dateKey + 'T00:00:00');
                    const isWeekend = d.getDay() === 0 || d.getDay() === 6;
                    const isMonthStart = d.getDate() === 1;
                    // Nur jeden 7. tag und tag 1 des monats voll labeln,
                    // sonst nur die ziffer. Bei 30 tagen sind das ~5
                    // beschriftete spalten + die unbeschrifteten dazwischen.
                    const showFullLabel = idx === 0 || isMonthStart || idx % 7 === 0;
                    return (
                      <th
                        key={dateKey}
                        className={`px-1 py-2 text-center font-mono font-normal align-bottom ${
                          isWeekend
                            ? 'text-gray-400 dark:text-gray-600'
                            : 'text-gray-500 dark:text-gray-400'
                        }`}
                        title={dateKey}
                      >
                        {showFullLabel ? (
                          <>
                            <div className="text-[10px]">
                              {d.toLocaleDateString('de-DE', {
                                day: '2-digit',
                                month: '2-digit',
                              })}
                            </div>
                          </>
                        ) : (
                          <div className="text-[10px]">{d.getDate()}</div>
                        )}
                      </th>
                    );
                  })}
                  <th className="sticky right-0 z-10 bg-white dark:bg-gray-900 px-3 py-2 text-right text-gray-500 dark:text-gray-400 font-medium border-l border-gray-200 dark:border-gray-800">
                    Summe
                  </th>
                </tr>
              </thead>
              <tbody>
                {aircraft.map((ac) => {
                  const dayStats = statsByAircraft.get(ac.id);
                  const summary = summaryByAircraft.get(ac.id)!;
                  const isIdle =
                    summary.activeDays === 0 && ac.status === 'ACTIVE';
                  return (
                    <tr
                      key={ac.id}
                      className={`border-t border-gray-100 dark:border-gray-800/50 ${
                        ac.status === 'RETIRED' ? 'opacity-50' : ''
                      }`}
                    >
                      <td className="sticky left-0 z-10 bg-white dark:bg-gray-900 px-3 py-2 border-r border-gray-200 dark:border-gray-800">
                        <div className="flex items-center gap-2">
                          {ac.photoUrl && (
                            <picture className="shrink-0">
                              {/* eslint-disable-next-line @next/next/no-img-element */}
                              <img
                                src={ac.photoUrl}
                                alt=""
                                className="w-8 h-8 rounded object-cover border border-gray-200 dark:border-gray-800"
                              />
                            </picture>
                          )}
                          <div className="min-w-0">
                            <div className="font-mono font-semibold text-gray-900 dark:text-white">
                              {ac.registration}
                            </div>
                            <div className="text-[10px] flex items-center gap-1 mt-0.5">
                              <span
                                className={`inline-flex px-1 py-px text-[9px] font-medium rounded border ${STATUS_BADGE_STYLES[ac.status]}`}
                              >
                                {STATUS_LABELS[ac.status]}
                              </span>
                              <span className="text-gray-500 dark:text-gray-500 font-mono">
                                {ac.aircraftType?.icaoType ?? ac.type}
                              </span>
                            </div>
                            {isIdle && (
                              <div className="text-[10px] text-amber-700 dark:text-amber-400 mt-0.5">
                                ⚠️ {days}d idle
                              </div>
                            )}
                          </div>
                        </div>
                      </td>
                      {dateColumns.map((dateKey) => {
                        const s = dayStats?.get(dateKey);
                        const minutes = s?.minutes ?? 0;
                        const flights = s?.flights ?? 0;
                        const bucket = bucketFor(minutes);
                        const isToday = dateKey === todayKey;
                        const d = new Date(dateKey + 'T00:00:00');
                        const dateLabel = d.toLocaleDateString('de-DE', {
                          weekday: 'short',
                          day: '2-digit',
                          month: '2-digit',
                        });
                        const tooltip =
                          flights > 0
                            ? `${dateLabel}: ${flights} Flug${flights === 1 ? '' : 'e'}, ${(minutes / 60).toFixed(1)} h`
                            : `${dateLabel}: Kein Flug`;
                        return (
                          <td
                            key={dateKey}
                            className={`p-0 text-center ${
                              isToday
                                ? 'outline outline-2 outline-indigo-500/60 outline-offset-[-2px]'
                                : ''
                            }`}
                            title={tooltip}
                          >
                            <div
                              className={`mx-auto w-6 h-6 rounded-sm ${BUCKET_COLORS[bucket]}`}
                            />
                          </td>
                        );
                      })}
                      <td className="sticky right-0 z-10 bg-white dark:bg-gray-900 px-3 py-2 text-right border-l border-gray-200 dark:border-gray-800">
                        <div className="text-sm font-mono font-semibold text-gray-900 dark:text-white">
                          {(summary.totalMinutes / 60).toFixed(1)} h
                        </div>
                        <div className="text-[10px] text-gray-500 dark:text-gray-500">
                          {summary.totalFlights}{' '}
                          {summary.totalFlights === 1 ? 'Flug' : 'Flüge'} ·{' '}
                          {summary.activeDays}d aktiv
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* Legend */}
        <aside className="mt-6 bg-gray-100 dark:bg-gray-900/50 border border-gray-200 dark:border-gray-800 rounded-lg p-4 text-sm">
          <p className="font-medium text-gray-700 dark:text-gray-300 mb-2">
            Legende
          </p>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-gray-600 dark:text-gray-400">
            {[0, 1, 2, 3, 4].map((bucket) => (
              <div key={bucket} className="flex items-center gap-1.5">
                <span
                  className={`inline-block w-4 h-4 rounded-sm ${BUCKET_COLORS[bucket]}`}
                  aria-hidden="true"
                />
                <span>{BUCKET_LABELS[bucket]}</span>
              </div>
            ))}
            <div className="flex items-center gap-1.5 ml-4">
              <span
                className="inline-block w-4 h-4 rounded-sm bg-gray-100 dark:bg-gray-900 outline outline-2 outline-indigo-500/60 outline-offset-[-2px]"
                aria-hidden="true"
              />
              <span>Heute</span>
            </div>
          </div>
          <p className="text-xs text-gray-500 dark:text-gray-500 mt-3">
            Basis: Approved PIREPs mit aircraft-zuordnung, gruppiert nach
            tag. Hover über eine zelle für die details.
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
  warn?: boolean;
}

function SummaryCard({ label, value, sublabel, warn }: SummaryCardProps) {
  return (
    <div
      className={`bg-white dark:bg-gray-900 border rounded-lg p-4 ${
        warn
          ? 'border-amber-500/30 bg-amber-500/5 dark:bg-amber-500/10'
          : 'border-gray-200 dark:border-gray-800'
      }`}
    >
      <p
        className={`text-xs uppercase tracking-wide font-medium ${
          warn
            ? 'text-amber-700 dark:text-amber-400'
            : 'text-gray-500 dark:text-gray-400'
        }`}
      >
        {label}
      </p>
      <p
        className={`text-2xl font-bold font-mono mt-1 ${
          warn ? 'text-amber-900 dark:text-amber-200' : ''
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
