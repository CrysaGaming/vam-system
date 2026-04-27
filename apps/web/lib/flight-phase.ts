/**
 * Flight Phase Detection
 *
 * Architektur: 10-12 Phasen wie in simconnect-data-catalog.md spezifiziert.
 *
 * Aktuell aktiv: 8 Phasen die mit VATSIM/IVAO-Daten möglich sind
 * (latitude, longitude, altitude, groundSpeed, heading, onGround).
 *
 * ACARS-pending: 4 Phasen die zusätzliche Daten brauchen
 * (engines, brakes, throttle, gear, flaps, vertical speed).
 * → Werden bei ACARS-Integration aktiviert (siehe acars-architecture.md).
 *
 * Bei ACARS-Launch:
 *   1. Auskommentierte Type-Members aktivieren
 *   2. Auskommentierte Detection-Branches aktivieren
 *   3. requiresAcars: true Flags in FLIGHT_PHASES nutzen für UI
 *   → Aufwand ~5 Min, kein Refactor nötig
 */

// ────────────────────────────────────────────────────────────
// TYPES
// ────────────────────────────────────────────────────────────

export type FlightPhase =
  | 'preflight'
  // | 'pushback'        // ACARS: braucht engines-running + brakes-released
  | 'taxi-out'
  // | 'takeoff-roll'    // ACARS: braucht throttle > 0.7 + on-runway + accel > 2m/s²
  | 'initial-climb'
  | 'climb'
  | 'cruise'
  | 'descent'
  | 'approach'
  // | 'landing-roll'    // ACARS: braucht reverse-thrust + decel + on-runway nach airborne
  // | 'taxi-in'         // ACARS: braucht engines-running + on-ground nach landing
  | 'arrived';

/**
 * Phase-Metadata für UI und ACARS-Integration.
 * requiresAcars: true → wird mit aktuellen Daten nicht detected.
 */
export const FLIGHT_PHASES = {
  'preflight':     { label: 'Preflight',      shortLabel: 'PRE',   requiresAcars: false },
  'pushback':      { label: 'Pushback',       shortLabel: 'PSH',   requiresAcars: true  },
  'taxi-out':      { label: 'Taxi Out',       shortLabel: 'TXO',   requiresAcars: false },
  'takeoff-roll':  { label: 'Takeoff Roll',   shortLabel: 'TKO',   requiresAcars: true  },
  'initial-climb': { label: 'Initial Climb',  shortLabel: 'ICL',   requiresAcars: false },
  'climb':         { label: 'Climb',          shortLabel: 'CLB',   requiresAcars: false },
  'cruise':        { label: 'Cruise',         shortLabel: 'CRZ',   requiresAcars: false },
  'descent':       { label: 'Descent',        shortLabel: 'DES',   requiresAcars: false },
  'approach':      { label: 'Approach',       shortLabel: 'APP',   requiresAcars: false },
  'landing-roll':  { label: 'Landing Roll',   shortLabel: 'LDG',   requiresAcars: true  },
  'taxi-in':       { label: 'Taxi In',        shortLabel: 'TXI',   requiresAcars: true  },
  'arrived':       { label: 'Arrived',        shortLabel: 'ARR',   requiresAcars: false },
} as const;

// ────────────────────────────────────────────────────────────
// DETECTION INPUT
// ────────────────────────────────────────────────────────────

export type PhaseDetectionInput = {
  /** On-ground flag from VATSIM/IVAO */
  onGround: boolean;
  /** Altitude in feet (MSL) */
  altitude: number;
  /** Ground speed in knots */
  groundSpeed: number;
  /** Cruise altitude from flight plan in feet, null if not filed */
  cruiseAltitude: number | null;
  /** Distance to arrival airport in km, null if no arrival in flight plan */
  distanceToArrivalKm: number | null;
  /**
   * Optional ACARS-Daten (aktuell nicht verfügbar, kommt später).
   * Wenn vorhanden, ermöglicht Detection der ACARS-only Phases.
   */
  // acars?: {
  //   enginesRunning: boolean;
  //   brakesSet: boolean;
  //   throttlePercent: number;       // 0..1
  //   verticalSpeedFpm: number;
  //   gearDown: boolean;
  //   flapsPosition: number;         // 0..1
  //   accelerationMs2: number;
  //   reverseThrust: boolean;
  // };
};

// ────────────────────────────────────────────────────────────
// THRESHOLDS (zentral konfigurierbar)
// ────────────────────────────────────────────────────────────

const PHASE_THRESHOLDS = {
  /** Stillstand-Geschwindigkeit unter der wir "preflight" annehmen (knots) */
  STILL_GS_KNOTS: 1,
  /** Taxi-Speed-Range (knots) */
  TAXI_GS_MIN: 1,
  TAXI_GS_MAX: 50,
  /** Initial-Climb obere Altitude-Grenze (ft AGL approximated as MSL für jetzt) */
  INITIAL_CLIMB_CEILING_FT: 3000,
  /** Cruise: Toleranz um cruise-altitude (ft) */
  CRUISE_TOLERANCE_FT: 1500,
  /** Approach: Distanz zum Arrival-Airport (km) */
  APPROACH_RADIUS_KM: 25,
  /** Approach: Altitude unter dieser ist Approach (ft) */
  APPROACH_CEILING_FT: 5000,
  /** Arrived: Distanz zum Arrival (km) für "arrived" wenn on-ground */
  ARRIVED_RADIUS_KM: 5,
} as const;

