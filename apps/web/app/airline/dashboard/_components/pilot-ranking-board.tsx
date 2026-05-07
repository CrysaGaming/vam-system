import Link from 'next/link';
import { prisma } from '@vam/db';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

/**
 * PilotRankingBoard — Track 3 #11.2.5 Phase-B Op-Widget #4 (airline-scoped).
 *
 * Airline-internal leaderboard. Klon des admin/_widgets/pilot-ranking-board
 * mit identischem URL-state-pattern, aber gefiltert auf piloten EINER
 * airline. Macht das airline-dashboard so reichhaltig wie das admin-
 * dashboard ohne dass airline-manager cross-airline-daten sehen.
 *
 * # Was vom admin-widget übernommen
 *
 *   - Drei sort-modes: hours / flights / landing
 *   - Drei perioden: alltime / 30d / 7d
 *   - Aircraft-filter (ICAO-type)
 *   - URL-state-pattern: native form method=GET, searchParams in der URL
 *   - searchParams-keys: rank_mode, rank_period, rank_aircraft (synchron
 *     zum admin damit URL-konventionen identisch sind)
 *   - Approved-only PIREPs (ranking ist verdiente leistung)
 *   - Min 3 PIREPs für landing-mode (statistical relevance)
 *   - Trophäen-farben für ränge 1/2/3
 *
 * # Was airline-spezifisch geändert
 *
 *   - **where-clause**: zusätzlich `airlineId: airlineId` damit nur
 *     PIREPs der eigenen airline ins ranking gehen
 *   - **aircraftOptions**: nur aircraft-types die in der eigenen flotte
 *     ge-pireped wurden (statt cross-airline scope) — sonst könnte
 *     airline-admin nach types filtern die seine flotte gar nicht hat
 *   - **users-display**: airline.icao weggelassen (alle haben dieselbe,
 *     wäre redundant); stattdessen nur rank.name als secondary-info
 *   - **reset-link**: zurück zu /airline/dashboard statt /admin
 *
 * # Tech-design (siehe admin/_widgets/pilot-ranking-board.tsx für details)
 *
 * Server-component liest searchParams via prop, native HTML-form für
 * filter-controls (kein JS-bundle), prisma.pirep.groupBy mit airline-
 * scoped where-clause, JS-side merging für landing-mode-statistics.
 *
 * # Performance-note
 *
 * Bei airlines mit 10k+ PIREPs wird die aggregation langsam. Da pro
 * airline aber typisch <1000 PIREPs/jahr anfallen, ist das skalierungs-
 * problem hier deutlich geringer als beim admin-widget. Page-level
 * caching + RSC streaming reichen für die foreseeable future.
 */

const TOP_N = 10;

type SortMode = 'hours' | 'flights' | 'landing';
type Period = 'alltime' | '30d' | '7d';

interface PilotRankingBoardProps {
  airlineId: string;
  /** Komplettes searchParams object aus der page. Wir lesen nur unsere prefixed keys. */
  searchParams: Record<string, string | string[] | undefined>;
}

const MODE_LABELS: Record<SortMode, string> = {
  hours: 'Flugstunden',
  flights: 'Flüge',
  landing: 'Landung-Rate',
};

const PERIOD_LABELS: Record<Period, string> = {
  alltime: 'All-Time',
  '30d': 'Letzte 30 Tage',
  '7d': 'Letzte 7 Tage',
};

function parseMode(raw: string | string[] | undefined): SortMode {
  if (raw === 'flights') return 'flights';
  if (raw === 'landing') return 'landing';
  return 'hours';
}

function parsePeriod(raw: string | string[] | undefined): Period {
  if (raw === '30d') return '30d';
  if (raw === '7d') return '7d';
  return 'alltime';
}

function parseAircraft(raw: string | string[] | undefined): string {
  if (typeof raw !== 'string') return '';
  // Sanitize: nur 2-8 zeichen alphanum (ICAO-aircraft-type-codes)
  if (!/^[A-Z0-9]{2,8}$/i.test(raw)) return '';
  return raw.toUpperCase();
}

function periodToDateFilter(period: Period): Date | null {
  if (period === 'alltime') return null;
  const now = Date.now();
  const days = period === '30d' ? 30 : 7;
  return new Date(now - days * 24 * 60 * 60 * 1000);
}

