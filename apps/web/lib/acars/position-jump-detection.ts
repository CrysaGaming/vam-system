import 'server-only';
import { prisma } from '@vam/db';

/**
 * Position-jump detection — Welle C / C2.
 *
 * Walks the LiveSessionPosition trail for a finished session and flags
 * consecutive position pairs where the actual great-circle distance
 * massively exceeds what the reported ground-speed could plausibly
 * cover in the elapsed wall-clock time. Two bands:
 *
 *   - "minor"  : actual > expected × 2  (sub-band [2, 5))
 *   - "major"  : actual > expected × 5
 *
 * Used by buildPirepFlags (apps/web/lib/acars/pirep-flags.ts) at
 * PIREP-creation time to populate the `positionJumps` flag entry.
 * Admins reviewing the PIREP queue see a flag with the timestamp,
 * distance, expected distance, and severity for each jump.
 *
 * # Why post-hoc rather than real-time
 *
 * Position-jumps need TWO consecutive rows to detect, and the second
 * row is what the heartbeat-route is writing now — we'd have to read
 * the previous one back out per heartbeat to compare. Doing it at
 * PIREP-creation (a one-shot cost amortized over the whole flight)
 * keeps the heartbeat hot path lean. The cost is that flagged jumps
 * surface only after BLOCK_ON, but that's an admin-review concern,
 * not a real-time alerting one — same lifecycle as the existing
 * verifyReplay heuristic-pass.
 *
 * # Tolerance windows
 *
 * Two intentional false-positive guards baked in:
 *
 *   1. Skip the first N positions (spawn-in-flight tolerance). A
 *      crash-recovery reconnect legitimately places the user at a
 *      new lat/lon vs the last-known position from the previous
 *      session — that's not a jump, that's the user resuming. The
 *      roadmap calls this out explicitly: "Tolerant am flight-start
 *      (spawn-in-flight nach crash-recovery legitim)".
 *
 *   2. Skip pairs where either endpoint is onGround=true. Taxi
 *      operations don't have meaningful "expected distance" because
 *      ground-speed jitter from pushback/turning produces apparent
 *      jumps at any actual speed. The PIREP queue would drown in
 *      taxi-noise without this guard.
 *
 *   3. Skip pairs where expectedDistanceNm is below MIN_EXPECTED_NM.
 *      At standstill (groundSpeed=0) or very low ground-speeds, even
 *      meters of GPS noise look like infinite-ratio jumps. The floor
 *      removes the divide-by-near-zero artefact without losing real
 *      detections — a teleport while parked is detected via the
 *      onGround filter above; a teleport mid-flight will have a
 *      meaningful expectedDistanceNm from the ground-speed reading.
 *
 * # Math
 *
 * Haversine distance for the great-circle approximation — accurate
 * to ~0.5% for any pair of lat/lon, more than sufficient at the
 * resolution we care about (NMs, not metres). Earth-radius constant
 * 3440.065nm (mean radius in NM).
 *
 * expectedDistanceNm = groundSpeed_kts × (elapsed_seconds / 3600)
 *
 * Both endpoints use their OWN ground-speed reading; we don't average
 * because the question is "could the pilot have plausibly covered
 * this distance" and the relevant cap is the ground-speed the pilot
 * REPORTED at the end of the segment. Using the earlier ground-speed
 * would underestimate at accelerating phases; using the later would
 * underestimate at decelerating phases. The MAX of the two is the
 * most generous bound — anything beyond that is suspicious.
 */

const EARTH_RADIUS_NM = 3440.065;

/** First N positions ignored (spawn-in-flight / crash-recovery tolerance). */
const SPAWN_TOLERANCE_POSITIONS = 5;

/** Pairs with expected distance below this floor are skipped. */
const MIN_EXPECTED_NM = 0.05;

/** Threshold for the "minor" flag — actual exceeds expected by this factor. */
const MINOR_THRESHOLD_MULT = 2;

/** Threshold for the "major" flag — actual exceeds expected by this factor. */
const MAJOR_THRESHOLD_MULT = 5;

/** Cap the number of jumps we record so a glitchy session can't bloat flags. */
const MAX_JUMPS_RECORDED = 20;

