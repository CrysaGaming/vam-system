import { prisma } from '@vam/db';
import { getUsersWithActiveAcars, detectTrackerPhase } from './tracker-phase.js';

const VATSIM_DATAFEED_URL = 'https://data.vatsim.net/v3/vatsim-data.json';
const POLL_INTERVAL_MS = 30_000; // 30 Sekunden

type VatsimPilot = {
  cid: number;
  name: string;
  callsign: string;
  server: string;
  pilot_rating: number;
  latitude: number;
  longitude: number;
  altitude: number;
  groundspeed: number;
  transponder: string;
  heading: number;
  qnh_i_hg: number;
  qnh_mb: number;
  flight_plan: {
    flight_rules: string;
    aircraft: string;
    aircraft_faa: string;
    aircraft_short: string;
    departure: string;
    arrival: string;
    alternate: string;
    cruise_tas: string;
    altitude: string;
    deptime: string;
    enroute_time: string;
    fuel_time: string;
    remarks: string;
    route: string;
  } | null;
  logon_time: string;
  last_updated: string;
};

/**
 * VATSIM ATC controller record from /v3/vatsim-data.json `controllers` array.
 *
 * Welle B — B2 phase 2B. We poll this alongside pilots and expose a public
 * snapshot via getPublicVatsimControllers() / GET /atc/online. The vam-web's
 * ATC-matcher reads it to attribute ACARS-pilots to specific ATC stations
 * based on their COM1 active-frequency at heartbeat time.
 *
 * Fields we care about for matching:
 *   - callsign: "EDDF_GND", "LANGEN_R", etc. Format: {LOCATION}_{POSITION}
 *     where LOCATION is either an ICAO airport (EDDF, KJFK) for ground-
 *     control positions or a region/FIR identifier (LANGEN, NEW_YORK) for
 *     area control. The matcher pattern-matches the prefix against our
 *     Airport table to derive a location for proximity checking.
 *   - frequency: e.g. "121.600". Always 3 decimals in MHz. Parsed to a
 *     number client-side for the matcher's ±5kHz tolerance check.
 *   - facility: 0=OBS, 1=FSS, 2=DEL, 3=GND, 4=TWR, 5=APP, 6=CTR. The
 *     matcher applies a position-distance gate scaled to the facility
 *     type (CTR can reach hundreds of nm, GND only a few).
 *   - visual_range: nm — VATSIM's notion of the station's coverage. We
 *     surface this as a fallback when our Airport-lookup-based distance
 *     fails (e.g., a non-standard callsign that doesn't match an ICAO).
 *
 * Fields we ignore: rating, server, qualifications — those are pilot/
 * controller-experience metadata, not relevant to the freq-match itself.
 */
type VatsimController = {
  cid: number;
  name: string;
  callsign: string;
  frequency: string;
  facility: number;
  rating: number;
  server: string;
  visual_range: number;
  text_atis: string[] | null;
  last_updated: string;
  logon_time: string;
};

type VatsimDatafeed = {
  general: {
    version: number;
    update_timestamp: string;
    connected_clients: number;
  };
  pilots: VatsimPilot[];
  // Welle B — B2 phase 2B. ATC controllers are also part of the same
  // VATSIM datafeed JSON; we used to ignore the field for tree-shake
  // hygiene but the matcher now reads it. Optional in the type because
  // a stale fetch (rare server outage) might return a stripped doc;
  // pollVatsim() falls back to an empty array.
  controllers?: VatsimController[];
};

