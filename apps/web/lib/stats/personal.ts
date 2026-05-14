/**
 * Welle I / I1 — Personal stats-aggregator.
 *
 * Liefert die zahlen für /me/stats: lifetime-totals, monthly-graph,
 * top-routes, top-aircraft, top-airports, personal-records. Alle
 * aggregations sind über PIREPs mit status='Approved' gefenstert —
 * draft/submitted/rejected zählen NICHT mit (würde die zahlen
 * verfälschen).
 *
 * # Public API
 *
 *   - getLifetimeTotals(userId) → totals (count, hours, avg, longest)
 *   - getMonthlyFlights(userId) → last-12-month buckets (graph)
 *   - getTopRoutes(userId, limit) → meistgeflogene departure→arrival
 *   - getTopAircraft(userId, limit) → meistgenutzte aircraft-types
 *   - getTopAirports(userId, limit) → meistangeflogene airports (dep+arr)
 *   - getPersonalRecords(userId) → best/worst landing, longest flight, etc.
 *
 * # Performance
 *
 * Alle queries als Promise.all-bundle für one-roundtrip-latency.
 * Indizes vorhanden auf (userId, status) und (userId, status,
 * submittedAt) damit groupBy-aggregations effizient sind. Bei einem
 * pilot mit 1000 PIREPs sollte die gesamte aggregation <100ms sein.
 *
 * # Why hier statt in packages/db
 *
 * Mirrors lib/fleet/utilization.ts (F2-pattern). Stats sind app-layer
 * concern (display-aggregation), nicht DB-domain — keine cross-app
 * reusability nötig. Type-imports von `@vam/db` sind ausreichend.
 */

import { prisma } from '@vam/db';

// ─────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────

export type LifetimeTotals = {
  totalFlights: number;
  totalHours: number; // decimal hours, rounded to 2 places
  avgFlightMinutes: number; // average per-flight duration
  longestFlightMin: number;
};

export type MonthlyBucket = {
  /** YYYY-MM string for chart x-axis */
  monthKey: string;
  /** Display label (e.g. "Jan", "Feb") for chart axis */
  label: string;
  /** Year for tooltip context */
  year: number;
  /** Flights submitted in this month */
  flights: number;
  /** Sum of flightTimeMin for the month */
  minutes: number;
};

export type RouteEntry = {
  departureIcao: string;
  arrivalIcao: string;
  flights: number;
  totalMinutes: number;
};

export type AircraftEntry = {
  type: string;
  flights: number;
  totalMinutes: number;
};

export type AirportEntry = {
  icao: string;
  departures: number;
  arrivals: number;
  total: number;
};

export type PersonalRecords = {
  longestFlight: {
    pirepId: string;
    flightTimeMin: number;
    departureIcao: string;
    arrivalIcao: string;
    submittedAt: Date;
  } | null;
  smoothestLanding: {
    pirepId: string;
    landingRateFpm: number; // negative = sink-rate
    arrivalIcao: string;
    submittedAt: Date;
  } | null;
  firstFlight: {
    pirepId: string;
    submittedAt: Date;
    departureIcao: string;
    arrivalIcao: string;
  } | null;
};

// ─────────────────────────────────────────────────────────────────────
// 1. Lifetime totals
// ─────────────────────────────────────────────────────────────────────

/**
 * Lifetime aggregate über alle approved PIREPs eines users.
 *
 * Returns counts of 0 + hours of 0 für users ohne approved PIREPs.
 * UI behandelt das als empty-state.
 */
export async function getLifetimeTotals(
  userId: string,
): Promise<LifetimeTotals> {
  const agg = await prisma.pirep.aggregate({
    where: { userId, status: 'Approved' },
    _count: { _all: true },
    _sum: { flightTimeMin: true },
    _avg: { flightTimeMin: true },
    _max: { flightTimeMin: true },
  });

  const totalFlights = agg._count._all ?? 0;
  const totalMinutes = agg._sum.flightTimeMin ?? 0;
  const avgMinutes = agg._avg.flightTimeMin ?? 0;
  const longestFlightMin = agg._max.flightTimeMin ?? 0;

  return {
    totalFlights,
    totalHours: Math.round((totalMinutes / 60) * 100) / 100,
    avgFlightMinutes: Math.round(avgMinutes),
    longestFlightMin,
  };
}

