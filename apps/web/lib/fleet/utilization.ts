import { prisma } from '@vam/db';

/**
 * Welle F / F2 — Fleet-utilization aggregations.
 *
 * Powers /airline/dashboard/fleet-utilization (a deep-dive expansion of
 * the small <FleetUtilization /> widget on /airline/dashboard). The widget
 * gives a quick top-15-per-30d glance; this lib provides the four full
 * cross-cuts the dedicated page needs:
 *
 *   1. Per-airframe utilization (rows in the main table)
 *   2. Per-aircraft-type rollup (which type-families do the heavy lifting)
 *   3. Hub-balance matrix (departures + arrivals per hub per type)
 *   4. Route-coverage matrix (which type flies which route how often)
 *
 * # Period parameter
 *
 * All queries accept a Date `since` cutoff. Pages pass one of:
 *   - 30 days ago (default — matches widget for visual consistency)
 *   - 90 days ago (quarterly view)
 *   - 365 days ago (annual)
 *   - new Date(0) (all-time)
 * Aggregations filter by `submittedAt >= since`. We use submittedAt rather
 * than approvedAt because (a) it's always set, (b) it's closer to "when
 * did the flight happen" than approval-bureaucracy time, and (c) it
 * matches the widget's window definition.
 *
 * # PIREP-status filter
 *
 * We exclude Rejected PIREPs — they didn't happen for utilization purposes
 * (the aircraft wasn't actually used, or the flight was cheated). Submitted
 * + Approved both count: an airline-admin reviewing the dashboard wants
 * to see throughput, not just the approval-bottleneck. If the airline
 * wants approved-only stats they can apply the status filter later.
 *
 * # Performance notes
 *
 * Worst case: ~10k PIREPs per airline for a year. groupBy queries are
 * O(rows) and fully indexed (airlineId + submittedAt). For very large
 * airlines (>50k PIREPs/year) the route-coverage matrix grows quadratically
 * with route × aircraft-type cardinality — we cap to top-20 routes by
 * pirep-count and top-10 aircraft-types to keep the rendered matrix
 * scannable and the query payload bounded.
 */

/** Result rows for per-airframe utilization. */
export interface AirframeUtilization {
  aircraftId: string;
  registration: string;
  type: string;
  aircraftTypeName: string | null;
  homeIcao: string | null;
  currentLocationIcao: string | null;
  status: 'ACTIVE' | 'MAINTENANCE' | 'STORED' | 'RETIRED';
  flightCount: number;
  blockMinutes: number;
  lastFlightAt: Date | null;
}

/**
 * Per-airframe utilization for the main table. Returns all airframes
 * (including idle ones and non-ACTIVE) so the admin can see the full
 * fleet inventory. Sorted by blockMinutes desc.
 */
export async function getAirframeUtilization(
  airlineId: string,
  since: Date,
): Promise<AirframeUtilization[]> {
  const [airframes, pirepStats, lastFlights] = await Promise.all([
    prisma.aircraft.findMany({
      where: { airlineId },
      select: {
        id: true,
        registration: true,
        type: true,
        homeIcao: true,
        currentLocationIcao: true,
        status: true,
        aircraftType: { select: { name: true } },
      },
      orderBy: { registration: 'asc' },
    }),
    prisma.pirep.groupBy({
      by: ['aircraftId'],
      where: {
        airlineId,
        status: { not: 'Rejected' },
        submittedAt: { gte: since },
        aircraftId: { not: null },
      },
      _count: { _all: true },
      _sum: { flightTimeMin: true },
    }),
    // last-flight is across all-time not the window, so an airframe shown
    // as "0 hours in last 30d" still has a useful "last flew 47d ago"
    // signal. groupBy max(submittedAt) gives the cheapest path.
    prisma.pirep.groupBy({
      by: ['aircraftId'],
      where: {
        airlineId,
        status: { not: 'Rejected' },
        aircraftId: { not: null },
      },
      _max: { submittedAt: true },
    }),
  ]);

  const statsByAircraft = new Map(
    pirepStats.map((s) => [s.aircraftId, s] as const),
  );
  const lastByAircraft = new Map(
    lastFlights.map((l) => [l.aircraftId, l._max.submittedAt] as const),
  );

  const rows: AirframeUtilization[] = airframes.map((a) => {
    const stats = statsByAircraft.get(a.id);
    return {
      aircraftId: a.id,
      registration: a.registration,
      type: a.type,
      aircraftTypeName: a.aircraftType?.name ?? null,
      homeIcao: a.homeIcao,
      currentLocationIcao: a.currentLocationIcao,
      status: a.status,
      flightCount: stats?._count._all ?? 0,
      blockMinutes: stats?._sum.flightTimeMin ?? 0,
      lastFlightAt: lastByAircraft.get(a.id) ?? null,
    };
  });

  // Sort: most-utilized first. Ties broken by registration for stable
  // ordering between renders.
  rows.sort((a, b) => {
    if (b.blockMinutes !== a.blockMinutes) {
      return b.blockMinutes - a.blockMinutes;
    }
    return a.registration.localeCompare(b.registration);
  });

  return rows;
}

