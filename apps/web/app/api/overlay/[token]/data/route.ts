/**
 * Public Overlay API
 *
 * Endpoint: GET /api/overlay/[token]/data
 *
 * Liefert die aktuellen Live-Daten eines Pilots für externe Konsumenten
 * (OBS Browser-Source, Streaming-Tools, Discord-Bots, etc.).
 *
 * Authentication: Token-basiert via URL-Path-Parameter.
 *   - Token ist 32 hex chars (128 bit Entropie)
 *   - User generiert Token in /settings, kann rotieren
 *   - Bei Leak: User rotiert → alter Token sofort ungültig
 *
 * Rate-Limiting:
 *   - 100 Requests/Min pro Token (5s Polling = 12/Min, viel Buffer)
 *   - 200 Requests/Min pro IP (mehrere OBS-Instanzen pro IP möglich)
 *   - 401-Spike-Detection bei 5+ failed auths in 1 Min
 *
 * CORS: Access-Control-Allow-Origin: *
 *   → Erlaubt OBS-Browser-Source und externe Web-Apps
 *
 * Cache: no-store
 *   → Daten ändern sich alle 30s (Tracker-Interval), aber User erwartet
 *     "live", also kein Caching auf Browser/CDN-Ebene.
 *
 * Response-Format: siehe OverlayResponse-Type unten.
 *
 * @see weather-provider-strategy.md  für ähnliche Proxy-Architektur
 * @see todo-obs-overlay-system.md     für Phase-Übersicht
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@vam/db';
import {
  detectPhase,
  haversineKm,
  formatDuration,
  FLIGHT_PHASES,
  type FlightPhase,
} from '@/lib/flight-phase';
import {
  checkRateLimit,
  recordAuthFail,
  RATE_LIMITS,
} from '@/lib/rate-limit';
import { fetchMetarsForIcaos } from '@/lib/metars/fetch-from-bot';

// ────────────────────────────────────────────────────────────
// RESPONSE TYPES
// ────────────────────────────────────────────────────────────

type OverlayUser = {
  callsign: string | null;
  name: string | null;
  rank: string | null;
};

/**
 * Telemetry-block — Welle 10 commit 10A.
 *
 * Extended fields aus dem Welle-9-LiveSession-schema. Alle nullable:
 *   - VATSIM/IVAO-tracker schreiben sie nicht (network-feeds liefern nur
 *     position+speed+altitude+heading) → all null
 *   - ACARS_CLIENT-feed schreibt sie pro heartbeat → großteils gefüllt
 *   - Einzelne felder können auch bei ACARS null sein wenn das aircraft
 *     diese SimVar nicht hat (z.B. engineN1 bei einem glider)
 *
 * Layouts entscheiden self-aware was sie rendern:
 *   - 'bar' / 'card': ignoriert telemetry komplett (10A = passthrough only)
 *   - 'cockpit' (10B): rendert IAS/Mach/VS/AP/Flaps/Gear/N1/Wind etc.
 *
 * landingRateFpm ist nicht in LiveSession persistiert sondern kommt aus
 * dem letzten TOUCHDOWN-AcarsEvent dieser session. Wir lookup'en das
 * lazy nur wenn die session active ist und onGround=true ist (sprich:
 * unmittelbar post-touchdown bis BLOCK_ON die session schließt). Hard-
 * Landing-indicator im UI checkt landingRateFpm < -800.
 */
type OverlayTelemetry = {
  altitudeAglFt: number | null;
  indicatedAirspeed: number | null;
  trueAirspeed: number | null;
  mach: number | null;
  verticalSpeedFpm: number | null;
  pitch: number | null;
  bank: number | null;

  // Engines (averaged over installed engines, client computes)
  engineN1Avg: number | null;
  engineN2Avg: number | null;
  fuelFlowPph: number | null;
  fuelTotalKg: number | null;

  // State / surface
  flapsPercent: number | null;
  gearDown: boolean | null;
  spoilersDeployed: boolean | null;
  parkingBrake: boolean | null;
  autopilotMaster: boolean | null;

  // Forces + environment
  gForce: number | null;
  windSpeedKts: number | null;
  windDirection: number | null;
  oatCelsius: number | null;

  // Derived (post-touchdown only): from latest TOUCHDOWN AcarsEvent
  landingRateFpm: number | null;
};

