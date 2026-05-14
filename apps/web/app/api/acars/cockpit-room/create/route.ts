import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@vam/db';
import { authenticateAcarsRequest } from '@/lib/acars/auth';

/**
 * POST /api/acars/cockpit-room/create — Welle E / E4 phase 1.
 *
 * Creates a new CockpitRoom owned by the authenticated pilot, with the
 * owner auto-enrolled as a CAPTAIN member. The room is opened in OPEN
 * state and ready to accept joins from other pilots.
 *
 * # Auth
 *
 * ACARS bearer-token (same as the rest of /api/acars/*). The endpoint
 * is intended to be called from the tray-client; future browser-side
 * "open cockpit" UI can use the same path with a separately-issued
 * token, or we add a parallel session-cookie variant later.
 *
 * # Body
 *
 * Optional JSON body:
 *   {
 *     "flightId": "ckxxxxxx",   // optional: anchor room to a Booking
 *     "title":    "EDDF-LFPG"   // optional: display name, max 80 chars
 *   }
 *
 * Empty body / no body / non-JSON body are all valid — the room
 * is created as a free-form ad-hoc room with no anchor and no title.
 * We don't 400 on missing body because the path is "open a cockpit
 * right now" and we don't want a parse-error to block that.
 *
 * # Validation
 *
 * - flightId, if provided, must reference a Booking that belongs to
 *   the caller. We don't allow anchoring a room to someone else's
 *   booking — that would be a coordination footgun (pilot A opens a
 *   "room" against pilot B's booking, pilot B has no idea why their
 *   booking is suddenly attached).
 *
 * - Caller must NOT have any other ACTIVE membership. One active
 *   cockpit per pilot at a time. If they're in another room, they
 *   need to /leave it first. Returns 409 conflict with the existing
 *   roomId so the client can prompt the user.
 *
 * # Side effects
 *
 * Creates the Room + the owner's CAPTAIN Member in a single
 * transaction. If anything in the transaction throws, neither row
 * is created — no orphaned rooms with no members.
 *
 * # Response
 *
 * 201 with the created room + initial member list:
 *   {
 *     "room": {
 *       "id", "ownerId", "flightId", "title", "status",
 *       "createdAt", "members": [{ id, pilotId, role, joinedAt }]
 *     }
 *   }
 *
 * Errors:
 *   401 — invalid/missing token (from authenticateAcarsRequest)
 *   403 — flightId references a booking that isn't the caller's
 *   404 — flightId references a booking that doesn't exist
 *   409 — caller already has an ACTIVE membership elsewhere
 *         (response includes the existing roomId for client UX)
 *   500 — transaction failure (rare)
 */
export async function POST(req: NextRequest) {
  const auth = await authenticateAcarsRequest(req);
  if ('response' in auth) return auth.response;

  const { user } = auth;

  // Parse body defensively. Empty body / non-JSON body → treat as
  // empty options. Only a structurally-valid JSON object with the
  // typed fields counts.
  let flightId: string | null = null;
  let title: string | null = null;
  try {
    const body = (await req.json()) as { flightId?: unknown; title?: unknown };
    if (typeof body?.flightId === 'string' && body.flightId.length > 0) {
      flightId = body.flightId;
    }
    if (typeof body?.title === 'string' && body.title.trim().length > 0) {
      // Cap at the schema's varchar(80) to avoid a Prisma error on
      // commit. Trim defensively — leading whitespace is never the
      // user's intent.
      title = body.title.trim().slice(0, 80);
    }
  } catch {
    // Body wasn't JSON; that's fine, just stay with defaults.
  }

  // Validate flightId ownership BEFORE creating the room — we don't
  // want a half-created room hanging around if validation fails.
  if (flightId) {
    const booking = await prisma.booking.findUnique({
      where: { id: flightId },
      select: { id: true, userId: true },
    });
    if (!booking) {
      return NextResponse.json({ error: 'booking-not-found' }, { status: 404 });
    }
    if (booking.userId !== user.id) {
      return NextResponse.json(
        { error: 'booking-not-yours' },
        { status: 403 },
      );
    }
  }

  // One-active-membership rule. We check BEFORE the transaction so we
  // can return a clean 409 with the existing roomId for the client's
  // error UI. If the user has stale ACTIVE rows from a never-cleaned-
  // up room (server crash mid-leave), this protects against silently
  // dual-enrolling them.
  const existingMembership = await prisma.cockpitMember.findFirst({
    where: { pilotId: user.id, status: 'ACTIVE' },
    select: { id: true, roomId: true },
  });
  if (existingMembership) {
    return NextResponse.json(
      {
        error: 'already-in-room',
        existingRoomId: existingMembership.roomId,
      },
      { status: 409 },
    );
  }

  // Transactional create: room + owner-member. interactive transaction
  // because we need the room id to insert the member row, and a single
  // failure should roll back both. Prisma's $transaction with the
  // sequential-array form is enough here — we don't need full
  // interactive-tx isolation.
  const created = await prisma.$transaction(async (tx) => {
    const room = await tx.cockpitRoom.create({
      data: {
        ownerId: user.id,
        flightId,
        title,
        // status defaults to OPEN, no need to set explicitly.
      },
    });
    await tx.cockpitMember.create({
      data: {
        roomId: room.id,
        pilotId: user.id,
        role: 'CAPTAIN',
        // status defaults to ACTIVE, joinedAt defaults to now.
      },
    });
    // Re-fetch with members included so the response matches the
    // shape of /current and /join — uniform response payload across
    // the cockpit-room endpoint family.
    return tx.cockpitRoom.findUniqueOrThrow({
      where: { id: room.id },
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
  });

  return NextResponse.json({ room: created }, { status: 201 });
}
