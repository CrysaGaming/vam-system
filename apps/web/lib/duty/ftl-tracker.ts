import 'server-only';

/**
 * Welle P / P2 — Pilot duty-time / fatigue tracker.
 *
 * Computes rolling flight-hour totals for a pilot over the last
 * 24h, 7d, and 28d windows, and classifies the result into a
 * traffic-light advisory: OK → CAUTION → REST_RECOMMENDED.
 *
 * # Why pure aggregation (no schema)
 *
 * EASA Part-FTL real-world rules track "duty time" (sign-in to
 * sign-off of a shift) separately from "flight time" (block-off to
 * block-on). For a VA/sim context that distinction adds complexity
 * without value — pilots fly when they feel like it, not on duty
 * shifts. We collapse the model to "flight time" only, derived
 * directly from approved PIREP `flightTimeMin` summed within the
 * window. No new table, no schema migration, no double-bookkeeping.
 *
 * # Why not on the DRAFT side too
 *
 * Filed-but-not-approved PIREPs are excluded by design. A pilot
 * stuck in DRAFT (24h+ before submitting) would otherwise see
 * stale-low duty hours; aggregating from Approved keeps the read
 * consistent with how everything else in the system counts time.
 *
 * # Limits
 *
 * Softened from real EASA values to fit casual sim use:
 *
 *   Last 24h:  CAUTION ≥ 8h   · REST_RECOMMENDED ≥ 13h
 *   Last 7d:   CAUTION ≥ 25h  · REST_RECOMMENDED ≥ 40h
 *   Last 28d:  CAUTION ≥ 80h  · REST_RECOMMENDED ≥ 120h
 *
 * Plus a hard rest-recommended rule: < 8h since last block-on
 * triggers REST_RECOMMENDED regardless of cumulative totals (the
 * "you just got off a long flight" check).
 *
 * The advisory is the WORST classification across all four checks
 * — one window in REST_RECOMMENDED puts the whole pilot there.
 *
 * # No hard block
 *
 * v1 is advisory-only. UIs render a banner / dashboard chip; nothing
 * prevents the pilot from filing more bookings. Reasonable middle
 * ground: real airlines need hard blocks because pilots get tired
 * for real; sim pilots are fine. v2 could add an airline-policy
 * flag to enable hard-block enforcement per airline.
 */

import { prisma } from '@vam/db';

export type DutyAdvisory = 'OK' | 'CAUTION' | 'REST_RECOMMENDED';

export type DutyWindowStats = {
  hours: number;
  threshold: { caution: number; rest: number };
  classification: DutyAdvisory;
};

export type DutyStatus = {
  /** Worst classification across all four checks. */
  overall: DutyAdvisory;
  last24h: DutyWindowStats;
  last7d: DutyWindowStats;
  last28d: DutyWindowStats;
  /** Hours since the most recent approved PIREP's submittedAt. null if
   *  the pilot has never filed a PIREP. */
  hoursSinceLastFlight: number | null;
  /** Reasons that pushed the overall advisory off OK. Empty when OK. */
  reasons: string[];
};

// ─── Threshold tuning ──────────────────────────────────────
// Adjust here if airlines want airline-scoped overrides later
// (would become an Airline.dutyPolicy JSON column).
const THRESHOLDS = {
  last24h: { caution: 8, rest: 13 },
  last7d: { caution: 25, rest: 40 },
  last28d: { caution: 80, rest: 120 },
  // Minimum rest after a "long" flight before next launch. Sim users
  // can ignore this freely, but the badge appears so they at least
  // see it.
  minRestAfterLongFlightHours: 8,
  longFlightHours: 6,
} as const;

function classify(
  hours: number,
  threshold: { caution: number; rest: number },
): DutyAdvisory {
  if (hours >= threshold.rest) return 'REST_RECOMMENDED';
  if (hours >= threshold.caution) return 'CAUTION';
  return 'OK';
}

function worst(a: DutyAdvisory, b: DutyAdvisory): DutyAdvisory {
  if (a === 'REST_RECOMMENDED' || b === 'REST_RECOMMENDED')
    return 'REST_RECOMMENDED';
  if (a === 'CAUTION' || b === 'CAUTION') return 'CAUTION';
  return 'OK';
}