async function pollVatsim(): Promise<void> {
  try {
    const res = await fetch(VATSIM_DATAFEED_URL, {
      headers: { Accept: 'application/json' },
    });

    if (!res.ok) {
      console.error(`[VATSIM-Tracker] Datafeed fetch failed: ${res.status}`);
      return;
    }

    const data = (await res.json()) as VatsimDatafeed;
    const onlinePilots = data.pilots ?? [];

    // Update public cache (all pilots, no DB writes)
    publicVatsimPilots = onlinePilots.map((p) => ({
      cid: p.cid,
      callsign: p.callsign,
      latitude: p.latitude,
      longitude: p.longitude,
      altitude: Math.round(p.altitude),
      groundSpeed: Math.round(p.groundspeed),
      heading: Math.round(p.heading),
      onGround: p.groundspeed < 30 && p.altitude < 1000,
      aircraftType: p.flight_plan?.aircraft_short ?? null,
      departureIcao: p.flight_plan?.departure || null,
      arrivalIcao: p.flight_plan?.arrival || null,
    }));
    publicVatsimLastUpdate = new Date();

    // ─── Welle B — B2 phase 2B. Controllers cache ──────────────────────
    // Parse the controllers array from the same datafeed (one fetch =
    // pilots + ATC). The vam-web matcher polls /atc/online to grab this
    // and attribute ACARS-pilots to specific stations based on their
    // COM1 active-frequency.
    //
    // Two transformations applied here that the matcher would otherwise
    // have to repeat on every read:
    //   1. frequency: string "121.600" → frequencyMhz: number 121.6.
    //      Floats so the matcher can do ±0.005 MHz tolerance arithmetic
    //      directly. Unparseable strings become NaN which the matcher
    //      filters out — never throws, always degrades gracefully.
    //   2. facility: int 0-6 → facilityType: string "OBS"|"FSS"|"DEL"
    //      |"GND"|"TWR"|"APP"|"CTR". The matcher's per-type proximity
    //      gate is keyed by the string, which is also what the UI wants
    //      to display ("EDDF_GND" badge color-coded by GND/TWR/etc.).
    //
    // Observers (facility=0) are skipped from the cache entirely. They
    // can't transmit, can't be tuned to by a pilot, and would only
    // pollute the matcher's candidate-set with false positives if their
    // observer-frequency happens to coincide with the pilot's COM1.
    const onlineControllers = data.controllers ?? [];
    publicVatsimControllers = onlineControllers
      .filter((c) => c.facility !== 0) // skip OBS
      .map((c) => ({
        cid: c.cid,
        callsign: c.callsign,
        frequency: c.frequency,
        frequencyMhz: parseFloat(c.frequency),
        facility: c.facility,
        facilityType: facilityCodeToType(c.facility),
        visualRange: c.visual_range,
        textAtis: c.text_atis?.join('\n') ?? null,
        logonTime: c.logon_time,
      }))
      .filter((c) => !Number.isNaN(c.frequencyMhz)); // skip bad frequencies
    publicVatsimControllersLastUpdate = new Date();

    // Get all known CIDs from our DB
    const knownUsers = await prisma.user.findMany({
      where: { vatsimCid: { not: null } },
      select: { id: true, vatsimCid: true },
    });

    const cidToUserId = new Map<number, string>();
    for (const u of knownUsers) {
      if (u.vatsimCid !== null) {
        cidToUserId.set(u.vatsimCid, u.id);
      }
    }

    if (cidToUserId.size === 0) {
      // Niemand zu tracken
      return;
    }

    // ACARS-priority gating (Welle 9 Phase 5): pilots with an active
    // ACARS_CLIENT session (heartbeat in last 60s) are tracked from that
    // primary source — bot must NOT overwrite their LiveSession with
    // VATSIM data. We compute the skip-set once per poll-cycle and
    // filter the loop below.
    const usersWithActiveAcars = await getUsersWithActiveAcars(
      Array.from(cidToUserId.values()),
    );
    let acarsSkipped = 0;

    // Filter VATSIM-Piloten auf bekannte CIDs
    const matchedPilots = onlinePilots.filter((p) => cidToUserId.has(p.cid));
    const matchedCids = new Set(matchedPilots.map((p) => p.cid));

    // Upsert LiveSessions + Append Positions
    for (const pilot of matchedPilots) {
      const userId = cidToUserId.get(pilot.cid);
      if (!userId) continue;

      // Skip pilots with an active ACARS-session — see comment above.
      if (usersWithActiveAcars.has(userId)) {
        acarsSkipped++;
        continue;
      }

      const altitude = Math.round(pilot.altitude);
      const groundSpeed = Math.round(pilot.groundspeed);
      const heading = Math.round(pilot.heading);
      const onGround = groundSpeed < 30 && altitude < 1000;

      const cruiseAltStr = pilot.flight_plan?.altitude ?? '';
      const cruiseAltitude = parseAltitude(cruiseAltStr);

      // ── Phase-detection (low-fidelity) ──
      // Reads previous session-row to derive V/S from altitude-diff;
      // returns the new phase, enteredPhaseAt, and a changed-flag.
      const sampleTs = new Date(pilot.last_updated);
      const phaseResult = await detectTrackerPhase({
        network: 'VATSIM',
        externalId: pilot.cid,
        groundSpeedKts: groundSpeed,
        altitudeFt: altitude,
        onGround,
        timestamp: sampleTs,
      });

      const session = await prisma.liveSession.upsert({
        where: {
          network_externalId: { network: 'VATSIM', externalId: pilot.cid },
        },
        create: {
          userId,
          network: 'VATSIM',
          dataSource: 'VATSIM_API',
          externalId: pilot.cid,
          callsign: pilot.callsign,
          aircraftType: pilot.flight_plan?.aircraft_short ?? null,
          aircraftRegistration: null,
          departureIcao: pilot.flight_plan?.departure || null,
          arrivalIcao: pilot.flight_plan?.arrival || null,
          alternateIcao: pilot.flight_plan?.alternate || null,
          cruiseAltitude,
          flightRules: pilot.flight_plan?.flight_rules ?? null,
          flightRoute: pilot.flight_plan?.route ?? null,
          flightRemarks: pilot.flight_plan?.remarks ?? null,
          latitude: pilot.latitude,
          longitude: pilot.longitude,
          altitude,
          groundSpeed,
          heading,
          transponder: pilot.transponder,
          onGround,
          currentPhase: phaseResult.phase,
          currentPhaseEnteredAt: phaseResult.enteredPhaseAt,
          connectedAt: new Date(pilot.logon_time),
          lastUpdatedAt: sampleTs,
          isActive: true,
        },
        update: {
          callsign: pilot.callsign,
          dataSource: 'VATSIM_API',
          aircraftType: pilot.flight_plan?.aircraft_short ?? null,
          departureIcao: pilot.flight_plan?.departure || null,
          arrivalIcao: pilot.flight_plan?.arrival || null,
          alternateIcao: pilot.flight_plan?.alternate || null,
          cruiseAltitude,
          flightRules: pilot.flight_plan?.flight_rules ?? null,
          flightRoute: pilot.flight_plan?.route ?? null,
          flightRemarks: pilot.flight_plan?.remarks ?? null,
          latitude: pilot.latitude,
          longitude: pilot.longitude,
          altitude,
          groundSpeed,
          heading,
          transponder: pilot.transponder,
          onGround,
          currentPhase: phaseResult.phase,
          currentPhaseEnteredAt: phaseResult.enteredPhaseAt,
          lastUpdatedAt: sampleTs,
          isActive: true,
        },
      });

      // Append zur Position-History (Trails)
      await prisma.liveSessionPosition.create({
        data: {
          sessionId: session.id,
          latitude: pilot.latitude,
          longitude: pilot.longitude,
          altitude,
          groundSpeed,
          heading,
          onGround,
          phase: phaseResult.phase,
        },
      });

      // Emit PHASE_CHANGE audit-event when phase transitioned. Source
      // is the public-feed (no client involved), so source='server'.
      if (phaseResult.changed) {
        await prisma.acarsEvent.create({
          data: {
            sessionId: session.id,
            type: 'PHASE_CHANGE',
            timestamp: sampleTs,
            payload: {
              from: phaseResult.from,
              to: phaseResult.phase,
              source: 'server',
            },
          },
        });
      }
    }

    // Sessions als inactive markieren wenn nicht mehr im Snapshot
    const knownCidArray = Array.from(cidToUserId.keys());
    const offlineCids = knownCidArray.filter((cid) => !matchedCids.has(cid));

    if (offlineCids.length > 0) {
      await prisma.liveSession.updateMany({
        where: {
          network: 'VATSIM',
          externalId: { in: offlineCids },
          isActive: true,
        },
        data: { isActive: false },
      });
    }

    console.log(
      `[VATSIM-Tracker] ${matchedPilots.length - acarsSkipped} matched online, ${acarsSkipped} skipped (ACARS-priority), ${offlineCids.length} marked offline (total VATSIM pilots: ${onlinePilots.length})`,
    );
  } catch (err) {
    console.error('[VATSIM-Tracker] Poll error:', err);
  }
}

