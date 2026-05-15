'use server';

/**
 * Welle N / N4 — Garmin token server actions.
 */

import { prisma } from '@vam/db';
import { revalidatePath } from 'next/cache';
import { auth } from '@/auth';
import { generateToken } from '@/lib/garmin/token';

export type GarminTokenActionResult =
  | { ok: true; plainToken?: string; message?: string }
  | { ok: false; error: string };

const LABEL_MAX = 60;
const MAX_TOKENS_PER_USER = 10;

export async function createGarminTokenAction(input: {
  label: string;
}): Promise<GarminTokenActionResult> {
  const session = await auth();
  if (!session?.user?.id) {
    return { ok: false, error: 'Nicht eingeloggt.' };
  }
  const userId = session.user.id;

  const label = input.label.trim();
  if (label.length < 1 || label.length > LABEL_MAX) {
    return { ok: false, error: `Label 1-${LABEL_MAX} chars erforderlich.` };
  }

  // Hard ceiling so a runaway script can't fill the table for one user.
  const existing = await prisma.garminApiToken.count({
    where: { userId, revokedAt: null },
  });
  if (existing >= MAX_TOKENS_PER_USER) {
    return {
      ok: false,
      error: `Max ${MAX_TOKENS_PER_USER} aktive tokens. Revoke einen alten.`,
    };
  }

  const { plain, hash, suffix } = generateToken();

  await prisma.garminApiToken.create({
    data: {
      userId,
      tokenHash: hash,
      tokenSuffix: suffix,
      label,
    },
  });

  revalidatePath('/settings/garmin');

  return {
    ok: true,
    plainToken: plain,
    message:
      'Token erstellt. Kopiere ihn jetzt — du siehst ihn nie wieder!',
  };
}

export async function revokeGarminTokenAction(input: {
  tokenId: string;
}): Promise<GarminTokenActionResult> {
  const session = await auth();
  if (!session?.user?.id) {
    return { ok: false, error: 'Nicht eingeloggt.' };
  }
  const userId = session.user.id;

  // updateMany scoped to userId — verhindert dass jemand fremde tokens
  // revoken kann selbst wenn er die tokenId rät.
  const res = await prisma.garminApiToken.updateMany({
    where: { id: input.tokenId, userId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
  if (res.count === 0) {
    return { ok: false, error: 'Token nicht gefunden oder schon revoked.' };
  }

  revalidatePath('/settings/garmin');
  return { ok: true, message: 'Token revoked.' };
}
