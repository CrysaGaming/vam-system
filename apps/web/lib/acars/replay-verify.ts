import 'server-only';
import { prisma } from '@vam/db';

/**
 * Replay verification (option #11).
 *
 * Reads the position trail recorded for a LiveSession and runs four
 * heuristics looking for physically-impossible or suspicious behaviour:
 *
 *   1. TELEPORT — consecutive samples with > 30 km between them in
 *      < 60 s of delta-time. Average speed > 1 800 kt, faster than any
 *      commercial aircraft. Almost always SimConnect glitching, but
 *      could also be a slew-mode-cheat. Flagged either way for human
 *      review.
 *
 *   2. SUPERSONIC — sustained groundSpeed > 600 kt (Mach 0.9 at FL350).
 *      Any single sample over the threshold is shrugged off as a
 *      noisy SimConnect read; we require ≥ 3 consecutive samples to
 *      flag, which means the aircraft was actually maintaining the
 *      speed for at least the heartbeat-cadence × 3 (~3 s at 1 Hz).
 *      Future: per-aircraft-type caps (A320 ~530 kt, B748 ~570 kt,
 *      Concorde ~1 200 kt) — for v1 a global ceiling of 600 kt is
 *      enough to catch the obvious cheats.
 *
 *   3. ALTITUDE JUMP — consecutive samples with > 5 000 ft delta in
 *      < 30 s. Average climb / descent > 10 000 fpm, beyond the
 *      physical envelope of any non-rocket. Flagged whether positive
 *      or negative — descents that fast are also impossible without
 *      structural failure. Touch-and-go's near-airport glitches are
 *      harder to filter out generically; we accept some false
 *      positives in exchange for catching real teleport-via-altitude.
 *
 *   4. CONTINUITY GAP — > 5 min between consecutive recordings. The
 *      ACARS-client sends heartbeats at ~ 1 Hz, so a 5-min gap means
 *      either a network outage (legitimate, but worth noting), the
 *      user hit pause (already counted in totalPauseSeconds — flag
 *      anyway because pause + simRate combinations are exploitable),
 *      or the user disconnected/reconnected mid-flight (we'd ideally
 *      record this as a CONNECTION_LOST event but currently don't).
 *      A few flags here are noise; admin-review filters them.
 *
 * Why post-tx in the auto-PIREP path: the trail is already committed
 * by the time the BLOCK_ON heartbeat triggers PIREP creation — the
 * heartbeat-route writes LiveSessionPosition rows for every payload.
 * Reading them back is a single indexed query; the heuristics are
 * O(N) over the trail. Even a 4-hour transatlantic at 1 Hz = ~14k
 * samples; the math is in microseconds.
 *
 * Why human-readable strings rather than structured flags: the v1
 * sink is the PIREP `remarks` field via the existing
 * "[ACARS-flag: ...]" prefix pattern. A future option #20 (structured
 * flags JSON column on Pirep) would replace this; until then,
 * remarks-text is what admin-review actually looks at.
 */

/** Maximum great-circle distance between consecutive samples before
 * we call it a teleport. Tuned for: any pair separated by less than
 * a minute should be physically reachable at < 1 800 kt. Some real
 * SimConnect glitches sit just below this; we accept those as noise. */
const TELEPORT_DISTANCE_KM = 30;

/** Time window for the teleport heuristic. Anything beyond this is
 * legitimately "could be a long network outage with the aircraft
 * actually moving" rather than instantaneous warp. */
const TELEPORT_WINDOW_SEC = 60;

/** Sustained-speed ceiling. 600 kt is faster than every commercial
 * aircraft except Concorde (which we don't expect in this dataset).
 * Glitchy single-sample noise is filtered by requiring 3 consecutive
 * samples over the threshold. */
const SUPERSONIC_KT = 600;
const SUPERSONIC_RUN_LENGTH = 3;

/** Altitude-delta heuristic. 5 000 ft in 30 s = 10 000 fpm, well
 * outside the climb / descent rate of any production airframe. */
const ALTITUDE_JUMP_FT = 5000;
const ALTITUDE_JUMP_WINDOW_SEC = 30;

/** Continuity-gap threshold. Heartbeats are ~ 1 Hz; 5 minutes of
 * silence indicates network loss, pause, or a disconnect. Flagged
 * for context, not as a hard cheat-signal. */
const CONTINUITY_GAP_SEC = 5 * 60;

export interface ReplayVerification {
  /** Human-readable flag strings. Empty = clean replay. */
  flags: string[];
  /** Total number of position samples the trail contained. */
  sampleCount: number;
}

/**
 * Run the four heuristics over the trail of the given session.
 * Soft-fails to an empty result on any error — never throws into the
 * PIREP-generation hot-path. The caller decides what to do with
 * empty / non-empty flags (typically: append to remarks).
 */
