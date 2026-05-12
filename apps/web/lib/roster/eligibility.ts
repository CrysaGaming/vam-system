/**
 * Track 5 #27 (Section F) — Roster-Assignment Eligibility Check
 *
 * Business-rules-layer für "darf dieser pilot auf diesen scheduled-flight
 * gerostert werden?". Pure read-only — kein write, kein side-effect.
 * Wird vom server-action `createSingleAssignment` aufgerufen UND vom
 * client-form für eine live-preview "warnings" UI.
 *
 * # Soft-fail philosophie
 *
 * Wir BLOCKEN nicht hart. Der return-typ ist `{ ok: true } | { ok: false,
 * reasons[] }` — der caller entscheidet was er mit reasons macht. Aktuell:
 *   - server-action createSingleAssignment: blockt by default, aber
 *     akzeptiert einen `overrideReasons?: string[]` parameter mit dem
 *     der admin "ja ich weiß" sagen kann (out-of-scope für #27, später).
 *   - client-form: zeigt warnings inline ohne submit zu disablen.
 *
 * Der grund: VA-admins haben oft business-reasons die das schema nicht
 * kennt (z.B. "der pilot lernt grade B738, soll trotzdem geroster werden"
 * trotz expired type-rating). Hard-blocks frustrieren admins; soft-warn
 * + override-flow ist UX-friendlicher.
 *
 * # Was wird gecheckt
 *
 *   1. Pilot existiert + gehört zur airline (defensive — sollte vor-
 *      gefiltert sein im UI, aber server-side trotzdem checken).
 *   2. Pilot ist EmploymentStatus=ACTIVE (kein roster für TERMINATED/
 *      RESIGNED pilots, sonst zeigen sie auf dashboards die sie nicht
 *      mehr haben sollten).
 *   3. ScheduledFlight existiert + gehört zur airline (FK-defense).
 *   4. canPilotFlyAircraft(pilot, route.aircraftTypeIcao) — leverages
 *      existing license + type-rating + expiry-checks aus dem career-
 *      modul (Welle 13E + Track 4 #91). Falls die airline career-mode
 *      OFF hat, returnt das immer allowed=true.
 *   5. Pilot hat keine ÜBERLAPPENDE roster-assignment (window:
 *      [departureTime, departureTime + estimatedMinutes]). Vermeidet
 *      "pilot ist 08:00 in EDDF UND 08:30 in EDDM" konflikte.
 *   6. Aircraft (wenn assignedAircraftId angegeben) ist nicht überlappend
 *      verplant — selbe window-logik wie pilot.
 *
 * # Was NICHT gecheckt wird
 *
 *   - Rank-progression-rules (z.B. "nur Senior Captain darf Widebody"):
 *     das wäre eine erweiterung im Rank-model die wir noch nicht haben
 *     (Rank kennt nur minFlightHours + requiredLicenses). Falls später
 *     gewünscht, hier als zusätzlicher check.
 *   - Crew-duty-time / FAR/EASA-rest-period (idee #6 aus den 50 optionen).
 *   - Pilot's geographic-location vs route's departure-airport
 *     (wäre cool für realism, aber sprengt MVP).
 */

import { prisma, canPilotFlyAircraft } from '@vam/db';

export type EligibilityIssue = {
  code:
    | 'pilot-not-found'
    | 'pilot-wrong-airline'
    | 'pilot-not-active'
    | 'flight-not-found'
    | 'flight-wrong-airline'
    | 'missing-license-or-rating'
    | 'pilot-conflict'
    | 'aircraft-conflict'
    | 'aircraft-not-found'
    | 'aircraft-wrong-airline';
  /** Human-readable message für UI (deutsch). */
  message: string;
  /** Optional structured details für UI-rendering. */
  details?: Record<string, unknown>;
};

export type EligibilityResult =
  | { ok: true; warnings: EligibilityIssue[] }
  | { ok: false; errors: EligibilityIssue[]; warnings: EligibilityIssue[] };

export type CheckEligibilityInput = {
  airlineId: string;
  pilotId: string;
  scheduledFlightId: string;
  /** Optional aircraft override. Wenn null, kein aircraft-conflict-check. */
  assignedAircraftId?: string | null;
};

