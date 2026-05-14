import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@vam/db';
import { authenticateAcarsRequest } from '@/lib/acars/auth';

/**
 * GET /api/acars/cockpit-room/current — Welle E / E4 phase 1.
 *
 * Returns the calling pilot's currently-active room, or null. Intended
 * for the ACARS tray-client to poll periodically (~10s) so it can
 * reflect "you're in a cockpit with N other pilots" in the UI without
 * the client having to maintain its own state across reconnects.
 *
 * # Auth
 *
 * ACARS bearer-token, same as the rest of the family.
 *
 * # Behavior
 *
 * Looks up the caller's ACTIVE CockpitMember row. If found, returns
 * the full room with ALL active members (so the client gets a
 * complete picture of who's in the cockpit). If not, returns null.
 *
 * # Pilot-name enrichment
 *
 * Member rows include the pilot's display name + id so the client UI
 * can render "Captain: Kevin (CAPTAIN), FO: Anna (FIRST_OFFICER)"
 * without doing a separate user-lookup. This is a deliberate
 * de-normalization at response-time (not stored on the row) — pilot
 * names can change in the User table without invalidating
 * historical CockpitMember rows.
 *
 * # Response
 *
 *   { "room": { ...full room with members[*].pilot.{id, name} } }
 *
 *   When the caller isn't in any active room:
 *   { "room": null }
 *
 *   Both cases return 200. The client decides UI state based on the
 *   room field.
 *
 * # Cache
 *
 * Cache-Control: no-store. Same reasoning as the /api/mobile/state
 * polling endpoint — caching room state would let the client see
 * stale member lists during a join/leave, which would be confusing.
 *
 * Errors:
 *   401 — invalid/missing token
 */
export async function GET(req: NextRequest) {
  const auth = await authenticateAcarsRequest(req);
  if ('response' in auth) return auth.response;

  const { user } = auth;

  // Find the caller's active membership. orderBy joinedAt desc is a
  // defensive tie-breaker for the (rare) case of multiple ACTIVE
  // rows existing simultaneously due to a server-crash race; we
  // always show the most-recently-joined one.
  const membership = await prisma.cockpitMember.findFirst({
    where: { pilotId: user.id, status: 'ACTIVE' },
    orderBy: { joinedAt: 'desc' },
    select: { roomId: true },
  });

  if (!membership) {
    return NextResponse.json(
      { room: null },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  }

  // Single query for the full room view. We include only ACTIVE
  // members in the response — LEFT rows are historical and shouldn't
  // appear in "who's in the cockpit RIGHT NOW" lookups. The orderBy
  // on members ensures a stable render order across polls (the
  // owner-as-CAPTAIN typically lands first because joinedAt was set
  // at room-create-time).
  const room = await prisma.cockpitRoom.findUnique({
    where: { id: membership.roomId },
    include: {
      members: {
        where: { status: 'ACTIVE' },
        orderBy: { joinedAt: 'asc' },
        select: {
          id: true,
          pilotId: true,
          role: true,
          joinedAt: true,
          // Embed minimal pilot identity. Just id + name + image so
          // the client can render avatars. We deliberately don't
          // expose email, airline, or other PII through this
          // endpoint — that's what /pilots/[id] is for if the client
          // wants more detail.
          pilot: {
            select: {
              id: true,
              name: true,
              image: true,
            },
          },
        },
      },
    },
  });

  // If room=null here, it means the membership row pointed at a
  // room that was deleted (cascade-delete of owner, e.g.). The
  // ACTIVE membership is now orphan but the prisma cascade should
  // have cleaned it up. Defensive 200/null rather than crash.
  if (!room) {
    return NextResponse.json(
      { room: null },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  }

  return NextResponse.json(
    { room },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
