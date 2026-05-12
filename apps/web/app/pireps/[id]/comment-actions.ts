'use server';

/**
 * Track 5 #14 (Section C) — PIREP-Comment server-actions.
 *
 * createCommentAction:  jeder logged-in user
 * updateCommentAction:  owner only, 15-min window
 * deleteCommentAction:  owner only (V1, V2 admin-override)
 *
 * Alle drei revalidieren /pireps/[id] damit die comments-section
 * fresh data lädt.
 */

import { auth } from '@/auth';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import {
  prisma,
  createComment,
  updateComment,
  deleteComment,
  CommentNotFoundError,
  CommentForbiddenError,
  CommentEditWindowClosedError,
  CommentBodyError,
} from '@vam/db';

async function requireUserId(): Promise<string> {
  const session = await auth();
  if (!session?.user?.id) redirect('/');
  return session.user.id;
}

type ActionResult<T = void> =
  | ({ success: true } & (T extends void ? object : { data: T }))
  | { success: false; error: string };

function formatError(e: unknown): string {
  if (e instanceof CommentNotFoundError) return 'Kommentar nicht gefunden.';
  if (e instanceof CommentForbiddenError) return 'Keine Berechtigung.';
  if (e instanceof CommentEditWindowClosedError) return e.message;
  if (e instanceof CommentBodyError) return e.message;
  if (e instanceof Error) return e.message;
  return 'Unbekannter Fehler.';
}

export async function createCommentAction(
  pirepId: string,
  rawBody: string,
): Promise<ActionResult> {
  const userId = await requireUserId();

  // Quick existence check für pirepId — der prisma.create würde sonst
  // bei P2003 (FK violation) einen kryptischen error werfen.
  const pirep = await prisma.pirep.findUnique({
    where: { id: pirepId },
    select: { id: true },
  });
  if (!pirep) return { success: false, error: 'PIREP nicht gefunden.' };

  try {
    await createComment(userId, pirepId, rawBody);
  } catch (e) {
    return { success: false, error: formatError(e) };
  }
  revalidatePath(`/pireps/${pirepId}`);
  return { success: true };
}

export async function updateCommentAction(
  commentId: string,
  pirepId: string,
  rawBody: string,
): Promise<ActionResult> {
  const userId = await requireUserId();
  try {
    await updateComment(commentId, userId, rawBody);
  } catch (e) {
    return { success: false, error: formatError(e) };
  }
  revalidatePath(`/pireps/${pirepId}`);
  return { success: true };
}

export async function deleteCommentAction(
  commentId: string,
  pirepId: string,
): Promise<ActionResult> {
  const userId = await requireUserId();
  try {
    await deleteComment(commentId, userId);
  } catch (e) {
    return { success: false, error: formatError(e) };
  }
  revalidatePath(`/pireps/${pirepId}`);
  return { success: true };
}
