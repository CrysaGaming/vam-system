/**
 * Block-event detection from flight-phase transitions (Welle 9 / M3.9).
 *
 * Translates phase-change tuples (from, to) into the canonical ACARS
 * "block events" — BLOCK_OFF, TOUCHDOWN, BLOCK_ON — that downstream
 * features (M6 PIREP-trigger, replay, scoring) consume. Pure mapping;
 * no DB access; no side effects. The heartbeat-route is responsible
 * for actually persisting the AcarsEvent rows.
 *
 * WHAT EACH EVENT MEANS:
 *
 *   BLOCK_OFF  — chocks off, flight has begun. Fires when phase
 *                leaves PreFlight (canonical via Pushback, but we
 *                also accept direct PreFlight→Taxi for operators
 *                that skip pushback, e.g. small GA aircraft).
 *
 *   TOUCHDOWN  — main wheels touched the runway. Fires on the
 *                Approach→Landing transition. M6 will use the
 *                payload's verticalFpm to score hard-landings.
 *
 *   BLOCK_ON   — chocks on, parking brake set, engines off. Fires
 *                on the *into-BlockOn* transition (typically from
 *                TaxiIn, occasionally from Landing if the aircraft
 *                shuts down on the runway). This is the canonical
 *                "flight ended" signal — M6 hangs the auto-PIREP
 *                creation off this exact event.
 *
 * WHAT WE DON'T EMIT YET (deferred to later milestones):
 *
 *   INCIDENT             — overspeed, stall, structural-G, etc.
 *                          Needs continuous monitoring against
 *                          aircraft-type V-speeds.
 *   CONNECTION_LOST      — emitted by the heartbeat-route's stale-
 *                          session cleanup, not from phase trans.
 *   CONNECTION_RESUMED   — symmetric counterpart, deferred.
 *
 * DESIGN: WHY phase-driven (not telemetry-driven)?
 *   We could detect block events directly from telemetry (e.g.,
 *   onGround && groundSpeed===0 && parkingBrake → BlockOn). But
 *   we already have a battle-tested phase detector in Welle 9
 *   Phase 5 with hysteresis windows, and re-deriving the same
 *   logic here would just duplicate state. Better to define block
 *   events in terms of the phase machine: one source of truth,
 *   and phase-transitions already include hysteresis so we won't
 *   spam BLOCK_OFF every time a parked aircraft jiggles slightly.
 */

import type { FlightPhase } from '@vam/shared';
import type { AcarsEventType } from '@vam/db';

/**
 * Map a (from → to) phase transition to the block events that
 * should fire. Most transitions yield zero events; a few yield one;
 * none yield more than one in the current scheme.
 *
 * Returns AcarsEventType[] (not a single optional) so the caller
 * can iterate without special-casing — keeps the heartbeat-route
 * loop trivial. Empty array means "phase changed but no block-
 * event implication" (e.g. Climb→Cruise).
 */
export function detectBlockEvents(
  from: FlightPhase | null,
  to: FlightPhase,
): AcarsEventType[] {
  // No prior phase = brand new session. The first phase the system
  // sees doesn't represent a transition for our purposes (a session
  // that opens directly in Taxi was already taxiing — we missed
  // the BLOCK_OFF). Trade-off: we'd rather lose an event than
  // emit a phantom one for offline/late-connecting clients.
  if (from === null) return [];

  // ─── BLOCK_OFF ────────────────────────────────────────────────────
  // Canonical: PreFlight → Pushback. Common variants:
  //   - PreFlight → Taxi (no pushback at this gate / small aircraft)
  //   - PreFlight → Takeoff (rare: rolling departure from the apron,
  //                          e.g. GA touch-and-go practice)
  // We treat all three as block-off because the *intent* is the same:
  // the aircraft has left its parking position under its own power.
  if (from === 'PreFlight' && (to === 'Pushback' || to === 'Taxi' || to === 'Takeoff')) {
    return ['BLOCK_OFF'];
  }

  // ─── TOUCHDOWN ────────────────────────────────────────────────────
  // Approach → Landing. The Welle-9 phase detector promotes to Landing
  // when wheels-on-ground is confirmed plus a stability window, so
  // this transition is exactly "we just touched down".
  //
  // We deliberately DON'T fire TOUCHDOWN on Approach → TaxiIn or
  // Approach → BlockOn directly — those would imply the phase
  // detector skipped Landing, which only happens if the heartbeat
  // cadence missed the touchdown moment entirely (unusual, but
  // possible during a queue-flush after network reconnect). In
  // those edge-cases, M6 will derive an *implied* touchdown from
  // the flight track instead.
  if (from === 'Approach' && to === 'Landing') {
    return ['TOUCHDOWN'];
  }

  // ─── BLOCK_ON ─────────────────────────────────────────────────────
  // Any transition INTO BlockOn means the flight has ended. The
  // canonical flow is TaxiIn → BlockOn, but we also accept:
  //   - Landing → BlockOn (GA: shut down on the runway / grass strip)
  //   - Approach → BlockOn (extreme edge: helicopter-ish vertical
  //                         landing direct to gate, also seen when
  //                         the queue-flush case mentioned above
  //                         skips multiple intermediate phases)
  // The detector already gates BlockOn behind hasLanded + onGround
  // + parkingBrake-window, so a wrong false-positive can't slip in.
  if (to === 'BlockOn') {
    return ['BLOCK_ON'];
  }

  return [];
}

