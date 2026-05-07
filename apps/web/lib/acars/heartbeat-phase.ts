/**
 * Heartbeat-side adapter for server-side phase-detection (Welle 9 Phase 5).
 *
 * Bridges the wire-format `HeartbeatSchema` from the ACARS-client to the
 * pure detector in `@vam/shared`. Lives in apps/web (not @vam/shared)
 * because it knows our specific schema-shape and which proxies we use
 * for fields the client doesn't yet send.
 *
 * Three-step flow per heartbeat:
 *   1. buildHeartbeatPhaseInput()   — map heartbeat → HighFidelityInput
 *   2. resolveHeartbeatPhase()      — pick client-provided OR server-detected
 *   3. caller persists currentPhase + currentPhaseEnteredAt + emits event
 *
 * Field-derivation (heartbeat → detector inputs):
 *   - engineOn         ← (engineN1Avg ?? 0) > 5    (engines spooled if N1 > 5%)
 *   - throttlePercent  ← engineN1Avg ?? 0          (proxy until client sends throttle)
 *   - autopilotAltLock ← autopilotMaster ?? false  (proxy — true AP-altitude-lock
 *                                                   would be more accurate, but
 *                                                   client doesn't expose it yet)
 *   - distanceToArrivalNm ← null                   (TODO: derive via airport-coords
 *                                                   lookup when arrivalIcao + Airport
 *                                                   table integration is wired up)
 *
 * State-flag derivation (no DB-fields exist for these — we derive from currentPhase):
 *   - hasBeenAirborne: pilot has been in any airborne-or-post-flight phase
 *   - hasLanded: pilot has been in a post-touchdown phase
 */

import {
  type FlightPhase,
  type HighFidelityInput,
  type PhaseDetectionState,
  detectPhaseHighFidelity,
  buildPreviousPhaseState,
} from '@vam/shared';

/**
 * Re-export so the heartbeat-route can stay agnostic of the @vam/shared
 * boundary and import everything phase-related from this single helper.
 */
export { buildPreviousPhaseState };

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
 * Subset of the parsed heartbeat-payload that we use to build the
 * detector input. Avoids importing the full HeartbeatSchema-type into
 * a context that doesn't need most of it.
 */
export interface HeartbeatPhaseSlice {
  position: { altitudeFt: number; altitudeAglFt?: number | null };
  speed: { groundKts: number; verticalFpm: number };
  state: {
    onGround: boolean;
    parkingBrake?: boolean | null;
    flapsPercent?: number | null;
    gearDown?: boolean | null;
    autopilotMaster?: boolean | null;
  };
  engine?: { n1Avg?: number | null } | null | undefined;
  flight: { cruiseAltitude?: number | null };
}

/**
 * Build the HighFidelityInput for the detector from the parsed heartbeat
 * + the timestamp the server has chosen for this sample. Uses `now`
 * instead of the client-timestamp so hysteresis-windows are computed on
 * server-clock (immune to client clock-drift).
 */
export function buildHeartbeatPhaseInput(
  data: HeartbeatPhaseSlice,
  now: Date,
): HighFidelityInput {
  const n1 = data.engine?.n1Avg ?? null;
  return {
    timestamp: now,
    groundSpeedKts: data.speed.groundKts,
    altitudeFt: data.position.altitudeFt,
    altitudeAglFt: data.position.altitudeAglFt ?? data.position.altitudeFt,
    verticalSpeedFpm: data.speed.verticalFpm,
    onGround: data.state.onGround,

    // Derived/proxied fields — see file-header for rationale.
    engineOn: (n1 ?? 0) > 5,
    throttlePercent: n1 ?? 0,
    parkingBrake: data.state.parkingBrake ?? false,
    gearDown: data.state.gearDown ?? false,
    flapsPercent: data.state.flapsPercent ?? 0,
    autopilotAltLock: data.state.autopilotMaster ?? false,

    distanceToArrivalNm: null, // TODO: derive from arrivalIcao + airport coords
    cruiseAltitudeFt: data.flight.cruiseAltitude ?? null,
  };
}

export interface ResolvedPhase {
  phase: FlightPhase;
  state: PhaseDetectionState;
  changed: boolean;
  source: 'client' | 'server';
}

/**
 * Decide the current phase for this heartbeat. Client-provided phase
 * wins (the client sees mid-frame transitions the server can never
 * observe); fall back to server-side detection when absent.
 *
 * The returned `state` always has `enteredPhaseAt` set to the moment
 * the new phase started — `now` if changed, otherwise the previous
 * `enteredPhaseAt`. Caller persists this on LiveSession.
 */
export function resolveHeartbeatPhase(
  clientPhase: FlightPhase | undefined,
  input: HighFidelityInput,
  previous: PhaseDetectionState,
  now: Date,
): ResolvedPhase {
  if (clientPhase !== undefined) {
    const changed = clientPhase !== previous.currentPhase;
    return {
      phase: clientPhase,
      state: {
        currentPhase: clientPhase,
        enteredPhaseAt: changed ? now : previous.enteredPhaseAt,
        hasBeenAirborne: previous.hasBeenAirborne || AIRBORNE_PHASES.has(clientPhase),
        hasLanded: previous.hasLanded || POST_LANDING_PHASES.has(clientPhase),
      },
      changed,
      source: 'client',
    };
  }

  const result = detectPhaseHighFidelity(input, previous);
  return {
    phase: result.phase,
    state: result.state,
    changed: result.changed,
    source: 'server',
  };
}