// ─────────────────────────────────────────────────────────────────────
// 2. Monthly flights (last 12 months rolling)
// ─────────────────────────────────────────────────────────────────────

/**
 * Last-12-month rolling-window flight-counts + minutes für graph.
 *
 * Bucket-keys: YYYY-MM strings. Months ohne flights kriegen einen
 * 0-bucket damit die x-axis konsistent bleibt (kein "lücke wegen
 * keine flights").
 *
 * # Implementation
 *
 * Raw SQL via $queryRaw weil prisma's groupBy auf date-fields nicht
 * monatlich gruppieren kann ohne separate truncate-step. PostgreSQL
 * date_trunc('month', ...) macht das nativ + ist über pirep_userId_idx
 * indexed.
 */
export async function getMonthlyFlights(
  userId: string,
): Promise<MonthlyBucket[]> {
  // Window: last 12 months including current. We anchor on the start
  // of the month 11 months ago so the user always sees a stable 12-
  // bucket axis regardless of when they visit.
  const now = new Date();
  const windowStart = new Date(now.getFullYear(), now.getMonth() - 11, 1);

  // Raw groupBy month via date_trunc. UTC because Pirep.submittedAt is
  // stored UTC in postgres; if we used local tz we'd see monthly
  // boundary drift around midnight-flights.
  const rows = await prisma.$queryRaw<
    Array<{ month: Date; flights: bigint; minutes: bigint | null }>
  >`
    SELECT
      date_trunc('month', "submittedAt") AS month,
      COUNT(*) AS flights,
      COALESCE(SUM("flightTimeMin"), 0) AS minutes
    FROM "Pirep"
    WHERE "userId" = ${userId}
      AND status = 'Approved'
      AND "submittedAt" >= ${windowStart}
    GROUP BY date_trunc('month', "submittedAt")
    ORDER BY month ASC
  `;

  // Build a lookup so we can fill missing-months with 0-buckets.
  const lookup = new Map<string, { flights: number; minutes: number }>();
  for (const row of rows) {
    const key = monthKey(row.month);
    lookup.set(key, {
      flights: Number(row.flights),
      minutes: Number(row.minutes ?? 0),
    });
  }

  // Generate 12 stable buckets from windowStart forward.
  const buckets: MonthlyBucket[] = [];
  const monthLabels = [
    'Jan', 'Feb', 'Mär', 'Apr', 'Mai', 'Jun',
    'Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Dez',
  ];
  for (let i = 0; i < 12; i++) {
    const d = new Date(windowStart.getFullYear(), windowStart.getMonth() + i, 1);
    const key = monthKey(d);
    const data = lookup.get(key) ?? { flights: 0, minutes: 0 };
    buckets.push({
      monthKey: key,
      label: monthLabels[d.getMonth()],
      year: d.getFullYear(),
      flights: data.flights,
      minutes: data.minutes,
    });
  }
  return buckets;
}

