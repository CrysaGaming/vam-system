import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@vam/db';
import { generateAcarsToken, looksLikePairingCode } from '@/lib/acars/pairing';

/**
 * POST /api/acars/pairing/redeem — Welle 9 commit 9B.
 *
 * Public endpoint (no auth — the code IS the auth). The ACARS desktop-
 * client posts the code the user typed in, gets back a long-lived
 * bearer-token to use on subsequent /api/acars/* calls.
 *
 * Body: { code: "X4F-7K2-9PB" }
 * Response 200: { token, user: { id, name, email } }
 * Response 400: { error: "invalid-format" | "invalid-or-expired" }
 *
 * Atomicity: rotates the user's old token (if any) AND marks the code
 * consumed in a single transaction. If either step fails, neither
 * commits — preventing the failure mode where a token is issued but the
 * code remains usable, or vice versa.
 *
 * Returns minimal user-info (id/name/email): the ACARS-client uses this
 * to show "Hello, Kevin" on its connected-screen. Email is included
 * for support-ticket-correlation; nothing else from the user-record is
 * exposed (no Discord-id, no ranks, no hours — those are not the
 * client's business).
 *
 * Security:
 *   - No auth-bypass possible: only valid+unconsumed+unexpired codes redeem.
 *   - Brute-force: 32^9 keyspace + 15-min TTL + (in 9C) IP-based rate-limit.
 *   - Replay: a redeemed code is dead immediately (consumedAt set).
 *   - Pairing-while-paired: if the user already has a token, this
 *     overwrites it. Old token becomes unusable. That's the correct
 *     behavior for "I'm pairing on a new device".
 */

const RedeemSchema = z.object({
  code: z.string().min(11).max(11), // exactly "XXX-XXX-XXX" (9 chars + 2 dashes)
});

export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid-body' }, { status: 400 });
  }

  const parsed = RedeemSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid-format' }, { status: 400 });
  }

  const code = parsed.data.code.toUpperCase();

  // Cheap format-check before hitting the DB. Mistyped codes ("X4F7K29PB"
  // missing dashes, or lower-case) get rejected here without consuming
  // a query.
  if (!looksLikePairingCode(code)) {
    return NextResponse.json({ error: 'invalid-format' }, { status: 400 });
  }

  const pairing = await prisma.acarsPairingCode.findUnique({
    where: { code },
    include: {
      user: { select: { id: true, name: true, email: true } },
    },
  });

  // Identical response for "doesn't exist" / "consumed" / "expired" —
  // keeps an attacker from probing which codes have ever been issued.
  if (!pairing || pairing.consumedAt || pairing.expiresAt < new Date()) {
    return NextResponse.json(
      { error: 'invalid-or-expired' },
      { status: 400 },
    );
  }

  const acarsToken = generateAcarsToken();
  const now = new Date();

  await prisma.$transaction([
    prisma.user.update({
      where: { id: pairing.userId },
      data: {
        acarsToken,
        acarsPairedAt: now,
        // acarsLastSeen NOT set here — that's the heartbeat's job. Setting
        // it here would render "online" on the settings card before the
        // client actually starts heartbeating, which is misleading.
      },
    }),
    prisma.acarsPairingCode.update({
      where: { id: pairing.id },
      data: { consumedAt: now },
    }),
  ]);

  return NextResponse.json({
    token: acarsToken,
    user: {
      id: pairing.user.id,
      name: pairing.user.name,
      email: pairing.user.email,
    },
  });
}