function parseAltitude(altStr: string): number | null {
  if (!altStr) return null;
  const trimmed = altStr.trim().toUpperCase();
  // FL370 → 37000
  if (trimmed.startsWith('FL')) {
    const num = parseInt(trimmed.slice(2), 10);
    return isNaN(num) ? null : num * 100;
  }
  // 7500 oder "7500" → 7500
  const num = parseInt(trimmed, 10);
  return isNaN(num) ? null : num;
}

// Module-level cache for ALL VATSIM pilots (public, no DB writes)
type PublicPilot = {
  cid: number;
  callsign: string;
  latitude: number;
  longitude: number;
  altitude: number;
  groundSpeed: number;
  heading: number;
  onGround: boolean;
  aircraftType: string | null;
  departureIcao: string | null;
  arrivalIcao: string | null;
};

let publicVatsimPilots: PublicPilot[] = [];
let publicVatsimLastUpdate: Date | null = null;

export function getPublicVatsimPilots(): {
  pilots: PublicPilot[];
  updatedAt: Date | null;
} {
  return {
    pilots: publicVatsimPilots,
    updatedAt: publicVatsimLastUpdate,
  };
}

// ─── Welle B — B2 phase 2B. Controllers cache + export ──────────────────
//
// Module-level snapshot of online ATC controllers, refreshed by every
// pollVatsim() call. Mirror of the publicVatsimPilots cache above —
// same shape (snapshot + updatedAt), same exposure pattern (one getter,
// no setters), same lifecycle (filled on every 30s poll).

