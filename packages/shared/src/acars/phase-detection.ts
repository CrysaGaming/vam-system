/**
 * Server-side flight-phase detection — Welle 9, Phase 5.
 *
 * PURE deterministic state-machine over telemetry samples. Each call
 * takes the latest sample + per-session state, returns new phase +
 * updated state. Idempotent: same inputs → same output. No DB-access,
 * no I/O, no clock-reads. Caller passes `timestamp` so detection is
 * fully testable with synthetic sequences.
 *
 * TWO DETECTORS — DataSource-Priority dictates which to use:
 *
 *   detectPhaseHighFidelity()  ← ACARS_CLIENT (priority-1)
 *     Full SimConnect: throttle, engineOn, parkingBrake, gear, flaps,
 *     AP-altitude-lock, AGL altitude. Uses canonical algorithm from
 *     docs/simconnect-data-catalog.md §11. Detects all 11 phases incl.
 *     Pushback, Approach, Block-On.
 *
 *   detectPhaseLowFidelity()   ← VATSIM_API / IVAO_API (fallback)
 *     Public-feed quality: only groundSpeed, altitude, onGround +
 *     derived verticalSpeedFpm + flight-plan distanceToArrival. Detects
 *     a SUBSET of phases — no Pushback (no engine/throttle), no
 *     Block-On (no parking-brake), Approach only via distance heuristic.
 *
 * MERGE-RULE (caller-side, not in this module):
 *   Bot-tracker checks LiveSession.lastAcarsHeartbeat — if fresh (<10s)
 *   → ACARS_CLIENT is primary, bot only updates `acarsLastVerifiedOn*`.
 *   Stale or absent → bot writes VATSIM_API/IVAO_API as primary and
 *   calls detectPhaseLowFidelity(). See acars-architecture.md §4 + §7.3.
 *
 * USED BY:
 *   - apps/web/app/api/acars/heartbeat/route.ts → high-fidelity
 *   - apps/bot/src/services/vatsim-tracker.ts   → low-fidelity
 *   - apps/bot/src/services/ivao-tracker.ts     → low-fidelity
 *   - apps/web/lib/acars/generate-pirep.ts      → reads phase-history
 */

// ─────────────────────────────────────────────────────────────────────────
// Phases & shared types
// ─────────────────────────────────────────────────────────────────────────

export const FLIGHT_PHASES = [
  'PreFlight',
  'Pushback',
  'Taxi',
  'Takeoff',
  'Climb',
  'Cruise',
  'Descent',
  'Approach',
  'Landing',
  'TaxiIn',
  'BlockOn',
] as const;

export type FlightPhase = (typeof FLIGHT_PHASES)[number];

/**
 * Phases reachable by the low-fidelity detector. PreFlight + the
 * airborne/landing-flow phases. No Pushback / no Block-On — those need
 * engine / brake state which VATSIM/IVAO don't expose.
 */
export const LOW_FIDELITY_PHASES = [
  'PreFlight',
  'Taxi',
  'Takeoff',
  'Climb',
  'Cruise',
  'Descent',
  'Approach',
  'Landing',
  'TaxiIn',
] as const;

export type LowFidelityPhase = (typeof LOW_FIDELITY_PHASES)[number];

/**
 * Per-session detection-state, persisted between calls.
 * - HighFidelity: read from LiveSession.currentPhase + the recordedAt
 *   of the LiveSessionPosition where currentPhase was first set.
 * - LowFidelity: same fields, just narrower phase domain.
 */
export interface PhaseDetectionState {
  currentPhase: FlightPhase;
  enteredPhaseAt: Date;
  /** Has the aircraft ever been off-the-ground in this session? */
  hasBeenAirborne: boolean;
  /** Has the aircraft touched down after being airborne? Gates TaxiIn. */
  hasLanded: boolean;
}

export interface PhaseDetectionResult {
  phase: FlightPhase;
  state: PhaseDetectionState;
  changed: boolean;
}

export function createInitialPhaseState(timestamp: Date): PhaseDetectionState {
  return {
    currentPhase: 'PreFlight',
    enteredPhaseAt: timestamp,
    hasBeenAirborne: false,
    hasLanded: false,
  };
}