/**
 * Run all eligibility-checks. Returns `ok:true` mit optional warnings
 * wenn alle hard-checks bestehen, oder `ok:false` mit errors + warnings
 * wenn ein hard-check fehlschlägt.
 *
 * # Hard vs soft (errors vs warnings)
 *
 *   HARD (errors, ok=false):
 *     - pilot/flight/aircraft existiert nicht oder gehört zur falschen airline
 *     - pilot ist nicht ACTIVE
 *
 *   SOFT (warnings, ok=true):
 *     - missing-license-or-rating (admin kann override-en für training-flüge)
 *     - pilot-conflict / aircraft-conflict (admin kennt vielleicht
 *       business-reason — z.B. einer der konflikt-flüge wird gleich
 *       cancelled)
 *
 * Diese teilung erlaubt der UI eine zweistufige UX:
 *   - errors → submit-button disabled, banner "kann nicht erstellt werden"
 *   - warnings → submit-button enabled, banner "achtung, aber okay" mit
 *     details-list
 */
export async function checkRosterEligibility(
  input: CheckEligibilityInput,
): Promise<EligibilityResult> {
  const errors: EligibilityIssue[] = [];
  const warnings: EligibilityIssue[] = [];

  // ─── 1. Pilot lookup + airline + employment-status ───
  const pilot = await prisma.user.findUnique({
    where: { id: input.pilotId },
    select: {
      id: true,
      name: true,
      airlineId: true,
      employmentStatus: true,
    },
  });

  if (!pilot) {
    errors.push({
      code: 'pilot-not-found',
      message: 'Pilot wurde nicht gefunden.',
    });
    return { ok: false, errors, warnings };
  }
  if (pilot.airlineId !== input.airlineId) {
    errors.push({
      code: 'pilot-wrong-airline',
      message: 'Pilot gehört nicht zu deiner Airline.',
    });
    return { ok: false, errors, warnings };
  }
  if (pilot.employmentStatus !== 'ACTIVE') {
    errors.push({
      code: 'pilot-not-active',
      message: `Pilot ist nicht aktiv (Status: ${pilot.employmentStatus}).`,
      details: { employmentStatus: pilot.employmentStatus },
    });
    // Wir collecten weiter um auch die anderen issues zu zeigen, aber
    // returnen am ende mit ok=false. Hilft dem admin den vollen scope
    // zu sehen.
  }

  // ─── 2. ScheduledFlight lookup + airline + route data ───
  const flight = await prisma.scheduledFlight.findUnique({
    where: { id: input.scheduledFlightId },
    select: {
      id: true,
      airlineId: true,
      departureTime: true,
      route: {
        select: {
          aircraftTypeIcao: true,
          estimatedMinutes: true,
          flightNumber: true,
          departure: { select: { icao: true } },
          arrival: { select: { icao: true } },
        },
      },
    },
  });

  if (!flight) {
    errors.push({
      code: 'flight-not-found',
      message: 'Scheduled Flight wurde nicht gefunden.',
    });
    return { ok: false, errors, warnings };
  }
  if (flight.airlineId !== input.airlineId) {
    errors.push({
      code: 'flight-wrong-airline',
      message: 'Flight gehört nicht zu deiner Airline.',
    });
    return { ok: false, errors, warnings };
  }

  // ─── 3. Aircraft (optional override) lookup ───
  if (input.assignedAircraftId) {
    const aircraft = await prisma.aircraft.findUnique({
      where: { id: input.assignedAircraftId },
      select: {
        id: true,
        airlineId: true,
        registration: true,
        type: true,
      },
    });
    if (!aircraft) {
      errors.push({
        code: 'aircraft-not-found',
        message: 'Aircraft wurde nicht gefunden.',
      });
      return { ok: false, errors, warnings };
    }
    if (aircraft.airlineId !== input.airlineId) {
      errors.push({
        code: 'aircraft-wrong-airline',
        message: 'Aircraft gehört nicht zu deiner Airline.',
      });
      return { ok: false, errors, warnings };
    }
  }

  // ─── 4. License + Type-rating check via existing canPilotFlyAircraft ───
  // Nur wenn route einen aircraft-type definiert. Bei aircraftTypeIcao=null
  // (z.B. legacy-routes) skippen wir den check.
  if (flight.route.aircraftTypeIcao) {
    const canFly = await canPilotFlyAircraft({
      userId: pilot.id,
      aircraftType: flight.route.aircraftTypeIcao,
    });
    if (!canFly.allowed && canFly.missing.length > 0) {
      // SOFT-fail: admin kann das overriden (z.B. training-rosters).
      warnings.push({
        code: 'missing-license-or-rating',
        message: `Pilot fehlt: ${canFly.missing.join(', ')}.`,
        details: {
          missing: canFly.missing,
          aircraftType: flight.route.aircraftTypeIcao,
        },
      });
    }
  }

  // ─── 5. Pilot-conflict: überlappende roster-assignments? ───
  // Wir definieren das overlap-window als
  //   [flight.departureTime, flight.departureTime + estimatedMinutes]
  // und suchen alle anderen ASSIGNED/ACCEPTED assignments des pilots
  // bei denen sich die windows schneiden. Konflikt = "andere assignment
  // startet vor unserem ende UND endet nach unserem start".
  const ourStart = flight.departureTime;
  const ourEnd = new Date(
    flight.departureTime.getTime() + flight.route.estimatedMinutes * 60_000,
  );

  // Suche kandidaten in einem broad window (±24h um unsere zeit) und
  // filter dann in JS — das ist günstig (max ein paar dutzend rows) und
  // einfacher als raw-SQL overlap-arithmetik.
  const candidates = await prisma.rosterAssignment.findMany({
    where: {
      pilotId: pilot.id,
      status: { in: ['ASSIGNED', 'ACCEPTED'] },
      scheduledFlight: {
        departureTime: {
          gte: new Date(ourStart.getTime() - 24 * 60 * 60_000),
          lte: new Date(ourEnd.getTime() + 24 * 60 * 60_000),
        },
      },
      // Wenn der pilot bereits zu DIESEM flight gerostert ist, kein
      // konflikt — er ist halt schon drauf. (Die DB würde das beim
      // create eh über @@unique blocken, separat handled von der action.)
      NOT: { scheduledFlightId: input.scheduledFlightId },
    },
    select: {
      id: true,
      scheduledFlight: {
        select: {
          departureTime: true,
          route: {
            select: {
              estimatedMinutes: true,
              flightNumber: true,
            },
          },
        },
      },
    },
  });

  for (const c of candidates) {
    const cStart = c.scheduledFlight.departureTime;
    const cEnd = new Date(
      cStart.getTime() + c.scheduledFlight.route.estimatedMinutes * 60_000,
    );
    // Overlap-test: A.start < B.end AND A.end > B.start
    if (cStart < ourEnd && cEnd > ourStart) {
      warnings.push({
        code: 'pilot-conflict',
        message: `Pilot ist bereits zu ${c.scheduledFlight.route.flightNumber} (${formatUtc(cStart)}) gerostert — flugzeiten überlappen.`,
        details: {
          conflictingAssignmentId: c.id,
          conflictingFlightNumber: c.scheduledFlight.route.flightNumber,
          conflictingDepartureTime: cStart.toISOString(),
        },
      });
    }
  }

  // ─── 6. Aircraft-conflict (wenn assignedAircraftId set) ───
  if (input.assignedAircraftId) {
    const aircraftConflicts = await prisma.rosterAssignment.findMany({
      where: {
        assignedAircraftId: input.assignedAircraftId,
        status: { in: ['ASSIGNED', 'ACCEPTED'] },
        scheduledFlight: {
          departureTime: {
            gte: new Date(ourStart.getTime() - 24 * 60 * 60_000),
            lte: new Date(ourEnd.getTime() + 24 * 60 * 60_000),
          },
        },
        NOT: { scheduledFlightId: input.scheduledFlightId },
      },
      select: {
        id: true,
        pilot: { select: { name: true } },
        scheduledFlight: {
          select: {
            departureTime: true,
            route: {
              select: {
                estimatedMinutes: true,
                flightNumber: true,
              },
            },
          },
        },
      },
    });

    for (const c of aircraftConflicts) {
      const cStart = c.scheduledFlight.departureTime;
      const cEnd = new Date(
        cStart.getTime() + c.scheduledFlight.route.estimatedMinutes * 60_000,
      );
      if (cStart < ourEnd && cEnd > ourStart) {
        warnings.push({
          code: 'aircraft-conflict',
          message: `Aircraft ist bereits an ${c.pilot.name ?? 'Pilot'} für ${c.scheduledFlight.route.flightNumber} (${formatUtc(cStart)}) verplant — zeiten überlappen.`,
          details: {
            conflictingAssignmentId: c.id,
            conflictingFlightNumber: c.scheduledFlight.route.flightNumber,
            conflictingDepartureTime: cStart.toISOString(),
            conflictingPilotName: c.pilot.name,
          },
        });
      }
    }
  }

  if (errors.length > 0) {
    return { ok: false, errors, warnings };
  }
  return { ok: true, warnings };
}

/** Compact "DD.MM HH:mmZ" für conflict-messages. */
function formatUtc(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(d.getUTCDate())}.${pad(d.getUTCMonth() + 1)} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}Z`;
}