/**
 * Track 1 #8 Phase 5 — Wetter-block für eine einzelne station.
 *
 * Reduzierte selection des bot's METAR-cache shape: nur die felder
 * die ein streamer-overlay realistisch zeigen will. Vollständiges
 * decoded payload (mit cloud-types CB/TCU, variable-wind-arcs etc.)
 * wäre over-the-top für eine bar/card-anzeige.
 *
 * Alle felder nullable — VATSIM's METAR-server liefert manchmal
 * unvollständige decodes, und der bot's parser gibt graceful nulls
 * statt zu crashen. UI muss null-tolerant sein.
 */
type OverlayWeather = {
  icao: string;
  raw: string; // raw METAR-string für nerds: "EDDF 121420Z 27015KT ..."
  flightCategory: 'VFR' | 'MVFR' | 'IFR' | 'LIFR' | null;
  wind: {
    direction: number | null; // null = variable
    speed: number; // knots
    gust: number | null;
  } | null;
  visibility: string | null; // "10000", "CAVOK", "9999", "1/2SM"
  weather: string[]; // ["RA", "FG", "TS"] — phenomena codes
  cloudCeilingFt: number | null; // erste BKN/OVC schicht in ft AGL, sonst null
  temperature: number | null; // °C
  dewpoint: number | null; // °C
  qnhHpa: number | null;
  fetchedAt: string;
};

type OverlayActiveResponse = {
  active: true;
  user: OverlayUser;
  network: 'VATSIM' | 'IVAO' | 'Offline';
  // Welle 9 commit 9E: telemetry source — independent of network. ACARS_CLIENT
  // means the desktop-app is feeding 1-2s simconnect data (the "premium" tier),
  // VATSIM_API/IVAO_API mean we're polling the public network feed (~30s),
  // MANUAL/REPLAY are admin-injected. OBS-overlay can render a quality-tier
  // badge based on this.
  dataSource: 'VATSIM_API' | 'IVAO_API' | 'ACARS_CLIENT' | 'MANUAL' | 'REPLAY';
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
  // Welle 10 commit 10A: extended telemetry. ACARS-only fields.
  // Always present (object never null), individual fields nullable.
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
  /**
   * Track 1 #8 Phase 5: Wetter für departure + arrival. Beide einträge
   * können null sein:
   *   - departure null wenn flightPlan.departure null/leer ODER bot den
   *     METAR nicht im cache hat (unbekannte station, VATSIM down)
   *   - analog für arrival
   *   - Beide null = bot ist down ODER keine flight-plan-info → UI rendert
   *     weather-section nicht
   * Wetter wird best-effort gefetched — bot-failures crashen den endpoint
   * NICHT, sondern resulten in null-blocks und das overlay rendert weiter.
   */
  weather: {
    departure: OverlayWeather | null;
    arrival: OverlayWeather | null;
  };
  timestamp: string;
};

type OverlayInactiveResponse = {
  active: false;
  user: OverlayUser;
  message: string;
};

type OverlayErrorResponse = {
  error: string;
  message?: string;
};

// ────────────────────────────────────────────────────────────
// CORS-HEADERS (alle Responses)
// ────────────────────────────────────────────────────────────

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Max-Age': '86400',
};

const NO_CACHE_HEADERS = {
  'Cache-Control': 'no-store, no-cache, must-revalidate',
  Pragma: 'no-cache',
  Expires: '0',
};

// ────────────────────────────────────────────────────────────
// HELPERS
// ────────────────────────────────────────────────────────────

function jsonResponse<T>(
  data: T,
  status: number,
  extraHeaders?: Record<string, string>,
): NextResponse {
  return new NextResponse(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      ...CORS_HEADERS,
      ...NO_CACHE_HEADERS,
      ...extraHeaders,
    },
  });
}

