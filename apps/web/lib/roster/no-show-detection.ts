/**
 * Track 5 #30 (Section F) — No-Show Detection
 *
 * Pure read-only detection logic. Findet roster-assignments die als
 * potential no-shows zählen — und liefert sie sortiert für die admin-
 * review-queue. Schreibt nichts in die DB; das macht die server-action
 * `markAssignmentsAsNoShow` in /airline/roster/no-shows/actions.ts.
 *
 * # Was zählt als no-show?
 *
 * Eine assignment ist no-show-kandidat wenn ALLE bedingungen erfüllt:
 *   1. status ∈ {ASSIGNED, ACCEPTED} (nicht bereits COMPLETED/CANCELLED/
 *      SWAPPED/NO_SHOW)
 *   2. scheduledFlight.departureTime + estimatedMinutes + GRACE_HOURS
 *      < jetzt (das flight-window ist eindeutig durch)
 *   3. assignment hat keinen verknüpften PIREP (pirepId IS NULL)
 *
 * Die GRACE-period reflektiert reale-airline-praxis: ein flight kann
 * verspätet starten oder der pilot fliegt langsamer als geplant. Wir
 * geben default 4h grace — wenn nach 4h ÜBER der eta noch kein PIREP
 * eingereicht wurde, ist das mit hoher confidence ein no-show.
 *
 * # Was wir NICHT automatisch tun
 *
 * Wir setzen den DB-status NICHT automatisch auf NO_SHOW. Begründung:
 *   - False-positives sind teuer (ein pilot der die PIREP vergessen hat
 *     einzureichen, aber den flight tatsächlich gemacht hat, wird zu
 *     unrecht als no-show markiert → reputation-schaden in
 *     airline-stats).
 *   - Admin-review fängt edge-cases: technische probleme, krankheit,
 *     entschuldigung-policy. Auto-mark würde dem admin die diskretion
 *     nehmen.
 *   - Spätere v2-erweiterung könnte einen cron-job laufen lassen mit
 *     einer LÄNGEREN grace (z.B. 7 tage) der dann automatisch markt —
 *     auf der grundlage dass nach 7 tagen die wahrscheinlichkeit für
 *     legit-late-PIREP gegen null geht.
 *
 * # Stats helper
 *
 * Separat: `getPilotNoShowStats` liefert pro-pilot-aggregate für die
 * /airline/pilots-page und das pilot-public-profile. Verwendet
 * status='NO_SHOW' (also CONFIRMED no-shows, nicht potential ones).
 */

import { prisma } from '@vam/db';

/**
 * Grace-hours nach scheduled-arrival bevor eine assignment als
 * potential-no-show qualifiziert. Default 4h aber config-bar via env.
 *
 * Rationale für 4h: typischer airline-OPS-cycle ist 30min-1h für
 * post-flight (taxi, turnaround, paperwork). 4h gibt comfortable
 * buffer für simulator-issues, debriefing-zeit, oder einfach
 * vergessen-die-PIREP-zu-submitten.
 */
const DEFAULT_GRACE_HOURS = 4;

export type NoShowCandidate = {
  assignmentId: string;
  pilotId: string;
  pilotName: string | null;
  pilotImage: string | null;
  rankName: string | null;
  /** Status der assignment (ASSIGNED oder ACCEPTED). */
  currentStatus: 'ASSIGNED' | 'ACCEPTED';
  scheduledFlightId: string;
  flightNumber: string;
  depIcao: string;
  arrIcao: string;
  departureTime: Date;
  estimatedMinutes: number;
  aircraftTypeIcao: string | null;
  /** Hours seit scheduled-arrival (= seit dep + estimatedMinutes). */
  hoursOverdue: number;
  /** Confidence-level — descriptive bucket für UI-coloring. */
  confidence: 'low' | 'medium' | 'high';
  /** Optional notiz vom rostering-flow. */
  note: string | null;
};

/**
 * Findet alle potential-no-show kandidaten für eine airline.
 *
 * @param airlineId
 * @param graceHours Grace-period nach scheduled-arrival. Default 4h.
 * @param limit Max ergebnisse (default 200 — admins haben selten mehr
 *              aktive backlog als das).
 */
