/**
 * Track 5 #28 (Section F) — Auto-Rostering Algorithm
 *
 * Generiert vorschläge "wer fliegt wann" anhand fairness-rotation und
 * eligibility-filterung. Pure read-only — gibt ein preview-result zurück
 * das die UI dem admin zeigt, BEVOR irgendwas committed wird. Der commit
 * läuft dann über `createRosterAssignments` aus #27 (mit
 * `source: 'auto'` im audit-log).
 *
 * # Algorithmus (greedy round-robin mit fairness-weights)
 *
 * Für jeden flight (chronologisch sortiert):
 *   1. Kandidaten-pool = alle pilots in der pilot-filter-liste, die
 *      `checkRosterEligibility` als ok=true zurückgibt (keine errors,
 *      keine soft-warnings — wir sind im auto-modus konservativ).
 *   2. Sortiere kandidaten nach fairness-score (ascending = niedrigster
 *      score zuerst). Score wird aus 3 metriken aggregiert:
 *         a) Active-assignments des pilots in der target-period
 *            (gewicht: +10 pro assignment — der dominante faktor)
 *         b) Total-assignments lifetime (gewicht: +0.5 pro assignment
 *            — leichter tiebreaker für historisch-low pilots)
 *         c) Recent-PIREP-count letzte 30 tage (gewicht: -1 pro PIREP
 *            — wer fliegt, kriegt nochmal — ungekehrtes "aktivitäts-
 *            bonus", aber schwach genug dass es a) nicht überschreibt)
 *   3. Pick top kandidat (= niedrigster score). Wenn keine kandidaten
 *      bleiben (alle haben eligibility-issues) → markiere flight als
 *      "unassignable" mit reason. Sonst weise zu — und increment den
 *      tally für diesen pilot, sodass nächste iteration ihn weiter
 *      unten in der sortierung sieht.
 *   4. Fortfahren bis alle flights verarbeitet sind.
 *
 * # Was NICHT gemacht wird (MVP-scope)
 *
 *   - Multi-pilot-per-flight (captain + FO + crew). Auto-rosters einen
 *     pilot pro flight. Co-pilot-rostering wäre eine erweiterung die
 *     einen "role" parameter in der RosterAssignment bräuchte (haben
 *     wir nicht). Manual creator (#27) erlaubt mehrere zuweisungen
 *     trotz @@unique([pilotId, scheduledFlightId]) weil das nur den
 *     SELBEN pilot doppelt blockt.
 *   - Aircraft-rotation (welche tail-number fliegt welche route).
 *     Wir lassen assignedAircraftId NULL, ScheduledFlight.preferred-
 *     Aircraft greift oder pilot wählt selbst.
 *   - Crew-duty-time/rest-period constraints (EASA/FAR). Idee #6
 *     aus den 50 optionen, würde eine eigene scheduling-engine
 *     bedeuten.
 *   - Optimization für minimum deadheading (pilot endet abends in
 *     EDDF, sollte nächsten morgen nicht in EDDM starten müssen).
 *     Auch zu komplex für MVP.
 *
 * # Performance
 *
 * O(flights × eligible-pilots × eligibility-check-cost). Eligibility-
 * check macht 2-3 DB-roundtrips pro call (pilot/flight lookup,
 * canPilotFlyAircraft, conflict-scan). Bei 50 flights × 10 pilots ×
 * 3 queries = 1500 queries. Akzeptabel für preview-flows (admin
 * wartet ein paar sekunden), aber NICHT für hot-paths.
 *
 * Für scale später: man könnte (a) eligibility-check batchen — alle
 * licenses + type-ratings einmalig fetchen, (b) den conflict-scan
 * gegen unseren in-memory "tally" laufen lassen statt jedes mal die
 * DB zu fragen. Reserviert für #28-v2 wenn admins mit 100+ flights
 * arbeiten wollen.
 */

import { prisma } from '@vam/db';
import {
  checkRosterEligibility,
  type EligibilityIssue,
} from '@/lib/roster/eligibility';

export type AutoRosterInput = {
  airlineId: string;
  /** ISO date strings; inclusive both sides. */
  fromDate: string;
  toDate: string;
  /** Wenn leer → ALLE ACTIVE pilots. Wenn gefüllt → nur diese. */
  pilotIdsWhitelist?: string[];
  /** Pilots die ausgeschlossen sind (urlaub, krank, etc). */
  pilotIdsBlacklist?: string[];
  /** Max flights pro pilot in dieser generation (default: kein cap). */
  maxFlightsPerPilot?: number;
};

