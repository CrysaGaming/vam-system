'use server';

/**
 * Welle N / N5 — Embed token server actions.
 *
 * Different from /settings/garmin in two ways:
 *
 *   - The plain token is *always* visible in the list (not "reveal-
 *     once"), because it has to go in URLs that the user shares — and
 *     re-issuing a token would break every embed they've already pasted
 *     somewhere.
 *   - There's no hash. The token IS public-ish by design (URL-visible).
 *     Re-displaying it later is fine.
 */

import { prisma } from '@vam/db';
import { revalidatePath } from 'next/cache';
import { auth } from '@/auth';
import { generateEmbedToken } from '@/lib/embed/token';

export type EmbedTokenActionResult =
  | { ok: true; message?: string }
  | { ok: false; error: string };

const LABEL_MAX = 60;
const MAX_TOKENS_PER_USER = 20;

export async function createEmbedTokenAction(input: {
  label: string;
}): Promise<EmbedTokenActionResult> {
  const session = await auth();
  if (!session?.user?.id) {
    return { ok: false, error: 'Nicht eingeloggt.' };
  }
  const userId = session.user.id;

  const label = input.label.trim();
  if (label.length < 1 || label.length > LABEL_MAX) {
    return { ok: false, error: `Label 1-${LABEL_MAX} chars erforderlich.` };
  }

  const existing = await prisma.embedToken.count({
    where: { userId, revokedAt: null },
  });
  if (existing >= MAX_TOKENS_PER_USER) {
    return {
      ok: false,
      error: `Max ${MAX_TOKENS_PER_USER} aktive tokens. Revoke einen alten.`,
    };
  }

  // Retry-loop für den extrem unwahrscheinlichen fall einer collision
  // auf tokenString @unique. 3 versuche reichen — die kollision-
  // wahrscheinlichkeit ist 2^-64 nach geburtstags-paradoxon mit dem
  // aktuellen tabellen-bestand.
  let lastError: unknown = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const tokenString = generateEmbedToken();
      await prisma.embedToken.create({
        data: { userId, tokenString, label },
      });
      revalidatePath('/settings/embeds');
      return { ok: true, message: `Token "${label}" erstellt.` };
    } catch (e) {
      lastError = e;
    }
  }
  console.error('createEmbedTokenAction: 3× collision', lastError);
  return { ok: false, error: 'Token-erstellung fehlgeschlagen.' };
}

export async function revokeEmbedTokenAction(input: {
  tokenId: string;
}): Promise<EmbedTokenActionResult> {
  const session = await auth();
  if (!session?.user?.id) {
    return { ok: false, error: 'Nicht eingeloggt.' };
  }
  const userId = session.user.id;

  const res = await prisma.embedToken.updateMany({
    where: { id: input.tokenId, userId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
  if (res.count === 0) {
    return { ok: false, error: 'Token nicht gefunden oder schon revoked.' };
  }

  revalidatePath('/settings/embeds');
  return { ok: true, message: 'Token revoked.' };
}
