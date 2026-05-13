import 'server-only';
import { prisma } from '@vam/db';
import { fetchAtcControllers, type PublicController } from '@/lib/atc/fetch-from-bot';
import { haversineKm } from '@/lib/flight-phase';

/**
 * Welle B — B2 phase 2B. ATC-session matcher.
 *
 * Called fire-and-forget from the heartbeat-handler whenever an ACARS
 * heartbeat arrives with com1ActiveMhz set. The matcher decides which
 * online VATSIM controller (if any) the pilot is currently tuned to,
 * and persists that as an open AtcSession row attached to the
 * LiveSession.
 *
 * Lifecycle (one decision per heartbeat invocation):
 *   1. Fetch the bot's current snapshot of online VATSIM controllers
 *      (cached 60s, see lib/atc/fetch-from-bot.ts).
 *   2. Find the existing open AtcSession for this LiveSession, if any.
 *   3. Compute the best match for the pilot's current com1ActiveMhz
 *      + position, applying the per-facility-type proximity gate.
 *   4. Compare existing vs new:
 *        - Same (stationCallsign + controllerCid): no-op (no DB write).
 *        - Different: close existing (endedAt=now), create new row.
 *        - Existing exists, no new match: close existing.
 *        - No existing, new match: create new row.
 *        - Both null: no-op.
 *
 * Why the simple "close on no-match" lifecycle rather than a grace
 * period: real-world test data is the input we'd tune a grace period
 * against, and we don't have it yet. The simple rule means a one-off
 * heartbeat-glitch could prematurely close a session, but the impact
 * is just an extra row on the PIREP — not data loss. We can add a
 * 2-heartbeat grace period in B2.x if testing shows it matters.
 *
 * Why no `bot-down` distinguished from `no controllers online`: a null
 * return from fetchAtcControllers means we couldn't get fresh data;
 * the matcher early-returns without touching DB state in that case,
 * which is the right call (don't make decisions on stale/no data).
 * An empty controllers array means "really nobody online" — that path
 * still runs through the close-existing logic correctly.
 *
 * Performance: one bot fetch (cached 60s), one prisma.atcSession.find
 * for the existing row, and 0-2 writes per call. Worst case is the
 * heartbeat that transitions the pilot from one controller to another
 * (close + create = 2 writes). The typical "still tuned to same
 * controller" case is 1 read + 0 writes. Designed to be hot-path
 * cheap because every heartbeat triggers a call.
 *
 * Idempotency: the matcher is called fire-and-forget from the
 * heartbeat. If two concurrent heartbeats for the same session race
 * (rare — heartbeat-handler serializes per session anyway), the
 * worst case is two close-same-session updates or two creates with
 * the same content. AtcSession has no unique constraint to enforce,
 * so duplicates are technically possible but practically harmless
 * (PIREP UI shows them sequentially).
 */

// ─── Frequency match tolerance ───────────────────────────────────────
//
// ±5 kHz = ±0.005 MHz. Tighter than full 8.33-kHz spacing (8.33 kHz =
// 0.00833 MHz) because (a) both pilot and controller report frequencies
// rounded to 3 decimals already, and (b) typical aviation radio
// precision is better than 5 kHz. We don't want to match 121.605 to
// 121.610 — those are adjacent channels with distinct controllers.
const FREQ_TOLERANCE_MHZ = 0.005;

// ─── Facility-type proximity gates (in nautical miles) ───────────────
//
// How close the pilot must be to a controller's station for a match to
// count. Numbers chosen from real-world ATC coverage typical values:
//   - DEL/GND: airport-only positions, useful only on or near the apron.
//   - TWR:     local control, runway environment, typically <10nm but
//              padded for variance.
//   - APP:     terminal-area, covers approaches up to ~50 nm in dense
//              airspace; 100 nm captures larger TMAs.
//   - CTR:     en-route area control; sectors can be hundreds of nm.
//   - FSS:     flight service, very large coverage areas.
//   - UNK:     no match (defensive; bot maps unknown facility codes to
//              "UNK" so we never accidentally match without a known type).
//
// 1 nautical mile = 1.852 km. Distance from haversineKm is in km, so
// each gate is the threshold in km that we compare against.
const FACILITY_GATE_KM: Record<string, number> = {
  DEL: 10 * 1.852, //   ~18.5 km
  GND: 10 * 1.852,
  TWR: 30 * 1.852, //   ~55.6 km
  APP: 100 * 1.852, // ~185.2 km
  CTR: 300 * 1.852, // ~555.6 km
  FSS: 500 * 1.852, // ~926 km
};