export async function findNoShowCandidates(input: {
  airlineId: string;
  graceHours?: number;
  limit?: number;
}): Promise<NoShowCandidate[]> {
  const graceHours = input.graceHours ?? DEFAULT_GRACE_HOURS;
  const limit = input.limit ?? 200;
  const now = new Date();

  // Cut-off: eine assignment qualifiziert nur wenn ihre scheduled-arrival
  // schon mehr als grace-period in der vergangenheit liegt. Wir können das
  // NICHT clean in einem prisma `where` ausdrücken weil estimatedMinutes
  // pro route variiert. Statt dessen: pre-filter via departureTime
  // (wenn departureTime + 24h grob in der vergangenheit liegt, schauen
  // wir näher hin), und exakt-filter in JS. 24h ist sehr großzügig —
  // selbst trans-pazifik-routes sind unter 20h.
  const veryLooseFilterCutoff = new Date(
    now.getTime() - graceHours * 60 * 60_000,
  );

  const candidates = await prisma.rosterAssignment.findMany({
    where: {
      airlineId: input.airlineId,
      status: { in: ['ASSIGNED', 'ACCEPTED'] },
      pirepId: null,
      scheduledFlight: {
        // departureTime + irgendeine flight-länge < (now - grace).
        // Wir können nicht direkt das im query ausdrücken, also pre-
        // filter auf "departureTime ist vor dem grace-cutoff" — das
        // ist eine notwendige aber nicht hinreichende bedingung.
        departureTime: { lt: veryLooseFilterCutoff },
      },
    },
    select: {
      id: true,
      pilotId: true,
      status: true,
      note: true,
      pilot: {
        select: {
          name: true,
          image: true,
          rank: { select: { name: true } },
        },
      },
      scheduledFlight: {
        select: {
          id: true,
          departureTime: true,
          route: {
            select: {
              flightNumber: true,
              estimatedMinutes: true,
              aircraftTypeIcao: true,
              departure: { select: { icao: true } },
              arrival: { select: { icao: true } },
            },
          },
        },
      },
    },
    orderBy: { scheduledFlight: { departureTime: 'asc' } },
    take: limit,
  });

  // Jetzt JS-side exact-filter: scheduled-arrival + grace < now
  const result: NoShowCandidate[] = [];
  for (const c of candidates) {
    const scheduledArrival = new Date(
      c.scheduledFlight.departureTime.getTime() +
        c.scheduledFlight.route.estimatedMinutes * 60_000,
    );
    const graceDeadline = new Date(
      scheduledArrival.getTime() + graceHours * 60 * 60_000,
    );
    if (graceDeadline >= now) continue; // noch im grace-window

    const hoursOverdue = (now.getTime() - scheduledArrival.getTime()) / (1000 * 60 * 60);

    // Confidence-bucket nach hoursOverdue.
    //   low    = 4h-12h     (grace expired, könnte noch legit late-PIREP sein)
    //   medium = 12h-48h    (sehr unwahrscheinlich noch legit)
    //   high   = >48h       (klar no-show)
    let confidence: NoShowCandidate['confidence'];
    if (hoursOverdue < 12) confidence = 'low';
    else if (hoursOverdue < 48) confidence = 'medium';
    else confidence = 'high';

    // Status muss ASSIGNED oder ACCEPTED sein (DB-where filtert das schon,
    // aber TS verstehts nicht ohne cast — wir wissen es).
    const status = c.status as 'ASSIGNED' | 'ACCEPTED';

    result.push({
      assignmentId: c.id,
      pilotId: c.pilotId,
      pilotName: c.pilot.name,
      pilotImage: c.pilot.image,
      rankName: c.pilot.rank?.name ?? null,
      currentStatus: status,
      scheduledFlightId: c.scheduledFlight.id,
      flightNumber: c.scheduledFlight.route.flightNumber,
      depIcao: c.scheduledFlight.route.departure.icao,
      arrIcao: c.scheduledFlight.route.arrival.icao,
      departureTime: c.scheduledFlight.departureTime,
      estimatedMinutes: c.scheduledFlight.route.estimatedMinutes,
      aircraftTypeIcao: c.scheduledFlight.route.aircraftTypeIcao,
      hoursOverdue,
      confidence,
      note: c.note,
    });
  }

  // Höchste-confidence first (admin will die klaren cases zuerst angehen)
  result.sort((a, b) => b.hoursOverdue - a.hoursOverdue);
  return result;
}

