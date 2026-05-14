/**
 * Welle I / I5 — Comparison-stats aggregator.
 *
 * Liefert 3-way-vergleichszahlen: dieser pilot vs. airline-durchschnitt
 * vs. platform-durchschnitt. Für die /me/comparison page als grouped
 * bar-chart. Vier metriken:
 *
 *   1. Ø Flugzeit pro PIREP (minutes)
 *   2. Ø Flüge pro monat (über die last-12-month window)
 *   3. Ø Landing-rate fpm (negative = smooth)
 *   4. PIREP-approval-rate (%)
 *
 * # Design choices
 *
 * - Airline-durchschnitt nimmt nur die airline des users — wenn der
 *   user keine airline hat, returnen wir 0er-airline-stats und das
 *   UI rendert "—". Auch der user-eigene-anteil wird in der airline-
 *   gemittelung NICHT herausgerechnet (sample-size klein, das mathe-
 *   matische bias ist akademisch).
 *
 * - Platform-durchschnitt = ALLE approved PIREPs system-weit, ohne
 *   filter. Über zigtausende rows ist der user-eigene-anteil sowieso
 *   noise.
 *
 * - Last-12-month window für die "Flüge pro monat"-metrik damit es
 *   konsistent mit der monthly-chart auf /me/stats ist und um early-
 *   adopter-pilots nicht durch ihre legacy-history zu strafen.
 *
 * # Performance
 *
 * 4 parallel aggregates × 3 scopes = 12 queries. Alle covered durch
 * (userId, status) bzw. (airlineId, status) indexes. Sub-200ms erwartet
 * für ein platform mit ~10k pilots × 100 PIREPs each.
 */

import { prisma } from '@vam/db';

export type ComparisonMetric = {
  user: number;
  airline: number;
  platform: number;
};

export type ComparisonStats = {
  avgFlightMinutes: ComparisonMetric;
  flightsPerMonth: ComparisonMetric;
  avgLandingRateFpm: ComparisonMetric;
  /** approval-rate als prozent (0-100, gerundet auf 1 nachkommastelle) */
  approvalRatePct: ComparisonMetric;
  /** total flights für context-display */
  totalFlights: ComparisonMetric;
  /** airline-name + icao für UI-labelling (null wenn user keiner airline) */
  airlineLabel: string | null;
};

/**
 * Get airline-id für den user. Returnt null wenn der user keine
 * airline-zugehörigkeit hat — UI behandelt das als "kein airline-
 * vergleich verfügbar".
 */
async function getUserAirline(
  userId: string,
): Promise<{ airlineId: string; label: string } | null> {
  const u = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      airline: { select: { id: true, icao: true, name: true } },
    },
  });
  if (!u?.airline) return null;
  return {
    airlineId: u.airline.id,
    label: `${u.airline.icao} · ${u.airline.name}`,
  };
}

/**
 * Berechnet alle 4 comparison-metriken in 3 scopes (user/airline/
 * platform) in einem Promise.all-bundle.
 *
 * Window-decision: die "flights per month"-metrik braucht ein
 * fixed-window damit die zahlen vergleichbar sind. Wir nutzen die
 * last 12 months — kürzer wäre noisy, länger würde inaktive
 * legacy-pilots overweighten.
 */
