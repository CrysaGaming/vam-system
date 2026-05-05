import 'server-only';

/**
 * Track 1 #8 Phase 6 — Shared payload-builder für die overlay-routes.
 *
 * Extracted aus apps/web/app/api/overlay/[token]/data/route.ts damit der
 * SSE-stream-endpoint (stream/route.ts) dieselbe response-shape produzieren
 * kann ohne business-logic zu duplizieren. Der einzige unterschied zwischen
 * den beiden routes ist der transport (one-shot JSON vs persistent SSE);
 * was im body steckt ist identisch.
 *
 * Auth + rate-limit + token-lookup macht jede route selber, weil:
 *   - data: rate-limit pro request (12 polls/min × N tokens)
 *   - stream: rate-limit nur beim connect (1 connection statt 12 ticks/min)
 *
 * Diese funktion bekommt den bereits-validierten user und session und
 * baut nur den payload. Database-IO + METAR-fetch passieren hier; auth
 * NICHT.
 */

import { prisma } from '@vam/db';
import {
  detectPhase,
  haversineKm,
  formatDuration,
  FLIGHT_PHASES,
  type FlightPhase,
} from '@/lib/flight-phase';
import {
  fetchMetarsForIcaos,
  type CachedMetar,
} from '@/lib/metars/fetch-from-bot';

// ────────────────────────────────────────────────────────────
// RESPONSE TYPES
// ────────────────────────────────────────────────────────────

export type OverlayUser = {
  callsign: string | null;
  name: string | null;
  rank: string | null;
};

export type OverlayTelemetry = {
  altitudeAglFt: number | null;
  indicatedAirspeed: number | null;
  trueAirspeed: number | null;
  mach: number | null;
  verticalSpeedFpm: number | null;
  pitch: number | null;
  bank: number | null;
  engineN1Avg: number | null;
  engineN2Avg: number | null;
  fuelFlowPph: number | null;
  fuelTotalKg: number | null;
  flapsPercent: number | null;
  gearDown: boolean | null;
  spoilersDeployed: boolean | null;
  parkingBrake: boolean | null;
  autopilotMaster: boolean | null;
  gForce: number | null;
  windSpeedKts: number | null;
  windDirection: number | null;
  oatCelsius: number | null;
  landingRateFpm: number | null;
};

export type OverlayWeather = {
  icao: string;
  raw: string;
  flightCategory: 'VFR' | 'MVFR' | 'IFR' | 'LIFR' | null;
  wind: {
    direction: number | null;
    speed: number;
    gust: number | null;
  } | null;
  visibility: string | null;
  weather: string[];
  cloudCeilingFt: number | null;
  temperature: number | null;
  dewpoint: number | null;
  qnhHpa: number | null;
  fetchedAt: string;
};

export type OverlayActiveResponse = {
  active: true;
  user: OverlayUser;
  network: 'VATSIM' | 'IVAO' | 'Offline';
  dataSource:
    | 'VATSIM_API'
    | 'IVAO_API'
    | 'ACARS_CLIENT'
    | 'MANUAL'
    | 'REPLAY';
  aircraft: {
    type: string | null;
    registration: string | null;
  };
  flightPlan: {
    departure: string | null;
    arrival: string | null;
    alternate: string | null;
    cruiseAltitude: number | null;
    flightRules: string | null;
  };
  position: {
    latitude: number;
    longitude: number;
    altitude: number;
    groundSpeed: number;
    heading: number;
    onGround: boolean;
  };
  telemetry: OverlayTelemetry;
  phase: {
    id: FlightPhase;
    label: string;
    shortLabel: string;
  };
  duration: {
    minutes: number;
    formatted: string;
  };
  progress: {
    distanceKm: number | null;
    etaMinutes: number | null;
    etaFormatted: string | null;
  };
  weather: {
    departure: OverlayWeather | null;
    arrival: OverlayWeather | null;
  };
  timestamp: string;
};

export type OverlayInactiveResponse = {
  active: false;
  user: OverlayUser;
  message: string;
};

export type OverlayResponse =
  | OverlayActiveResponse
  | OverlayInactiveResponse;

export type OverlayErrorResponse = {
  error: string;
  message?: string;
};

// User-shape that comes out of prisma's overlayToken-lookup.
// Both routes do this lookup and pass the result here.
export type OverlayUserContext = {
  id: string;
  name: string | null;
  rank: { name: string } | null;
};

