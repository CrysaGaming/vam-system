import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@vam/db';
import { authenticateAcarsRequest } from '@/lib/acars/auth';

/**
 * GET /api/acars/status — Welle 9 commit 9B.
 *
 * Bearer-authenticated. The ACARS desktop-client uses this for two things:
 *   1. Connectivity-probe on launch: "is the server reachable + is my
 *      token still valid?" — if 401, the client knows to prompt re-pair.
 *   2. Periodic health-check (every minute or so) so the client can show
 *      a connection-state indicator in its tray-icon.
 *
 * Response: minimal user-info + airline-context + preferred-network.
 *   - airline.icao + name: client uses these to label the connection
 *     ("Connected to: Lufthansa Virtual (DLH)") so the user knows
 *     which airline they're flying for.
 *   - preferredNetwork: client reads this on connect to default the
 *     network-picker. User can still override per-flight in the client
 *     if their setup differs.
 *   - serverTime: client uses this to detect clock-drift between local
 *     machine and server. Heartbeats include client-side timestamps;
 *     a large drift would fail server-side anti-replay validation in 9C.
 */

export async function GET(req: NextRequest) {
  const auth = await authenticateAcarsRequest(req);
  if ('response' in auth) return auth.response;

  // Fetch airline context separately from auth — auth only loads the
  // narrow user-record needed for token-validation. Airline-info isn't
  // every-request data so a separate fetch keeps the auth-helper small.
  const airline = auth.user.airlineId
    ? await prisma.airline.findUnique({
        where: { id: auth.user.airlineId },
        select: { id: true, icao: true, name: true },
      })
    : null;

  return NextResponse.json({
    user: {
      id: auth.user.id,
      name: auth.user.name,
      email: auth.user.email,
    },
    airline,
    preferredNetwork: auth.user.preferredNetwork,
    serverTime: new Date().toISOString(),
  });
}
