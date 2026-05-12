/**
 * Track 5 #9 — Airline Leaderboards.
 *
 * Cross-pilot rankings innerhalb einer airline. Verschiedene boards:
 *
 *   - mostFlights:        rank by total approved PIREPs
 *   - mostHours:          rank by sum(flightTimeMin)
 *   - mostDistance:       rank by sum(route.distanceNm)
 *   - smoothestPilot:     rank by avg(|landingRateFpm|) ascending
 *                         (kleiner = besser)
 *   - mostRecentActivity: rank by last7dFlights (= "wer ist grad aktiv")
 *
 * Pro board returnen wir top 10 mit pilot-summary (id, name, image,
 * rank). Optional: position-of-current-user wenn der nicht in top-10
 * ist (separater "Du bist platz X"-hint im UI).
 *
 * # Filter
 *
 * - status='Approved' (gleicher filter wie career-stats)
 * - airlineId = airline (innerhalb der airline rankings)
 * - smoothestPilot: nur user mit mind. 5 landings damit fresh-pilots
 *   mit einer butter-landung nicht das ranking dominieren
 *
 * # Performance
 *
 * 5 parallele queries pro board. Jedes board macht eine groupBy auf
 * userId + (aggregate or count) + zusätzlich einen user.findMany call
 * für die display-info. Bei einer airline mit 50 pilots: ~10 queries
 * total in <100ms.
 *
 * # Privacy
 *
 * Nur same-airline-viewer sehen leaderboards. Admin-cross-airline-view
 * existiert separat (V2: /admin/leaderboards). V1 ist airline-internal.
 */

import { prisma } from "../index.js";

const APPROVED_FILTER = { status: "Approved" as const };

export type LeaderboardKind =
  | "mostFlights"
  | "mostHours"
  | "mostDistance"
  | "smoothestPilot"
  | "mostRecentActivity";

export type LeaderboardPilotSummary = {
  id: string;
  name: string | null;
  image: string | null;
  rankName: string | null;
};

export type LeaderboardEntry = {
  pilot: LeaderboardPilotSummary;
  /** raw value (e.g. 142 für mostFlights, oder avg-fpm bei smoothestPilot) */
  value: number;
  /** human-readable mit unit */
  displayValue: string;
};

export type AirlineLeaderboards = {
  mostFlights: LeaderboardEntry[];
  mostHours: LeaderboardEntry[];
  mostDistance: LeaderboardEntry[];
  smoothestPilot: LeaderboardEntry[];
  mostRecentActivity: LeaderboardEntry[];
};

const TOP_N = 10;

/**
 * Lädt alle 5 leaderboards für eine airline. Returnt typed objekt
 * mit top-N pilots pro board.
 */
