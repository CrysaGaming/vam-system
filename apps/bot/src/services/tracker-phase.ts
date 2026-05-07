/**
 * Shared phase-detection logic for the network-trackers (VATSIM, IVAO).
 *
 * Two responsibilities:
 *
 *   1. ACARS-priority gating (`getUsersWithActiveAcars`): trackers must
 *      NOT overwrite a LiveSession when the user has a fresh ACARS-client
 *      heartbeat. ACARS_CLIENT is priority-1 per acars-architecture.md §4
 *      and §7.3 — when active, public-feed data is fallback-only and is
 *      effectively replaced. We skip the upsert entirely; future work
 *      could write an `acarsLastVerifiedOnVatsim` field to confirm
 *      cross-source identity, but that's an additive feature.
 *
 *   2. Low-fidelity phase-detection (`detectTrackerPhase`): public-feed
 *      data lacks engine/throttle/gear/flaps/AP-lock signals. We derive
 *      vertical-speed from successive altitude samples (the trackers
 *      poll every 30s, so V/S is accurate to ~one sample-period) and
 *      run the LOW_FIDELITY_PHASES subset detector. distanceToArrival
 *      is set to null for now — deriving it requires Airport-coords
 *      lookup, deferred until needed.
 *
 * Both functions are pure-DB-readers (no writes). Caller composes the
 * upsert + position + optional PHASE_CHANGE event.
 */

import { prisma } from '@vam/db';
import {
  type FlightPhase,
  type LowFidelityInput,
  detectPhaseLowFidelity,
  buildPreviousPhaseState,
} from '@vam/shared';

/**
 * How fresh must the latest ACARS-heartbeat be for the ACARS-session
 * to count as "active" — i.e., for the bot-tracker to back off?
 *
 * Heartbeats arrive at 1-2s. 60s is generous: even if the client misses
 * a few heartbeats due to a wifi-blip, the bot still defers to it. If
 * the ACARS-client has truly disconnected, public-feed takes back over
 * after the window closes.
 */
const ACARS_PRIORITY_WINDOW_MS = 60_000;

/**
 * Find which of the given user-ids have an active ACARS-client session
 * (heartbeat within the priority window). The trackers should skip
 * upserting LiveSessions for these users on this poll-cycle.
 */
export async function getUsersWithActiveAcars(userIds: string[]): Promise<Set<string>> {
  if (userIds.length === 0) return new Set();
  const cutoff = new Date(Date.now() - ACARS_PRIORITY_WINDOW_MS);
  const sessions = await prisma.liveSession.findMany({
    where: {
      userId: { in: userIds },
      dataSource: 'ACARS_CLIENT',
      isActive: true,
      lastAcarsHeartbeat: { gte: cutoff },
    },
    select: { userId: true },
  });
  return new Set(sessions.map((s) => s.userId));
}

export interface TrackerSnapshot {
  network: 'VATSIM' | 'IVAO';
  externalId: number;
  groundSpeedKts: number;
  altitudeFt: number;
  onGround: boolean;
  /** Public-feed sample-time. Used both for V/S derivation and detector hysteresis. */
  timestamp: Date;
}

export interface TrackerPhaseResult {
  phase: FlightPhase;
  enteredPhaseAt: Date;
  /** True iff phase differs from the previous session-row state. */
  changed: boolean;
  /** Phase the session was in BEFORE this snapshot (for PHASE_CHANGE event payload). */
  from: FlightPhase;
}

/**
 * Run the low-fidelity detector for one tracker-snapshot. Reads the
 * previous session-row to derive V/S (needs the prior altitude +
 * sample-time) and to seed the state-machine.
 *
 * Returns a result with everything the caller needs for the upsert
 * (phase, enteredPhaseAt) plus a flag indicating whether to emit a
 * PHASE_CHANGE event.
 */
export async function detectTrackerPhase(snap: TrackerSnapshot): Promise<TrackerPhaseResult> {
  const previous = await prisma.liveSession.findUnique({
    where: { network_externalId: { network: snap.network, externalId: snap.externalId } },
    select: {
      altitude: true,
      lastUpdatedAt: true,
      currentPhase: true,
      currentPhaseEnteredAt: true,
    },
  });

  // ── Derive vertical-speed from altitude-diff between samples ──
  // 0 fpm if no prior sample (first poll for this pilot) or if the
  // delta is suspicious (clock-skew producing negative or huge values).
  let verticalSpeedFpm = 0;
  if (previous && previous.lastUpdatedAt) {
    const deltaSec = (snap.timestamp.getTime() - previous.lastUpdatedAt.getTime()) / 1000;
    if (deltaSec > 0 && deltaSec < 600) {
      verticalSpeedFpm = Math.round(((snap.altitudeFt - previous.altitude) / deltaSec) * 60);
    }
  }

  const previousState = buildPreviousPhaseState(
    previous?.currentPhase ?? null,
    previous?.currentPhaseEnteredAt ?? null,
    snap.timestamp,
  );
  const input: LowFidelityInput = {
    timestamp: snap.timestamp,
    groundSpeedKts: snap.groundSpeedKts,
    altitudeFt: snap.altitudeFt,
    onGround: snap.onGround,
    verticalSpeedFpm,
    distanceToArrivalNm: null, // TODO: derive from arrivalIcao + airport coords
  };
  const result = detectPhaseLowFidelity(input, previousState);
  return {
    phase: result.phase,
    enteredPhaseAt: result.state.enteredPhaseAt,
    changed: result.changed,
    from: previousState.currentPhase,
  };
}