// ────────────────────────────────────────────────────────────
// HELPERS
// ────────────────────────────────────────────────────────────

/**
 * Reduziert eine bot-CachedMetar zu einer slim OverlayWeather. Returns
 * null wenn raw-METAR fehlt (unwahrscheinlich aber defensive).
 *
 * cloudCeilingFt: erste BKN/OVC schicht (broken/overcast = "ceiling"
 * laut ICAO definition). FEW/SCT zählen nicht — die werden im UI nur
 * als sky-condition-text gezeigt wenn überhaupt.
 */
function reduceMetarForOverlay(cached: CachedMetar): OverlayWeather | null {
  if (!cached.raw) return null;
  const decoded = cached.decoded;

  let cloudCeilingFt: number | null = null;
  if (decoded?.clouds) {
    const ceiling = decoded.clouds.find(
      (c) => c.coverage === 'BKN' || c.coverage === 'OVC',
    );
    if (ceiling) cloudCeilingFt = ceiling.base;
  }

  return {
    icao: cached.icao,
    raw: cached.raw,
    flightCategory: decoded?.flightCategory ?? null,
    wind: decoded?.wind
      ? {
          direction: decoded.wind.direction,
          speed: decoded.wind.speed,
          gust: decoded.wind.gust,
        }
      : null,
    visibility: decoded?.visibility ?? null,
    weather: decoded?.weather ?? [],
    cloudCeilingFt,
    temperature: decoded?.temperature ?? null,
    dewpoint: decoded?.dewpoint ?? null,
    qnhHpa: decoded?.pressure?.qnhHpa ?? null,
    fetchedAt: cached.fetchedAt,
  };
}

// ────────────────────────────────────────────────────────────
// PAYLOAD BUILDER
// ────────────────────────────────────────────────────────────

/**
 * Baut die overlay-response für einen pre-validated user. Auth + rate-
 * limit muss der caller schon erledigt haben — diese funktion macht
 * NUR die DB-lookups (LiveSession + Airport + AcarsEvent + METAR-cache)
 * und mapped sie auf die public response-shape.
 *
 * Active-Path: liefert OverlayActiveResponse mit allen blocks.
 * Inactive-Path: liefert OverlayInactiveResponse mit message.
 *
 * Throws bei DB-fehlern (caller decided was zu tun ist — data/route.ts
 * lässt durch und Next.js antwortet 500; stream/route.ts emittet
 * error-event und schließt die connection).
 */