export async function PilotRankingBoard({ airlineId, searchParams }: PilotRankingBoardProps) {
  const mode = parseMode(searchParams.rank_mode);
  const period = parsePeriod(searchParams.rank_period);
  const aircraftFilter = parseAircraft(searchParams.rank_aircraft);

  const dateFilter = periodToDateFilter(period);

  // Aircraft-options: distinct aircraft-types die in PIREPs DIESER airline
  // vorkommen. Wir filtern auf approved PIREPs damit wir nicht draft/
  // rejected listen — diese sollen nicht zum filter-dropdown beitragen.
  const aircraftOptions = await prisma.aircraft.findMany({
    where: {
      airlineId,
      pireps: {
        some: { status: 'Approved' },
      },
    },
    select: {
      aircraftType: { select: { icaoType: true } },
    },
    distinct: ['aircraftTypeId'],
    take: 50,
    orderBy: { createdAt: 'asc' },
  });
  const aircraftIcaoSet = new Set(
    aircraftOptions
      .map((a) => a.aircraftType?.icaoType)
      .filter((s): s is string => !!s),
  );
  const aircraftIcaoList = Array.from(aircraftIcaoSet).sort();

  // Build the where-clause für die ranking-aggregation. Nur Approved-
  // PIREPs zählen UND nur PIREPs DIESER airline. airlineId ist der
  // entscheidende unterschied zum admin-widget — alles andere ist
  // identisches filter-pattern.
  const where = {
    airlineId,
    status: 'Approved' as const,
    ...(dateFilter ? { submittedAt: { gte: dateFilter } } : {}),
    ...(aircraftFilter
      ? { aircraft: { aircraftType: { icaoType: aircraftFilter } } }
      : {}),
  };

  // Aggregations-query: groupBy userId. Je nach mode anderes orderBy.
  // Für 'landing' brauchen wir _avg(landingRateFpm) und filter auf
  // PIREPs die einen wert haben.
  type RankingGroup = {
    userId: string;
    _count: { _all: number };
    _sum?: { flightTimeMin: number | null };
    _avg?: { landingRateFpm: number | null };
  };

  let grouped: RankingGroup[];
  if (mode === 'landing') {
    const raw = await prisma.pirep.groupBy({
      by: ['userId'],
      where: { ...where, landingRateFpm: { not: null } },
      _avg: { landingRateFpm: true },
      _count: { _all: true },
    });
    grouped = raw as RankingGroup[];
  } else {
    const raw = await prisma.pirep.groupBy({
      by: ['userId'],
      where,
      _sum: { flightTimeMin: true },
      _count: { _all: true },
      orderBy:
        mode === 'hours'
          ? { _sum: { flightTimeMin: 'desc' } }
          : { _count: { userId: 'desc' } },
      take: TOP_N,
    });
    grouped = raw as RankingGroup[];
  }

  // Für landing-mode: nach JS sortieren (closest to 0 wins) + min 3 PIREPs
  // für statistical-relevance. Limit nach sort.
  const finalGroups: RankingGroup[] =
    mode === 'landing'
      ? grouped
          .filter((g) => g._count._all >= 3)
          .sort((a, b) => {
            const aVal = Math.abs(a._avg?.landingRateFpm ?? -9999);
            const bVal = Math.abs(b._avg?.landingRateFpm ?? -9999);
            return aVal - bVal;
          })
          .slice(0, TOP_N)
      : grouped;

  const userIds = finalGroups.map((g) => g.userId);
  const users =
    userIds.length > 0
      ? await prisma.user.findMany({
          where: { id: { in: userIds } },
          select: {
            id: true,
            name: true,
            image: true,
            rank: { select: { name: true } },
          },
        })
      : [];

  const userMap = new Map(users.map((u) => [u.id, u]));

  return (
    <section className="mb-10">
      <Card>
        <CardHeader>
          <div className="flex items-start justify-between gap-3 flex-wrap">
            <div>
              <CardTitle className="flex items-center gap-2">
                <span aria-hidden="true">🏆</span>
                <span>Pilot-Ranking</span>
              </CardTitle>
              <CardDescription>
                Top {TOP_N} ·{' '}
                {MODE_LABELS[mode]} · {PERIOD_LABELS[period]}
                {aircraftFilter && (
                  <>
                    {' · '}
                    <span className="font-mono">{aircraftFilter}</span>
                  </>
                )}
              </CardDescription>
            </div>
          </div>

          {/* Filter-form. method=GET damit URL-state shareable bleibt. Kein
              JS — submit feuert page-reload mit neuen searchParams. */}
          <form method="GET" action="" className="flex flex-wrap gap-2 mt-3 text-xs">
            <select
              name="rank_mode"
              defaultValue={mode}
              className="bg-white dark:bg-gray-900 border border-gray-300 dark:border-gray-700 rounded px-2 py-1"
              aria-label="Ranking-Modus"
            >
              <option value="hours">Flugstunden</option>
              <option value="flights">Anzahl Flüge</option>
              <option value="landing">Beste Landung-Rate</option>
            </select>
            <select
              name="rank_period"
              defaultValue={period}
              className="bg-white dark:bg-gray-900 border border-gray-300 dark:border-gray-700 rounded px-2 py-1"
              aria-label="Zeitraum"
            >
              <option value="alltime">All-Time</option>
              <option value="30d">30 Tage</option>
              <option value="7d">7 Tage</option>
            </select>
            <select
              name="rank_aircraft"
              defaultValue={aircraftFilter}
              className="bg-white dark:bg-gray-900 border border-gray-300 dark:border-gray-700 rounded px-2 py-1"
              aria-label="Aircraft-Type"
            >
              <option value="">alle Aircraft</option>
              {aircraftIcaoList.map((icao) => (
                <option key={icao} value={icao}>
                  {icao}
                </option>
              ))}
            </select>
            <button
              type="submit"
              className="px-3 py-1 bg-primary text-primary-foreground rounded hover:opacity-90 transition"
            >
              Anwenden
            </button>
            {(mode !== 'hours' || period !== 'alltime' || aircraftFilter) && (
              <Link
                href="/airline/dashboard"
                className="px-3 py-1 bg-gray-200 dark:bg-gray-800 hover:bg-gray-300 dark:hover:bg-gray-700 rounded transition"
              >
                Zurücksetzen
              </Link>
            )}
          </form>
        </CardHeader>

        <CardContent>
          {finalGroups.length === 0 ? (
            <p className="text-sm text-gray-500 dark:text-gray-400 py-4 text-center">
              Keine PIREPs im ausgewählten zeitraum
              {aircraftFilter && ` für ${aircraftFilter}`}.
            </p>
          ) : (
            <ol className="space-y-1.5">
              {finalGroups.map((group, idx) => {
                const user = userMap.get(group.userId);
                if (!user) return null;
                const rank = idx + 1;
                const value = formatValue(mode, group);
                return (
                  <li key={group.userId}>
                    <Link
                      href={`/pilots/${user.id}`}
                      className="flex items-center gap-3 px-2 py-1.5 rounded hover:bg-gray-100 dark:hover:bg-gray-800 transition"
                    >
                      <span
                        className={`shrink-0 w-7 text-center font-bold tabular-nums ${
                          rank === 1
                            ? 'text-yellow-600 dark:text-yellow-400'
                            : rank === 2
                              ? 'text-gray-500 dark:text-gray-400'
                              : rank === 3
                                ? 'text-amber-700 dark:text-amber-500'
                                : 'text-gray-400 dark:text-gray-600'
                        }`}
                        aria-hidden="true"
                      >
                        {rank}
                      </span>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate">{user.name}</p>
                        {user.rank?.name && (
                          <p className="text-xs text-gray-500 dark:text-gray-400 truncate">
                            {user.rank.name}
                          </p>
                        )}
                      </div>
                      <span className="shrink-0 text-sm font-mono tabular-nums text-gray-900 dark:text-gray-100">
                        {value}
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ol>
          )}
        </CardContent>
      </Card>
    </section>
  );
}

/**
 * Display-formatting per sort-mode. Tabular-nums ensures rechtsbündige
 * alignment in der liste.
 */
function formatValue(
  mode: SortMode,
  group: {
    _sum?: { flightTimeMin: number | null };
    _avg?: { landingRateFpm: number | null };
    _count: { _all: number };
  },
): string {
  if (mode === 'hours') {
    const min = group._sum?.flightTimeMin ?? 0;
    return `${(min / 60).toFixed(1)} h`;
  }
  if (mode === 'flights') {
    return `${group._count._all}`;
  }
  // landing
  const avgFpm = group._avg?.landingRateFpm ?? 0;
  return `${Math.round(avgFpm)} fpm`;
}