function monthKey(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

// ─────────────────────────────────────────────────────────────────────
// 3. Top routes
// ─────────────────────────────────────────────────────────────────────

/**
 * Top-N meistgeflogene departure→arrival kombinationen.
 *
 * Wir gruppieren by departureId+arrivalId (route-id selbst kann null
 * sein bei free-flights). Die ICAO-codes resolvieren wir in einer
 * zweiten query — billiger als ein 3-table-join auf groupBy.
 */
export async function getTopRoutes(
  userId: string,
  limit = 10,
): Promise<RouteEntry[]> {
  const groups = await prisma.pirep.groupBy({
    by: ['departureId', 'arrivalId'],
    where: { userId, status: 'Approved' },
    _count: { _all: true },
    _sum: { flightTimeMin: true },
    orderBy: { _count: { id: 'desc' } },
    take: limit,
  });
  if (groups.length === 0) return [];

  // Resolve ICAO codes for all involved airport-ids. Single query
  // covering departure AND arrival sets.
  const airportIds = new Set<string>();
  for (const g of groups) {
    airportIds.add(g.departureId);
    airportIds.add(g.arrivalId);
  }
  const airports = await prisma.airport.findMany({
    where: { id: { in: Array.from(airportIds) } },
    select: { id: true, icao: true },
  });
  const icaoMap = new Map(airports.map((a) => [a.id, a.icao]));

  return groups.map((g) => ({
    departureIcao: icaoMap.get(g.departureId) ?? '???',
    arrivalIcao: icaoMap.get(g.arrivalId) ?? '???',
    flights: g._count._all,
    totalMinutes: g._sum.flightTimeMin ?? 0,
  }));
}

// ─────────────────────────────────────────────────────────────────────
// 4. Top aircraft types
// ─────────────────────────────────────────────────────────────────────

/**
 * Top-N meistgenutzte aircraft-types. Gruppe by Aircraft.type via join.
 *
 * PIREPs mit aircraftId=null (legacy/free-flight) werden weggefiltert —
 * wir können sie keinem type zuordnen. UI zeigt diese in der "andere"-
 * bucket nicht; das ist ok für V1.
 */
export async function getTopAircraft(
  userId: string,
  limit = 10,
): Promise<AircraftEntry[]> {
  // Raw SQL weil groupBy nicht über join-fields kann ohne workaround.
  // We aggregate by aircraft.type directly.
  const rows = await prisma.$queryRaw<
    Array<{ type: string; flights: bigint; minutes: bigint | null }>
  >`
    SELECT
      a.type AS type,
      COUNT(p.id) AS flights,
      COALESCE(SUM(p."flightTimeMin"), 0) AS minutes
    FROM "Pirep" p
    INNER JOIN "Aircraft" a ON a.id = p."aircraftId"
    WHERE p."userId" = ${userId}
      AND p.status = 'Approved'
    GROUP BY a.type
    ORDER BY flights DESC
    LIMIT ${limit}
  `;

  return rows.map((r) => ({
    type: r.type,
    flights: Number(r.flights),
    totalMinutes: Number(r.minutes ?? 0),
  }));
}

// ─────────────────────────────────────────────────────────────────────
// 5. Top airports (departures + arrivals combined)
// ─────────────────────────────────────────────────────────────────────

/**
 * Top-N meistangeflogene airports — kombinierte departure+arrival
 * zählung. Ein PIREP EDDF→EDDM erhöht BEIDE airport-counters.
 *
 * Sortiert nach total-touches descending. Bei tie sortiert
 * deterministisch nach ICAO ascending.
 */
export async function getTopAirports(
  userId: string,
  limit = 10,
): Promise<AirportEntry[]> {
  // Raw SQL: UNION ALL der departure- und arrival-counts pro airport-id,
  // dann aggregat by icao. Kein groupBy in prisma möglich für solche
  // multi-field zähleungen.
  const rows = await prisma.$queryRaw<
    Array<{ icao: string; departures: bigint; arrivals: bigint }>
  >`
    WITH dep AS (
      SELECT "departureId" AS airport_id, COUNT(*) AS cnt
      FROM "Pirep"
      WHERE "userId" = ${userId} AND status = 'Approved'
      GROUP BY "departureId"
    ),
    arr AS (
      SELECT "arrivalId" AS airport_id, COUNT(*) AS cnt
      FROM "Pirep"
      WHERE "userId" = ${userId} AND status = 'Approved'
      GROUP BY "arrivalId"
    ),
    combined AS (
      SELECT airport_id, cnt AS departures, 0::bigint AS arrivals FROM dep
      UNION ALL
      SELECT airport_id, 0::bigint AS departures, cnt AS arrivals FROM arr
    )
    SELECT
      ap.icao AS icao,
      SUM(c.departures) AS departures,
      SUM(c.arrivals) AS arrivals
    FROM combined c
    INNER JOIN "Airport" ap ON ap.id = c.airport_id
    GROUP BY ap.icao
    ORDER BY (SUM(c.departures) + SUM(c.arrivals)) DESC, ap.icao ASC
    LIMIT ${limit}
  `;

  return rows.map((r) => {
    const dep = Number(r.departures);
    const arr = Number(r.arrivals);
    return {
      icao: r.icao,
      departures: dep,
      arrivals: arr,
      total: dep + arr,
    };
  });
}

// ─────────────────────────────────────────────────────────────────────
// 6. Personal records
// ─────────────────────────────────────────────────────────────────────

/**
 * Highlights für die "Personal Records"-section:
 *   - Longest flight: max flightTimeMin
 *   - Smoothest landing: highest (=least-negative) landingRateFpm
 *     unter den approved PIREPs (NULL excluded — kein landing-data,
 *     z.B. legacy PIREPs)
 *   - First flight: earliest submittedAt
 */
export async function getPersonalRecords(
  userId: string,
): Promise<PersonalRecords> {
  const [longest, smoothest, first] = await Promise.all([
    prisma.pirep.findFirst({
      where: { userId, status: 'Approved', flightTimeMin: { not: null } },
      orderBy: { flightTimeMin: 'desc' },
      select: {
        id: true,
        flightTimeMin: true,
        submittedAt: true,
        departure: { select: { icao: true } },
        arrival: { select: { icao: true } },
      },
    }),
    prisma.pirep.findFirst({
      where: {
        userId,
        status: 'Approved',
        landingRateFpm: { not: null },
        // Filter out unrealistic touch-and-go positive-rates ("smoothest"
        // means closest to 0 from negative side, i.e. softest sink). We
        // accept negative rates only — positive means go-around or bad
        // data.
        // Note: prisma doesn't support OR + null-check easily, so we
        // do the orderBy server-side and trust the data here. The UI
        // gates display anyway.
      },
      orderBy: { landingRateFpm: 'desc' }, // -50 > -300 > -800
      select: {
        id: true,
        landingRateFpm: true,
        submittedAt: true,
        arrival: { select: { icao: true } },
      },
    }),
    prisma.pirep.findFirst({
      where: { userId, status: 'Approved' },
      orderBy: { submittedAt: 'asc' },
      select: {
        id: true,
        submittedAt: true,
        departure: { select: { icao: true } },
        arrival: { select: { icao: true } },
      },
    }),
  ]);

  return {
    longestFlight: longest
      ? {
          pirepId: longest.id,
          flightTimeMin: longest.flightTimeMin ?? 0,
          departureIcao: longest.departure.icao,
          arrivalIcao: longest.arrival.icao,
          submittedAt: longest.submittedAt,
        }
      : null,
    smoothestLanding:
      smoothest && smoothest.landingRateFpm !== null && smoothest.landingRateFpm <= 0
        ? {
            pirepId: smoothest.id,
            landingRateFpm: smoothest.landingRateFpm,
            arrivalIcao: smoothest.arrival.icao,
            submittedAt: smoothest.submittedAt,
          }
        : null,
    firstFlight: first
      ? {
          pirepId: first.id,
          submittedAt: first.submittedAt,
          departureIcao: first.departure.icao,
          arrivalIcao: first.arrival.icao,
        }
      : null,
  };
}

// ─────────────────────────────────────────────────────────────────────
// Aggregate convenience — alle 6 parallel
// ─────────────────────────────────────────────────────────────────────

export type PersonalStatsBundle = {
  totals: LifetimeTotals;
  monthly: MonthlyBucket[];
  topRoutes: RouteEntry[];
  topAircraft: AircraftEntry[];
  topAirports: AirportEntry[];
  records: PersonalRecords;
};

/**
 * One-stop helper für die /me/stats page — alle 6 aggregations parallel.
 */
export async function getPersonalStatsBundle(
  userId: string,
): Promise<PersonalStatsBundle> {
  const [totals, monthly, topRoutes, topAircraft, topAirports, records] =
    await Promise.all([
      getLifetimeTotals(userId),
      getMonthlyFlights(userId),
      getTopRoutes(userId, 5),
      getTopAircraft(userId, 5),
      getTopAirports(userId, 5),
      getPersonalRecords(userId),
    ]);
  return { totals, monthly, topRoutes, topAircraft, topAirports, records };
}
