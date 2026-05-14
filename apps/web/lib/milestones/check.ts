/**
 * Welle K / K1 — Milestone-Threshold-Checker.
 *
 * Pure-function-helper der prüft ob ein PIREP-approve den pilot über
 * einen flight-hours- oder flight-count-threshold geschoben hat. Wenn
 * ja, returnen wir die liste der gecrossten thresholds — der caller
 * (apps/web/app/pireps/actions.ts) emittet pro threshold ein
 * Milestone-Discord-Event.
 *
 * # Threshold-Listen
 *
 * Bewusst exponential gestaffelt — frühe milestones (10, 25, 50)
 * geben "ich bin angekommen"-feedback, große milestones (5000,
 * 10000) sind echte achievements. Über alle 10 hour-thresholds und
 * 9 flight-thresholds spannt das die typische pilot-career-curve.
 *
 *   Hours:   10, 25, 50, 100, 250, 500, 1000, 2500, 5000, 10000
 *   Flights: 10, 25, 50, 100, 250, 500, 1000, 2500, 5000
 *
 * # Detection-pattern
 *
 * crossingsBetween(prev, current, thresholds) returns alle thresholds
 * die im halb-offenen interval (prev, current] liegen. Ein PIREP der
 * den user von 99h auf 102h bringt crosst HOURS_100 (interval (99, 102]
 * enthält 100). Mehrere thresholds in einem einzigen flight (selten —
 * z.B. ein 50h-flug der gleichzeitig 250 und 500 crossen würde) emitten
 * dann mehrere events, einer pro threshold.
 *
 * # Why pure-function
 *
 * Testbar, idempotent, kein side-effect. Der caller fragt mit
 * (oldHours, newHours) und (oldFlights, newFlights) — die zahlen
 * werden im approve-flow ohnehin berechnet, also keine extra DB-
 * roundtrips.
 */

export const HOUR_MILESTONES = [
  10, 25, 50, 100, 250, 500, 1000, 2500, 5000, 10000,
] as const;

export const FLIGHT_MILESTONES = [
  10, 25, 50, 100, 250, 500, 1000, 2500, 5000,
] as const;

export type MilestoneKind = 'hours' | 'flights';

export type Milestone = {
  kind: MilestoneKind;
  threshold: number;
  /** Human label für discord-embed-title */
  label: string;
};

/**
 * Returnt alle thresholds aus `levels` die im interval (prev, current]
 * liegen (lower-exclusive, upper-inclusive).
 *
 * - prev=99, current=102, levels=[100,250] → [100]
 * - prev=99, current=99,  levels=[100]     → []          (no progress)
 * - prev=99, current=100, levels=[100]     → [100]       (exactly hit)
 * - prev=0,  current=600, levels=[100,500] → [100, 500]  (skipped multi)
 *
 * Used für sowohl hour- als flight-milestones; die threshold-listen
 * sind die einzigen unterschiede.
 */
export function crossingsBetween(
  prev: number,
  current: number,
  levels: readonly number[],
): number[] {
  if (current <= prev) return [];
  return levels.filter((lvl) => prev < lvl && lvl <= current);
}

/**
 * Detect alle milestones die durch einen einzelnen PIREP-approve
 * gecrossst wurden. Returnt array — leer wenn keiner gecrossst.
 *
 * Caller pattern (in apps/web/app/pireps/actions.ts):
 *
 *   const prev = { hours: user.totalFlightHours, flights: user.totalFlights };
 *   // ... approve PIREP, increment user totals ...
 *   const next = { hours: prev.hours + pirep.flightTimeMin/60,
 *                  flights: prev.flights + 1 };
 *   const milestones = detectMilestones(prev, next);
 *   for (const m of milestones) emitMilestoneReached({ userId, ...m });
 */
export function detectMilestones(
  prev: { hours: number; flights: number },
  next: { hours: number; flights: number },
): Milestone[] {
  const result: Milestone[] = [];
  for (const t of crossingsBetween(prev.hours, next.hours, HOUR_MILESTONES)) {
    result.push({
      kind: 'hours',
      threshold: t,
      label: `${t} Flugstunden`,
    });
  }
  for (const t of crossingsBetween(prev.flights, next.flights, FLIGHT_MILESTONES)) {
    result.push({
      kind: 'flights',
      threshold: t,
      label: `${t} Flüge`,
    });
  }
  return result;
}
