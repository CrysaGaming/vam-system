import { prisma } from '@vam/db';

const IVAO_WHAZZUP_URL = 'https://api.ivao.aero/v2/tracker/whazzup';
const POLL_INTERVAL_MS = 30_000; // 30 Sekunden
const USER_AGENT = 'VAM-System/1.0 (https://vam.kevindrack.de)';

type IvaoLastTrack = {
  altitude: number;
  altitudeDifference?: number;
  arrivalDistance?: number;
  departureDistance?: number;
  groundSpeed: number;
  heading: number;
  latitude: number;
  longitude: number;
  onGround: boolean;
  state?: string;
  timestamp: string;
  transponder: number;
  transponderMode?: string;
  time?: number;
};

type IvaoFlightPlan = {
  id?: number;
  revision?: number;
  aircraftId?: string;
  aircraftNumber?: number;
  departureId?: string;
  arrivalId?: string;
  alternativeId?: string;
  alternative2Id?: string;
  route?: string;
  remarks?: string;
  speed?: string;
  level?: string;
  flightRules?: string;
  flightType?: string;
  eet?: number;
  endurance?: number;
  departureTime?: number;
  actualDepartureTime?: number;
  peopleOnBoard?: number;
  createdAt?: string;
  updatedAt?: string;
  aircraftEquipments?: string;
  aircraftTransponderTypes?: string;
};

type IvaoPilot = {
  time: number;
  id: number;
  userId: number;
  callsign: string;
  serverId?: string;
  softwareTypeId?: string;
  softwareVersion?: string;
  rating?: number;
  pilotSession?: {
    simulatorId?: string;
    textureId?: number;
  };
  lastTrack: IvaoLastTrack;
  flightPlan: IvaoFlightPlan | null;
  createdAt: string;
};

type IvaoWhazzup = {
  updatedAt: string;
  servers?: unknown[];
  voiceServers?: unknown[];
  clients: {
    pilots: IvaoPilot[];
    atcs?: unknown[];
    observers?: unknown[];
    followMe?: unknown[];
  };
};

function parseLevel(levelStr: string | undefined): number | null {
  if (!levelStr) return null;
  const trimmed = levelStr.trim().toUpperCase();
  if (trimmed.startsWith('FL')) {
    const num = parseInt(trimmed.slice(2), 10);
    return isNaN(num) ? null : num * 100;
  }
  if (trimmed.startsWith('A')) {
    const num = parseInt(trimmed.slice(1), 10);
    return isNaN(num) ? null : num * 100;
  }
  const num = parseInt(trimmed, 10);
  return isNaN(num) ? null : num;
}

