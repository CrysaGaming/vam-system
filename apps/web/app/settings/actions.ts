'use server';

import { auth } from '@/auth';
import { prisma } from '@vam/db';
import { revalidatePath } from 'next/cache';
import { randomBytes } from 'crypto';
import { z } from 'zod';

/**
 * Generiert einen kryptographisch sicheren Token für OBS-Overlays.
 * Format: 32 Zeichen, hex (16 Bytes Random Entropie).
 */
function generateOverlayToken(): string {
  return randomBytes(16).toString('hex');
}

/**
 * Holt den OBS-Overlay-Token des aktuellen Users.
 * Generiert einen neuen, falls noch keiner existiert (lazy creation).
 */
export async function getOrCreateOverlayToken(): Promise<string> {
  const session = await auth();
  if (!session?.user) {
    throw new Error('Unauthorized');
  }

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { overlayToken: true },
  });

  if (!user) {
    throw new Error('User nicht gefunden');
  }

  if (user.overlayToken) {
    return user.overlayToken;
  }

  // Lazy creation: Token erst beim ersten Aufruf generieren
  const newToken = generateOverlayToken();
  await prisma.user.update({
    where: { id: session.user.id },
    data: { overlayToken: newToken },
  });

  return newToken;
}

/**
 * Rotiert den OBS-Overlay-Token (z.B. wenn er geleakt wurde).
 * Alter Token wird ungültig, neuer wird generiert.
 */
export async function rotateOverlayToken(): Promise<string> {
  const session = await auth();
  if (!session?.user) {
    throw new Error('Unauthorized');
  }

  const newToken = generateOverlayToken();
  await prisma.user.update({
    where: { id: session.user.id },
    data: { overlayToken: newToken },
  });

  revalidatePath('/settings');

  return newToken;
}

const SetSimBriefUsernameSchema = z.object({
  username: z.string().nullable(),
});

export async function setSimBriefUsername(
  input: z.infer<typeof SetSimBriefUsernameSchema>,
): Promise<{ success: true } | { success: false; error: string }> {
  const session = await auth();
  if (!session?.user?.id) {
    return { success: false, error: 'unauthorized' };
  }

  const parsed = SetSimBriefUsernameSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, error: 'invalid_input' };
  }

  const raw = parsed.data.username;
  const trimmed = raw === null ? null : raw.trim();
  const normalized =
    trimmed === null || trimmed.length === 0 ? null : trimmed;

  if (normalized !== null) {
    if (normalized.length > 50) {
      return { success: false, error: 'too_long' };
    }
    if (!/^[a-zA-Z0-9_.-]+$/.test(normalized)) {
      return { success: false, error: 'invalid_format' };
    }
  }

  await prisma.user.update({
    where: { id: session.user.id },
    data: { simBriefUsername: normalized },
  });

  revalidatePath('/settings');

  return { success: true };
}