export async function getAirlineLeaderboards(
  airlineId: string,
): Promise<AirlineLeaderboards> {
  const baseWhere = { airlineId, ...APPROVED_FILTER };
  const last7d = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

  // ─── Top 5 parallele groupBys ───
  const [
    flightCounts,
    hoursAgg,
    distRows,
    landingRows,
    recentCounts,
  ] = await Promise.all([
    // mostFlights: count of approved PIREPs per user
    prisma.pirep.groupBy({
      by: ["userId"],
      where: baseWhere,
      _count: { _all: true },
      orderBy: { _count: { id: "desc" } },
      take: TOP_N,
    }),

    // mostHours: sum(flightTimeMin) per user
    prisma.pirep.groupBy({
      by: ["userId"],
      where: { ...baseWhere, flightTimeMin: { not: null } },
      _sum: { flightTimeMin: true },
      orderBy: { _sum: { flightTimeMin: "desc" } },
      take: TOP_N,
    }),

    // mostDistance: per user sum von route.distanceNm.
    // Kein _sum auf joined column in prisma — wir fetchen alle pireps
    // mit route + reduzieren in TS. Bei einer mid-sized airline mit
    // ~5000 approved PIREPs ist das ein paar tausend rows, akzeptabel.
    prisma.pirep.findMany({
      where: { ...baseWhere, routeId: { not: null } },
      select: { userId: true, route: { select: { distanceNm: true } } },
    }),

    // smoothestPilot: fetch alle landing-fpms grouped by user,
    // dann in TS avg(|fpm|) berechnen + filter user mit >=5 landings.
    prisma.pirep.findMany({
      where: { ...baseWhere, landingRateFpm: { not: null } },
      select: { userId: true, landingRateFpm: true },
    }),

    // mostRecentActivity: count of PIREPs in last 7 days per user
    prisma.pirep.groupBy({
      by: ["userId"],
      where: { ...baseWhere, submittedAt: { gte: last7d } },
      _count: { _all: true },
      orderBy: { _count: { id: "desc" } },
      take: TOP_N,
    }),
  ]);

  // ─── User-info für alle distinct user-ids in einer query laden ───
  const userIds = new Set<string>();
  flightCounts.forEach((r) => userIds.add(r.userId));
  hoursAgg.forEach((r) => userIds.add(r.userId));
  distRows.forEach((r) => userIds.add(r.userId));
  landingRows.forEach((r) => userIds.add(r.userId));
  recentCounts.forEach((r) => userIds.add(r.userId));

  const users =
    userIds.size > 0
      ? await prisma.user.findMany({
          where: { id: { in: Array.from(userIds) } },
          select: {
            id: true,
            name: true,
            image: true,
            rank: { select: { name: true } },
          },
        })
      : [];

  const userMap = new Map<string, LeaderboardPilotSummary>(
    users.map((u) => [
      u.id,
      {
        id: u.id,
        name: u.name,
        image: u.image,
        rankName: u.rank?.name ?? null,
      },
    ]),
  );

  function pilotOf(userId: string): LeaderboardPilotSummary {
    return (
      userMap.get(userId) ?? {
        id: userId,
        name: null,
        image: null,
        rankName: null,
      }
    );
  }

  // ─── mostFlights ───
  const mostFlights: LeaderboardEntry[] = flightCounts.map((r) => ({
    pilot: pilotOf(r.userId),
    value: r._count._all,
    displayValue: `${r._count._all.toLocaleString("de-DE")} Flüge`,
  }));

  // ─── mostHours ───
  const mostHours: LeaderboardEntry[] = hoursAgg
    .filter((r) => (r._sum.flightTimeMin ?? 0) > 0)
    .map((r) => {
      const min = r._sum.flightTimeMin ?? 0;
      const hours = Math.round((min / 60) * 10) / 10;
      return {
        pilot: pilotOf(r.userId),
        value: hours,
        displayValue: `${hours.toLocaleString("de-DE")} h`,
      };
    });

  // ─── mostDistance — reduce in TS ───
  const distByUser = new Map<string, number>();
  for (const r of distRows) {
    const cur = distByUser.get(r.userId) ?? 0;
    distByUser.set(r.userId, cur + (r.route?.distanceNm ?? 0));
  }
  const mostDistance: LeaderboardEntry[] = Array.from(distByUser.entries())
    .sort(([, a], [, b]) => b - a)
    .slice(0, TOP_N)
    .map(([userId, nm]) => ({
      pilot: pilotOf(userId),
      value: nm,
      displayValue: `${nm.toLocaleString("de-DE")} nm`,
    }));

  // ─── smoothestPilot — avg(|fpm|) per user, filter >=5 landings ───
  type LandingAgg = { sum: number; count: number };
  const landingByUser = new Map<string, LandingAgg>();
  for (const r of landingRows) {
    if (r.landingRateFpm === null) continue;
    const cur = landingByUser.get(r.userId) ?? { sum: 0, count: 0 };
    cur.sum += Math.abs(r.landingRateFpm);
    cur.count += 1;
    landingByUser.set(r.userId, cur);
  }
  const MIN_LANDINGS_FOR_RANKING = 5;
  const smoothestPilot: LeaderboardEntry[] = Array.from(landingByUser.entries())
    .filter(([, agg]) => agg.count >= MIN_LANDINGS_FOR_RANKING)
    .map(([userId, agg]) => ({
      pilot: pilotOf(userId),
      value: Math.round(agg.sum / agg.count),
      displayValue: `Ø ${Math.round(agg.sum / agg.count)} fpm (n=${agg.count})`,
    }))
    .sort((a, b) => a.value - b.value) // ascending — kleiner = besser
    .slice(0, TOP_N);

  // ─── mostRecentActivity ───
  const mostRecentActivity: LeaderboardEntry[] = recentCounts.map((r) => ({
    pilot: pilotOf(r.userId),
    value: r._count._all,
    displayValue: `${r._count._all.toLocaleString("de-DE")} Flüge (7d)`,
  }));

  return {
    mostFlights,
    mostHours,
    mostDistance,
    smoothestPilot,
    mostRecentActivity,
  };
}