// ─────────────────────────────────────────────────────────────────────
// Payload-builder: structured data we attach to each event row.
// ─────────────────────────────────────────────────────────────────────

/**
 * Subset of heartbeat-data the payload-builder needs. Kept narrow
 * (instead of importing the full HeartbeatSchema type) so this
 * module stays trivially testable and isn't coupled to schema
 * shape changes.
 */
export interface BlockEventInputs {
  /** Server-resolved ICAO designator from M3.8. NOT the raw heartbeat value. */
  resolvedAircraftType: string;
  aircraftRegistration: string;
  aircraftTitle: string | null;

  /** ICAO airports from the flight-plan. Either may be null for free-flight. */
  departureIcao: string | null;
  arrivalIcao: string | null;

  /** Position at the moment the event fires. */
  latitude: number;
  longitude: number;
  altitudeFt: number;
  altitudeAglFt: number | null;

  /** Velocity vector — useful for TOUCHDOWN's hard-landing scoring. */
  groundSpeedKts: number;
  verticalFpm: number;

  /** State flags for cross-validation. */
  onGround: boolean;
  parkingBrake: boolean | null;

  /** Fuel snapshot — M6 derives consumed fuel as fuel(BLOCK_OFF) − fuel(BLOCK_ON). */
  fuelTotalKg: number | null;

  /**
   * When the session was originally connected. Only used for the
   * BLOCK_ON payload's flightDurationMinutes derivation. Null if
   * unknown — caller should pass session.connectedAt.
   */
  sessionConnectedAt: Date;

  /** When THIS heartbeat is being processed — used as the event timestamp. */
  now: Date;
}

/**
 * The shape of an event-payload's `payload` JSON column. Discriminated
 * on `kind` so each event can carry the fields most relevant to it
 * without bloating the others. M6 will pattern-match on `kind` to
 * pick the right consumer.
 *
 * Field naming follows the existing PHASE_CHANGE-payload's convention
 * (camelCase, ISO timestamps for any nested Dates) — keeps the JSONB
 * column shape consistent across event types.
 */
export type BlockEventPayload =
  | {
      kind: 'BLOCK_OFF';
      atIcao: string | null;
      position: { latitude: number; longitude: number; altitudeFt: number };
      fuelKgAtBlockOff: number | null;
      aircraft: { type: string; registration: string; title: string | null };
    }
  | {
      kind: 'TOUCHDOWN';
      atIcao: string | null;
      position: { latitude: number; longitude: number; altitudeAglFt: number | null };
      /** Vertical-speed at the touchdown moment. M6 scoring: hard-landing if < -600 fpm. */
      verticalFpmAtTouchdown: number;
      /** Ground-speed at touchdown. Long-roll vs short-roll diagnostics. */
      groundSpeedKtsAtTouchdown: number;
      aircraft: { type: string; registration: string };
    }
  | {
      kind: 'BLOCK_ON';
      atIcao: string | null;
      position: { latitude: number; longitude: number };
      fuelKgAtBlockOn: number | null;
      flightDurationMinutes: number;
      aircraft: { type: string; registration: string; title: string | null };
    };

/**
 * Build the payload for a given block-event from a heartbeat snapshot.
 * Caller should only invoke this for event-types returned by
 * detectBlockEvents() — no defensive guards inside, just a switch.
 */