export type AutoRosterCandidate = {
  pilotId: string;
  pilotName: string | null;
  rankName: string | null;
  totalFlightHours: number;
  /** Fairness-score (niedriger = bevorzugt). */
  fairnessScore: number;
  /** Welche soft-warnings bei dem kandidat auftreten würden. */
  warnings: EligibilityIssue[];
};

export type AutoRosterAssignmentProposal = {
  scheduledFlightId: string;
  flightNumber: string;
  departureTime: string; // ISO
  depIcao: string;
  arrIcao: string;
  aircraftTypeIcao: string | null;
  /** Gewählter pilot (null wenn unassignable). */
  pickedPilotId: string | null;
  pickedPilotName: string | null;
  /** Alle eligible kandidaten in fairness-order (für admin-review). */
  candidates: AutoRosterCandidate[];
  /** Wenn pickedPilotId=null, der grund. */
  unassignableReason?: string;
};

export type AutoRosterPreview = {
  proposals: AutoRosterAssignmentProposal[];
  /** Aggregat über die proposals: wieviele assignments pro pilot. */
  perPilotCounts: Array<{
    pilotId: string;
    pilotName: string | null;
    assignmentCount: number;
  }>;
  /** Wie viele flights konnten nicht zugewiesen werden? */
  unassignableCount: number;
};

/**
 * Generiert eine preview ohne irgendwas in die DB zu schreiben.
 *
 * Workflow:
 *   1. Lade alle eligible-pool-pilots (ACTIVE, in whitelist falls
 *      angegeben, NOT in blacklist).
 *   2. Lade alle ScheduledFlights im date-range mit status=Planned.
 *   3. Initialisiere tally Map<pilotId, count> auf 0.
 *   4. Sortiere flights chronologisch.
 *   5. Pro flight: hole eligible candidates (eligibility-check),
 *      sortiere by fairness-score, pick top, increment tally.
 *   6. Wenn maxFlightsPerPilot gesetzt und tally erreicht ist, fall
 *      der pilot raus für weitere flights.
 *
 * Returnt AutoRosterPreview mit allen proposals (auch unassignable
 * ones) und aggregat-counts. Admin entscheidet im UI welche er
 * commitet via createRosterAssignments mit `source: 'auto'`.
 */
