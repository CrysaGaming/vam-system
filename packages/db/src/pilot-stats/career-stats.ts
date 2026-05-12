/**
 * Track 5 #6 — Pilot Career Stats aggregation.
 *
 * One DB-roundtrip-per-stat would be wasteful — wir laufen ein paar
 * groupBy/aggregate-queries parallel und reduzieren in TS. Bei einem
 * pilot mit 500 PIREPs ist das alles im sub-100ms-bereich.
 *
 * # Welche stats?
 *
 * Career-totals (lifetime):
 *   - totalFlights        Anzahl approved PIREPs
 *   - totalHours          sum(flightTimeMin) / 60 (h.hh)
 *   - totalDistanceNm     sum(route.distanceNm) wenn route gebunden
 *   - totalFuelKg         sum(fuelUsedKg)
 *   - totalPassengers     sum(passengerCount)
 *
 * Per-period:
 *   - last30dFlights / last30dHours
 *   - last7dFlights  / last7dHours
 *
 * Landings-quality:
 *   - avgLandingFpm       mean(abs(landingRateFpm)) für ACARS-PIREPs
 *   - bestLandingFpm      min(abs(landingRateFpm)) — smoothest
 *   - hardLandingCount    count(abs(landingRateFpm) > 600)
 *
 * Aircraft breakdown:
 *   - top 5 aircraft.type by hours
 *
 * Route breakdown:
 *   - top 5 (dep,arr) pairs by count
 *
 * Network split:
 *   - VATSIM / IVAO / Offline counts
 *
 * # Filter: nur Approved PIREPs
 *
 * Stats sind "career achievements" — Drafts und Submitted (pending) PIREPs
 * zählen nicht. Wenn pilot zwei PIREPs eingereicht hat aber nur einer
 * approved ist, zeigen wir 1 flight. Rejected zählt auch nicht.
 *
 * # Performance
 *
 * 5 parallele queries: aggregate-counters, recent-windows, landing-stats,
 * aircraft-groupBy, route-groupBy. groupBy auf (userId, status='Approved')
 * filter ist indexed → fast.
 */

import { prisma } from "../index.js";

export type AircraftTypeStat = {
  type: string;
  flights: number;
  hours: number;
};

export type RoutePairStat = {
  departureIcao: string;
  arrivalIcao: string;
  count: number;
};

export type PilotCareerStats = {
  totalFlights: number;
  totalHours: number;
  totalDistanceNm: number;
  totalFuelKg: number;
  totalPassengers: number;

  last30dFlights: number;
  last30dHours: number;
  last7dFlights: number;
  last7dHours: number;

  /** mean absolute landing rate, fpm. null wenn keine PIREPs mit fpm-data */
  avgLandingFpm: number | null;
  /** smoothest touchdown ever (smallest abs(fpm)). null wenn keine data */
  bestLandingFpm: number | null;
  /** count of PIREPs with abs(fpm) > 600 (hard/severe per industry bands) */
  hardLandingCount: number;

  /** top 5 aircraft types by hours */
  aircraftBreakdown: AircraftTypeStat[];
  /** top 5 route pairs by count */
  topRoutes: RoutePairStat[];

  /** network-split counts */
  networkSplit: {
    VATSIM: number;
    IVAO: number;
    Offline: number;
  };

  /**
   * Recent monthly buckets — last 12 calendar-months. Each entry has
   * `monthKey` (YYYY-MM), `flights`, `hours`. Used for trend-charts.
   * Empty months get 0/0 entries so the chart-x-axis is dense.
   */
  monthlyTrend: Array<{
    monthKey: string;
    flights: number;
    hours: number;
  }>;
};

const APPROVED_FILTER = { status: "Approved" as const };