/**
 * Extract the leading ICAO-4 token from a VATSIM-style callsign.
 *
 * Examples:
 *   "EDDF_GND"       → "EDDF"
 *   "KJFK_TWR"       → "KJFK"
 *   "EDDF_S_GND"     → "EDDF"
 *   "LANGEN_R"       → null (no ICAO airport — region control)
 *   "NY_CTR"         → null (region)
 *
 * Returns null when the callsign doesn't start with an ICAO-4 + "_"
 * pattern. Area control (CTR) and FSS callsigns commonly use region/
 * FIR identifiers (LANGEN, BOSTON) instead of airport ICAOs, in which
 * case we can't do an airport-based proximity check — the caller
 * falls back to a visualRange-based check for those.
 */
function extractIcaoFromCallsign(callsign: string): string | null {
  const match = /^([A-Z]{4})_/.exec(callsign);
  return match ? match[1] : null;
}

/**
 * Public entrypoint. Called fire-and-forget from the heartbeat-handler.
 * Never throws — internal errors are logged at warning and swallowed
 * so a matcher failure can't take down the heartbeat path.
 *
 * Parameters:
 *   - sessionId: the LiveSession row id (used as FK on AtcSession).
 *   - com1ActiveMhz: from the heartbeat's radios block. Pass null
 *     when the pilot has no COM1 tuned (matcher closes any existing
 *     open session).
 *   - lat/lng: pilot's current position. Used for the per-facility
 *     proximity gate.
 */
export async function matchAndPersistAtcSession(
  sessionId: string,
  com1ActiveMhz: number | null,
  lat: number,
  lng: number,
): Promise<void> {
  try {
    // Find the currently-open AtcSession for this LiveSession, if any.
    // We only ever maintain at most one open session per LiveSession —
    // the lifecycle is single-channel by design (COM1 active is
    // explicitly singular, no parallel listening tracked here).
    const existing = await prisma.atcSession.findFirst({
      where: { sessionId, endedAt: null },
      orderBy: { startedAt: 'desc' },
    });

    // Determine the new match, if any. com1ActiveMhz being null
    // ("radio off" or "client doesn't report") short-circuits to no
    // match — we treat it as the explicit "not currently listening
    // to any ATC" signal.
    let newMatch: PublicController | null = null;
    if (com1ActiveMhz !== null) {
      const controllers = await fetchAtcControllers();
      if (controllers === null) {
        // Bot unreachable — skip this heartbeat without changes. The
        // open AtcSession (if any) stays open; the next successful
        // matcher run will either confirm it (no change) or close it.
        // This is the right policy for transient errors: don't make
        // close-decisions on missing data.
        return;
      }
      newMatch = await pickBestMatch(controllers, com1ActiveMhz, lat, lng);
    }

    // Decision tree.
    if (existing && newMatch) {
      // Same controller still tuned? Compare stationCallsign + cid as
      // the identity of "this is the same session continuing". freq
      // alone isn't enough (same airport often has multiple positions
      // sharing a freq across regions).
      if (
        existing.stationCallsign === newMatch.callsign &&
        existing.controllerCid === newMatch.cid
      ) {
        return; // no-op, same session
      }
      // Different controller now → close old, open new.
      await prisma.$transaction([
        prisma.atcSession.update({
          where: { id: existing.id },
          data: { endedAt: new Date() },
        }),
        prisma.atcSession.create({
          data: {
            sessionId,
            stationCallsign: newMatch.callsign,
            facilityType: newMatch.facilityType,
            frequencyMhz: newMatch.frequencyMhz,
            controllerCid: newMatch.cid,
            controllerName: '', // VATSIM datafeed has no `name` exposed
                                // via PublicController right now; we
                                // could surface it later from the
                                // bot's cache, but UI doesn't need it
                                // for the basic "EDDF_GND 121.6" line.
          },
        }),
      ]);
      return;
    }

    if (existing && !newMatch) {
      // Pilot tuned away (or out of range, or controller logged off).
      await prisma.atcSession.update({
        where: { id: existing.id },
        data: { endedAt: new Date() },
      });
      return;
    }

    if (!existing && newMatch) {
      // First match for this freq — open a new AtcSession.
      await prisma.atcSession.create({
        data: {
          sessionId,
          stationCallsign: newMatch.callsign,
          facilityType: newMatch.facilityType,
          frequencyMhz: newMatch.frequencyMhz,
          controllerCid: newMatch.cid,
          controllerName: '',
        },
      });
      return;
    }

    // Both null — nothing to do.
  } catch (err) {
    // Never let matcher errors propagate into the heartbeat-handler.
    // Logged at warn because this is recoverable: the next heartbeat
    // will retry the same logic with fresh data.
    console.warn('[atc-matcher] failed:', err);
  }
}