/**
 * Public shape exposed to vam-web's ATC matcher via GET /atc/online.
 * Pre-parsed for matcher convenience: frequencyMhz is the .frequency
 * field parsed to a number (NaN rows filtered out); facilityType is
 * facility (int 0-6) mapped to the conventional ICAO position-suffix
 * string ("GND", "TWR", etc.) for proximity-gate keys and UI display.
 */
type PublicController = {
  cid: number;
  callsign: string;
  frequency: string;
  frequencyMhz: number;
  facility: number;
  facilityType: string;
  visualRange: number;
  textAtis: string | null;
  logonTime: string;
};

let publicVatsimControllers: PublicController[] = [];
let publicVatsimControllersLastUpdate: Date | null = null;

export function getPublicVatsimControllers(): {
  controllers: PublicController[];
  updatedAt: Date | null;
} {
  return {
    controllers: publicVatsimControllers,
    updatedAt: publicVatsimControllersLastUpdate,
  };
}

/**
 * VATSIM facility-code → conventional position-suffix string.
 *
 * Mapping per VATSIM API docs:
 *   0 = OBS (Observer; filtered out of the cache, present here for completeness)
 *   1 = FSS (Flight Service Station)
 *   2 = DEL (Delivery)
 *   3 = GND (Ground)
 *   4 = TWR (Tower)
 *   5 = APP (Approach/Departure — VATSIM uses one code for both)
 *   6 = CTR (Center / Area Control)
 *
 * Unknown codes return the literal "UNK" rather than throwing because the
 * matcher / UI should degrade gracefully if VATSIM ever introduces a new
 * facility tier without redeploying the bot.
 */
function facilityCodeToType(facility: number): string {
  switch (facility) {
    case 0:
      return 'OBS';
    case 1:
      return 'FSS';
    case 2:
      return 'DEL';
    case 3:
      return 'GND';
    case 4:
      return 'TWR';
    case 5:
      return 'APP';
    case 6:
      return 'CTR';
    default:
      return 'UNK';
  }
}

export function startVatsimTracker(): void {
  console.log('[VATSIM-Tracker] Starting (poll interval: 30s)');
  // Erste Abfrage sofort
  void pollVatsim();
  // Dann alle 30s
  setInterval(() => {
    void pollVatsim();
  }, POLL_INTERVAL_MS);
}