/**
 * Extrahiert die Client-IP aus dem Request.
 * Berücksichtigt Cloudflare-Tunnel-Header und Standard-Proxy-Header.
 */
function getClientIp(req: NextRequest): string {
  // Cloudflare-Tunnel setzt diesen Header
  const cfIp = req.headers.get('cf-connecting-ip');
  if (cfIp) return cfIp;

  // Standard X-Forwarded-For (kann mehrere IPs enthalten, nimm erste)
  const forwarded = req.headers.get('x-forwarded-for');
  if (forwarded) return forwarded.split(',')[0].trim();

  // X-Real-IP als Fallback
  const realIp = req.headers.get('x-real-ip');
  if (realIp) return realIp;

  // Last-resort: unbekannt
  return 'unknown';
}

/**
 * Validiert Token-Format. Schnell-Check vor DB-Zugriff um Bruteforce
 * via Garbage-Tokens zu reduzieren.
 *
 * Erwartetes Format: 32 hex chars (a-f, 0-9), case-insensitive
 */
function isValidTokenFormat(token: string): boolean {
  return /^[0-9a-f]{32}$/i.test(token);
}

/**
 * Track 1 #8 Phase 5 — Reduziert eine bot-CachedMetar zu einer slim
 * OverlayWeather. Returns null wenn raw-METAR fehlt (unwahrscheinlich
 * aber defensive).
 *
 * cloudCeilingFt: erste BKN/OVC schicht (broken/overcast = "ceiling"
 * laut ICAO definition). FEW/SCT zählen nicht — die werden im UI
 * nur als sky-condition-text gezeigt wenn überhaupt.
 */
function reduceMetarForOverlay(
  cached: import('@/lib/metars/fetch-from-bot').CachedMetar,
): OverlayWeather | null {
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
// OPTIONS HANDLER (CORS preflight)
// ────────────────────────────────────────────────────────────

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: CORS_HEADERS,
  });
}

