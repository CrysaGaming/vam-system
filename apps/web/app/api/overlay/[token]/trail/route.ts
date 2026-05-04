/**
 * Public Overlay Trail API — Welle 10 commit 10C.
 *
 * Endpoint: GET /api/overlay/[token]/trail
 *
 * Liefert die letzten N Positionen einer aktiven Live-Session als
 * lightweight polyline-payload für die mini-map im OBS-overlay.
 * Same auth/cors/rate-limit pattern wie /api/overlay/[token]/data —
 * unterscheidet sich nur in: was zurückgegeben wird (positions-array
 * statt session-snapshot) und wie oft gepollt (langsamer, ~10s,
 * weil trail sich incremental ändert).
 *
 * Coordinate-system: rohe lat/lng. Die client-side mini-map projiziert
 * equirectangular auf SVG-viewport. Für die typische trail-länge
 * (kurz- bis mittelstrecke) ist die distortion vernachlässigbar.
 * Polar-flüge oder zickzack-around-the-international-date-line würden
 * komisch aussehen — out of scope für MVP.
 *
 * Query-params:
 *   ?n=200    Override default 100, capped at 500. Mehr punkte =
 *             smoother polyline aber größere payload.
 *
 * Response shapes:
 *   active=false:  { active: false }
 *   active=true:   { active: true, sessionId, points: [...],
 *                    departure: {icao, lat, lng}|null,
 *                    arrival:   {icao, lat, lng}|null,
 *                    current:   {lat, lng, heading} }
 *
 * Privacy: identisch zur data-route — nur flight-tracking-data,
 * keine email/discord/PIREP-history. Der trail leakt grundsätzlich
 * mehr (route-history) als data (snapshot), aber alles was im trail
 * ist wäre auch via wiederholtes data-polling rekonstruierbar — das
 * trail-endpoint ist nur der convenience-shortcut.
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@vam/db';
import {
  checkRateLimit,
  recordAuthFail,
  RATE_LIMITS,
} from '@/lib/rate-limit';

// ────────────────────────────────────────────────────────────
// RESPONSE TYPES
// ────────────────────────────────────────────────────────────

type TrailPoint = {
  /** Latitude in degrees */
  lat: number;
  /** Longitude in degrees */
  lng: number;
  /** Altitude in feet (msl) */
  alt: number;
  /** Recorded-at timestamp, ISO-8601 */
  t: string;
  /** Phase-id when this point was recorded (ACARS-only, null otherwise) */
  phase: string | null;
};

type TrailAirport = {
  icao: string;
  lat: number;
  lng: number;
};

type TrailActiveResponse = {
  active: true;
  sessionId: string;
  points: TrailPoint[];
  departure: TrailAirport | null;
  arrival: TrailAirport | null;
  current: {
    lat: number;
    lng: number;
    heading: number;
  };
};

type TrailInactiveResponse = {
  active: false;
  message: string;
};

type TrailErrorResponse = {
  error: string;
  message?: string;
};

// ────────────────────────────────────────────────────────────
// CONFIG
// ────────────────────────────────────────────────────────────

const DEFAULT_POINT_LIMIT = 100;
const MAX_POINT_LIMIT = 500;

// ────────────────────────────────────────────────────────────
// CORS + CACHE HEADERS
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

function getClientIp(req: NextRequest): string {
  const cfIp = req.headers.get('cf-connecting-ip');
  if (cfIp) return cfIp;
  const forwarded = req.headers.get('x-forwarded-for');
  if (forwarded) return forwarded.split(',')[0].trim();
  const realIp = req.headers.get('x-real-ip');
  if (realIp) return realIp;
  return 'unknown';
}

function isValidTokenFormat(token: string): boolean {
  return /^[0-9a-f]{32}$/i.test(token);
}

