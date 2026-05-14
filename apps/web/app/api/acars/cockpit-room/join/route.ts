import { NextRequest, NextResponse } from 'next/server';
import { prisma, type CockpitRole } from '@vam/db';
import { authenticateAcarsRequest } from '@/lib/acars/auth';

/**
 * POST /api/acars/cockpit-room/join — Welle E / E4 phase 1.
 *
 * Joins the authenticated pilot as a member of an existing OPEN room
 * with the requested role.
 *
 * # Auth
 *
 * ACARS bearer-token, same as /create. The token-bearer is the joining
 * pilot; we never accept a "join on behalf of someone else" parameter.
 *
 * # Body
 *
 * Required JSON:
 *   {
 *     "roomId": "ckxxxxxx",                              // required
 *     "role":   "FIRST_OFFICER" | "RELIEF" | "OBSERVER"  // optional
 *   }
 *
 * role defaults to FIRST_OFFICER if absent or unrecognized. CAPTAIN
 * is NOT a valid join-role — the captaincy is implied by ownership;
 * a captain-role member is only created via /create. This avoids
 * confusion where a room has two pilots both calling themselves
 * "Captain" through the join channel.
 *
 * # Validation order
 *
 *   1. Authenticated token (handled by helper, returns 401 directly).
 *   2. roomId present + non-empty (400).
 *   3. Caller has no other ACTIVE membership (409 with existingRoomId).
 *   4. Room exists (404).
 *   5. Room status is OPEN (410 — "gone", room closed).
 *   6. Caller is NOT already an ACTIVE member of THIS room (409 —
 *      idempotent-ish: surface their existing membership rather than
 *      creating a duplicate row).
 *
 * Why 410 vs 403 for closed rooms: 410 ("gone") more accurately
 * describes "this room exists in history but is no longer joinable",
 * which is what CLOSED means in our model. 403 would imply "you're
 * not allowed" which isn't quite right — nobody is allowed to join a
 * closed room, including the owner.
 *
 * # Stale-LEFT-row handling
 *
 * If the caller has a LEFT row from a prior membership in THIS room,
 * we create a NEW ACTIVE row rather than reactivating the old one.
 * Keeps the audit trail cleaner ("pilot joined twice with a gap")
 * and avoids confusion about which joinedAt timestamp applies. The
 * old LEFT row stays as historical breadcrumb.
 *
 * # Response
 *
 * 200 with the updated room + member list, matching /create's shape:
 *   { "room": { ...same fields..., members: [...] } }
 *
 * Errors:
 *   400 — missing/empty roomId
 *   401 — bad token
 *   404 — room not found
 *   409 — already in ANOTHER room (existingRoomId in payload)
 *         OR already an ACTIVE member of THIS room
 *   410 — room is CLOSED, no new joins allowed
 */
export async function POST(req: NextRequest) {
  const auth = await authenticateAcarsRequest(req);
  if ('response' in auth) return auth.response;

  const { user } = auth;

  // Parse + validate body. Unlike /create, the roomId is REQUIRED
  // here — there's no sensible default for "which room to join".
  let roomId: string | null = null;
  let requestedRole: CockpitRole = 'FIRST_OFFICER';
  try {
    const body = (await req.json()) as { roomId?: unknown; role?: unknown };
    if (typeof body?.roomId === 'string' && body.roomId.length > 0) {
      roomId = body.roomId;
    }
    if (typeof body?.role === 'string') {
      // Allowed via this endpoint: FIRST_OFFICER, RELIEF, OBSERVER.
      // CAPTAIN explicitly excluded — see endpoint docstring.
      if (
        body.role === 'FIRST_OFFICER' ||
        body.role === 'RELIEF' ||
        body.role === 'OBSERVER'
      ) {
        requestedRole = body.role;
      }
    }
  } catch {
    // Fall through to the roomId-null check below — same 400 path.
  }

  if (!roomId) {
    return NextResponse.json(
      { error: 'roomId-required' },
      { status: 400 },
    );
  }

  // Check #3: caller already in another active room. Single query —
  // we need to know both whether they have ANY active membership AND
  // whether it's in THIS room (different error codes).
  const existingMembership = await prisma.cockpitMember.findFirst({
    where: { pilotId: user.id, status: 'ACTIVE' },
    select: { id: true, roomId: true },
  });
  if (existingMembership) {
    if (existingMembership.roomId === roomId) {
      // Already an active member of the requested room — 409 but
      // with a slightly different shape so the client can decide
      // whether to surface as "already joined" (silent success) or
      // "you're already here" (informational).
      return NextResponse.json(
        {
          error: 'already-member-of-this-room',
          existingRoomId: roomId,
          existingMembershipId: existingMembership.id,
        },
        { status: 409 },
      );
    }
    return NextResponse.json(
      {
        error: 'already-in-room',
        existingRoomId: existingMembership.roomId,
      },
      { status: 409 },
    );
  }

  // Check #4 + #5: room exists + is open. Combined into one query.
  const room = await prisma.cockpitRoom.findUnique({
    where: { id: roomId },
    select: { id: true, status: true },
  });
  if (!room) {
    return NextResponse.json({ error: 'room-not-found' }, { status: 404 });
  }
  if (room.status !== 'OPEN') {
    return NextResponse.json({ error: 'room-closed' }, { status: 410 });
  }

  // Create the membership. We don't need a transaction here — the
  // room exists, the caller has no other active membership, and the
  // create is atomic on its own. Even if a concurrent /create or
  // /join landed between our checks and this insert, the worst case
  // is a transient duplicate-active-membership which the next /leave
  // or /current would surface; the client can self-correct.
  await prisma.cockpitMember.create({
    data: {
      roomId,
      pilotId: user.id,
      role: requestedRole,
      // status defaults ACTIVE, joinedAt defaults to now.
    },
  });

  // Bump the room's updatedAt so a parent /current poller (or future
  // websocket-trigger) can detect "something changed". Prisma's
  // @updatedAt only fires when a column on the row itself changes —
  // adding a member doesn't trigger it. We touch the title field by
  // re-assigning its current value to force the update; this is the
  // simplest pattern that doesn't require a dedicated "updatedAt"
  // setter. The alternative (a join-counter column) bloats the
  // schema for negligible benefit.
  //
  // EDIT: actually, simpler to update updatedAt directly via
  // prisma.cockpitRoom.update which is documented to fire @updatedAt.
  // Set the same field back to its current value (no-op data change)
  // to trigger the timestamp bump.
  await prisma.cockpitRoom.update({
    where: { id: roomId },
    data: { updatedAt: new Date() },
  });

  // Return the room with its active members so the client gets the
  // post-join state in one call. Mirrors /create's response shape.
  const fullRoom = await prisma.cockpitRoom.findUniqueOrThrow({
    where: { id: roomId },
    include: {
      members: {
        where: { status: 'ACTIVE' },
        select: {
          id: true,
          pilotId: true,
          role: true,
          joinedAt: true,
        },
      },
    },
  });

  return NextResponse.json({ room: fullRoom }, { status: 200 });
}
