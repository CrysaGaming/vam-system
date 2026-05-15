'use server';

import { z } from 'zod';
import { revalidatePath } from 'next/cache';
import { requireUserWithAirline } from '@/lib/auth';
import {
  acknowledgeIropsEvent,
  type AckResult,
} from '@/lib/irops/dispatcher';

/**
 * Welle P / P4 — Server action: acknowledge an IROP event.
 *
 * Thin wrapper around the dispatcher's `acknowledgeIropsEvent` helper.
 * Adds the user-scope check (pilot must be authenticated) and the
 * dashboard-revalidate so the card refresh picks up the new state.
 *
 * Returns the AckResult discriminated union — the client passes the
 * outcome to router.refresh() on success and silently swallows failure
 * (it's almost always "already acked" or "not yours", both invisible
 * from the pilot's perspective).
 */

const AckSchema = z.object({
  eventId: z.string().cuid(),
});

export async function ackIropsEventAction(
  eventId: string,
): Promise<AckResult> {
  const parsed = AckSchema.parse({ eventId });
  const { id: userId } = await requireUserWithAirline();

  const result = await acknowledgeIropsEvent(parsed.eventId, userId);
  if (result.ok) {
    revalidatePath('/dashboard');
  }
  return result;
}