export async function getPilotCareerStats(
  userId: string,
): Promise<PilotCareerStats> {
  const now = new Date();
  const d30 = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  const d7 = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  // 12-month-window für trend-chart. Wir starten am 1. des monats vor
  // 11 monaten damit der erste bucket ein voller monat ist.
  const trendStart = new Date(now.getFullYear(), now.getMonth() - 11, 1);

  const baseWhere = { userId, ...APPROVED_FILTER };

  // ─── Parallel queries ───
  const [
    totalsAgg,
    last30dAgg,
    last7dAgg,
    landingAgg,
    bestLanding,
    hardLandingCount,
    aircraftGroup,
    routeGroup,
    networkGroup,
    trendPireps,
  ] = await Promise.all([
    // ── totals (count + flight-time + fuel + pax)
    prisma.pirep.aggregate({
      where: baseWhere,
      _count: { _all: true },
      _sum: {
        flightTimeMin: true,
        fuelUsedKg: true,
        passengerCount: true,
      },
    }),

    // ── last 30d window
    prisma.pirep.aggregate({
      where: { ...baseWhere, submittedAt: { gte: d30 } },
      _count: { _all: true },
      _sum: { flightTimeMin: true },
    }),

    // ── last 7d window
    prisma.pirep.aggregate({
      where: { ...baseWhere, submittedAt: { gte: d7 } },
      _count: { _all: true },
      _sum: { flightTimeMin: true },
    }),

    // ── avg landing fpm. Prisma kann keine abs() aggregations server-side,
    //    daher fetchen wir die werte und reduzieren in TS. Limit ist
    //    implizit durch userId-filter — pro pilot meist <500 PIREPs.
    //    Bei einem 10000-PIREPs-pilot würde das schwer; dann müsste
    //    eine raw-query mit ABS() ran. V1 reicht.
    prisma.pirep.findMany({
      where: {
        ...baseWhere,
        landingRateFpm: { not: null },
      },
      select: { landingRateFpm: true },
    }),

    // ── best (smoothest) landing — bei MAX null-handling tricky.
    //    Wir fetchen oben die liste eh, hier nur placeholder; computed below.
    Promise.resolve(null),

    // ── hard-landings count (abs > 600). Kein abs() in prisma, daher
    //    zweimal-OR-bedingung.
    prisma.pirep.count({
      where: {
        ...baseWhere,
        OR: [
          { landingRateFpm: { lt: -600 } },
          { landingRateFpm: { gt: 600 } },
        ],
      },
    }),

    // ── aircraft-breakdown. groupBy on aircraftId + _sum-flightTimeMin.
    //    Nachher join auf Aircraft.type in TS.
    prisma.pirep.groupBy({
      by: ["aircraftId"],
      where: { ...baseWhere, aircraftId: { not: null } },
      _count: { _all: true },
      _sum: { flightTimeMin: true },
    }),

    // ── route-breakdown. groupBy on (departureId, arrivalId).
    prisma.pirep.groupBy({
      by: ["departureId", "arrivalId"],
      where: baseWhere,
      _count: { _all: true },
      orderBy: { _count: { id: "desc" } },
      take: 5,
    }),

    // ── network split
    prisma.pirep.groupBy({
      by: ["network"],
      where: baseWhere,
      _count: { _all: true },
    }),

    // ── monthly-trend: alle PIREPs der letzten 12 monate. Wir bucketsetzen
    //    in TS damit es portabel über mysql/pg/sqlite bleibt (DATE_TRUNC
    //    syntax variiert per dialect).
    prisma.pirep.findMany({
      where: {
        ...baseWhere,
        submittedAt: { gte: trendStart },
      },
      select: { submittedAt: true, flightTimeMin: true },
    }),
  ]);

  // ─── totals ───
  const totalFlights = totalsAgg._count._all;
  const totalHoursMin = totalsAgg._sum.flightTimeMin ?? 0;
  const totalFuelKg = totalsAgg._sum.fuelUsedKg ?? 0;
  const totalPassengers = totalsAgg._sum.passengerCount ?? 0;

  // ─── total distance — extra query (route-distance via join).
  //     Kein _sum auf joined-field in prisma → eigene aggregate-query.
  const distAgg = await prisma.pirep.findMany({
    where: { ...baseWhere, routeId: { not: null } },
    select: { route: { select: { distanceNm: true } } },
  });
  const totalDistanceNm = distAgg.reduce(
    (sum, p) => sum + (p.route?.distanceNm ?? 0),
    0,
  );

  // ─── landing-stats from in-memory list ───
  const fpms = landingAgg
    .map((p) => p.landingRateFpm)
    .filter((v): v is number => v !== null)
    .map((v) => Math.abs(v));
  const avgLandingFpm =
    fpms.length > 0
      ? Math.round(fpms.reduce((s, v) => s + v, 0) / fpms.length)
      : null;
  const bestLandingFpm = fpms.length > 0 ? Math.min(...fpms) : null;

  // ─── aircraft breakdown — resolve aircraftId → type, top 5 by hours ───
  const aircraftIds = aircraftGroup
    .map((g) => g.aircraftId)
    .filter((v): v is string => v !== null);
  const aircraft = await prisma.aircraft.findMany({
    where: { id: { in: aircraftIds } },
    select: { id: true, type: true },
  });
  const idToType = new Map(aircraft.map((a) => [a.id, a.type]));
  // Gruppieren by-type (mehrere airframes können gleichen type haben)
  const typeTotals = new Map<string, { flights: number; minutes: number }>();
  for (const g of aircraftGroup) {
    const type = g.aircraftId ? idToType.get(g.aircraftId) : null;
    if (!type) continue;
    const prev = typeTotals.get(type) ?? { flights: 0, minutes: 0 };
    typeTotals.set(type, {
      flights: prev.flights + g._count._all,
      minutes: prev.minutes + (g._sum.flightTimeMin ?? 0),
    });
  }
  const aircraftBreakdown: AircraftTypeStat[] = Array.from(typeTotals.entries())
    .map(([type, v]) => ({
      type,
      flights: v.flights,
      hours: Math.round((v.minutes / 60) * 10) / 10,
    }))
    .sort((a, b) => b.hours - a.hours)
    .slice(0, 5);

  // ─── route breakdown — resolve airport-ids to ICAO ───
  const airportIds = new Set<string>();
  for (const g of routeGroup) {
    airportIds.add(g.departureId);
    airportIds.add(g.arrivalId);
  }
  const airports = await prisma.airport.findMany({
    where: { id: { in: Array.from(airportIds) } },
    select: { id: true, icao: true },
  });
  const idToIcao = new Map(airports.map((a) => [a.id, a.icao]));
  const topRoutes: RoutePairStat[] = routeGroup.map((g) => ({
    departureIcao: idToIcao.get(g.departureId) ?? "????",
    arrivalIcao: idToIcao.get(g.arrivalId) ?? "????",
    count: g._count._all,
  }));

  // ─── network split ───
  const networkSplit = { VATSIM: 0, IVAO: 0, Offline: 0 };
  for (const g of networkGroup) {
    if (g.network in networkSplit) {
      networkSplit[g.network as keyof typeof networkSplit] = g._count._all;
    }
  }

  // ─── monthly trend bucketing ───
  // Build empty 12-month skeleton
  const buckets = new Map<string, { flights: number; minutes: number }>();
  for (let i = 11; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    buckets.set(key, { flights: 0, minutes: 0 });
  }
  for (const p of trendPireps) {
    const d = p.submittedAt;
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    const cur = buckets.get(key);
    if (!cur) continue; // outside window
    cur.flights += 1;
    cur.minutes += p.flightTimeMin ?? 0;
  }
  const monthlyTrend = Array.from(buckets.entries()).map(([monthKey, v]) => ({
    monthKey,
    flights: v.flights,
    hours: Math.round((v.minutes / 60) * 10) / 10,
  }));

  return {
    totalFlights,
    totalHours: Math.round((totalHoursMin / 60) * 10) / 10,
    totalDistanceNm,
    totalFuelKg,
    totalPassengers,
    last30dFlights: last30dAgg._count._all,
    last30dHours: Math.round(((last30dAgg._sum.flightTimeMin ?? 0) / 60) * 10) / 10,
    last7dFlights: last7dAgg._count._all,
    last7dHours: Math.round(((last7dAgg._sum.flightTimeMin ?? 0) / 60) * 10) / 10,
    avgLandingFpm,
    bestLandingFpm,
    hardLandingCount,
    aircraftBreakdown,
    topRoutes,
    networkSplit,
    monthlyTrend,
  };
}
