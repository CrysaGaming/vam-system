'use server';

import { auth } from '@/auth';
import { prisma } from '@vam/db';
import { revalidatePath } from 'next/cache';

/**
 * Track 4 #59 (Section K): Server-action zum setzen/clearen des
 * annualHourGoal feldes auf User.
 *
 * Authorization: pilot kann nur sein eigenes ziel setzen — userId-param
 * muss zur session.user.id passen, sonst error. Bewusst kein admin-
 * override-pfad in #59 (annual goals sind explizit ein self-help-feature,
 * nicht admin-mandated).
 *
 * Validation:
 *   - hours=null: clear-action (pilot entfernt sein ziel)
 *   - hours=int 10..2000: gültiger range
 *   - sonst: throw
 *
 * revalidatePath('/dashboard') triggert next/cache invalidation damit der
 * goal-card nach dem save den frischen state vom server hat.
 */
export async function saveAnnualHourGoal(
  userId: string,
  hours: number | null,
): Promise<void> {
  const session = await auth();
  if (!session?.user?.id) {
    throw new Error('Nicht eingeloggt.');
  }
  if (session.user.id !== userId) {
    throw new Error('Du kannst nur dein eigenes ziel setzen.');
  }

  if (hours !== null) {
    if (!Number.isInteger(hours) || hours < 10 || hours > 2000) {
      throw new Error('Ziel muss eine ganze zahl zwischen 10 und 2000 sein.');
    }
  }

  await prisma.user.update({
    where: { id: userId },
    data: { annualHourGoal: hours },
  });

  revalidatePath('/dashboard');
}
