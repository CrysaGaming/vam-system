import { NextResponse } from 'next/server';
import { prisma } from '@vam/db';
import { resolveEmbedToken } from '@/lib/embed/token';

/**
 * Welle N / N5 — Public embed-state endpoint.
 *
 * Route: GET /api/embed/state/[token]
 *
 * Token-in-URL pattern. No NextAuth cookie required; the token IS
 * the credential, and the URL is meant to be shared (Discord, OBS,
 * Twitch panels). If you don't want it shared, don't share it — or
 * revoke and re-generate.
 *
 * # Payload
 *
 * Identical shape to /api/garmin/state's flat structure (callsign,
 * alt, gs, hdg, dep, arr, onGnd, hbAge, t) so the embed page and the
 * Garmin data-field can share parsing logic. The /m/cockpit-style
 * MobileState shape is too verbose for an iframe widget.
 *
 * # CORS
 *
 * Allow-Origin: * because OBS/Discord/Twitch fetch from sandboxed
 * iframes with no origin headers we can predict. The endpoint is
 * read-only and token-gated, so wildcard CORS is acceptable. Cache-
 * Control: no-store so embed widgets always see fresh data.
 */
export const dynamic = 'force-dynamic';

const HEADERS = {
  'Cache-Control': 'no-store',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
};

export async function GET(
  _req: Request,
  context: { params: Promise<{ token: string }> },
) {
  const { token } = await context.params;
  const resolved = await resolveEmbedToken(token);
  if (!resolved) {
    return NextResponse.json(
      { error: 'unauthorized' },
      { status: 401, headers: HEADERS },
    );
  }

  const live = await prisma.liveSession.findFirst({
    where: { userId: resolved.userId, isActive: true },
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
    // 200 statt 404 — der embed-client soll "NO FLT" zeigen statt
    // einen error-state. Anders als /api/garmin/state, weil der
    // embed-frame durchgehend rendert.
    return NextResponse.json(
      {
        t: new Date().toISOString(),
        session: null,
      },
      { status: 200, headers: HEADERS },
    );
  }

  return NextResponse.json(
    {
      t: new Date().toISOString(),
      session: {
        callsign: live.callsign,
        alt: Math.round(live.altitude),
        gs: Math.round(live.groundSpeed),
        hdg: Math.round(live.heading),
        dep: live.departureIcao,
        arr: live.arrivalIcao,
        onGnd: live.onGround,
        hbAge: live.lastAcarsHeartbeat
          ? Math.round(
              (Date.now() - live.lastAcarsHeartbeat.getTime()) / 1000,
            )
          : null,
      },
    },
    { status: 200, headers: HEADERS },
  );
}

// Pre-flight CORS for browsers that send OPTIONS before GET. Most
// embeds won't — they `<iframe src>` directly — but Discord Activities
// (and any fetch-from-JS overlay) do.
export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: HEADERS });
}