/** Per-aircraft-type rollup. */
export interface TypeRollup {
  typeName: string;
  airframeCount: number;
  activeAirframes: number;
  flightCount: number;
  blockMinutes: number;
}

/**
 * Aggregates the per-airframe rows into a per-type view. Useful for
 * "Which type-family is doing the heavy lifting?" questions. Uses the
 * pre-computed `airframes` rather than re-querying — saves a round-trip
 * and keeps the type-string consistent with the table above.
 */
export function rollupByType(
  airframes: AirframeUtilization[],
): TypeRollup[] {
  const byType = new Map<string, TypeRollup>();
  for (const a of airframes) {
    const key = a.type;
    const existing = byType.get(key);
    if (existing) {
      existing.airframeCount += 1;
      if (a.status === 'ACTIVE') existing.activeAirframes += 1;
      existing.flightCount += a.flightCount;
      existing.blockMinutes += a.blockMinutes;
    } else {
      byType.set(key, {
        typeName: key,
        airframeCount: 1,
        activeAirframes: a.status === 'ACTIVE' ? 1 : 0,
        flightCount: a.flightCount,
        blockMinutes: a.blockMinutes,
      });
    }
  }
  return Array.from(byType.values()).sort(
    (a, b) => b.blockMinutes - a.blockMinutes,
  );
}

/** Hub-balance row: per-hub departure + arrival counts per type. */
export interface HubBalanceRow {
  hubIcao: string;
  hubName: string | null;
  isPrimary: boolean;
  departures: number;
  arrivals: number;
  byType: Array<{ type: string; departures: number; arrivals: number }>;
}

/**
 * Hub-balance matrix. For each hub of the airline, counts how many flights
 * departed from + arrived at that hub in the period, broken down by
 * aircraft-type. Helps spot imbalances ("EDDM has 80 departures but only
 * 30 arrivals — pilots aren't coming back, ferry-flights mounting").
 *
 * We join via Airport.icao instead of FK because Pirep.departureId/arrivalId
 * are FK to Airport, not Hub. Hub-list comes separately from AirlineHub.
 */
export async function getHubBalance(
  airlineId: string,
  since: Date,
): Promise<HubBalanceRow[]> {
  const hubs = await prisma.airlineHub.findMany({
    where: { airlineId },
    select: {
      isPrimary: true,
      airport: { select: { icao: true, name: true } },
    },
  });

  if (hubs.length === 0) return [];

  const hubIcaos = hubs.map((h) => h.airport.icao);

  // Pull all PIREPs that touch any hub. Single query rather than per-hub
  // (would be N round-trips). Filter + groupBy in-memory by (icao, type).
  const pireps = await prisma.pirep.findMany({
    where: {
      airlineId,
      status: { not: 'Rejected' },
      submittedAt: { gte: since },
      OR: [
        { departure: { icao: { in: hubIcaos } } },
        { arrival: { icao: { in: hubIcaos } } },
      ],
    },
    select: {
      aircraft: { select: { type: true } },
      departure: { select: { icao: true } },
      arrival: { select: { icao: true } },
    },
  });

  const rowByIcao = new Map<string, HubBalanceRow>();
  for (const h of hubs) {
    rowByIcao.set(h.airport.icao, {
      hubIcao: h.airport.icao,
      hubName: h.airport.name,
      isPrimary: h.isPrimary,
      departures: 0,
      arrivals: 0,
      byType: [],
    });
  }

  // Per-hub-per-type counters using nested map for in-memory groupBy.
  // Inner map: type → {dep, arr}. Outer map: hubIcao → inner.
  const counters = new Map<
    string,
    Map<string, { dep: number; arr: number }>
  >();
  for (const icao of hubIcaos) counters.set(icao, new Map());

  for (const p of pireps) {
    const type = p.aircraft?.type ?? 'Unknown';
    const depIcao = p.departure.icao;
    const arrIcao = p.arrival.icao;
    if (rowByIcao.has(depIcao)) {
      rowByIcao.get(depIcao)!.departures += 1;
      const inner = counters.get(depIcao)!;
      const existing = inner.get(type) ?? { dep: 0, arr: 0 };
      existing.dep += 1;
      inner.set(type, existing);
    }
    if (rowByIcao.has(arrIcao)) {
      rowByIcao.get(arrIcao)!.arrivals += 1;
      const inner = counters.get(arrIcao)!;
      const existing = inner.get(type) ?? { dep: 0, arr: 0 };
      existing.arr += 1;
      inner.set(type, existing);
    }
  }

  // Materialize byType lists, sorted by total-touches desc.
  for (const [icao, inner] of counters) {
    const row = rowByIcao.get(icao)!;
    row.byType = Array.from(inner.entries())
      .map(([type, c]) => ({ type, departures: c.dep, arrivals: c.arr }))
      .sort((a, b) => b.departures + b.arrivals - (a.departures + a.arrivals));
  }

  // Sort: primary hubs first, then by total-touches desc.
  return Array.from(rowByIcao.values()).sort((a, b) => {
    if (a.isPrimary !== b.isPrimary) return a.isPrimary ? -1 : 1;
    return b.departures + b.arrivals - (a.departures + a.arrivals);
  });
}

