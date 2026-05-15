import { NextResponse } from 'next/server';
import { prisma } from '@vam/db';
import { verifyBearer } from '@/lib/garmin/token';

/**
 * Welle N / N4 — Garmin Connect IQ telemetry endpoint.
 *
 * Route: GET /api/garmin/state
 *
 * Bearer-token auth (vs cookie-auth on /api/mobile/state) because
 * Garmin's Connect-IQ HTTP-stack (Communications.makeWebRequest) has
 * no cookie jar. Token is generated in /settings/garmin and pasted
 * into the Connect-IQ phone-app settings.
 *
 * # Payload
 *
 * Tiny on purpose. Garmin watches have ~32-64 KB heap for the entire
 * data-field; parsing a 50-field JSON would OOM. We return 5 fields
 * + a timestamp + a flat structure (no nested session object).
 *
 * # Caching
 *
 * No-store: every request hits the DB. Connect-IQ data-fields poll at
 * 5-10s intervals during active flight, and we want fresh data each
 * time. Index on (userId, isActive) keeps this cheap.
 *
 * # Errors
 *
 * 401 if token invalid/revoked. 404 if no active LiveSession (vs the
 * /api/mobile/state pattern of always-200 with null) — Connect-IQ's
 * error-handling is simpler with HTTP status codes than null-checks.
 */
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const auth = req.headers.get('authorization');
  const verified = await verifyBearer(auth);
  if (!verified) {
    return NextResponse.json(
      { error: 'unauthorized' },
      { status: 401, headers: { 'Cache-Control': 'no-store' } },
    );
  }

  const live = await prisma.liveSession.findFirst({
    where: { userId: verified.userId, isActive: true },
    orderBy: { lastUpdatedAt: 'desc' },
    select: {
      callsign: true,
      altitude: true,
      groundSpeed: true,
      heading: true,
      departureIcao: true,
      arrivalIcao: true,
      onGround: true,
      lastUpdatedAt: true,
      lastAcarsHeartbeat: true,
    },
  });

  if (!live) {
    return NextResponse.json(
      { error: 'no-active-session' },
      { status: 404, headers: { 'Cache-Control': 'no-store' } },
    );
  }

  // Flat shape — Connect-IQ JSON-parser is happier without nesting.
  // Numeric fields rounded to ints (watch display rounds anyway, no
  // sense paying for float-parse overhead).
  return NextResponse.json(
    {
      t: new Date().toISOString(),
      callsign: live.callsign,
      alt: Math.round(live.altitude),
      gs: Math.round(live.groundSpeed),
      hdg: Math.round(live.heading),
      dep: live.departureIcao,
      arr: live.arrivalIcao,
      onGnd: live.onGround,
      hbAge:
        live.lastAcarsHeartbeat
          ? Math.round(
              (Date.now() - live.lastAcarsHeartbeat.getTime()) / 1000,
            )
          : null,
    },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