/** Quick count helper für badge-anzeige. */
export async function countNoShowCandidates(input: {
  airlineId: string;
  graceHours?: number;
}): Promise<number> {
  // Wir können das nicht clean in einer count-query machen (selbe
  // estimatedMinutes-problematik). Solution: rufe findNoShowCandidates
  // mit hohem limit auf und zähle. Bei großen airlines könnte das
  // performance-issues geben — aber realistisch sind die meisten
  // VAs unter 100 backlog-assignments.
  const candidates = await findNoShowCandidates({
    airlineId: input.airlineId,
    graceHours: input.graceHours,
    limit: 500,
  });
  return candidates.length;
}

// ─────────────────────────────────────────────────────────────────────
// Confirmed no-show stats
// ─────────────────────────────────────────────────────────────────────

export type PilotNoShowStats = {
  pilotId: string;
  /** Wieviele confirmed no-shows hat der pilot insgesamt. */
  totalNoShows: number;
  /** Wieviele in den letzten 30 tagen. */
  noShowsLast30Days: number;
  /** Wieviele in den letzten 90 tagen. */
  noShowsLast90Days: number;
  /** Wieviele completed assignments hat der pilot insgesamt (für rate). */
  totalCompleted: number;
  /**
   * Reliability-rate (completed / (completed + no_show)) als prozent-zahl
   * 0-100. NULL wenn keine assignments gesamt (kein data).
   */
  reliabilityPct: number | null;
};

/**
 * Per-pilot no-show stats. Genutzt von /airline/pilots (badge), pilot-
 * public-profile, und vom no-show-report.
 *
 * # Performance
 *
 * Eine groupBy-query auf [pilotId, status] — sehr schnell, läuft auf
 * dem existing `[airlineId, status]` index plus prisma's interne
 * sort+aggregat. Bei 100 pilots × 6 status-werte = 600 rows max.
 */
export async function getPilotNoShowStats(input: {
  airlineId: string;
  pilotIds?: string[];
}): Promise<Map<string, PilotNoShowStats>> {
  const where: {
    airlineId: string;
    pilotId?: { in: string[] };
  } = { airlineId: input.airlineId };
  if (input.pilotIds && input.pilotIds.length > 0) {
    where.pilotId = { in: input.pilotIds };
  }

  // Hole alle assignments des airline mit relevant-status, gruppiere
  // dann in JS. Wir könnten 4 separate groupBy machen (NO_SHOW total,
  // NO_SHOW 30d, NO_SHOW 90d, COMPLETED total) aber das wären 4 round-
  // trips. Ein single fetch + JS-aggregat ist hier billiger.
  const now = new Date();
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60_000);
  const ninetyDaysAgo = new Date(now.getTime() - 90 * 24 * 60 * 60_000);

  const rows = await prisma.rosterAssignment.findMany({
    where: {
      ...where,
      status: { in: ['NO_SHOW', 'COMPLETED'] },
    },
    select: {
      pilotId: true,
      status: true,
      updatedAt: true,
    },
  });

  const stats = new Map<string, PilotNoShowStats>();

  // Initialize for all known pilots (so missing pilots return zero)
  if (input.pilotIds) {
    for (const pid of input.pilotIds) {
      stats.set(pid, {
        pilotId: pid,
        totalNoShows: 0,
        noShowsLast30Days: 0,
        noShowsLast90Days: 0,
        totalCompleted: 0,
        reliabilityPct: null,
      });
    }
  }

  for (const r of rows) {
    let entry = stats.get(r.pilotId);
    if (!entry) {
      entry = {
        pilotId: r.pilotId,
        totalNoShows: 0,
        noShowsLast30Days: 0,
        noShowsLast90Days: 0,
        totalCompleted: 0,
        reliabilityPct: null,
      };
      stats.set(r.pilotId, entry);
    }
    if (r.status === 'NO_SHOW') {
      entry.totalNoShows += 1;
      if (r.updatedAt >= thirtyDaysAgo) entry.noShowsLast30Days += 1;
      if (r.updatedAt >= ninetyDaysAgo) entry.noShowsLast90Days += 1;
    } else if (r.status === 'COMPLETED') {
      entry.totalCompleted += 1;
    }
  }

  // Compute reliability rates
  for (const entry of stats.values()) {
    const totalRated = entry.totalCompleted + entry.totalNoShows;
    if (totalRated === 0) {
      entry.reliabilityPct = null;
    } else {
      entry.reliabilityPct = Math.round((entry.totalCompleted / totalRated) * 100);
    }
  }

  return stats;
}
