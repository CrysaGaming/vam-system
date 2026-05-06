import Link from 'next/link';
import { prisma } from '@vam/db';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

/**
 * Vision §9.2.5 — Pilot-Ranking-Board mit Filtern.
 *
 * Cross-airline leaderboard mit drei achsen die der admin via URL-form
 * kombinieren kann:
 *
 *   1. **Sort-mode**:
 *      - `hours` (default) — sum(flightTimeMin) / 60, höchster wert oben
 *      - `flights` — count of approved PIREPs, höchster wert oben
 *      - `landing` — avg(landingRateFpm) wo nicht null, NÄCHSTER ZU 0
 *        (also kleinster |fpm|) ist beste landung. Default-anzeige
 *        zeigt -120 fpm als "1.20 g touchdown" interpretation.
 *
 *   2. **Period**:
 *      - `alltime` (default) — alle approved PIREPs
 *      - `30d` — submittedAt >= now-30d
 *      - `7d` — submittedAt >= now-7d
 *
 *   3. **Aircraft-filter** (optional):
 *      - leer = alle aircraft
 *      - icao-string = filter auf aircraft.aircraftType.icaoType matched
 *
 * # Tech-design
 *
 * Server-component liest searchParams via prop. Filter-controls sind
 * eine native HTML-form mit method=GET — keine client-component, kein
 * useState, keine action. Browser baut die URL beim submit zusammen
 * (?rank_mode=hours&rank_period=30d&rank_aircraft=B738), nextjs RSC
 * re-rendert die ganze page mit den neuen searchParams.
 *
 * Das ist der billigste interaction-pattern für ein dashboard-widget
 * weil:
 *   - kein JS-bundle für interactivity (form ist HTML-native)
 *   - server-side cache greift via revalidate (siehe page export)
 *   - "shareable URLs" — admin kann ein ranking-link an pilot schicken
 *
 * # Performance
 *
 * Aggregation ist `prisma.pirep.groupBy({ by: ['userId'], _sum, _count,
 * _avg })` mit where-filter. Bei großem PIREP-volume (10k+) wird das
 * langsam — aber der page-revalidate von 30s caching hilft. Für >100k
 * brauchts materialisierte tabellen (separates ticket).
 *
 * # Why nicht User.totalFlightHours für alltime?
 *
 * Konsistenz: alle perioden nutzen die SELBE aggregations-pipeline.
 * User.totalFlightHours wird per PIREP-approval inkrementiert (siehe
 * approve.ts) und sollte dem aggregat entsprechen, aber bei legacy-
 * imports oder admin-overrides kann's drift geben. Aggregat aus PIREPs
 * ist die ground-truth.
 */

const TOP_N = 10;

type SortMode = 'hours' | 'flights' | 'landing';
type Period = 'alltime' | '30d' | '7d';

interface PilotRankingBoardProps {
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

export async function PilotRankingBoard({ searchParams }: PilotRankingBoardProps) {
  const mode = parseMode(searchParams.rank_mode);
  const period = parsePeriod(searchParams.rank_period);
  const aircraftFilter = parseAircraft(searchParams.rank_aircraft);

  const dateFilter = periodToDateFilter(period);

  // Aircraft-options: distinct aircraft-types die in PIREPs vorkommen.
  // Wir filtern auf approved PIREPs damit wir nicht draft/rejected
  // listen — diese sind state=Filed/Approved/Rejected und rejected
  // PIREPs sollen nicht zum ranking beitragen. Aircraft-filter-dropdown
  // zeigt aber alle types die je geflogen wurden (auch rejected) damit
  // der admin auch nach kontroversen types filtern kann.
  const aircraftOptions = await prisma.aircraft.findMany({
    where: {
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
  // status PIREPs zählen ("ranking ist verdiente leistung, nicht
  // submitted leistung").
  const where = {
    status: 'Approved' as const,
    ...(dateFilter ? { submittedAt: { gte: dateFilter } } : {}),
    ...(aircraftFilter
      ? { aircraft: { aircraftType: { icaoType: aircraftFilter } } }
      : {}),
  };

  // Aggregations-query: groupBy userId. Je nach mode anderes orderBy.
  // Für 'landing' brauchen wir _avg(landingRateFpm) und filter auf
  // PIREPs die einen wert haben.
  //
  // Wir typecasten die return-arrays auf einen einheitlichen shape
  // damit der display-code unten beide branches gleich behandeln kann
  // — TypeScript inferiert sonst zwei verschiedene PickEnumerable-typen.
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
            airline: { select: { name: true, icao: true } },
            rank: { select: { name: true } },
          },
        })
      : [];

  const userMap = new Map(users.map((u) => [u.id, u]));

  return (
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
              href="/admin"
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
                      <p className="text-xs text-gray-500 dark:text-gray-400 truncate">
                        {user.airline?.icao ?? '—'}
                        {user.rank?.name && ` · ${user.rank.name}`}
                      </p>
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
