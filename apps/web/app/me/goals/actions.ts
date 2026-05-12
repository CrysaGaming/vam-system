'use server';

/**
 * Track 5 #10 — Server-actions für pilot-goals.
 *
 * Thin wrappers um die @vam/db helpers mit auth-check + revalidatePath.
 * Owner-checks passieren in den helpers via {where:{id, userId}}-filter,
 * also kann ein user nicht goals von fremden usern updaten/löschen
 * selbst wenn er die goalId rät.
 */

import { auth } from '@/auth';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import {
  createPilotGoal,
  updatePilotGoal,
  deletePilotGoal,
  type PilotGoalKind,
} from '@vam/db';

const ALLOWED_KINDS: PilotGoalKind[] = [
  'WeeklyFlights',
  'WeeklyHours',
  'MonthlyFlights',
  'MonthlyHours',
];

async function requireUserId(): Promise<string> {
  const session = await auth();
  if (!session?.user?.id) redirect('/');
  return session.user.id;
}

export async function createGoalAction(formData: FormData): Promise<void> {
  const userId = await requireUserId();
  const kind = formData.get('kind') as string;
  const targetStr = formData.get('target') as string;

  if (!ALLOWED_KINDS.includes(kind as PilotGoalKind)) {
    throw new Error('Ungültiger goal-kind.');
  }
  const target = parseInt(targetStr, 10);
  if (!Number.isFinite(target)) {
    throw new Error('Target muss eine ganze zahl sein.');
  }

  await createPilotGoal(userId, kind as PilotGoalKind, target);
  revalidatePath('/me/goals');
}

export async function updateGoalAction(formData: FormData): Promise<void> {
  const userId = await requireUserId();
  const goalId = formData.get('goalId') as string;
  const targetStr = formData.get('target') as string;

  if (!goalId) throw new Error('goalId fehlt.');
  const target = parseInt(targetStr, 10);
  if (!Number.isFinite(target)) {
    throw new Error('Target muss eine ganze zahl sein.');
  }

  await updatePilotGoal(goalId, userId, target);
  revalidatePath('/me/goals');
}

export async function deleteGoalAction(formData: FormData): Promise<void> {
  const userId = await requireUserId();
  const goalId = formData.get('goalId') as string;
  if (!goalId) throw new Error('goalId fehlt.');

  await deletePilotGoal(goalId, userId);
  revalidatePath('/me/goals');
}
