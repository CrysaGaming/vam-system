'use server';

import { auth } from '@/auth';
import { revalidatePath } from 'next/cache';
import { joinEvent, leaveEvent } from '@vam/db';

/**
 * Track 1 #7 (Events / Flight-Tours, 9.2.8) — Public signup-actions.
 *
 * Server-actions die von der detail-page (signup-button) aufgerufen
 * werden. Auth-checks: nur eingeloggte user dürfen joinen/leaven.
 *
 * Result-shape: passthrough von db-helpers, plus revalidatePath sodass
 * die page nach action sofort die neue participant-count + button-state
 * rendert.
 */

export type JoinActionResult =
  | { ok: true; wasAlreadyJoined: boolean }
  | {
      ok: false;
      reason: 'unauthorized' | 'event-not-found' | 'event-not-published' | 'event-full' | 'event-ended';
    };

export async function joinEventAction(
  eventId: string,
  slug: string,
): Promise<JoinActionResult> {
  const session = await auth();
  if (!session?.user) return { ok: false, reason: 'unauthorized' };

  const result = await joinEvent(eventId, session.user.id);
  if (!result.ok) {
    return { ok: false, reason: result.reason };
  }

  // Page-level revalidate: detail + catalog (counts ändern sich)
  revalidatePath(`/events/${slug}`);
  revalidatePath('/events');
  return { ok: true, wasAlreadyJoined: result.wasAlreadyJoined };
}

export type LeaveActionResult =
  | { ok: true; wasAlreadyAbsent: boolean }
  | { ok: false; reason: 'unauthorized' };

export async function leaveEventAction(
  eventId: string,
  slug: string,
): Promise<LeaveActionResult> {
  const session = await auth();
  if (!session?.user) return { ok: false, reason: 'unauthorized' };

  const result = await leaveEvent(eventId, session.user.id);
  revalidatePath(`/events/${slug}`);
  revalidatePath('/events');
  return { ok: true, wasAlreadyAbsent: result.wasAlreadyAbsent };
}
