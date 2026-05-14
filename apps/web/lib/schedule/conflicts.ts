/**
 * Welle L / L1 — Schedule-gen-v2: Aircraft conflict detection.
 *
 * V1 ließ aircraft-double-bookings durch ("informational im UI") weil
 * der generator schnell sein sollte und conflicts ein UX-thema waren.
 * V2 zieht das in eine pure-function damit:
 *   1. Der admin auf einer dedizierten /airline/schedule/conflicts page
 *      alle aktuellen konflikte einsehen kann
 *   2. Die calendar-view konflikte visuell markieren kann
 *   3. Future-work: der generator pre-flight warnen kann
 *
 * # Conflict-definition
 *
 * Zwei ScheduledFlight-rows kollidieren wenn:
 *   - Gleiche preferredAircraftId (NULL-aircraft kollidiert nie weil das
 *     "pilot wählt selbst" bedeutet)
 *   - Status NICHT in (Cancelled, Completed) — wir blockieren keine
 *     historischen oder abgesagten flüge
 *   - Zeit-intervall [departureTime, departureTime + estimatedDurationMin]
 *     überlappt mit anderem flug's intervall
 *
 * V2 estimatedDurationMin kommt aus Route.estimatedMinutes (existing field).
 * Wenn das NULL ist, default 120min (2h) als platzhalter.
 *
 * # Algo
 *
 * Naiv O(n²) pair-comparison; bei <500 flights/woche (typische airline)
 * ist das schnell genug. Optimierung via sweep-line wenn das mal nicht
 * mehr reicht (V3).
 */

export type ScheduleConflictInput = {
  id: string;
  preferredAircraftId: string | null;
  departureTime: Date;
  /** Minuten flight-time aus Route.estimatedMinutes; default 120 wenn null. */
  estimatedDurationMin: number;
  /** Status — Cancelled/Completed werden ignoriert. */
  status: 'Planned' | 'Booked' | 'Completed' | 'Cancelled' | string;
  /** Optional meta für rendering — wird nicht für conflict-logik genutzt. */
  meta?: Record<string, unknown>;
};

export type ScheduleConflict = {
  /** Eine deterministisch sortierte id (kleinere zuerst) damit dedup einfach ist. */
  aId: string;
  bId: string;
  aircraftId: string;
  /** Überlappung in minuten — wie viele minuten überlappen die beiden flüge. */
  overlapMin: number;
};

/**
 * Erkennt aircraft-doppelbelegungen in einer liste von scheduled flights.
 *
 * Returnt unique pairs, jeweils mit kleinerer id zuerst (deterministisch).
 * Selbst-pairs werden ausgeschlossen (a !== b).
 *
 * @example
 *   const flights = [
 *     { id: 'f1', preferredAircraftId: 'ac1', departureTime: new Date('2026-05-14T10:00Z'),
 *       estimatedDurationMin: 120, status: 'Planned' },
 *     { id: 'f2', preferredAircraftId: 'ac1', departureTime: new Date('2026-05-14T11:00Z'),
 *       estimatedDurationMin: 90, status: 'Planned' },
 *   ];
 *   detectScheduleConflicts(flights);
 *   // → [{ aId: 'f1', bId: 'f2', aircraftId: 'ac1', overlapMin: 60 }]
 */
export function detectScheduleConflicts(
  flights: ScheduleConflictInput[],
): ScheduleConflict[] {
  // Vor-filter: keine NULL-aircraft, keine cancelled/completed.
  const active = flights.filter(
    (f) =>
      f.preferredAircraftId !== null &&
      f.status !== 'Cancelled' &&
      f.status !== 'Completed',
  );

  // Group by aircraft damit das O(n²) nur innerhalb der jeweiligen
  // aircraft-gruppe greift statt cross-aircraft.
  const byAircraft = new Map<string, ScheduleConflictInput[]>();
  for (const f of active) {
    const acId = f.preferredAircraftId!;
    if (!byAircraft.has(acId)) byAircraft.set(acId, []);
    byAircraft.get(acId)!.push(f);
  }

  const conflicts: ScheduleConflict[] = [];

  for (const [aircraftId, group] of byAircraft) {
    // Innerhalb der gruppe alle paare prüfen
    for (let i = 0; i < group.length; i++) {
      for (let j = i + 1; j < group.length; j++) {
        const a = group[i];
        const b = group[j];
        const overlap = computeOverlapMinutes(
          a.departureTime,
          a.estimatedDurationMin,
          b.departureTime,
          b.estimatedDurationMin,
        );
        if (overlap > 0) {
          // Deterministisch sortieren damit dedup einfach ist
          const [aId, bId] = a.id < b.id ? [a.id, b.id] : [b.id, a.id];
          conflicts.push({ aId, bId, aircraftId, overlapMin: overlap });
        }
      }
    }
  }

  return conflicts;
}

/**
 * Berechnet überlappung in minuten zwischen zwei zeit-intervallen.
 * Returnt 0 wenn sie sich nicht überlappen.
 */
function computeOverlapMinutes(
  aStart: Date,
  aDurationMin: number,
  bStart: Date,
  bDurationMin: number,
): number {
  const aStartMs = aStart.getTime();
  const aEndMs = aStartMs + aDurationMin * 60 * 1000;
  const bStartMs = bStart.getTime();
  const bEndMs = bStartMs + bDurationMin * 60 * 1000;

  const overlapMs = Math.min(aEndMs, bEndMs) - Math.max(aStartMs, bStartMs);
  if (overlapMs <= 0) return 0;
  return Math.round(overlapMs / 60 / 1000);
}

/**
 * Hilfsfunktion: gruppiert conflicts zu einer Set<flightId> damit das UI
 * schnell entscheiden kann ob ein flight in mindestens einem conflict
 * involviert ist (z.B. für badge-rendering im calendar).
 */
export function conflictedFlightIds(conflicts: ScheduleConflict[]): Set<string> {
  const ids = new Set<string>();
  for (const c of conflicts) {
    ids.add(c.aId);
    ids.add(c.bId);
  }
  return ids;
}