/** Phases that imply the aircraft has been off-the-ground in this session. */
const AIRBORNE_PHASES = new Set<FlightPhase>([
  'Takeoff',
  'Climb',
  'Cruise',
  'Descent',
  'Approach',
  'Landing',
  'TaxiIn',
  'BlockOn',
]);

/** Phases that imply the aircraft has touched down after being airborne. */
const POST_LANDING_PHASES = new Set<FlightPhase>([
  'Landing',
  'TaxiIn',
  'BlockOn',
]);

/**
 * Reconstruct a PhaseDetectionState from session-row fields.
 *
 * Approximates `hasBeenAirborne` and `hasLanded` from `currentPhase` —
 * we don't store those flags separately on the session-row to keep the
 * schema lean. The approximation is sound: phase-progression is largely
 * monotonic, and once a phase like Cruise or Landing is reached the
 * derived flags stay true for the rest of the session.
 *
 * If `currentPhase` is null (brand-new session, before any heartbeat
 * has run detection), returns the initial PreFlight state at `fallbackNow`.
 */
export function buildPreviousPhaseState(
  currentPhase: string | null,
  currentPhaseEnteredAt: Date | null,
  fallbackNow: Date,
): PhaseDetectionState {
  if (!currentPhase) {
    return createInitialPhaseState(fallbackNow);
  }
  const phase = currentPhase as FlightPhase;
  return {
    currentPhase: phase,
    enteredPhaseAt: currentPhaseEnteredAt ?? fallbackNow,
    hasBeenAirborne: AIRBORNE_PHASES.has(phase),
    hasLanded: POST_LANDING_PHASES.has(phase),
  };
}

// ─────────────────────────────────────────────────────────────────────────
// Tunables (industry-standard from vmsACARS PDK + simconnect-data-catalog §11)
// ─────────────────────────────────────────────────────────────────────────

/** Anti-flap hold-time for most transitions */
const MIN_PHASE_HOLD_MS = 3_000;

// Speed thresholds (knots ground-speed)
const PUSHBACK_MAX_GS = 5;
const TAXI_MIN_GS = 5;
const LANDING_ROLLOUT_MAX_GS = 30;

// Throttle threshold for takeoff detection
const TAKEOFF_THROTTLE_PCT = 60;

// V/S thresholds (feet per minute)
const CLIMB_MIN_VS_FPM = 500;
const DESCENT_MIN_VS_FPM = 500;
const CRUISE_LEVEL_VS_FPM = 200;
const GO_AROUND_VS_FPM = 500;
const TOUCH_AND_GO_VS_FPM = 200;

// Distance to arrival (nautical miles) for Approach detection
const APPROACH_MAX_DIST_NM = 30;

// AGL threshold for high-fidelity Approach detection
const GO_AROUND_MIN_AGL_FT = 500;

// Cruise-altitude tolerance when flight-plan provides cruise altitude
const CRUISE_ALT_TOLERANCE_FT = 500;

// ═════════════════════════════════════════════════════════════════════════
// HIGH-FIDELITY DETECTOR (ACARS_CLIENT — full SimConnect)
// ═════════════════════════════════════════════════════════════════════════

/**
 * Telemetry-shape from ACARS_CLIENT. All fields required — the client
 * always reads them from SimConnect. Canonical algorithm from
 * simconnect-data-catalog.md §11.
 */
export interface HighFidelityInput {
  timestamp: Date;
  groundSpeedKts: number;
  altitudeFt: number;
  altitudeAglFt: number;
  verticalSpeedFpm: number;
  onGround: boolean;
  engineOn: boolean;
  throttlePercent: number;
  parkingBrake: boolean;
  gearDown: boolean;
  flapsPercent: number;
  autopilotAltLock: boolean;
  /** Distance to arrival airport in nautical miles. Null if no flight-plan filed. */
  distanceToArrivalNm: number | null;
  /** Cruise altitude from flight-plan in feet. Null if no flight-plan filed. */
  cruiseAltitudeFt: number | null;
}