/** Route-coverage cell: which type flew route X how often. */
export interface RouteCoverageRow {
  routeId: string;
  flightNumber: string;
  depIcao: string;
  arrIcao: string;
  totalFlights: number;
  byType: Array<{ type: string; count: number }>;
}

/**
 * Route-coverage matrix. For each of the top-N busiest routes, breaks down
 * how many flights each type flew. Reveals "this A320-route is being
 * covered 60% by B737s" type-mismatch signals.
 *
 * Capped to top-20 routes by total-flight-count in the period. Beyond
 * that the matrix is too sparse to be useful and the UI gets unwieldy.
 */
export async function getRouteCoverage(
  airlineId: string,
  since: Date,
  limit = 20,
): Promise<RouteCoverageRow[]> {
  // Step 1: rank routes by pirep-count in the period.
  const topRoutes = await prisma.pirep.groupBy({
    by: ['routeId'],
    where: {
      airlineId,
      status: { not: 'Rejected' },
      submittedAt: { gte: since },
      routeId: { not: null },
    },
    _count: { _all: true },
    orderBy: { _count: { routeId: 'desc' } },
    take: limit,
  });

  if (topRoutes.length === 0) return [];

  const routeIds = topRoutes
    .map((r) => r.routeId)
    .filter((id): id is string => id !== null);

  // Step 2: route-meta for the top routes (flightNumber, dep/arr icao).
  const routes = await prisma.route.findMany({
    where: { id: { in: routeIds } },
    select: {
      id: true,
      flightNumber: true,
      departure: { select: { icao: true } },
      arrival: { select: { icao: true } },
    },
  });
  const routeMeta = new Map(routes.map((r) => [r.id, r] as const));

  // Step 3: per-route-per-type breakdown. Single query, group in memory.
  const detailPireps = await prisma.pirep.findMany({
    where: {
      airlineId,
      status: { not: 'Rejected' },
      submittedAt: { gte: since },
      routeId: { in: routeIds },
    },
    select: {
      routeId: true,
      aircraft: { select: { type: true } },
    },
  });

  const byRoute = new Map<string, Map<string, number>>();
  for (const id of routeIds) byRoute.set(id, new Map());
  for (const p of detailPireps) {
    if (!p.routeId) continue;
    const inner = byRoute.get(p.routeId);
    if (!inner) continue;
    const type = p.aircraft?.type ?? 'Unknown';
    inner.set(type, (inner.get(type) ?? 0) + 1);
  }

  return topRoutes
    .map((r): RouteCoverageRow | null => {
      if (!r.routeId) return null;
      const meta = routeMeta.get(r.routeId);
      if (!meta) return null;
      const inner = byRoute.get(r.routeId);
      const byType = inner
        ? Array.from(inner.entries())
            .map(([type, count]) => ({ type, count }))
            .sort((a, b) => b.count - a.count)
        : [];
      return {
        routeId: r.routeId,
        flightNumber: meta.flightNumber,
        depIcao: meta.departure.icao,
        arrIcao: meta.arrival.icao,
        totalFlights: r._count._all,
        byType,
      };
    })
    .filter((x): x is RouteCoverageRow => x !== null);
}

/** Top-level summary KPIs for the page header. */
export interface FleetSummary {
  totalAirframes: number;
  activeAirframes: number;
  totalBlockMinutes: number;
  totalFlights: number;
  airframesWithZeroFlights: number;
}

/** Computes summary from the rows (avoids a separate query). */
export function summarize(airframes: AirframeUtilization[]): FleetSummary {
  let activeAirframes = 0;
  let totalBlockMinutes = 0;
  let totalFlights = 0;
  let zeroFlight = 0;
  for (const a of airframes) {
    if (a.status === 'ACTIVE') activeAirframes += 1;
    totalBlockMinutes += a.blockMinutes;
    totalFlights += a.flightCount;
    if (a.flightCount === 0 && a.status === 'ACTIVE') zeroFlight += 1;
  }
  return {
    totalAirframes: airframes.length,
    activeAirframes,
    totalBlockMinutes,
    totalFlights,
    airframesWithZeroFlights: zeroFlight,
  };
}

/** Convert minutes to "h:mm" string. */
export function formatHoursMinutes(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${h}:${m.toString().padStart(2, '0')}`;
}