export async function generateAutoRosterPreview(
  input: AutoRosterInput,
): Promise<AutoRosterPreview> {
  const fromDate = new Date(input.fromDate);
  const toDate = new Date(input.toDate);

  // ─── 1. Pilot-pool ───
  const pilotWhereClause: {
    airlineId: string;
    employmentStatus: 'ACTIVE';
    id?: { in?: string[]; notIn?: string[] };
  } = {
    airlineId: input.airlineId,
    employmentStatus: 'ACTIVE',
  };
  if (input.pilotIdsWhitelist && input.pilotIdsWhitelist.length > 0) {
    pilotWhereClause.id = { in: input.pilotIdsWhitelist };
  }
  if (input.pilotIdsBlacklist && input.pilotIdsBlacklist.length > 0) {
    // Merge with whitelist if both set (id.in AND id.notIn).
    pilotWhereClause.id = {
      ...(pilotWhereClause.id ?? {}),
      notIn: input.pilotIdsBlacklist,
    };
  }

  const pilots = await prisma.user.findMany({
    where: pilotWhereClause,
    select: {
      id: true,
      name: true,
      totalFlights: true,
      totalFlightHours: true,
      rank: { select: { name: true } },
    },
  });

  if (pilots.length === 0) {
    return {
      proposals: [],
      perPilotCounts: [],
      unassignableCount: 0,
    };
  }

  // ─── 2. Lade pre-existing assignment-counts in der target-period ───
  // Damit fairness-score reflektiert was BEREITS in der window für
  // den pilot existiert (manuelle assignments vorher + andere generations
  // die committed wurden). Wir wollen nicht einen pilot der schon 5x
  // diese woche dran ist nochmal picken.
  const existingAssignments = await prisma.rosterAssignment.findMany({
    where: {
      airlineId: input.airlineId,
      pilotId: { in: pilots.map((p) => p.id) },
      status: { in: ['ASSIGNED', 'ACCEPTED'] },
      scheduledFlight: {
        departureTime: { gte: fromDate, lte: toDate },
      },
    },
    select: { pilotId: true },
  });

  const existingTally = new Map<string, number>();
  for (const a of existingAssignments) {
    existingTally.set(a.pilotId, (existingTally.get(a.pilotId) ?? 0) + 1);
  }

  // ─── 3. Lade recent-PIREP-counts (letzte 30 tage, dieser airline) ───
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60_000);
  const recentPireps = await prisma.pirep.groupBy({
    by: ['userId'],
    where: {
      userId: { in: pilots.map((p) => p.id) },
      airlineId: input.airlineId,
      status: 'Approved',
      submittedAt: { gte: thirtyDaysAgo },
    },
    _count: { _all: true },
  });

  const recentPirepTally = new Map<string, number>();
  for (const r of recentPireps) {
    recentPirepTally.set(r.userId, r._count._all);
  }

  // ─── 4. Flights im target-window ───
  const flights = await prisma.scheduledFlight.findMany({
    where: {
      airlineId: input.airlineId,
      status: 'Planned',
      departureTime: { gte: fromDate, lte: toDate },
    },
    select: {
      id: true,
      departureTime: true,
      route: {
        select: {
          flightNumber: true,
          aircraftTypeIcao: true,
          departure: { select: { icao: true } },
          arrival: { select: { icao: true } },
        },
      },
    },
    orderBy: { departureTime: 'asc' },
  });

  // ─── 5. Per-flight assignment-loop ───
  // Generation-tally: wie oft hat das algorithmus innerhalb DIESER
  // generation einen pilot gepicked? Separat vom existingTally damit
  // wir beim score-compute zwischen beiden differenzieren können.
  const generationTally = new Map<string, number>();
  const proposals: AutoRosterAssignmentProposal[] = [];

  for (const flight of flights) {
    // Compute fairness-score per pilot für diesen flight.
    const candidatePool: AutoRosterCandidate[] = [];

    for (const pilot of pilots) {
      const totalForPilot =
        (existingTally.get(pilot.id) ?? 0) +
        (generationTally.get(pilot.id) ?? 0);

      // Cap check
      if (
        input.maxFlightsPerPilot !== undefined &&
        totalForPilot >= input.maxFlightsPerPilot
      ) {
        continue;
      }

      // Eligibility-check. Im auto-modus excluden wir pilots mit ANY
      // warnings (license, conflict). Admin kann später im preview-UI
      // manuell override-en wenn er einen warning-fall haben will,
      // oder im manual-creator nochmal anders zuweisen.
      const eligibility = await checkRosterEligibility({
        airlineId: input.airlineId,
        pilotId: pilot.id,
        scheduledFlightId: flight.id,
      });

      if (!eligibility.ok) continue; // hard-error → skip
      if (eligibility.warnings.length > 0) continue; // soft-warning → skip im auto-modus

      // Score-formula: dominant factor ist current-period-assignments,
      // mit lifetime-history als leichter tiebreaker, und recent-PIREP
      // als sub-tiebreaker (negativer beitrag = aktive piloten leicht
      // bevorzugt — kontra-intuitiv aber: aktive piloten haben "muscle
      // memory" und sind on-call wahrscheinlicher; inaktive haben
      // wahrscheinlich grund untätig zu sein).
      const score =
        totalForPilot * 10 +
        pilot.totalFlights * 0.5 -
        (recentPirepTally.get(pilot.id) ?? 0) * 1;

      candidatePool.push({
        pilotId: pilot.id,
        pilotName: pilot.name,
        rankName: pilot.rank?.name ?? null,
        totalFlightHours: pilot.totalFlightHours,
        fairnessScore: score,
        warnings: eligibility.warnings,
      });
    }

    candidatePool.sort((a, b) => a.fairnessScore - b.fairnessScore);

    const picked = candidatePool[0] ?? null;
    if (picked) {
      generationTally.set(
        picked.pilotId,
        (generationTally.get(picked.pilotId) ?? 0) + 1,
      );
    }

    proposals.push({
      scheduledFlightId: flight.id,
      flightNumber: flight.route.flightNumber,
      departureTime: flight.departureTime.toISOString(),
      depIcao: flight.route.departure.icao,
      arrIcao: flight.route.arrival.icao,
      aircraftTypeIcao: flight.route.aircraftTypeIcao,
      pickedPilotId: picked?.pilotId ?? null,
      pickedPilotName: picked?.pilotName ?? null,
      candidates: candidatePool,
      unassignableReason: picked
        ? undefined
        : candidatePool.length === 0
          ? 'Keine eligible Piloten — alle haben Lizenz-, Type-Rating- oder Konflikt-Issues.'
          : 'Keine Kandidaten nach Filter (cap erreicht?).',
    });
  }

  // ─── 6. Aggregate per-pilot counts ───
  const perPilotCounts = Array.from(generationTally.entries())
    .map(([pilotId, count]) => {
      const pilot = pilots.find((p) => p.id === pilotId);
      return {
        pilotId,
        pilotName: pilot?.name ?? null,
        assignmentCount: count,
      };
    })
    .sort((a, b) => b.assignmentCount - a.assignmentCount);

  const unassignableCount = proposals.filter(
    (p) => p.pickedPilotId === null,
  ).length;

  return {
    proposals,
    perPilotCounts,
    unassignableCount,
  };
}