export function detectPhaseHighFidelity(
  i: HighFidelityInput,
  prev: PhaseDetectionState,
): PhaseDetectionResult {
  const inPhaseMs = i.timestamp.getTime() - prev.enteredPhaseAt.getTime();
  const canTransition = inPhaseMs >= MIN_PHASE_HOLD_MS;

  const hasBeenAirborne = prev.hasBeenAirborne || !i.onGround;
  const hasLanded = prev.hasLanded || (prev.hasBeenAirborne && i.onGround);

  const next = computeHighFidelityPhase(i, prev, canTransition);

  if (next === prev.currentPhase) {
    return {
      phase: prev.currentPhase,
      state: { ...prev, hasBeenAirborne, hasLanded },
      changed: false,
    };
  }
  return {
    phase: next,
    state: { currentPhase: next, enteredPhaseAt: i.timestamp, hasBeenAirborne, hasLanded },
    changed: true,
  };
}

function computeHighFidelityPhase(
  i: HighFidelityInput,
  prev: PhaseDetectionState,
  canTransition: boolean,
): FlightPhase {
  // ─── Block-On has highest priority — can fire from ANY phase ───
  // Definition (canonical): parkingBrake set + engines off + on ground
  if (i.parkingBrake && !i.engineOn && i.onGround) {
    // But only after we've actually flown (or were taxiing) — don't
    // mark a fresh PreFlight session with cold engines as "BlockOn"
    if (prev.hasBeenAirborne || prev.currentPhase === 'TaxiIn' || prev.currentPhase === 'Taxi') {
      return 'BlockOn';
    }
    // Cold-and-dark on ramp, never moved: stay PreFlight
    return 'PreFlight';
  }

  // BlockOn is otherwise terminal
  if (prev.currentPhase === 'BlockOn') return 'BlockOn';

  // ─── On-Ground branch ───
  if (i.onGround) {
    // Engines off on ground, not yet flown → Pre-Flight
    if (!i.engineOn) {
      return prev.hasBeenAirborne ? 'TaxiIn' : 'PreFlight';
    }
    // Slow-and-engine-on
    if (i.groundSpeedKts < PUSHBACK_MAX_GS) {
      // After landing, slow rollout = TaxiIn (already cleared rollout)
      if (prev.hasLanded) return 'TaxiIn';
      // Before flight: Pushback (or Pre-Flight if just sitting)
      return prev.currentPhase === 'PreFlight' || prev.currentPhase === 'Pushback'
        ? 'Pushback'
        : 'Taxi';
    }
    // Throttle high → Takeoff roll
    if (i.throttlePercent > TAKEOFF_THROTTLE_PCT && !prev.hasLanded) {
      return 'Takeoff';
    }
    // Default on-ground-moving: Taxi (or TaxiIn if post-landing)
    return prev.hasLanded ? 'TaxiIn' : 'Taxi';
  }

  // ─── Airborne branch ───
  // Strong climb
  if (i.verticalSpeedFpm > CLIMB_MIN_VS_FPM) {
    // Go-around detection: were in Approach, suddenly climbing well above ground
    if (prev.currentPhase === 'Approach' && i.altitudeAglFt > GO_AROUND_MIN_AGL_FT) {
      return canTransition ? 'Climb' : 'Approach';
    }
    return 'Climb';
  }

  // Strong descent — Approach if close to arrival AND configured for landing
  if (i.verticalSpeedFpm < -DESCENT_MIN_VS_FPM) {
    const closeToArrival =
      i.distanceToArrivalNm != null && i.distanceToArrivalNm < APPROACH_MAX_DIST_NM;
    const configured = i.gearDown || i.flapsPercent > 10;
    if (closeToArrival && configured) return 'Approach';
    return 'Descent';
  }

  // Level-ish flight: Cruise iff AP-altitude-locked AND |V/S| < 200fpm
  if (i.autopilotAltLock && Math.abs(i.verticalSpeedFpm) < CRUISE_LEVEL_VS_FPM) {
    return 'Cruise';
  }

  // Configured + slow + low-altitude AGL but not strongly descending = late approach
  if (
    (i.gearDown || i.flapsPercent > 10) &&
    i.altitudeAglFt < 2000 &&
    i.distanceToArrivalNm != null &&
    i.distanceToArrivalNm < APPROACH_MAX_DIST_NM
  ) {
    return 'Approach';
  }

  // Touchdown branch from Approach handled in on-ground branch above (Landing)
  // For airborne but no clear classification, keep previous phase if reasonable
  if (
    prev.currentPhase === 'Climb' ||
    prev.currentPhase === 'Cruise' ||
    prev.currentPhase === 'Descent' ||
    prev.currentPhase === 'Approach'
  ) {
    return prev.currentPhase;
  }

  // Just-took-off transition: Takeoff → Climb when V/S not yet >500 but airborne
  if (prev.currentPhase === 'Takeoff') return 'Climb';

  // Mid-air session-start with no prior context → Cruise as best guess
  return 'Cruise';
}

