import { NextRequest, NextResponse } from 'next/server';
import { prisma, type Prisma } from '@vam/db';

/**
 * Bearer-token authentication helper for /api/acars/* endpoints
 * (Welle 9 commit 9B).
 *
 * Verifies the `Authorization: Bearer <token>` header against the
 * User.acarsToken column (@unique, indexed). Returns either:
 *   - { user: User } on success, or
 *   - { response: NextResponse } that the route handler should return as-is
 *
 * Why pre-built NextResponse on failure: keeps every caller's code path
 * uniform — `if ('response' in result) return result.response`. No
 * thrown exceptions, no try/catch noise. The response is always
 * JSON-shaped so the ACARS-client can parse it consistently.
 *
 * Token-rotation impact: if a user disconnects (acarsToken=null), the
 * lookup fails and the next heartbeat gets 401. The ACARS-client should
 * detect 401, stop the heartbeat-loop, and prompt the user to re-pair.
 *
 * Database-load: every heartbeat hits this query. The @unique index on
 * acarsToken makes it O(log n) — at scale (1M users, ~10 heartbeats/sec)
 * Postgres handles this trivially. If we ever profile a hotspot here,
 * the move would be a per-process LRU cache keyed by token-prefix.
 */

export type AcarsAuthResult =
  | {
      user: Prisma.UserGetPayload<{
        select: {
          id: true;
          name: true;
          email: true;
          airlineId: true;
          preferredNetwork: true;
        };
      }>;
    }
  | { response: NextResponse };

export async function authenticateAcarsRequest(
  req: NextRequest,
): Promise<AcarsAuthResult> {
  const header = req.headers.get('authorization');
  if (!header || !header.startsWith('Bearer ')) {
    return {
      response: NextResponse.json(
        { error: 'missing-bearer-token' },
        { status: 401 },
      ),
    };
  }

  const token = header.slice(7).trim();
  if (token.length === 0) {
    return {
      response: NextResponse.json(
        { error: 'empty-bearer-token' },
        { status: 401 },
      ),
    };
  }

  const user = await prisma.user.findUnique({
    where: { acarsToken: token },
    select: {
      id: true,
      name: true,
      email: true,
      airlineId: true,
      preferredNetwork: true,
    },
  });

  if (!user) {
    // Same response for "no such token" and "wrong token" — don't leak
    // anything an attacker could use to enumerate.
    return {
      response: NextResponse.json({ error: 'invalid-token' }, { status: 401 }),
    };
  }

  return { user };
}