export async function getPilotDutyStatus(
  userId: string,
): Promise<DutyStatus> {
  const now = Date.now();
  const cutoff24h = new Date(now - 24 * 60 * 60 * 1000);
  const cutoff7d = new Date(now - 7 * 24 * 60 * 60 * 1000);
  const cutoff28d = new Date(now - 28 * 24 * 60 * 60 * 1000);

  // Three aggregates in parallel. Each sums approved PIREPs by the
  // submittedAt timestamp (closer to "when the flight ended" than
  // createdAt, which for auto-PIREPs == flight-end and for manual
  // PIREPs == filing-time, both reasonable).
  //
  // Plus one findFirst for the most-recent-flight timestamp.
  const [agg24, agg7, agg28, lastFlight] = await Promise.all([
    prisma.pirep.aggregate({
      where: { userId, status: 'Approved', submittedAt: { gte: cutoff24h } },
      _sum: { flightTimeMin: true },
    }),
    prisma.pirep.aggregate({
      where: { userId, status: 'Approved', submittedAt: { gte: cutoff7d } },
      _sum: { flightTimeMin: true },
    }),
    prisma.pirep.aggregate({
      where: { userId, status: 'Approved', submittedAt: { gte: cutoff28d } },
      _sum: { flightTimeMin: true },
    }),
    prisma.pirep.findFirst({
      where: { userId, status: 'Approved' },
      orderBy: { submittedAt: 'desc' },
      select: { submittedAt: true, flightTimeMin: true },
    }),
  ]);

  const hours24 = (agg24._sum.flightTimeMin ?? 0) / 60;
  const hours7 = (agg7._sum.flightTimeMin ?? 0) / 60;
  const hours28 = (agg28._sum.flightTimeMin ?? 0) / 60;

  const last24h: DutyWindowStats = {
    hours: hours24,
    threshold: THRESHOLDS.last24h,
    classification: classify(hours24, THRESHOLDS.last24h),
  };
  const last7d: DutyWindowStats = {
    hours: hours7,
    threshold: THRESHOLDS.last7d,
    classification: classify(hours7, THRESHOLDS.last7d),
  };
  const last28d: DutyWindowStats = {
    hours: hours28,
    threshold: THRESHOLDS.last28d,
    classification: classify(hours28, THRESHOLDS.last28d),
  };

  // Rest-after-long-flight check. If the most recent flight was a
  // long one AND we're inside the minimum-rest window, flag.
  const hoursSinceLastFlight = lastFlight?.submittedAt
    ? (now - lastFlight.submittedAt.getTime()) / (60 * 60 * 1000)
    : null;
  const lastFlightHours = lastFlight?.flightTimeMin
    ? lastFlight.flightTimeMin / 60
    : 0;
  const recentLongFlight =
    lastFlightHours >= THRESHOLDS.longFlightHours &&
    hoursSinceLastFlight !== null &&
    hoursSinceLastFlight < THRESHOLDS.minRestAfterLongFlightHours;

  const reasons: string[] = [];
  let overall: DutyAdvisory = 'OK';

  overall = worst(overall, last24h.classification);
  overall = worst(overall, last7d.classification);
  overall = worst(overall, last28d.classification);
  if (recentLongFlight) {
    overall = worst(overall, 'REST_RECOMMENDED');
    reasons.push(
      `Letzter flug war ${lastFlightHours.toFixed(1)}h — empfohlen ${THRESHOLDS.minRestAfterLongFlightHours}h pause vor dem nächsten.`,
    );
  }

  // Window-specific reason lines. We only add the strongest one per
  // window to avoid overwhelming the dashboard card.
  if (last24h.classification !== 'OK') {
    reasons.push(
      `${hours24.toFixed(1)}h in den letzten 24h (caution ${THRESHOLDS.last24h.caution}h · rest ${THRESHOLDS.last24h.rest}h).`,
    );
  }
  if (last7d.classification !== 'OK') {
    reasons.push(
      `${hours7.toFixed(1)}h in den letzten 7 tagen (caution ${THRESHOLDS.last7d.caution}h · rest ${THRESHOLDS.last7d.rest}h).`,
    );
  }
  if (last28d.classification !== 'OK') {
    reasons.push(
      `${hours28.toFixed(1)}h in den letzten 28 tagen (caution ${THRESHOLDS.last28d.caution}h · rest ${THRESHOLDS.last28d.rest}h).`,
    );
  }

  return {
    overall,
    last24h,
    last7d,
    last28d,
    hoursSinceLastFlight,
    reasons,
  };
}

// ─── Display helpers (server + client) ──────────────────────

export function advisoryBadgeStyle(advisory: DutyAdvisory): {
  bg: string;
  text: string;
  label: string;
  emoji: string;
} {
  switch (advisory) {
    case 'OK':
      return {
        bg: 'bg-emerald-100 dark:bg-emerald-900/40',
        text: 'text-emerald-800 dark:text-emerald-200',
        label: 'Fit zum fliegen',
        emoji: '✅',
      };
    case 'CAUTION':
      return {
        bg: 'bg-amber-100 dark:bg-amber-900/40',
        text: 'text-amber-800 dark:text-amber-200',
        label: 'Caution',
        emoji: '⚠️',
      };
    case 'REST_RECOMMENDED':
      return {
        bg: 'bg-rose-100 dark:bg-rose-900/40',
        text: 'text-rose-800 dark:text-rose-200',
        label: 'Pause empfohlen',
        emoji: '😴',
      };
  }
}