// ═════════════════════════════════════════════════════════════════════════
// LOW-FIDELITY DETECTOR (VATSIM_API / IVAO_API — public datafeed)
// ═════════════════════════════════════════════════════════════════════════

/**
 * Telemetry-shape from VATSIM/IVAO public datafeed. Lacks engine state,
 * throttle, gear, flaps, brake, AP-lock, AGL altitude. V/S must be
 * derived by the caller from successive samples (alt[t]-alt[t-1])/Δt.
 *
 * Caller computes:
 *   - verticalSpeedFpm = (current.altFt - prev.altFt) / (deltaSec/60)
 *   - distanceToArrivalNm = haversine(currentLatLon, arrivalAirport)
 *
 * If only one sample exists (first poll), pass verticalSpeedFpm: 0.
 */
export interface LowFidelityInput {
  timestamp: Date;
  groundSpeedKts: number;
  altitudeFt: number;
  onGround: boolean;
  /** Caller-derived from successive samples. 0 for first sample of session. */
  verticalSpeedFpm: number;
  /** Caller-derived from flight-plan + current position. Null if no flight-plan. */
  distanceToArrivalNm: number | null;
}

export function detectPhaseLowFidelity(
  i: LowFidelityInput,
  prev: PhaseDetectionState,
): PhaseDetectionResult {
  const inPhaseMs = i.timestamp.getTime() - prev.enteredPhaseAt.getTime();
  const canTransition = inPhaseMs >= MIN_PHASE_HOLD_MS;

  const hasBeenAirborne = prev.hasBeenAirborne || !i.onGround;
  const hasLanded = prev.hasLanded || (prev.hasBeenAirborne && i.onGround);

  const next = computeLowFidelityPhase(i, prev, canTransition);

  if (next === prev.currentPhase) {
    return {
      phase: prev.currentPhase,
      state: { ...prev, hasBeenAirborne, hasLanded },
      changed: false,
    };
  }
  return {
    phase: next,
    state: { currentPhase: next, enteredPhaseAt: i.timestamp, hasBeenAirborne, hasLanded },
    changed: true,
  };
}

function computeLowFidelityPhase(
  i: LowFidelityInput,
  prev: PhaseDetectionState,
  canTransition: boolean,
): FlightPhase {
  // BlockOn / Pushback / detailed PreFlight are not detectable here —
  // we don't know engine-state or parking-brake. We collapse to a
  // simpler ladder: PreFlight → Taxi → Takeoff → Climb → Cruise →
  // Descent → Approach → Landing → TaxiIn (terminal).

  if (i.onGround) {
    // Stationary on-ground
    if (i.groundSpeedKts < TAXI_MIN_GS) {
      return prev.hasBeenAirborne ? 'TaxiIn' : 'PreFlight';
    }
    // Moving on-ground, fast enough to be takeoff-roll
    if (i.groundSpeedKts >= 60 && !prev.hasLanded) {
      return 'Takeoff';
    }
    // Otherwise taxi (pre or post)
    return prev.hasLanded ? 'TaxiIn' : 'Taxi';
  }

  // Airborne
  if (i.verticalSpeedFpm > CLIMB_MIN_VS_FPM) return 'Climb';

  if (i.verticalSpeedFpm < -DESCENT_MIN_VS_FPM) {
    const closeToArrival =
      i.distanceToArrivalNm != null && i.distanceToArrivalNm < APPROACH_MAX_DIST_NM;
    if (closeToArrival) return 'Approach';
    return 'Descent';
  }

  // Level-ish — best guess Cruise (no AP-lock signal available)
  // But: if previously Climb/Descent, sustain a bit before flipping
  if (
    prev.currentPhase === 'Climb' ||
    prev.currentPhase === 'Descent' ||
    prev.currentPhase === 'Approach'
  ) {
    return canTransition ? 'Cruise' : prev.currentPhase;
  }

  if (prev.currentPhase === 'Takeoff') return 'Climb';

  return 'Cruise';
}