/**
 * Single detected jump. Persisted in PirepFlags.positionJumps[].
 * The shape mirrors what admin-review UI surfaces: timestamp +
 * "what happened" (distances and severity).
 */
export type PositionJump = {
  /** ISO timestamp of the LATER position (when the jump was observed). */
  atIso: string;
  /** Actual great-circle distance between the two positions, nm. */
  distanceNm: number;
  /** Distance the ground-speed could plausibly cover in the elapsed time, nm. */
  expectedNm: number;
  /** Elapsed seconds between the two position readings. */
  elapsedSec: number;
  /** Severity band — "minor" = 2-5×, "major" = 5×+. */
  severity: 'minor' | 'major';
};

/**
 * Detect all position-jumps in a LiveSession's position trail.
 * Returns up to MAX_JUMPS_RECORDED entries; if the trail has more,
 * the cap is hit and the extras are silently dropped (the flag still
 * fires from the first jump). Empty trail or no jumps → [].
 *
 * Read-only against already-committed LiveSessionPosition rows; safe
 * to call from generate-pirep.ts before the transaction.
 */
export async function detectPositionJumps(
  sessionId: string,
): Promise<PositionJump[]> {
  const positions = await prisma.liveSessionPosition.findMany({
    where: { sessionId },
    select: {
      latitude: true,
      longitude: true,
      groundSpeed: true,
      onGround: true,
      recordedAt: true,
    },
    orderBy: { recordedAt: 'asc' },
  });

  if (positions.length < 2) {
    // Too few points to detect a jump — only one pair would exist
    // (length=2 case) and even that needs the spawn-tolerance check.
    return [];
  }

  const jumps: PositionJump[] = [];

  // Walk pairs (p_i, p_{i+1}). Start at SPAWN_TOLERANCE_POSITIONS to
  // skip the early spawn-in-flight / crash-recovery legitimate teleports.
  for (
    let i = SPAWN_TOLERANCE_POSITIONS;
    i < positions.length - 1 && jumps.length < MAX_JUMPS_RECORDED;
    i++
  ) {
    const a = positions[i];
    const b = positions[i + 1];

    // Taxi-noise guard: skip pairs where either endpoint is on the
    // ground. Ground-jumps would either be real teleports (already
    // caught by other pre-flight tooling) or taxi-speed jitter (not
    // worth flagging).
    if (a.onGround || b.onGround) continue;

    const elapsedSec = (b.recordedAt.getTime() - a.recordedAt.getTime()) / 1000;

    // Defensive: clock-skew or duplicate timestamps. Negative or
    // sub-millisecond elapsed makes the expectedDistance meaningless.
    if (elapsedSec <= 0.001) continue;

    // Plausible distance: use the MAX of the two endpoints' reported
    // ground-speeds (most generous to the pilot). See math docstring
    // for why MAX rather than average.
    const maxGroundSpeedKts = Math.max(a.groundSpeed, b.groundSpeed);
    const expectedNm = maxGroundSpeedKts * (elapsedSec / 3600);

    if (expectedNm < MIN_EXPECTED_NM) continue;

    const distanceNm = haversineNm(
      a.latitude,
      a.longitude,
      b.latitude,
      b.longitude,
    );

    const ratio = distanceNm / expectedNm;
    if (ratio < MINOR_THRESHOLD_MULT) continue;

    jumps.push({
      atIso: b.recordedAt.toISOString(),
      distanceNm: Math.round(distanceNm * 10) / 10,
      expectedNm: Math.round(expectedNm * 10) / 10,
      elapsedSec: Math.round(elapsedSec * 10) / 10,
      severity: ratio >= MAJOR_THRESHOLD_MULT ? 'major' : 'minor',
    });
  }

  return jumps;
}

/**
 * Great-circle distance between two lat/lon points in nautical miles.
 * Standard Haversine formula — accurate to ~0.5% globally, which is
 * more than enough at the NM resolution we care about.
 */
function haversineNm(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const φ1 = toRad(lat1);
  const φ2 = toRad(lat2);
  const Δφ = toRad(lat2 - lat1);
  const Δλ = toRad(lon2 - lon1);

  const a =
    Math.sin(Δφ / 2) ** 2 +
    Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return EARTH_RADIUS_NM * c;
}