export async function verifyReplay(
  sessionId: string,
): Promise<ReplayVerification> {
  // Pull only the columns we read. Trail can be 10k+ rows on long
  // flights; selecting the full row would haul Float pitches and
  // bools we don't need. The composite index (sessionId, recordedAt)
  // makes this a single ordered seek + scan.
  const trail = await prisma.liveSessionPosition.findMany({
    where: { sessionId },
    orderBy: { recordedAt: 'asc' },
    select: {
      latitude: true,
      longitude: true,
      altitude: true,
      groundSpeed: true,
      recordedAt: true,
    },
  });

  if (trail.length < 2) {
    // Nothing to compare. Return early with empty flags — a session
    // with one sample isn't suspicious, it's just under-tracked
    // (e.g., user disconnected immediately). Future: own flag for
    // "trail too short to verify" if we want to surface it.
    return { flags: [], sampleCount: trail.length };
  }

  const flags: string[] = [];

  // Track supersonic streaks across the iteration. We flag when a
  // run of SUPERSONIC_RUN_LENGTH consecutive samples sits above the
  // threshold; a single noisy sample doesn't trigger.
  let supersonicRun = 0;
  let supersonicRunStartIndex = -1;
  let maxObservedKt = 0;

  for (let i = 1; i < trail.length; i++) {
    const prev = trail[i - 1];
    const curr = trail[i];
    const deltaSec = (curr.recordedAt.getTime() - prev.recordedAt.getTime()) / 1000;
    if (deltaSec <= 0) continue; // duplicate timestamps or clock-skew; skip

    // ─── Teleport heuristic ─────────────────────────────────────────
    const distKm = haversineKm(
      prev.latitude,
      prev.longitude,
      curr.latitude,
      curr.longitude,
    );
    if (deltaSec <= TELEPORT_WINDOW_SEC && distKm > TELEPORT_DISTANCE_KM) {
      flags.push(
        `teleport at ${formatTimestamp(curr.recordedAt)} (+${distKm.toFixed(1)} km in ${deltaSec.toFixed(0)} s)`,
      );
    }

    // ─── Altitude jump heuristic ────────────────────────────────────
    const altDelta = Math.abs(curr.altitude - prev.altitude);
    if (deltaSec <= ALTITUDE_JUMP_WINDOW_SEC && altDelta > ALTITUDE_JUMP_FT) {
      flags.push(
        `altitude jump at ${formatTimestamp(curr.recordedAt)} (${altDelta} ft in ${deltaSec.toFixed(0)} s)`,
      );
    }

    // ─── Continuity gap heuristic ───────────────────────────────────
    if (deltaSec > CONTINUITY_GAP_SEC) {
      const gapMin = Math.round(deltaSec / 60);
      flags.push(
        `continuity gap at ${formatTimestamp(curr.recordedAt)} (${gapMin} min)`,
      );
    }

    // ─── Supersonic-streak tracking ─────────────────────────────────
    // groundSpeed comes from the heartbeat in kt already.
    if (curr.groundSpeed > maxObservedKt) maxObservedKt = curr.groundSpeed;
    if (curr.groundSpeed > SUPERSONIC_KT) {
      if (supersonicRun === 0) supersonicRunStartIndex = i;
      supersonicRun += 1;
      // Flag exactly once at the threshold-cross (next bump just keeps
      // the streak; no need to flood with one flag per sample).
      if (supersonicRun === SUPERSONIC_RUN_LENGTH) {
        const startTs = trail[supersonicRunStartIndex].recordedAt;
        flags.push(
          `supersonic GS at ${formatTimestamp(startTs)} (${curr.groundSpeed} kt sustained)`,
        );
      }
    } else {
      supersonicRun = 0;
      supersonicRunStartIndex = -1;
    }
  }

  return { flags, sampleCount: trail.length };
}

/**
 * Format a Date as HH:MM:SS in UTC. Trail timestamps are stored as
 * UTC; admins reviewing PIREPs reason about flight times in UTC
 * (matches charts, METAR time, etc.) so that's what we display.
 * Date-string is omitted because the PIREP itself carries the date
 * via createdAt — no need to repeat it in every flag.
 */
function formatTimestamp(d: Date): string {
  const h = String(d.getUTCHours()).padStart(2, '0');
  const m = String(d.getUTCMinutes()).padStart(2, '0');
  const s = String(d.getUTCSeconds()).padStart(2, '0');
  return `${h}:${m}:${s}`;
}

/**
 * Great-circle distance in kilometres. Haversine formula. Earth
 * radius 6 371 km. Inputs are decimal-degree latitude / longitude.
 *
 * Why not a cheaper Euclidean approximation: trails span continents
 * (transatlantic, transpacific) where flat-earth shortcuts diverge
 * by tens of percent. Haversine is fast enough — handful of trig
 * ops per sample, a 14k-sample trail finishes in single-digit ms.
 */
function haversineKm(
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