export async function buildOverlayPayload(
  userCtx: OverlayUserContext,
): Promise<OverlayResponse> {
  const overlayUser: OverlayUser = {
    callsign: null,
    name: userCtx.name,
    rank: userCtx.rank?.name ?? null,
  };

  // ─── 1. LiveSession-Lookup ─────────────────────────────────
  const session = await prisma.liveSession.findFirst({
    where: {
      userId: userCtx.id,
      isActive: true,
    },
    orderBy: { lastUpdatedAt: 'desc' },
  });

  if (!session) {
    return {
      active: false,
      user: overlayUser,
      message: 'No active flight',
    };
  }

  // ─── 2. Optional: Arrival-Airport für Distance/ETA ────────
  let distanceToArrivalKm: number | null = null;
  let etaMinutes: number | null = null;

  if (session.arrivalIcao) {
    const arrival = await prisma.airport.findUnique({
      where: { icao: session.arrivalIcao },
      select: { latitude: true, longitude: true },
    });
    if (arrival) {
      distanceToArrivalKm = haversineKm(
        session.latitude,
        session.longitude,
        arrival.latitude,
        arrival.longitude,
      );
      const groundSpeedKmh = session.groundSpeed * 1.852;
      if (groundSpeedKmh > 30) {
        etaMinutes = (distanceToArrivalKm / groundSpeedKmh) * 60;
      }
    }
  }

  // ─── 3. Phase-Detection ────────────────────────────────────
  const phase = detectPhase({
    onGround: session.onGround,
    altitude: session.altitude,
    groundSpeed: session.groundSpeed,
    cruiseAltitude: session.cruiseAltitude,
    distanceToArrivalKm,
  });
  const phaseMeta = FLIGHT_PHASES[phase];

  // ─── 4. Duration ───────────────────────────────────────────
  const durationMinutes = Math.floor(
    (Date.now() - new Date(session.connectedAt).getTime()) / 60_000,
  );

  // ─── 5. Landing-rate (post-touchdown only) ────────────────
  let landingRateFpm: number | null = null;
  if (session.dataSource === 'ACARS_CLIENT' && session.onGround) {
    const touchdown = await prisma.acarsEvent.findFirst({
      where: { sessionId: session.id, type: 'TOUCHDOWN' },
      orderBy: { timestamp: 'desc' },
      select: { payload: true },
    });
    if (touchdown?.payload && typeof touchdown.payload === 'object') {
      const v = (touchdown.payload as Record<string, unknown>)
        .verticalSpeedFpm;
      if (typeof v === 'number' && Number.isFinite(v)) {
        landingRateFpm = Math.round(v);
      } else if (typeof v === 'string') {
        const n = Number.parseFloat(v);
        if (Number.isFinite(n)) landingRateFpm = Math.round(n);
      }
    }
  }

  // ─── 6. Weather (Track 1 #8 Phase 5, best-effort) ──────────
  const weatherIcaos: string[] = [];
  if (session.departureIcao) weatherIcaos.push(session.departureIcao);
  if (session.arrivalIcao) weatherIcaos.push(session.arrivalIcao);

  const weatherCache =
    weatherIcaos.length > 0 ? await fetchMetarsForIcaos(weatherIcaos) : {};

  const weather = {
    departure: session.departureIcao
      ? weatherCache[session.departureIcao.toUpperCase()]
        ? reduceMetarForOverlay(
            weatherCache[session.departureIcao.toUpperCase()],
          )
        : null
      : null,
    arrival: session.arrivalIcao
      ? weatherCache[session.arrivalIcao.toUpperCase()]
        ? reduceMetarForOverlay(
            weatherCache[session.arrivalIcao.toUpperCase()],
          )
        : null
      : null,
  };

  // ─── 7. Response ───────────────────────────────────────────
  return {
    active: true,
    user: {
      ...overlayUser,
      callsign: session.callsign,
    },
    network: session.network,
    dataSource: session.dataSource,
    aircraft: {
      type: session.aircraftType,
      registration: session.aircraftRegistration,
    },
    flightPlan: {
      departure: session.departureIcao,
      arrival: session.arrivalIcao,
      alternate: session.alternateIcao,
      cruiseAltitude: session.cruiseAltitude,
      flightRules: session.flightRules,
    },
    position: {
      latitude: session.latitude,
      longitude: session.longitude,
      altitude: session.altitude,
      groundSpeed: session.groundSpeed,
      heading: session.heading,
      onGround: session.onGround,
    },
    telemetry: {
      altitudeAglFt: session.altitudeAglFt,
      indicatedAirspeed: session.indicatedAirspeed,
      trueAirspeed: session.trueAirspeed,
      mach: session.mach,
      verticalSpeedFpm: session.verticalSpeedFpm,
      pitch: session.pitch,
      bank: session.bank,
      engineN1Avg: session.engineN1Avg,
      engineN2Avg: session.engineN2Avg,
      fuelFlowPph: session.fuelFlowPph,
      fuelTotalKg: session.fuelTotalKg,
      flapsPercent: session.flapsPercent,
      gearDown: session.gearDown,
      spoilersDeployed: session.spoilersDeployed,
      parkingBrake: session.parkingBrake,
      autopilotMaster: session.autopilotMaster,
      gForce: session.gForce,
      windSpeedKts: session.windSpeedKts,
      windDirection: session.windDirection,
      oatCelsius: session.oatCelsius,
      landingRateFpm,
    },
    phase: {
      id: phase,
      label: phaseMeta.label,
      shortLabel: phaseMeta.shortLabel,
    },
    duration: {
      minutes: durationMinutes,
      formatted: formatDuration(durationMinutes),
    },
    progress: {
      distanceKm:
        distanceToArrivalKm !== null
          ? Math.round(distanceToArrivalKm)
          : null,
      etaMinutes: etaMinutes !== null ? Math.round(etaMinutes) : null,
      etaFormatted:
        etaMinutes !== null ? formatDuration(etaMinutes) : null,
    },
    weather,
    timestamp: new Date().toISOString(),
  };
}
