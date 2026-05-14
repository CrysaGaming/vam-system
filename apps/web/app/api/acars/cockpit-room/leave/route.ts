import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@vam/db';
import { authenticateAcarsRequest } from '@/lib/acars/auth';

/**
 * POST /api/acars/cockpit-room/leave — Welle E / E4 phase 1.
 *
 * Marks the authenticated pilot's currently-active CockpitMember row
 * as LEFT, with leftAt=now. If the pilot was the owner AND was the
 * last ACTIVE member, the room is also auto-closed.
 *
 * # Auth
 *
 * ACARS bearer-token, same as the rest of the family.
 *
 * # Body
 *
 * Empty / no body. The pilot can only have ONE active membership at a
 * time (enforced by /create and /join), so there's no ambiguity about
 * which room to leave. The server simply finds the caller's ACTIVE
 * row and flips it.
 *
 * # Auto-close logic
 *
 * After the membership is marked LEFT, we count remaining ACTIVE
 * members. If zero AND the leaving pilot was the room's owner, the
 * room transitions to CLOSED with closedAt=now. This handles the
 * common case of a captain opening a room, no one joining, then the
 * captain disconnecting — the room shouldn't linger as OPEN forever.
 *
 * Special case: owner leaves but other members are still ACTIVE. We
 * leave the room OPEN. The captaincy is implied by ownerId, which we
 * don't transfer (owner can re-join later and resume). This is a
 * deliberate v1 choice — alternative would be auto-promoting a
 * remaining FIRST_OFFICER, but ownership transfer adds enough
 * complexity that we punt to v2.
 *
 * Special case: non-owner leaves and the owner has already left. The
 * room stays OPEN but effectively orphaned. The next non-owner leave
 * still won't trigger auto-close (since they're not the owner). This
 * is acceptable for v1 — operationally rare, admin can close manually
 * via a future /close endpoint or DB query. Logged as a TODO below.
 *
 * # Response
 *
 *   200 with the updated room snapshot (same shape as /create/join):
 *     { room: {..., status: 'OPEN'|'CLOSED', members: [active-only]} }
 *
 *   200 with room=null when caller had no active membership to leave.
 *   This is INTENTIONALLY 200, not 404 — "leave" is idempotent from
 *   the caller's perspective: if they weren't in any room and they
 *   call leave, they end up not in any room. The client doesn't need
 *   an error path for that.
 *
 * Errors:
 *   401 — invalid/missing token
 */
export async function POST(req: NextRequest) {
  const auth = await authenticateAcarsRequest(req);
  if ('response' in auth) return auth.response;

  const { user } = auth;

  // Find the caller's ACTIVE membership (if any). One-active-rule
  // means this is unique by construction; we use findFirst rather
  // than findUnique because the unique-by-pilotId-where-status=ACTIVE
  // isn't a Prisma unique-constraint (would need partial unique
  // which isn't natively supported in their @@unique syntax).
  const membership = await prisma.cockpitMember.findFirst({
    where: { pilotId: user.id, status: 'ACTIVE' },
    select: { id: true, roomId: true, room: { select: { ownerId: true } } },
  });

  if (!membership) {
    // No-op idempotent leave. Return success with room=null so the
    // client can update its UI without distinguishing "left" from
    // "wasn't in a room".
    return NextResponse.json({ room: null }, { status: 200 });
  }

  // Two-step path: mark member LEFT, then conditionally close the
  // room. We could wrap these in a $transaction but the second step
  // is a guarded conditional that's safe to run separately — even if
  // we crashed between them, the worst case is a closed-but-still-
  // OPEN-flagged room which the next /current or admin-cleanup would
  // surface. Avoiding the transaction keeps the hot path simpler.
  await prisma.cockpitMember.update({
    where: { id: membership.id },
    data: {
      status: 'LEFT',
      leftAt: new Date(),
    },
  });

  // Auto-close check. Two conditions must BOTH hold:
  //   1. Caller is the room's owner.
  //   2. No ACTIVE members remain (post-update).
  //
  // We re-count from the DB rather than computing locally — keeps
  // the auto-close logic resilient to concurrent joins/leaves that
  // landed between findFirst and update above. Cheap query (covered
  // by the (roomId) index).
  //
  // TODO(welle-E4-phase-2): consider also auto-closing when ALL
  // remaining members (regardless of ownership) have left. For v1
  // we leave non-owner-only rooms as orphan-OPEN; ops can sweep
  // via a periodic job once we observe how often this happens.
  const isOwner = membership.room.ownerId === user.id;
  if (isOwner) {
    const activeCount = await prisma.cockpitMember.count({
      where: { roomId: membership.roomId, status: 'ACTIVE' },
    });
    if (activeCount === 0) {
      await prisma.cockpitRoom.update({
        where: { id: membership.roomId },
        data: {
          status: 'CLOSED',
          closedAt: new Date(),
        },
      });
    } else {
      // Owner left but others are still here. Touch updatedAt so
      // pollers see the change, but leave status OPEN.
      await prisma.cockpitRoom.update({
        where: { id: membership.roomId },
        data: { updatedAt: new Date() },
      });
    }
  } else {
    // Non-owner left. Touch updatedAt for pollers.
    await prisma.cockpitRoom.update({
      where: { id: membership.roomId },
      data: { updatedAt: new Date() },
    });
  }

  // Re-fetch the final state. Members filtered to ACTIVE only —
  // matches /create + /join responses so the client doesn't need
  // branching to render the post-leave list.
  const room = await prisma.cockpitRoom.findUnique({
    where: { id: membership.roomId },
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

  return NextResponse.json({ room }, { status: 200 });
}