async function pollIvao(): Promise<void> {
  try {
    const res = await fetch(IVAO_WHAZZUP_URL, {
      headers: {
        Accept: 'application/json',
        'User-Agent': USER_AGENT,
      },
    });

    if (!res.ok) {
      console.error(`[IVAO-Tracker] Whazzup fetch failed: ${res.status}`);
      return;
    }

    const data = (await res.json()) as IvaoWhazzup;
    const onlinePilots = data.clients?.pilots ?? [];

    // Update public cache (all pilots, no DB writes)
    publicIvaoPilots = onlinePilots
      .filter((p) => p.lastTrack)
      .map((p) => {
        const t = p.lastTrack;
        return {
          cid: p.userId,
          callsign: p.callsign,
          latitude: t.latitude,
          longitude: t.longitude,
          altitude: Math.round(t.altitude),
          groundSpeed: Math.round(t.groundSpeed),
          heading: Math.round(t.heading),
          onGround: t.onGround ?? false,
          aircraftType: p.flightPlan?.aircraftId ?? null,
          departureIcao: p.flightPlan?.departureId || null,
          arrivalIcao: p.flightPlan?.arrivalId || null,
        };
      });
    publicIvaoLastUpdate = new Date();

    // Get all known VIDs from our DB
    const knownUsers = await prisma.user.findMany({
      where: { ivaoVid: { not: null } },
      select: { id: true, ivaoVid: true },
    });

    const vidToUserId = new Map<number, string>();
    for (const u of knownUsers) {
      if (u.ivaoVid !== null) {
        vidToUserId.set(u.ivaoVid, u.id);
      }
    }

    if (vidToUserId.size === 0) {
      return;
    }

    // Filter IVAO-Piloten auf bekannte VIDs
    const matchedPilots = onlinePilots.filter((p) => vidToUserId.has(p.userId));
    const matchedVids = new Set(matchedPilots.map((p) => p.userId));

    // Upsert LiveSessions + Append Positions
    for (const pilot of matchedPilots) {
      const userId = vidToUserId.get(pilot.userId);
      if (!userId) continue;

      const track = pilot.lastTrack;
      if (!track) continue;

      const altitude = Math.round(track.altitude);
      const groundSpeed = Math.round(track.groundSpeed);
      const heading = Math.round(track.heading);
      const onGround = track.onGround ?? (groundSpeed < 30 && altitude < 1000);

      const fp = pilot.flightPlan;
      const cruiseAltitude = parseLevel(fp?.level);
      const transponder = track.transponder
        ? track.transponder.toString().padStart(4, '0')
        : null;

      const session = await prisma.liveSession.upsert({
        where: {
          network_externalId: { network: 'IVAO', externalId: pilot.userId },
        },
        create: {
          userId,
          network: 'IVAO',
          dataSource: 'IVAO_API',
          externalId: pilot.userId,
          callsign: pilot.callsign,
          aircraftType: fp?.aircraftId ?? null,
          aircraftRegistration: null,
          departureIcao: fp?.departureId || null,
          arrivalIcao: fp?.arrivalId || null,
          alternateIcao: fp?.alternativeId || null,
          cruiseAltitude,
          flightRules: fp?.flightRules ?? null,
          flightRoute: fp?.route ?? null,
          flightRemarks: fp?.remarks ?? null,
          latitude: track.latitude,
          longitude: track.longitude,
          altitude,
          groundSpeed,
          heading,
          transponder,
          onGround,
          connectedAt: new Date(pilot.createdAt),
          lastUpdatedAt: new Date(track.timestamp),
          isActive: true,
        },
        update: {
          callsign: pilot.callsign,
          dataSource: 'IVAO_API',
          aircraftType: fp?.aircraftId ?? null,
          departureIcao: fp?.departureId || null,
          arrivalIcao: fp?.arrivalId || null,
          alternateIcao: fp?.alternativeId || null,
          cruiseAltitude,
          flightRules: fp?.flightRules ?? null,
          flightRoute: fp?.route ?? null,
          flightRemarks: fp?.remarks ?? null,
          latitude: track.latitude,
          longitude: track.longitude,
          altitude,
          groundSpeed,
          heading,
          transponder,
          onGround,
          lastUpdatedAt: new Date(track.timestamp),
          isActive: true,
        },
      });

      await prisma.liveSessionPosition.create({
        data: {
          sessionId: session.id,
          latitude: track.latitude,
          longitude: track.longitude,
          altitude,
          groundSpeed,
          heading,
          onGround,
        },
      });
    }

    // Sessions als inactive markieren wenn nicht mehr im Snapshot
    const knownVidArray = Array.from(vidToUserId.keys());
    const offlineVids = knownVidArray.filter((vid) => !matchedVids.has(vid));

    if (offlineVids.length > 0) {
      await prisma.liveSession.updateMany({
        where: {
          network: 'IVAO',
          externalId: { in: offlineVids },
          isActive: true,
        },
        data: { isActive: false },
      });
    }

    console.log(
      `[IVAO-Tracker] ${matchedPilots.length} matched online, ${offlineVids.length} marked offline (total IVAO pilots: ${onlinePilots.length})`,
    );
  } catch (err) {
    console.error('[IVAO-Tracker] Poll error:', err);
  }
}

// Module-level cache for ALL IVAO pilots
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

let publicIvaoPilots: PublicPilot[] = [];
let publicIvaoLastUpdate: Date | null = null;

export function getPublicIvaoPilots(): {
  pilots: PublicPilot[];
  updatedAt: Date | null;
} {
  return {
    pilots: publicIvaoPilots,
    updatedAt: publicIvaoLastUpdate,
  };
}

export function startIvaoTracker(): void {
  console.log('[IVAO-Tracker] Starting (poll interval: 30s)');
  void pollIvao();
  setInterval(() => {
    void pollIvao();
  }, POLL_INTERVAL_MS);
}