// ────────────────────────────────────────────────────────────
// HANDLERS
// ────────────────────────────────────────────────────────────

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: CORS_HEADERS,
  });
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ token: string }> },
): Promise<NextResponse> {
  const { token } = await params;
  const ip = getClientIp(req);

  // Token-format-pre-check before DB hit (same pattern as data-route).
  if (!isValidTokenFormat(token)) {
    recordAuthFail(`bad-format:${ip}`);
    return jsonResponse<TrailErrorResponse>(
      { error: 'invalid_token_format' },
      401,
    );
  }

  // Rate-limit shares the same bucket as /data — both routes use the
  // user's overlay-token as the identifier. A streamer running both
  // data-poll (5s) and trail-poll (10s) gets ~18 req/min total which
  // is well under the 100/min limit. Sharing the bucket means a
  // misconfigured client can't double its allowance by hitting both
  // routes at full speed.
  const rateLimit = checkRateLimit(token, ip);
  const rateLimitHeaders = {
    'X-RateLimit-Limit': String(RATE_LIMITS.TOKEN_REQUESTS_PER_MIN),
    'X-RateLimit-Remaining': String(rateLimit.remaining),
    'X-RateLimit-Reset': String(Math.ceil(rateLimit.resetAt / 1000)),
  };

  if (!rateLimit.allowed) {
    return jsonResponse<TrailErrorResponse>(
      {
        error: 'rate_limit_exceeded',
        message: `Too many requests. Limited by ${rateLimit.limitedBy}.`,
      },
      429,
      rateLimitHeaders,
    );
  }

  // Token-lookup — only the user-id is needed. The user's session
  // is then queried by userId.
  const user = await prisma.user.findUnique({
    where: { overlayToken: token },
    select: { id: true },
  });

  if (!user) {
    recordAuthFail(`unknown-token:${ip}`);
    return jsonResponse<TrailErrorResponse>(
      { error: 'invalid_token' },
      401,
      rateLimitHeaders,
    );
  }

  // Active session lookup — same dedup-by-userId-isActive as the
  // data-route. If the user has multiple active sessions (shouldn't
  // happen, but possible during ACARS+VATSIM transition), pick the
  // most-recently-updated one.
  const session = await prisma.liveSession.findFirst({
    where: {
      userId: user.id,
      isActive: true,
    },
    orderBy: { lastUpdatedAt: 'desc' },
    select: {
      id: true,
      latitude: true,
      longitude: true,
      heading: true,
      departureIcao: true,
      arrivalIcao: true,
    },
  });

  if (!session) {
    return jsonResponse<TrailInactiveResponse>(
      {
        active: false,
        message: 'No active flight',
      },
      200,
      rateLimitHeaders,
    );
  }

  // Parse n=… query-param. Out-of-range / non-numeric values fall
  // back to the default rather than 400ing — keeps the URL-builder
  // tolerant.
  const url = new URL(req.url);
  const nRaw = url.searchParams.get('n');
  const nParsed = nRaw ? Number.parseInt(nRaw, 10) : DEFAULT_POINT_LIMIT;
  const limit =
    Number.isFinite(nParsed) && nParsed > 0
      ? Math.min(nParsed, MAX_POINT_LIMIT)
      : DEFAULT_POINT_LIMIT;

  // Position-fetch + airport-resolution in parallel. Most flights have
  // both ICAOs; if one is missing the response just has null in that
  // slot. We don't fail the whole trail if one airport isn't in the
  // catalog — the polyline still renders, just without the start/end
  // markers.
  const [points, departure, arrival] = await Promise.all([
    prisma.liveSessionPosition.findMany({
      where: { sessionId: session.id },
      orderBy: { recordedAt: 'desc' }, // newest first for the LIMIT cut
      take: limit,
      select: {
        latitude: true,
        longitude: true,
        altitude: true,
        recordedAt: true,
        phase: true,
      },
    }),
    session.departureIcao
      ? prisma.airport.findUnique({
          where: { icao: session.departureIcao },
          select: { icao: true, latitude: true, longitude: true },
        })
      : Promise.resolve(null),
    session.arrivalIcao
      ? prisma.airport.findUnique({
          where: { icao: session.arrivalIcao },
          select: { icao: true, latitude: true, longitude: true },
        })
      : Promise.resolve(null),
  ]);

  // Reverse to chronological-ascending so the client can render the
  // polyline in flight-order (oldest at start, newest at end). The
  // DB-query is descending+limited because we want "the last N", not
  // "the first N" — reversing in JS is O(n) and the array is small.
  const orderedPoints: TrailPoint[] = points
    .reverse()
    .map((p) => ({
      lat: p.latitude,
      lng: p.longitude,
      alt: p.altitude,
      t: p.recordedAt.toISOString(),
      phase: p.phase,
    }));

  const response: TrailActiveResponse = {
    active: true,
    sessionId: session.id,
    points: orderedPoints,
    departure: departure
      ? {
          icao: departure.icao,
          lat: departure.latitude,
          lng: departure.longitude,
        }
      : null,
    arrival: arrival
      ? {
          icao: arrival.icao,
          lat: arrival.latitude,
          lng: arrival.longitude,
        }
      : null,
    current: {
      lat: session.latitude,
      lng: session.longitude,
      heading: session.heading,
    },
  };

  return jsonResponse(response, 200, rateLimitHeaders);
}