export function buildBlockEventPayload(
  eventType: AcarsEventType,
  inputs: BlockEventInputs,
): BlockEventPayload {
  switch (eventType) {
    case 'BLOCK_OFF':
      return {
        kind: 'BLOCK_OFF',
        atIcao: inputs.departureIcao,
        position: {
          latitude: inputs.latitude,
          longitude: inputs.longitude,
          altitudeFt: inputs.altitudeFt,
        },
        fuelKgAtBlockOff: inputs.fuelTotalKg,
        aircraft: {
          type: inputs.resolvedAircraftType,
          registration: inputs.aircraftRegistration,
          title: inputs.aircraftTitle,
        },
      };

    case 'TOUCHDOWN':
      return {
        kind: 'TOUCHDOWN',
        atIcao: inputs.arrivalIcao,
        position: {
          latitude: inputs.latitude,
          longitude: inputs.longitude,
          altitudeAglFt: inputs.altitudeAglFt,
        },
        verticalFpmAtTouchdown: inputs.verticalFpm,
        groundSpeedKtsAtTouchdown: inputs.groundSpeedKts,
        aircraft: {
          type: inputs.resolvedAircraftType,
          registration: inputs.aircraftRegistration,
        },
      };

    case 'BLOCK_ON': {
      // Total flight duration is approximated from connectedAt to now.
      // It's an over-estimate (includes any pre-flight time before
      // BLOCK_OFF) which we'll refine in M6 by computing block-to-block
      // duration once both events are in the DB.
      const durationMs = inputs.now.getTime() - inputs.sessionConnectedAt.getTime();
      const flightDurationMinutes = Math.max(0, Math.round(durationMs / 60_000));
      return {
        kind: 'BLOCK_ON',
        atIcao: inputs.arrivalIcao,
        position: { latitude: inputs.latitude, longitude: inputs.longitude },
        fuelKgAtBlockOn: inputs.fuelTotalKg,
        flightDurationMinutes,
        aircraft: {
          type: inputs.resolvedAircraftType,
          registration: inputs.aircraftRegistration,
          title: inputs.aircraftTitle,
        },
      };
    }

    default:
      // Unreachable for the M3.9 set we emit; defensive throw so a
      // future caller that tries CONNECTION_LOST/INCIDENT through this
      // builder gets a clear error instead of an empty payload.
      throw new Error(
        `buildBlockEventPayload called with unsupported eventType=${eventType}`,
      );
  }
}

// ─────────────────────────────────────────────────────────────────────
// Stale-session detection.
// ─────────────────────────────────────────────────────────────────────

/**
 * After this idle gap, we consider the previous LiveSession dead and
 * start a fresh one. 10 minutes is the sweet-spot:
 *   - Long enough to ride out genuine transient outages (Wi-Fi blips,
 *     sim-paused-while-AFK, brief client-restart for a sim-mod tweak).
 *   - Short enough that a forgotten/abandoned session doesn't hang
 *     around indefinitely (which is what produced the
 *     "phase=PreFlight(server, 50:10)" stale-state we kept seeing
 *     during M3.7 testing).
 *
 * Tunable. If we ever want network-specific values (VATSIM users
 * are pickier about session boundaries than offline ones), this
 * becomes a per-network constant.
 */
export const STALE_SESSION_THRESHOLD_MS = 10 * 60 * 1000;

/**
 * Decide whether an existing session is stale enough to be closed.
 * Returns false when there's no last-heartbeat timestamp (defensive)
 * since we can't compute the gap.
 */
export function isSessionStale(
  lastHeartbeatAt: Date | null,
  now: Date,
): boolean {
  if (!lastHeartbeatAt) return false;
  return now.getTime() - lastHeartbeatAt.getTime() > STALE_SESSION_THRESHOLD_MS;
}

/**
 * Payload for the CONNECTION_LOST event we emit when closing a stale
 * session. The event's `timestamp` field on the row will be the
 * lastHeartbeatAt (i.e., when the connection actually died), not now
 * (which is when we noticed). M6 uses this to compute realistic
 * session durations after the fact.
 */
export interface ConnectionLostPayload {
  kind: 'CONNECTION_LOST';
  reason: 'stale-session-cleanup';
  /** How long ago the last heartbeat was, in seconds. Audit field. */
  silentForSeconds: number;
  /** The phase the session was in when it went quiet. May be null. */
  lastKnownPhase: string | null;
}

export function buildConnectionLostPayload(
  lastHeartbeatAt: Date,
  lastKnownPhase: string | null,
  now: Date,
): ConnectionLostPayload {
  return {
    kind: 'CONNECTION_LOST',
    reason: 'stale-session-cleanup',
    silentForSeconds: Math.round((now.getTime() - lastHeartbeatAt.getTime()) / 1000),
    lastKnownPhase,
  };
}
