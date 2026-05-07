import { prisma } from '@vam/db';
import Link from 'next/link';
import { Card, CardContent } from '@/components/ui/card';

/**
 * TopRoutes — Track 3 #11.2.5 v1-Full Operations-Widget #2.
 *
 * Zeigt die top-10 aktivsten routen der airline in den letzten 30 tagen,
 * gemessen an PIREP-volumen. Ergänzung zur "Routen"-KPI (welche routes
 * existieren) → "welche werden tatsächlich geflogen".
 *
 * # Design-Entscheidungen
 *
 * **30-tage-fenster**: balance zwischen schnell-genug-aktualität (saison-
 * effekte sichtbar, neue routes erscheinen sofort wenn beliebt) und
 * statistik-rauschen (1 woche wäre zu volatil bei kleinen airlines).
 * 30 tage bringen pro woche ~25% des fensters, also smooth-trend.
 *
 * **Approved + Submitted gezählt**: Rejected werden ausgeschlossen
 * weil die "wurden nicht gemacht" pirep-mäßig — landing-rate-checks
 * etc. die fehl-PIREPs aus stats halten. Submitted-state wird mitgezählt
 * weil's faktisch geflogene flüge sind, nur eben noch nicht ge-reviewt.
 *
 * **routeId NOT NULL filter**: Pirep.routeId ist nullable weil pilots
 * ad-hoc-flüge ohne airline-route fliegen können (direct-fly, freelance,
 * etc.). Diese excluden wir hier weil das widget AIRLINE-OWNED routes
 * zeigt. Direct-flights würden das ranking verfälschen.
 *
 * **Two-query-pattern**: groupBy gibt nur counts pro routeId, dann
 * separate findMany für die route-details. Prisma kann groupBy nicht
 * mit include kombinieren. Alternative wäre raw-SQL JOIN, aber zwei
 * indizierte queries (PK-lookup) sind hier billiger als der
 * code-overhead.
 *
 * **Progress-bar relativ zum top-1**: Visualisiert dominanz. Wenn die
 * top-route 10x mehr flights hat als #10, sieht man das sofort. Andere
 * variante wäre absolute scale (z.B. /100 flights), aber das macht das
 * widget bei kleinen airlines unleserlich (alle bars wären winzig).
 *
 * **Take 10**: Selbe begründung wie pirep-flow-timeline — dashboard ist
 * überblicks-tool, nicht full-listing. Falls eine airline routes-detail-
 * page später kommt, bekommt die das vollständige ranking.
 */

interface TopRoutesProps {
  airlineId: string;
}

export async function TopRoutes({ airlineId }: TopRoutesProps) {
  // 30-tage-fenster ab jetzt rückwärts. Date-arithmetik in JS damit wir
  // nicht von server-timezone-quirks abhängig sind — UTC-millis sind
  // global eindeutig.
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

  const grouped = await prisma.pirep.groupBy({
    by: ['routeId'],
    where: {
      airlineId,
      routeId: { not: null },
      status: { not: 'Rejected' },
      submittedAt: { gte: thirtyDaysAgo },
    },
    _count: { _all: true },
    orderBy: { _count: { routeId: 'desc' } },
    take: 10,
  });

  // Empty-state: Wenn keine PIREPs im fenster, widget ausblenden. Selbe
  // logik wie pirep-flow-timeline — leere widgets sind UX-rauschen.
  if (grouped.length === 0) return null;

  // RouteId-extraction mit type-narrowing. Der NOT NULL filter im where
  // garantiert dass routeId hier non-null ist, aber TS sieht das nicht
  // automatisch. Die explicit map(... as string) ist die idiomatische
  // form, alternativ non-null-assertion hätte gleichen runtime-effekt.
  const routeIds = grouped
    .map((g) => g.routeId)
    .filter((id): id is string => id !== null);

  const routes = await prisma.route.findMany({
    where: { id: { in: routeIds } },
    select: {
      id: true,
      flightNumber: true,
      departure: { select: { icao: true, name: true } },
      arrival: { select: { icao: true, name: true } },
      aircraftTypeIcao: true,
    },
  });

  // Map für O(1) lookup statt O(n) find pro render-row. Bei 10 routes
  // egal, aber das pattern skaliert.
  const routeById = new Map(routes.map((r) => [r.id, r]));

  // Merge counts mit route-details. Die order kommt vom groupBy
  // (by count desc), nicht vom findMany — das ist absichtlich.
  const ranked = grouped
    .map((g) => {
      const route = routeById.get(g.routeId as string);
      if (!route) return null;
      return { route, count: g._count._all };
    })
    .filter((x): x is { route: typeof routes[0]; count: number } => x !== null);

  // Top-1-count für progress-bar-scale. ranked[0] existiert weil
  // grouped.length > 0 oben gechecked.
  const maxCount = ranked[0]?.count ?? 1;

  return (
    <section className="mb-10">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold">Top-Routen</h2>
        <span className="text-xs text-gray-500 dark:text-gray-400">
          letzte 30 Tage
        </span>
      </div>
      <Card>
        <CardContent className="p-0">
          <ul className="divide-y divide-gray-200 dark:divide-gray-800">
            {ranked.map((item, idx) => (
              <li key={item.route.id}>
                <Link
                  href={`/airline/routes/${item.route.id}`}
                  className="flex items-center gap-4 px-4 py-3 hover:bg-gray-50 dark:hover:bg-gray-800/30 transition"
                >
                  <span className="text-sm font-mono text-gray-400 dark:text-gray-500 w-6 text-right tabular-nums">
                    {idx + 1}
                  </span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-baseline gap-2 mb-1">
                      <span className="font-mono text-sm font-medium text-gray-900 dark:text-white">
                        {item.route.flightNumber}
                      </span>
                      <span className="font-mono text-sm text-gray-700 dark:text-gray-300">
                        {item.route.departure.icao} → {item.route.arrival.icao}
                      </span>
                      {item.route.aircraftTypeIcao && (
                        <span className="font-mono text-xs text-gray-500 dark:text-gray-400">
                          {item.route.aircraftTypeIcao}
                        </span>
                      )}
                    </div>
                    {/* Progress-bar relativ zum top-1. Min-width 4px damit
                        die schwächste route trotzdem sichtbar ist. */}
                    <div className="h-1.5 bg-gray-100 dark:bg-gray-800 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-primary rounded-full transition-all"
                        style={{
                          width: `${Math.max(4, (item.count / maxCount) * 100)}%`,
                        }}
                      />
                    </div>
                  </div>
                  <span className="text-sm font-medium text-gray-900 dark:text-white tabular-nums whitespace-nowrap">
                    {item.count}{' '}
                    <span className="text-xs font-normal text-gray-500 dark:text-gray-400">
                      {item.count === 1 ? 'Flug' : 'Flüge'}
                    </span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>
    </section>
  );
}