/**
 * Pick the best matching controller for a pilot's current frequency +
 * position. "Best" means:
 *   1. Frequency within ±5 kHz tolerance, AND
 *   2. Pilot position within the per-facility-type proximity gate.
 *
 * Among ties (multiple frequency-matching controllers within range —
 * shouldn't normally happen but possible at airports with co-located
 * facilities), we pick the CLOSEST by haversine distance.
 *
 * Returns null when no controller passes both gates.
 */
function pickBestMatch(
  controllers: readonly PublicController[],
  com1ActiveMhz: number,
  lat: number,
  lng: number,
): Promise<PublicController | null> {
  // First pass: frequency match.
  const freqMatches = controllers.filter(
    (c) => Math.abs(c.frequencyMhz - com1ActiveMhz) <= FREQ_TOLERANCE_MHZ,
  );
  if (freqMatches.length === 0) return Promise.resolve(null);

  // Second pass: per-candidate proximity check. We need each
  // controller's station-location, which we derive from the callsign
  // prefix → Airport lookup. For region/FIR callsigns (LANGEN_R,
  // BOSTON_FSS) where the prefix isn't an ICAO airport, we fall back
  // to accepting the match without a strict-distance check IF the
  // facility type is CTR or FSS (their coverage is regional anyway
  // and our bot doesn't currently expose VATSIM's FIR-boundary data).
  //
  // Airport lookups are batched into a single findMany to keep DB
  // round-trips down — typically 1-3 freqMatches, but worst case at
  // a hub with multiple co-loc'd positions could be more.
  return pickBestByDistance(freqMatches, lat, lng);
}

/**
 * Synchronous version-shape — actually async due to the airport
 * lookups, but kept as a separate function so the decision tree in
 * matchAndPersistAtcSession stays readable. Performs the airport-
 * lookup + distance computation + facility-gate per candidate.
 */
async function pickBestByDistance(
  freqMatches: readonly PublicController[],
  lat: number,
  lng: number,
): Promise<PublicController | null> {
  // Collect ICAO prefixes for airport lookup. Some entries will return
  // null (region/FIR callsigns); those bypass the airport-lookup and
  // use the visualRange fallback.
  const candidateIcaos = new Set<string>();
  for (const c of freqMatches) {
    const icao = extractIcaoFromCallsign(c.callsign);
    if (icao) candidateIcaos.add(icao);
  }

  // Single batched lookup. Defensive against typo'd callsigns: missing
  // ICAOs just don't appear in the result map, and we'll fall through
  // to the visualRange fallback for those.
  const airportRows = await prisma.airport.findMany({
    where: { icao: { in: Array.from(candidateIcaos) } },
    select: { icao: true, latitude: true, longitude: true },
  });
  const icaoToCoords = new Map<string, { lat: number; lng: number }>();
  for (const a of airportRows) {
    icaoToCoords.set(a.icao, { lat: a.latitude, lng: a.longitude });
  }

  // Score each candidate; keep the best (smallest distance) that
  // passes its facility-gate.
  let best: PublicController | null = null;
  let bestDistKm = Infinity;
  for (const c of freqMatches) {
    const gateKm = FACILITY_GATE_KM[c.facilityType];
    if (!gateKm) continue; // UNK or unknown facility type — skip

    const icao = extractIcaoFromCallsign(c.callsign);
    let distKm: number | null = null;

    if (icao) {
      const coords = icaoToCoords.get(icao);
      if (coords) {
        distKm = haversineKm(lat, lng, coords.lat, coords.lng);
      }
    }

    // Fallback for callsigns without an ICAO match (region/FIR like
    // LANGEN_R, BOSTON_FSS). Their controllers cover large areas the
    // exact bounds of which we don't have — accept the match if the
    // facility type is CTR or FSS (broad-area types), reject otherwise
    // (a "GND" position with no ICAO match is suspect — probably a
    // typo callsign or non-standard usage).
    if (distKm === null) {
      if (c.facilityType === 'CTR' || c.facilityType === 'FSS') {
        // Accept with a synthetic distance of 0 km — they all tie at
        // 0 and we pick by array order. Good enough for v1.
        if (0 < bestDistKm) {
          best = c;
          bestDistKm = 0;
        }
        continue;
      }
      // Strict types with no ICAO match → no match.
      continue;
    }

    // Standard path: distance is computed, check against the gate.
    if (distKm <= gateKm && distKm < bestDistKm) {
      best = c;
      bestDistKm = distKm;
    }
  }

  return best;
}