export async function getComparisonStats(
  userId: string,
): Promise<ComparisonStats> {
  const airline = await getUserAirline(userId);

  const now = new Date();
  const windowStart = new Date(now.getFullYear(), now.getMonth() - 11, 1);
  // Inclusive 12-month window: divide by 12 for the per-month rate.
  // (Edge case: für einen brand-new user mit 1 month of PIREPs ist
  // der "per-month"-rate damit deflated. Bewusst — wir vergleichen
  // gleiche windows über alle scopes, das ist fair.)
  const monthsInWindow = 12;

  const [
    userAvg,
    userApproved,
    userTotal,
    userRecent,
    airlineAvg,
    airlineApproved,
    airlineTotal,
    airlineRecent,
    platformAvg,
    platformApproved,
    platformTotal,
    platformRecent,
  ] = await Promise.all([
    // ── USER scope (4 queries) ─────────────────────────────────────
    prisma.pirep.aggregate({
      where: { userId, status: 'Approved' },
      _avg: { flightTimeMin: true, landingRateFpm: true },
      _count: { _all: true },
    }),
    prisma.pirep.count({ where: { userId, status: 'Approved' } }),
    prisma.pirep.count({
      where: { userId, status: { in: ['Approved', 'Rejected'] } },
    }),
    prisma.pirep.count({
      where: {
        userId,
        status: 'Approved',
        submittedAt: { gte: windowStart },
      },
    }),
    // ── AIRLINE scope (4 queries) ──────────────────────────────────
    airline
      ? prisma.pirep.aggregate({
          where: {
            user: { airlineId: airline.airlineId },
            status: 'Approved',
          },
          _avg: { flightTimeMin: true, landingRateFpm: true },
          _count: { _all: true },
        })
      : Promise.resolve({
          _avg: { flightTimeMin: null, landingRateFpm: null },
          _count: { _all: 0 },
        }),
    airline
      ? prisma.pirep.count({
          where: {
            user: { airlineId: airline.airlineId },
            status: 'Approved',
          },
        })
      : Promise.resolve(0),
    airline
      ? prisma.pirep.count({
          where: {
            user: { airlineId: airline.airlineId },
            status: { in: ['Approved', 'Rejected'] },
          },
        })
      : Promise.resolve(0),
    airline
      ? prisma.pirep.count({
          where: {
            user: { airlineId: airline.airlineId },
            status: 'Approved',
            submittedAt: { gte: windowStart },
          },
        })
      : Promise.resolve(0),
    // ── PLATFORM scope (4 queries) ─────────────────────────────────
    prisma.pirep.aggregate({
      where: { status: 'Approved' },
      _avg: { flightTimeMin: true, landingRateFpm: true },
      _count: { _all: true },
    }),
    prisma.pirep.count({ where: { status: 'Approved' } }),
    prisma.pirep.count({
      where: { status: { in: ['Approved', 'Rejected'] } },
    }),
    prisma.pirep.count({
      where: { status: 'Approved', submittedAt: { gte: windowStart } },
    }),
  ]);

  // For airline + platform "per month" rates, we need to divide by
  // the count of pilots (or simply by 1 if it's a "team total") —
  // we choose **PER PILOT** so the user can compare apples-to-apples.
  // i.e. "Du fliegst 8/monat, der durchschnitt deiner airline ist
  // 4/monat" — that's user-vs-other-user, not user-vs-airline-total.
  //
  // To compute per-pilot, we'd need a count of active pilots in each
  // scope. Approximation: count distinct userIds with approved PIREPs
  // in the window. V1 simplification: take the airline's pilots-count
  // and platform's pilots-count from a separate query.

  const [airlinePilots, platformPilots] = await Promise.all([
    airline
      ? prisma.user.count({ where: { airlineId: airline.airlineId } })
      : Promise.resolve(0),
    prisma.user.count(),
  ]);

  // Divide each scope's recent-flight-count by (pilots × months) for
  // the per-pilot-per-month rate. User scope is just /12 since it's
  // already 1-pilot.
  const userPerMonth = userRecent / monthsInWindow;
  const airlinePerMonth =
    airline && airlinePilots > 0
      ? airlineRecent / (airlinePilots * monthsInWindow)
      : 0;
  const platformPerMonth =
    platformPilots > 0
      ? platformRecent / (platformPilots * monthsInWindow)
      : 0;

  // Approval-rate = approved / (approved + rejected). Drafts +
  // Submitted excluded because they're in-flight; only finalized
  // decisions count.
  const approvalRate = (approved: number, total: number): number =>
    total === 0 ? 0 : Math.round((approved / total) * 1000) / 10;

  return {
    avgFlightMinutes: {
      user: Math.round(userAvg._avg.flightTimeMin ?? 0),
      airline: Math.round(airlineAvg._avg.flightTimeMin ?? 0),
      platform: Math.round(platformAvg._avg.flightTimeMin ?? 0),
    },
    flightsPerMonth: {
      user: Math.round(userPerMonth * 10) / 10,
      airline: Math.round(airlinePerMonth * 10) / 10,
      platform: Math.round(platformPerMonth * 10) / 10,
    },
    avgLandingRateFpm: {
      user: Math.round(userAvg._avg.landingRateFpm ?? 0),
      airline: Math.round(airlineAvg._avg.landingRateFpm ?? 0),
      platform: Math.round(platformAvg._avg.landingRateFpm ?? 0),
    },
    approvalRatePct: {
      user: approvalRate(userApproved, userTotal),
      airline: approvalRate(airlineApproved, airlineTotal),
      platform: approvalRate(platformApproved, platformTotal),
    },
    totalFlights: {
      user: userApproved,
      airline: airlineApproved,
      platform: platformApproved,
    },
    airlineLabel: airline?.label ?? null,
  };
}