// ────────────────────────────────────────────────────────────
// DETECTION FUNCTION
// ────────────────────────────────────────────────────────────

/**
 * Bestimmt die aktuelle Flight-Phase basierend auf verfügbaren Daten.
 *
 * Priority-Order (top-down):
 *   on-ground branch → preflight | taxi-out | arrived
 *   airborne branch  → initial-climb | climb | cruise | descent | approach
 *
 * Bei ACARS-Integration: zusätzliche Branches einkommentieren
 * für pushback, takeoff-roll, landing-roll, taxi-in.
 */
export function detectPhase(input: PhaseDetectionInput): FlightPhase {
  const {
    onGround,
    altitude,
    groundSpeed,
    cruiseAltitude,
    distanceToArrivalKm,
  } = input;

  // ─── ON-GROUND ─────────────────────────────────────────────
  if (onGround) {
    // Stillstand vor Pushback / nach Block-On
    if (groundSpeed < PHASE_THRESHOLDS.STILL_GS_KNOTS) {
      // Wenn wir nahe am Arrival-Airport sind UND on-ground UND still:
      // Flug ist effektiv beendet
      if (
        distanceToArrivalKm !== null &&
        distanceToArrivalKm <= PHASE_THRESHOLDS.ARRIVED_RADIUS_KM
      ) {
        return 'arrived';
      }
      return 'preflight';
    }

    // ACARS-only: Pushback (braucht brakes-released + engines-running)
    // if (input.acars?.brakesSet === false && input.acars?.enginesRunning) {
    //   return 'pushback';
    // }

    // ACARS-only: Takeoff-Roll (braucht throttle + acceleration)
    // if (
    //   input.acars?.throttlePercent &&
    //   input.acars.throttlePercent > 0.7 &&
    //   input.acars.accelerationMs2 > 2
    // ) {
    //   return 'takeoff-roll';
    // }

    // ACARS-only: Landing-Roll (braucht reverse + war airborne)
    // Hier: ohne phase-history schwer zu detecten ohne ACARS

    // ACARS-only: Taxi-In (braucht "war gerade gelandet"-Kontext)

    // Default ground-mit-bewegung: Taxi
    if (
      groundSpeed >= PHASE_THRESHOLDS.TAXI_GS_MIN &&
      groundSpeed < PHASE_THRESHOLDS.TAXI_GS_MAX
    ) {
      // Wenn nahe arrival → war gerade Landing, ist taxi-in
      // Aber ohne ACARS nicht zuverlässig differenzierbar von taxi-out.
      // → Fallback: einfach "taxi-out" für beides (User-Differenzierung gering)
      return 'taxi-out';
    }

    // Edge-Case: on-ground mit hohem groundspeed → Takeoff-Roll oder Landing-Roll
    // Ohne ACARS-Kontext (war airborne?) → taxi-out als safe fallback
    return 'taxi-out';
  }

  // ─── AIRBORNE ──────────────────────────────────────────────

  // Approach: nahe arrival + niedrig
  if (
    distanceToArrivalKm !== null &&
    distanceToArrivalKm <= PHASE_THRESHOLDS.APPROACH_RADIUS_KM &&
    altitude <= PHASE_THRESHOLDS.APPROACH_CEILING_FT
  ) {
    return 'approach';
  }

  // Initial-Climb: niedrige Höhe nach Takeoff
  if (altitude < PHASE_THRESHOLDS.INITIAL_CLIMB_CEILING_FT) {
    return 'initial-climb';
  }

  // Cruise: nahe an cruise-altitude
  if (cruiseAltitude !== null) {
    const altDiff = Math.abs(altitude - cruiseAltitude);
    if (altDiff <= PHASE_THRESHOLDS.CRUISE_TOLERANCE_FT) {
      return 'cruise';
    }

    // Climb vs. Descent basierend auf Position relativ zu cruise-altitude
    if (altitude < cruiseAltitude) {
      return 'climb';
    } else {
      return 'descent';
    }
  }

  // Fallback ohne cruise-altitude:
  // Wenn nahe arrival → descent, sonst climb (heuristisch)
  if (
    distanceToArrivalKm !== null &&
    distanceToArrivalKm <= PHASE_THRESHOLDS.APPROACH_RADIUS_KM * 4
  ) {
    return 'descent';
  }

  return 'climb';
}

// ────────────────────────────────────────────────────────────
// HELPERS
// ────────────────────────────────────────────────────────────

/**
 * Berechnet Distanz zwischen 2 Punkten in km (Haversine).
 */
export function haversineKm(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
): number {
  const R = 6371;
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) *
      Math.cos(toRad(lat2)) *
      Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

/**
 * Formatiert Minuten als "1h 24m" oder "45m".
 */
export function formatDuration(minutes: number): string {
  const m = Math.max(0, Math.round(minutes));
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  const remainder = m % 60;
  return `${h}h ${remainder.toString().padStart(2, '0')}m`;
}
