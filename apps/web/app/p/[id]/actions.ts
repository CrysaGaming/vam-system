'use server';

/**
 * Track 5 #13 (Section C) — Follow-Server-Actions.
 *
 * Live in /p/[id] so deep-links sind möglich. Logged-in only.
 * Cross-action revalidation: nach jedem toggle revalidaten wir den
 * target's public-profile-pfad UND den viewer's eigene profile-pfad
 * (damit die "Following X"-count beim viewer aktuell ist).
 */

import { auth } from '@/auth';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import {
  followUser,
  unfollowUser,
  SelfFollowError,
  NotFollowableError,
} from '@vam/db';

async function requireViewerId(): Promise<string> {
  const session = await auth();
  if (!session?.user?.id) redirect('/');
  return session.user.id;
}

export async function followAction(
  targetId: string,
): Promise<{ success: true } | { success: false; error: string }> {
  const viewerId = await requireViewerId();
  try {
    await followUser(viewerId, targetId);
  } catch (e) {
    if (e instanceof SelfFollowError) {
      return { success: false, error: 'self_follow' };
    }
    if (e instanceof NotFollowableError) {
      return { success: false, error: 'not_followable' };
    }
    throw e;
  }
  revalidatePath(`/p/${targetId}`);
  revalidatePath(`/p/${viewerId}`);
  revalidatePath(`/p/${targetId}/followers`);
  revalidatePath(`/p/${viewerId}/following`);
  return { success: true };
}

export async function unfollowAction(
  targetId: string,
): Promise<{ success: true }> {
  const viewerId = await requireViewerId();
  await unfollowUser(viewerId, targetId);
  revalidatePath(`/p/${targetId}`);
  revalidatePath(`/p/${viewerId}`);
  revalidatePath(`/p/${targetId}/followers`);
  revalidatePath(`/p/${viewerId}/following`);
  return { success: true };
}
