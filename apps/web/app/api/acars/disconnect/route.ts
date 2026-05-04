import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@vam/db';
import { authenticateAcarsRequest } from '@/lib/acars/auth';

/**
 * POST /api/acars/disconnect — Welle 9 commit 9C.
 *
 * Graceful shutdown signal from the ACARS-client. The client should call
 * this when the user closes the app, or when the sim disconnects cleanly,
 * so the live-map can immediately drop the pilot's marker rather than
 * waiting for a heartbeat-timeout cleanup.
 *
 * Effects:
 *   - Marks the active ACARS-session as isActive=false.
 *   - Does NOT delete the session or its positions — those stay for
 *     PIREP-replay / audit. The 9F auto-PIREP-trigger may still fire
 *     for this session if a BLOCK_ON event arrives via /api/acars/event
 *     before disconnect (race-tolerant by design).
 *   - Does NOT invalidate the bearer token — disconnect is "this flight
 *     is done", not "I'm un-pairing". The /settings/disconnectAcars
 *     server-action handles token revocation.
 *
 * Idempotent: calling on an already-inactive session is a no-op (no
 * sessions matched, returns ok). Acceptable response either way — the
 * client doesn't need to know whether the disconnect actually changed
 * anything.
 */

export async function POST(req: NextRequest) {
  const auth = await authenticateAcarsRequest(req);
  if ('response' in auth) return auth.response;

  const result = await prisma.liveSession.updateMany({
    where: {
      userId: auth.user.id,
      dataSource: 'ACARS_CLIENT',
      isActive: true,
    },
    data: {
      isActive: false,
      lastUpdatedAt: new Date(),
    },
  });

  return NextResponse.json({ ok: true, sessionsClosed: result.count });
}