// ────────────────────────────────────────────────────────────
// GET HANDLER
// ────────────────────────────────────────────────────────────

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ token: string }> },
): Promise<NextResponse> {
  const { token } = await params;
  const ip = getClientIp(req);

  // ─── 1. Token-Format-Check (vor DB-Hit, schnell) ──────────
  if (!isValidTokenFormat(token)) {
    recordAuthFail(`bad-format:${ip}`);
    return jsonResponse<OverlayErrorResponse>(
      { error: 'invalid_token_format' },
      401,
    );
  }

  // ─── 2. Rate-Limit ─────────────────────────────────────────
  const rateLimit = checkRateLimit(token, ip);
  const rateLimitHeaders = {
    'X-RateLimit-Limit': String(RATE_LIMITS.TOKEN_REQUESTS_PER_MIN),
    'X-RateLimit-Remaining': String(rateLimit.remaining),
    'X-RateLimit-Reset': String(Math.ceil(rateLimit.resetAt / 1000)),
  };

  if (!rateLimit.allowed) {
    return jsonResponse<OverlayErrorResponse>(
      {
        error: 'rate_limit_exceeded',
        message: `Too many requests. Limited by ${rateLimit.limitedBy}.`,
      },
      429,
      rateLimitHeaders,
    );
  }

  // ─── 3. Token-Lookup ───────────────────────────────────────
  const user = await prisma.user.findUnique({
    where: { overlayToken: token },
    select: {
      id: true,
      name: true,
      rank: { select: { name: true } },
    },
  });

  if (!user) {
    recordAuthFail(`unknown-token:${ip}`);
    return jsonResponse<OverlayErrorResponse>(
      { error: 'invalid_token' },
      401,
      rateLimitHeaders,
    );
  }

  const overlayUser: OverlayUser = {
    callsign: null,
    name: user.name,
    rank: user.rank?.name ?? null,
  };

  // ─── 4. LiveSession-Lookup ─────────────────────────────────
  const session = await prisma.liveSession.findFirst({
    where: {
      userId: user.id,
      isActive: true,
    },
    orderBy: { lastUpdatedAt: 'desc' },
  });

  if (!session) {
    return jsonResponse<OverlayInactiveResponse>(
      {
        active: false,
        user: overlayUser,
        message: 'No active flight',
      },
      200,
      rateLimitHeaders,
    );
  }

  // ─── 5. Optional: Arrival-Airport für Distance/ETA ────────
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
      // ETA: nur wenn airborne mit sinnvoller Speed
      const groundSpeedKmh = session.groundSpeed * 1.852;
      if (groundSpeedKmh > 30) {
        etaMinutes = (distanceToArrivalKm / groundSpeedKmh) * 60;
      }
    }
  }

  // ─── 6. Phase-Detection ────────────────────────────────────
  const phase = detectPhase({
    onGround: session.onGround,
    altitude: session.altitude,
    groundSpeed: session.groundSpeed,
    cruiseAltitude: session.cruiseAltitude,
    distanceToArrivalKm,
  });
  const phaseMeta = FLIGHT_PHASES[phase];

  // ─── 7. Duration ───────────────────────────────────────────
  const durationMinutes = Math.floor(
    (Date.now() - new Date(session.connectedAt).getTime()) / 60_000,
  );

  // ─── 8. Landing-rate (post-touchdown only) ────────────────
  // Look up latest TOUCHDOWN-event for this session if we're plausibly
  // post-touchdown (onGround=true). Skip the query for airborne sessions
  // — saves a DB-hit on the 99% case where the pilot is mid-flight. The
  // ACARS-client emits TOUCHDOWN at runway-contact and BLOCK_ON at
  // parking, so the window we want this populated is roughly
  // touchdown→taxi-in→gate (a few minutes).
  let landingRateFpm: number | null = null;
  if (session.dataSource === 'ACARS_CLIENT' && session.onGround) {
    const touchdown = await prisma.acarsEvent.findFirst({
      where: { sessionId: session.id, type: 'TOUCHDOWN' },
      orderBy: { timestamp: 'desc' },
      select: { payload: true },
    });
    if (touchdown?.payload && typeof touchdown.payload === 'object') {
      const v = (touchdown.payload as Record<string, unknown>).verticalSpeedFpm;
      if (typeof v === 'number' && Number.isFinite(v)) {
        landingRateFpm = Math.round(v);
      } else if (typeof v === 'string') {
        const n = Number.parseFloat(v);
        if (Number.isFinite(n)) landingRateFpm = Math.round(n);
      }
    }
  }

  // ─── 9a. Weather (Track 1 #8 Phase 5, best-effort) ─────────
  // Wir holen METARs für departure + arrival aus dem bot's METAR-cache.
  // fetchMetarsForIcaos ist defensiv: bei bot-down kommt ein leeres
  // dict zurück (kein throw), wir mappen dann beide auf null.
  // Skip ganz wenn weder departure noch arrival ICAO bekannt — kein
  // grund den bot ohne lookup-keys anzufragen.
  const weatherIcaos: string[] = [];
  if (session.departureIcao) weatherIcaos.push(session.departureIcao);
  if (session.arrivalIcao) weatherIcaos.push(session.arrivalIcao);

  const weatherCache =
    weatherIcaos.length > 0
      ? await fetchMetarsForIcaos(weatherIcaos)
      : {};

  const weather = {
    departure: session.departureIcao
      ? (weatherCache[session.departureIcao.toUpperCase()]
          ? reduceMetarForOverlay(
              weatherCache[session.departureIcao.toUpperCase()],
            )
          : null)
      : null,
    arrival: session.arrivalIcao
      ? (weatherCache[session.arrivalIcao.toUpperCase()]
          ? reduceMetarForOverlay(
              weatherCache[session.arrivalIcao.toUpperCase()],
            )
          : null)
      : null,
  };

  // ─── 9. Response ───────────────────────────────────────────
  const response: OverlayActiveResponse = {
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

  return jsonResponse(response, 200, rateLimitHeaders);
}
